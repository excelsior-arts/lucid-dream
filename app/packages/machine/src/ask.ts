/* One question to the language model, answered as a thing rather than as prose.
 *
 * A reply is words, streamed, and the page reads them as they come. This is
 * the other kind of call: a small prompt, one JSON object back, no streaming
 * anybody watches -- what a game asks when it wants a *decision* out of the
 * model rather than a line. What a district is called and what shape the
 * ground takes there; what a standing form on the way is made of; whether a
 * run of five things picked up is worth a remark. Small questions, many of
 * them, and every one of them wants the same three things done to the answer:
 * find the JSON in it, check it, and ask once more if it was no good.
 *
 * The machine is not changed for this. The chat route streams words, and a
 * JSON object is words; asking for one is a matter of how the question is put,
 * and reading it is a matter of patience with what a model wraps an answer
 * in -- a fence, a preamble, a stray comma before the closing brace. The
 * bigger the model the less of that there is, and the smaller the model the
 * more of what it answers is dropped at the reader; that difference is not
 * hidden here and is not meant to be. What comes back says which it was.
 *
 * Nothing here knows what is being asked for. `read` is the caller's: it is
 * handed the parsed object and either returns the thing or throws a reason,
 * and the reason is what the retry tells the model.
 */
import {streamChat} from './chat';
import type {Message} from './chat';

export interface AskOptions<T> {
  /** Who is answering, and what it knows. The cached front of the prompt. */
  system: string;
  /** The question, with the shape of the answer described in it. */
  user: string;
  /** Take the parsed JSON and make the thing of it, or throw why not. A
      thrown string is what the model is told on the second try, so it is
      worth writing for a reader: "amplitude must be a number of metres". */
  read: (json: unknown) => T;
  /** How much of an answer is worth waiting for. A decision is short. */
  max_tokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** One more go, with the reason, when the first answer would not read.
      On by default; a caller with a fallback in hand may prefer speed. */
  retry?: boolean;
}

export interface Asked<T> {
  ok: boolean;
  /** The thing, when `ok`. */
  value?: T;
  /** What the model actually said, last time it was asked. */
  raw: string;
  /** Why the answer was refused, when it was. */
  why?: string;
  /** How many times the model was asked: 1, or 2 after a retry. */
  tries: number;
  /** Wall-clock milliseconds, all tries. */
  ms: number;
}

/* How the model is told what an answer looks like. Appended to the question
   rather than to the system prompt, so the front of the prompt -- which the
   server keeps cached across calls -- stays the caller's and does not change
   between one kind of question and the next. */
const ONLY_JSON =
  '\n\nAnswer with one JSON object and nothing else: no words before it, none after, no code fence.';

/** Ask, read, and once if need be, ask again. Never throws for a bad answer;
    a network or a machine failure is still thrown, since there is no answer
    at all to read. An aborted call is reported as not ok. */
export async function ask<T>(o: AskOptions<T>): Promise<Asked<T>> {
  const began = now();
  const messages: Message[] = [
    {role: 'system', content: o.system},
    {role: 'user', content: o.user + ONLY_JSON},
  ];
  let raw = '';
  let why = '';
  const most = o.retry === false ? 1 : 2;
  for (let tries = 1; tries <= most; tries++) {
    raw = '';
    try {
      for await (const delta of streamChat({
        messages,
        max_tokens: o.max_tokens ?? 400,
        temperature: o.temperature,
        signal: o.signal,
      })) raw += delta;
    } catch (e) {
      /* Whoever stopped it may have said why -- the mind's reasons are
         words -- and the word is worth more to a console than "stopped". */
      if (o.signal?.aborted) {
        const reason = o.signal.reason;
        return {ok: false, raw, why: typeof reason === 'string' && reason ? reason : 'stopped',
                tries, ms: now() - began};
      }
      throw e;
    }
    const found = findJson(raw);
    if (found === null) {
      why = 'no JSON object in the answer';
    } else {
      let json: unknown;
      try {
        json = JSON.parse(found);
      } catch {
        json = undefined;
        why = 'the JSON would not parse';
      }
      if (json !== undefined) {
        try {
          return {ok: true, value: o.read(json), raw, tries, ms: now() - began};
        } catch (e) {
          why = e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (tries < most) {
      /* The model is shown its own answer and what was wrong with it, which
         is the one correction a model reliably takes. The schema is not
         repeated: it is still in the question above. */
      messages.push({role: 'assistant', content: raw});
      messages.push({role: 'user', content:
        'That was not usable: ' + why + '. Answer the question again, as one JSON object only.'});
    }
  }
  return {ok: false, raw, why, tries: most, ms: now() - began};
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The JSON in what a model said, or null.
 *
 * Models wrap. A code fence around it, "Here is the object:" before it, a
 * thinking block a server did not strip, a sentence after. The object is
 * the first `{` that closes -- braces counted, strings and their escapes
 * skipped over, so a brace inside a name does not end it early. And one
 * repair, because it is the one small models make most: a comma before a
 * closing bracket is removed. Nothing else is fixed; a broken answer is
 * better refused than guessed at, since the caller has a fallback and the
 * model has a second try.
 */
export function findJson(text: string): string | null {
  let s = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  s = s.replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1');
    }
  }
  return null;
}

/* ---- small readers, for the callers' `read` ------------------------------- */

/** A number in bounds, or the reason it is not. `name` is what the model is
    told; the value is clamped rather than refused when `clamp` is set, since
    a hill one metre taller than allowed is a hill and not a mistake. */
export function num(
  v: unknown, name: string, lo: number, hi: number, clamp = true,
): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`${name} must be a number between ${lo} and ${hi}`);
  }
  if (n < lo || n > hi) {
    if (!clamp) throw new Error(`${name} must be between ${lo} and ${hi}`);
    return Math.min(hi, Math.max(lo, n));
  }
  return n;
}

/** A word from a list, matched loosely: case, and a plural or a hyphen the
    model added, are not reasons to throw away a whole answer. */
export function word<W extends string>(v: unknown, name: string, allowed: readonly W[]): W {
  const s = String(v ?? '').trim().toLowerCase().replace(/[-_]/g, ' ');
  for (const w of allowed) {
    const ww = w.toLowerCase();
    if (s === ww || s === ww + 's' || s.startsWith(ww + ' ') || s.endsWith(' ' + ww)
        || ww.startsWith(s + ' ')) return w;
  }
  throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
}

/** A line of text, trimmed and cut to length. Empty is allowed when `may`. */
export function line(v: unknown, name: string, most: number, may = false): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!s && !may) throw new Error(`${name} must be a short line of text`);
  return s.length > most ? s.slice(0, most - 1).replace(/\s+\S*$/, '') + '…' : s;
}

/** A colour as `#rrggbb`, from whatever a model writes one as. */
export function colour(v: unknown, name: string): string {
  const s = String(v ?? '').trim().toLowerCase();
  const m = /^#?([0-9a-f]{6})$/.exec(s) ?? /^#?([0-9a-f]{3})$/.exec(s);
  if (!m) throw new Error(`${name} must be a hex colour like #8a5c3b`);
  const h = m[1]!;
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
}

/** A list of at most `most` things, each read by `each`; one that will not
    read is dropped and named in `dropped` rather than failing the whole. */
export function list<T>(
  v: unknown, name: string, most: number, each: (item: unknown, i: number) => T,
): {kept: T[]; dropped: string[]} {
  const kept: T[] = [];
  const dropped: string[] = [];
  const items = Array.isArray(v) ? v : v == null ? [] : [v];
  for (let i = 0; i < items.length; i++) {
    if (kept.length >= most) {
      dropped.push(`${name}[${i}]: more than ${most}`);
      continue;
    }
    try {
      kept.push(each(items[i], i));
    } catch (e) {
      dropped.push(`${name}[${i}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {kept, dropped};
}
