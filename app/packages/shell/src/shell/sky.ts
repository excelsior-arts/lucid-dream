/* The sky. A canvas behind everything, and the only thing here that is not DOM.

   Three things it must not do: heat the machine that is running three models,
   keep drawing when nobody is looking, or move at all for somebody who has
   asked motion to stop. So: device pixels capped at 2, the loop stops with the
   page, and reduced motion draws one still frame and returns.

   Stars are drawn in three depths and the near ones lag the pointer. That
   parallax is the whole illusion — a flat field of dots reads as wallpaper,
   and the same dots at three speeds read as distance. */

interface Layer {n: number; r: number; a: number; drift: number; par: number}
interface Star {x: number; y: number; depth: number; phase: number; warm: boolean}

const LAYERS: Layer[] = [
  {n: 90, r: 0.7, a: 0.35, drift: 0.004, par: 4},   // far
  {n: 45, r: 1.1, a: 0.55, drift: 0.010, par: 11},
  {n: 16, r: 1.7, a: 0.85, drift: 0.020, par: 22},  // near, and the ones
];                                                  // that actually twinkle

/** Draws until the returned stop is called. */
export function startSky(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let stars: Star[] = [], w = 0, h = 0, dpr = 1;
  let px = 0, py = 0, tx = 0, ty = 0;   // pointer, smoothed

  const seed = () => {
    stars = [];
    LAYERS.forEach((L, depth) => {
      for (let i = 0; i < L.n; i++) {
        stars.push({
          x: Math.random(), y: Math.random(), depth,
          // A phase per star, so the twinkle never pulses in unison.
          phase: Math.random() * Math.PI * 2,
          warm: Math.random() < 0.18,   // a few embers among the cold ones
        });
      }
    });
  };

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (t: number) => {
    ctx.clearRect(0, 0, w, h);

    // Two soft clouds of light, one warm and low, one cold and high. Cheap
    // depth: without them the field is stars on flat paint.
    const neb = (cx: number, cy: number, rad: number, rgb: string, alpha: number) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${rgb},${alpha})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    };
    neb(w * 0.5, h * 0.28, Math.max(w, h) * 0.55, '201,138,60', 0.07);
    neb(w * 0.12, h * 0.85, Math.max(w, h) * 0.45, '90,130,190', 0.05);

    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    for (const s of stars) {
      const L = LAYERS[s.depth]!;
      // Wrap rather than respawn: the field is infinite and costs nothing.
      const x = ((s.x + t * L.drift * 0.00004) % 1) * w + px * L.par;
      const y = s.y * h + py * L.par;
      const tw = still ? 1 : 0.65 + 0.35 * Math.sin(t * 0.0013 + s.phase);
      ctx.globalAlpha = L.a * tw;
      ctx.fillStyle = s.warm ? '#e6c07a' : '#cfe0f2';
      ctx.beginPath(); ctx.arc(x, y, L.r * (s.warm ? 1.15 : 1), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  let raf: number | null = null;
  const frame = (t: number) => { draw(t); raf = requestAnimationFrame(frame); };
  const start = () => { if (!raf && !still) raf = requestAnimationFrame(frame); };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };

  const onResize = () => { resize(); seed(); draw(0); };
  const onVisible = () => (document.hidden ? stop() : start());
  // Only where there is a pointer to follow. On a touch screen every tap is a
  // pointermove, so the box took a lean from wherever your thumb landed and
  // kept it — which reads as the box leaning against the side of the window.
  const hasPointer = matchMedia('(hover: hover)').matches;
  const onPointer = (e: PointerEvent) => {
    tx = (e.clientX / innerWidth - 0.5) * -1;
    ty = (e.clientY / innerHeight - 0.5) * -1;
    if (!hasPointer) return;                 // the sky still drifts; the room does not
    document.documentElement.style.setProperty('--lean-x', (ty * 5).toFixed(2));
    document.documentElement.style.setProperty('--lean-y', (tx * -6).toFixed(2));
  };

  addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('pointermove', onPointer, {passive: true});

  resize(); seed(); draw(0); start();

  return () => {
    stop();
    removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('pointermove', onPointer);
  };
}
