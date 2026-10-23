/* A .zip, written and read, with nothing but the browser.
 *
 * Small on purpose: what goes in is a few hundred text files, so they are
 * stored rather than squeezed, and the one thing a reader has to cope with
 * that this writer never does is deflate -- which is what Finder's
 * Compress, `zip -r` and every other zip a person makes on a Mac uses. The
 * browser inflates it (DecompressionStream, 'deflate-raw'). No ZIP64, no
 * encryption, no spanning: a userdata/ that needs any of those is not one a
 * page should be swallowing whole.
 */

export interface ZipFile {
  /** The path inside the archive, with forward slashes. */
  name: string;
  data: Uint8Array;
  /** When it was last written, in seconds; now if not said. */
  at?: number;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A DOS date and time, which is what a zip keeps. */
function dos(at: number): {time: number; date: number} {
  const d = new Date(at * 1000);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** The archive, every file stored. */
export function zip(files: readonly ZipFile[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const {time, date} = dos(f.at ?? Date.now() / 1000);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);              // the name is UTF-8
    head.setUint16(8, 0, true);                   // stored
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 0x0314, true);               // made on Unix, version 2.0
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(38, (0o100644 << 16) >>> 0, true);   // a plain file, rw-r--r--
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as Uint8Array<ArrayBuffer>).body!
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in an archive, by its central directory. Directories are left
    out; a file stored or deflated is read, anything else is refused. */
export async function unzip(bytes: Uint8Array): Promise<ZipFile[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip: no end of central directory');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out: ZipFile[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('not a zip: a damaged directory');
    const method = v.getUint16(at + 10, true);
    const time = v.getUint16(at + 12, true);
    const date = v.getUint16(at + 14, true);
    const packed = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const noteLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + noteLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + packed);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compressed in a way this does not read`);
    const data = method === 0 ? raw.slice() : await inflate(raw);
    const when = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31,
                          time >> 11, (time >> 5) & 63, (time & 31) * 2);
    out.push({name, data, at: when.getTime() / 1000});
  }
  return out;
}
