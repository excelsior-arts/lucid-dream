/* The sky. A canvas behind everything, and the only thing here that is not DOM.

   Three things it must not do: heat the machine that is running three models,
   keep drawing when nobody is looking, or move at all for somebody who has
   asked motion to stop. So: device pixels capped at 2, the loop stops with the
   page, and reduced motion draws one still frame and returns.

   Stars are drawn in three depths and the near ones lag the pointer. That
   parallax is the whole illusion — a flat field of dots reads as wallpaper,
   and the same dots at three speeds read as distance. */
(() => {
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const LAYERS = [
    {n: 90, r: 0.7, a: 0.35, drift: 0.004, par: 4},   // far
    {n: 45, r: 1.1, a: 0.55, drift: 0.010, par: 11},
    {n: 16, r: 1.7, a: 0.85, drift: 0.020, par: 22},  // near, and the ones
  ];                                                  // that actually twinkle
  let stars = [], w = 0, h = 0, dpr = 1;
  let px = 0, py = 0, tx = 0, ty = 0;   // pointer, smoothed

  function seed() {
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
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);

    // Two soft clouds of light, one warm and low, one cold and high. Cheap
    // depth: without them the field is stars on flat paint.
    const neb = (cx, cy, rad, rgb, alpha) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${rgb},${alpha})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    };
    neb(w * 0.5, h * 0.28, Math.max(w, h) * 0.55, '201,138,60', 0.07);
    neb(w * 0.12, h * 0.85, Math.max(w, h) * 0.45, '90,130,190', 0.05);

    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    for (const s of stars) {
      const L = LAYERS[s.depth];
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
  }

  let raf = null;
  const frame = t => { draw(t); raf = requestAnimationFrame(frame); };
  const start = () => { if (!raf && !still) raf = requestAnimationFrame(frame); };
  const stop = () => { if (raf) cancelAnimationFrame(raf), raf = null; };

  addEventListener('resize', () => { resize(); seed(); draw(0); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  // Only where there is a pointer to follow. On a touch screen every tap is a
  // pointermove, so the box took a lean from wherever your thumb landed and
  // kept it — which reads as the box leaning against the side of the window.
  const hasPointer = matchMedia('(hover: hover)').matches;
  addEventListener('pointermove', e => {
    tx = (e.clientX / innerWidth - 0.5) * -1;
    ty = (e.clientY / innerHeight - 0.5) * -1;
    if (!hasPointer) return;                 // the sky still drifts; the room does not
    document.documentElement.style.setProperty('--lean-x', (ty * 5).toFixed(2));
    document.documentElement.style.setProperty('--lean-y', (tx * -6).toFixed(2));
  }, {passive: true});

  resize(); seed(); draw(0); start();
})();

/* ---------------------------------------------------------------------------
   The corners.

   Three controls, in three corners, on every screen: what you can hear, how to
   put this in your pocket, and the fact that none of it leaves the room. Built
   here rather than written into each page, because three copies of a control
   is three copies of a bug.

   The sounds matter more than they look like they do. This app is worth
   nothing on mute — it is a voice — and the surest way to tell somebody their
   speakers are live, without a dialog, is for the lid to make a sound when it
   opens. It also sets the level: if the latch is comfortable, it will be too.
--------------------------------------------------------------------------- */
(() => {
  const KEY = 'lucid:volume', CALM_KEY = 'lucid:calm';
  const read = () => { try { const v = localStorage.getItem(KEY); return v === null ? 0.7 : +v; } catch { return 0.7; } };
  const write = v => { try { localStorage.setItem(KEY, String(v)); } catch {} };
  const readCalm = () => { try { return localStorage.getItem(CALM_KEY) === '1'; } catch { return false; } };
  /* Hush is not a volume. It is the answer to "not now" — somebody else in
     the room, a phone call, a sleeping child — and it has to cover the one
     sound this program makes that a volume slider does not: the pill's own
     voice, which is played by the app through an audio element and has never
     been the shell's to turn down. So the shell keeps the switch and the app
     reads it. */
  const HUSH_KEY = 'lucid:hush';
  const readHush = () => { try { return localStorage.getItem(HUSH_KEY) === '1'; } catch { return false; } };
  const writeHush = (v) => { try { localStorage.setItem(HUSH_KEY, v ? '1' : '0'); } catch {} };
  const writeCalm = v => { try { localStorage.setItem(CALM_KEY, v ? '1' : '0'); } catch {} };

  // How far the interface steps back when asked to be calm.
  //
  // These are fixed numbers, set by ear, and that is deliberate: I tried
  // levelling the interface automatically against the measured loudness of the
  // voice, and it asked for fifteen times the gain. A 50ms click and half a
  // second of speech cannot be compared by average level — the click's energy
  // is concentrated where your ear is most alert to it, and its average is
  // almost nothing. Now that the voice is normalized to a known loudness
  // before it plays, one constant per sound is both simpler and truer.
  const CALM = 0.35;

  // ---- the instrument ------------------------------------------------------
  // Every sound in the interface is made here, out of an oscillator and a
  // little noise. No files: nothing to download, nothing to license, and a
  // sound can be retuned in one line instead of re-recorded.
  const Sound = {
    ctx: null, master: null, ui: null, level: read(), calm: readCalm(),
    hush: readHush(),

    // Browsers refuse to make a sound before you have touched the page, and are
    // right to. Safari is the strict one: the context has to be *built* inside
    // a real gesture, not merely resumed in one. Built on a hover instead, it
    // comes up suspended, its clock never starts, and every sound scheduled
    // against that clock is silently thrown away — which is exactly what a
    // page that works in Chrome and is mute in Safari looks like.
    //
    // So: nothing before the first press, and no sound at all until the
    // context actually reports itself running.
    wake(gesture) {
      if (!this.ctx) {
        if (!gesture) return null;                 // not yet; a hover is not a press
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        /* iOS routes WebAudio to the "ambient" channel, which the ring/silent
           switch on the side of the phone kills — while its voice, played from
           an <audio> element, goes out on the media channel and ignores that
           switch. So on a silenced phone it talks and the interface is mute,
           which reads as broken. Asking for the playback session puts both on
           the same channel. Ignored by browsers that have never heard of it.

           Never downgraded, though. `playback` is a category a microphone
           cannot be opened in: Safari refuses with InvalidStateError and the
           words "AudioSession category is not compatible with audio capture",
           which is the only clue anywhere. An app that is listening has
           already asked for `play-and-record`, which covers this just as well
           — it is the same media channel with a microphone attached — and
           taking that away to gain nothing costs the microphone. */
        try {
          const s = navigator.audioSession;
          if (s && s.type !== 'play-and-record') s.type = 'playback';
        } catch (e) { /* not available; the switch wins, and that is survivable */ }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.level;
        this.master.connect(this.ctx.destination);
        // Everything the interface makes goes through here first, so it can be
        // pulled back without touching the level the voice plays at.
        this.ui = this.ctx.createGain();
        this.ui.gain.value = this.calm ? CALM : 1;
        this.ui.connect(this.master);
        // WebKit wants something actually played inside the gesture before it
        // considers the context unlocked. One silent frame does it.
        const s = this.ctx.createBufferSource();
        s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        s.connect(this.master);
        s.start(0);
      }
      if (this.ctx.state !== 'running') {
        if (gesture) this.ctx.resume();
        return this.ctx.state === 'running' ? this.ctx : null;
      }
      return this.ctx;
    },

    setCalm(on) {
      this.calm = !!on;
      writeCalm(this.calm);
      if (this.ui) this.ui.gain.value = this.calm ? CALM : 1;
    },

    setHush(on) {
      this.hush = !!on;
      writeHush(this.hush);
      if (this.master) this.master.gain.value = this.hush ? 0 : this.level;
      // Said out loud, because the thing most affected by it is not here: the
      // voice belongs to whichever app is open, and it listens for this.
      document.dispatchEvent(new CustomEvent('lucid:hush', {detail: this.hush}));
    },

    setLevel(v) {
      this.level = Math.max(0, Math.min(1, v));
      write(this.level);
      if (this.master) this.master.gain.value = this.hush ? 0 : this.level;
      // Anything else that makes noise — its voice, on the talk page — reads
      // this rather than keeping its own idea of loud.
      document.dispatchEvent(new CustomEvent('lucid:volume', {detail: this.level}));
    },

    // A struck sound: a body, a click of noise on the front of it, and a decay.
    strike({freq = 420, noise = 0.35, decay = 0.09, gain = 0.5, type = 'triangle'} = {}) {
      const ctx = this.wake();
      if (!ctx || !this.level || this.hush) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      g.connect(this.ui);

      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.55), t + decay);
      osc.connect(g); osc.start(t); osc.stop(t + decay + 0.02);

      if (noise > 0) {
        const n = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        n.buffer = buf;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(noise * gain, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1200;
        n.connect(hp); hp.connect(ng); ng.connect(this.ui);
        n.start(t);
      }
    },

    // Moving air, for anything that opens or carries you somewhere. Brown
    // noise rather than white — white hisses, brown breathes — swept through
    // a bandpass that rises and falls. A struck sound was wrong here: a lid
    // going back is a movement, and a low sine reads as a drum.
    whoosh({dur = 0.95, peak = 0.5} = {}) {
      const ctx = this.wake();
      if (!ctx || !this.level || this.hush) return;
      const t = ctx.currentTime;
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0, loudest = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.021 * white) / 1.021;      // integrate: brown noise
        d[i] = last;
        if (Math.abs(last) > loudest) loudest = Math.abs(last);
      }
      // Normalized, because integrated noise comes out at whatever level it
      // happens to reach and the bandpass then takes most of that away.
      const lift = loudest ? 1 / loudest : 1;
      for (let i = 0; i < len; i++) d[i] *= lift;
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.8;
      band.frequency.setValueAtTime(260, t);
      band.frequency.exponentialRampToValueAtTime(1400, t + dur * 0.42);
      band.frequency.exponentialRampToValueAtTime(380, t + dur);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.36);   // swells
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);        // and goes

      src.connect(band); band.connect(g); g.connect(this.ui);
      src.start(t); src.stop(t + dur + 0.05);
    },

    // All of these sit deliberately low. A click is a sharp transient and a
    // voice is sustained, so matching them by number leaves the interface
    // shouting over the thing you are here to listen to — which is what
    // happened: at equal gain the ticks read as much louder than it does.
    tick()  { this.strike({freq: 520, noise: 0.5, decay: 0.05, gain: 0.16}); },

    /* ---- something is coming ----------------------------------------------
     *
     * A soft pulse, quickening. It covers the gap between a reply appearing
     * as text and the same reply arriving as a voice — which on the first
     * turn of an evening is the length of time it takes to load a speech
     * model, and is spent watching words scroll past in silence with no way
     * to tell whether the sound is broken or merely late.
     *
     * Two things make it not an alarm. It starts a beat late, so an ordinary
     * turn — where the voice is a moment behind the text — never plays it at
     * all and this is only ever heard when there is genuinely something to
     * wait for. And it accelerates, which is the part that says *arriving*
     * rather than *waiting*: a metronome is a wait, a quickening is an
     * approach. Low, short, and under the words either way.
     */
    HOLD: 1100,          // silence first: a short gap is not worth announcing
    FROM: 620,           // the first beat after it, and then sooner and sooner
    TO: 210,
    waiting(on) {
      if (!on) {
        clearTimeout(this._pulse);
        this._pulse = this._gap = null;
        this._done = false;                      // whatever it was waiting for, that is over
        return;
      }
      /* Already saying so — or already given up. The deck asks for this five
         times a second while a reply is pending, so having stopped is a state
         it has to keep: without it, the beat that gave up simply started
         again on the next ask, and the twenty-beat limit turned into twenty
         beats, a pause, and twenty more, all evening. */
      if (this._pulse || this._done) return;
      this._gap = this.FROM;
      this._beats = 0;
      const beat = (first) => {
        if (!first) {
          // And it gives up. Past this the voice is not late, it is not
          // coming — a machine with no speech model loaded, a synthesiser
          // that died — and a sound that means "any moment now" is a lie
          // after twenty of them. The console is where that gets explained.
          if (++this._beats > 20) { this._pulse = null; this._done = true; return; }
          // Quietly at first and a little brighter as it closes, the way
          // something approaching sounds.
          const near = (this.FROM - this._gap) / (this.FROM - this.TO);
          this.strike({freq: 150 + near * 60, noise: 0.12, decay: 0.16,
                       gain: 0.05 + near * 0.03, type: 'sine'});
          this._gap = Math.max(this.TO, this._gap * 0.86);
        }
        this._pulse = setTimeout(beat, first ? this.HOLD : this._gap);
      };
      beat(true);
    },

    latch() { this.strike({freq: 300, noise: 0.7, decay: 0.12, gain: 0.3});
              setTimeout(() => this.strike({freq: 880, noise: 0.2, decay: 0.07, gain: 0.13}), 55); },
    hover() { this.strike({freq: 1250, noise: 0.15, decay: 0.03, gain: 0.045, type: 'sine'}); },
  };
  window.Lucid = Object.assign(window.Lucid || {}, {sound: Sound});

  /* Where the open box goes.
   *
   * Three rules, and they are the whole thing:
   *
   *   1. Leave a real gap at every edge. A box pressed against the sides of a
   *      phone looks like a mistake, not an object.
   *   2. Put the hinge — the fold where the lid meets the tray — on the middle
   *      line of the window. It is the one landmark both halves share, and
   *      anchoring it means the lid always has the top half and the tray the
   *      bottom, at every size and in either orientation. Centering the whole
   *      bounding box instead let the fold drift wherever the lid's height
   *      happened to put it.
   *   3. Size so both halves fit in their own half, not so the total fits
   *      somewhere.
   *
   * Everything is measured rather than modeled, because perspective is not
   * linear: scaling the box by z magnifies the standing lid by more than z,
   * and a translate inside the perspective moves the object further than it
   * says. Both are closed in on with a few damped passes — which is short,
   * exact, and does not care which browser is doing the projecting.
   */
  window.Lucid.fitOpenBox = (caseEl, roomEl, openWith) => {
    const box = caseEl && caseEl.querySelector('.box');
    const lid = caseEl && caseEl.querySelector('.lid');
    if (!box || !lid || !roomEl) return;

    const primed = caseEl.classList.contains('priming');
    const opened = openWith && !caseEl.classList.contains(openWith);
    caseEl.classList.add('priming');           // nothing animates while we work

    /* How far the browser is zoomed in. The window's own width is in screen
       pixels and the viewport's is in the page's, so the ratio between them is
       the zoom and nothing else. It is not exact to the pixel — a scrollbar or
       a docked inspector is inside one and not the other — but it is used for
       one thing only, a type size, where a percent either way is invisible.

       Nothing about the geometry is allowed to depend on it. The note below
       says why: fitting the box to anything but the window it is actually in
       ends the opening animation somewhere the freshly loaded next page does
       not agree with, and the box has to be the same object on both pages.

       A browser that will not tell — iOS reports the two as equal — comes out
       at 1, which is the truth there: that page cannot be zoomed. */
    const eye = window.outerWidth > 0 && window.innerWidth > 0
                  ? window.outerWidth / window.innerWidth : 1;
    const near = eye >= 0.25 && eye <= 5 ? eye : 1;
    if (opened) caseEl.classList.add(openWith);

    // What of the room can actually be seen. Some browsers report a layout
    // viewport taller than the visible one, and the box was then sized and
    // centered for space that lives behind the toolbar.
    const vv = window.visualViewport;
    const r = roomEl.getBoundingClientRect();
    const room = {
      left: Math.max(r.left, 0),
      right: Math.min(r.right, vv ? vv.width : r.right),
      top: Math.max(r.top, 0),
      bottom: Math.min(r.bottom, vv ? vv.height : r.bottom),
    };
    const roomW = room.right - room.left, roomH = room.bottom - room.top;
    if (roomW <= 0 || roomH <= 0) return;

    // The gaps. Proportional, with a floor, so a phone gets air too.
    const gapX = Math.max(14, roomW * 0.06), gapY = Math.max(14, roomH * 0.05);
    const middle = room.top + roomH / 2;
    // Plain CSS pixels, and deliberately so. I tried multiplying these back
    // up by the browser's zoom, so that zooming would magnify the box rather
    // than re-fitting it — which looked right until you zoomed to 200% and
    // opened the box: the opening animation, fitted to the zoomed window,
    // ended somewhere the freshly-loaded next page did not agree with, and
    // the box arrived with a jump. Fitting to the window it is actually in
    // means the two pages always agree, and the box can never overflow.
    const above = middle - room.top - gapY;    // room the lid has
    const below = room.bottom - middle - gapY; // room the tray has
    const across = roomW - gapX * 2;

    // The three numbers that matter, at whatever scale it is drawn at now:
    // how far the object reaches left-to-right, how far above the hinge, and
    // how far below it. The hinge is the box's own far edge — the line the lid
    // turns on — which is the top of the box's rectangle.
    const reach = () => {
      const b = box.getBoundingClientRect(), l = lid.getBoundingClientRect();
      const hinge = b.top;
      return {wide: Math.max(b.right, l.right) - Math.min(b.left, l.left),
              up: hinge - Math.min(b.top, l.top),
              down: Math.max(b.bottom, l.bottom) - hinge,
              hinge};
    };

    caseEl.style.setProperty('--sink', '0px');
    let zoom = 1;
    for (let pass = 0; pass < 4; pass++) {
      caseEl.style.setProperty('--zoom', zoom.toFixed(3));
      // The eye steps back as the box grows: perspective is a fixed distance
      // in CSS, and a box scaled up against a fixed distance is a wide-angle
      // lens pressed against it — the tray splays out and the thing looks bent.
      const stage = caseEl.parentElement;
      // Swept against the rendered box: further back than 1900 and the lid
      // stops tapering at all, nearer and the tray splays away from it. Here
      // the two are within a few percent and both are visibly boxes.
      if (stage) stage.style.perspective = Math.round(1900 * zoom) + 'px';
      const at = reach();
      if (at.wide <= 0 || at.up <= 0 || at.down <= 0) break;
      const off = Math.min(across / at.wide, above / at.up, below / at.down);
      if (Math.abs(off - 1) < 0.02) break;
      zoom = Math.max(0.15, Math.min(zoom * off, 2.4));
    }

    /* And how big the writing on it comes out.
     *
     * Everything inside the box is drawn inside a transform that scales with
     * the box, so type asked for in fixed pixels arrives multiplied by the
     * fit — and the fit is against the window in CSS pixels, which browser
     * zoom makes *smaller* the further in you go. The two cancel out exactly.
     * The box and every word on it came out the same size on the glass at 50%
     * as at 200%, and a hair smaller the further in you went, while the rest
     * of the page grew around it: zooming did the opposite of what zooming is
     * for.
     *
     * The cancelling is the whole of it, so undoing it is the whole of the
     * answer: ask for a size, times the zoom. At 100% that is a plain number
     * of pixels and nothing on this box moves; at 200% the writing is twice
     * the size on the glass, which is what 200% means, and it is a straight
     * line between and past them. Every other proportion is left alone — the
     * writing is still a share of the box, still smaller in a smaller window,
     * still the phone's own size on a phone.
     *
     * Twelve, not the ten the sheet was first drawn at. Read at arm's length
     * on a desk that was a squint; this is that fifth back, and it is the one
     * number the sheet is set in, so moving it moves the whole of it together.
     *
     * The line is straight wherever the box keeps its shape, which on an
     * ordinary window is the whole of a browser's zoom range. Zoomed far
     * enough that the window measures as a phone on its side, the shared sheet
     * turns the box shallow and the writing steps with it — because the
     * writing is a share of the box, and that is a different box. Both pages
     * step the same way at the same place, which is the part that matters.
     */
    caseEl.style.setProperty('--type', (12 * near).toFixed(2) + 'px');

    // And the hinge onto the middle line. Damped, because a translate inside
    // the perspective moves the object further on screen than it is told to.
    let sink = 0;
    for (let pass = 0; pass < 4; pass++) {
      const off = middle - reach().hinge;
      if (Math.abs(off) < 1) break;
      sink += off * 0.72;
      caseEl.style.setProperty('--sink', Math.round(sink) + 'px');
    }

    if (opened) caseEl.classList.remove(openWith);
    // Transitions stay off for a moment after the last fit rather than for a
    // frame: dragging a window edge fires resize continuously, and each fit
    // would otherwise start a 0.9s animation that the next one interrupts —
    // which is the box lurching about under the pointer.
    if (!primed) {
      clearTimeout(caseEl._settle);
      caseEl._settle = setTimeout(() => caseEl.classList.remove('priming'), 160);
    }
    return zoom;
  };

  /* ---- the console --------------------------------------------------------
     A sheet that comes down over whatever is on screen: what the machine is
     doing along the top, everything it has said underneath, and a line to type
     into. On every page, because it is the shell's — see shell/log.py.

     It is deliberately not a popover like the other three fittings. Those are
     small answers to small questions. This is the place you go when the
     evening is not working, and it wants the width of the window and a
     scrollback you can read.
  --------------------------------------------------------------------------*/
  const Console = (() => {
    let hatch, bar, list, input, hints, knob;
    let open = false, follow = true, trouble = false, seeded = false;

    /* How far somebody has read. Every line carries the moment it was said,
       so the dot is a question about one number: is there an error newer than
       the last one they were looking at?

       It has to outlive the page. A socket that reconnects is handed the
       whole ring again, and a reload is handed it from the first line — so
       without a mark of its own, every error of the evening lights the knob
       again on every refresh, including the ones already read and answered.
       Kept per browser, in whatever storage will have it; a machine that
       refuses storage falls back to "this page only", which is the old
       behavior and no worse than it was. */
    const SEEN = 'lucid.log.seen';
    let seen = 0;
    try { seen = +(localStorage.getItem(SEEN) || 0) || 0; } catch (e) {}
    const readUpTo = (at) => {
      if (!(at > seen)) return;
      seen = at;
      try { localStorage.setItem(SEEN, String(at)); } catch (e) {}
    };
    let newest = 0;
    let orders = [], health = new Map(), ws = null, tries = 0;
    /* Commands the page itself answers, as against the ones the server does.
       Some things only a browser can do — open a sheet, leave a room, ask a
       question and wait for the answer — and they belong in the same list as
       everything else, because the person typing does not care which side of
       the wire a thing lives on. */
    const local = new Map();
    const every = () => [...orders, ...[...local.values()].map(o =>
      ({name: o.name, about: o.about, args: o.args || '', app: 'page'}))]
      .sort((a, b) => a.name.localeCompare(b.name));
    const past = [];                       // what you have typed, for arrow-up
    let recall = -1;

    /* Which app, and which part of it. A page may say what it is — a room, a
       front door — and the console asks for the commands that make sense
       there. Without that the box's own page was being offered a microphone
       and a conversation to reset. */
    const APP = (location.pathname.split('/')[1] || '').trim()
              + (window.LucidWhere ? '/' + window.LucidWhere : '');
    const clock = at => {
      const d = new Date(at * 1000);
      return String(d.getHours()).padStart(2, '0') + ':'
           + String(d.getMinutes()).padStart(2, '0') + ':'
           + String(d.getSeconds()).padStart(2, '0');
    };
    const safe = t => String(t).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

    function make() {
      if (hatch) return;
      hatch = el('div', 'hatch');
      hatch.innerHTML = `
        <div class="hatch-bar"></div>
        <div class="hatch-log" role="log"></div>
        <!-- The commands sit in the panel's own column rather than floating
             out of the input row. Hung off the row they opened upward with
             nothing above them to stop it: past a certain number of commands
             the list was taller than the panel, and on a phone taller than the
             screen. Here the panel shares its height out — the log gives way,
             the list takes what it needs and no more. -->
        <div class="hatch-hints" hidden></div>
        <form class="hatch-say" autocomplete="off">
          <button type="button" class="hatch-mark" title="the commands"
                  aria-label="show the commands">/</button>
          <input type="text" spellcheck="false" placeholder="type / for what you can do">
        </form>`;
      document.body.appendChild(hatch);
      bar = hatch.querySelector('.hatch-bar');
      list = hatch.querySelector('.hatch-log');
      input = hatch.querySelector('input');
      hints = hatch.querySelector('.hatch-hints');

      /* The prompt is the way in.

         Everything here starts with a slash, and on a phone that character is
         two taps down a keyboard nobody has been to since they last typed a
         URL. It was already sitting there as an ornament — a chevron saying
         "this is where you type" to somebody who could see the box perfectly
         well — so it does the one job that was missing instead: press it and
         the list is open. */
      hatch.querySelector('.hatch-mark').addEventListener('click', () => {
        if (!input.value.startsWith('/')) input.value = '/' + input.value;
        input.focus();
        suggest();
      });

      // Following the tail unless you have scrolled up to read something.
      list.addEventListener('scroll', () => {
        follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
      });
      hatch.querySelector('.hatch-say').addEventListener('submit', e => {
        e.preventDefault();
        send();
      });
      input.addEventListener('input', suggest);
      input.addEventListener('keydown', key);
      hatch.addEventListener('click', e => e.stopPropagation());
    }

    // ---- what the machine is up to ----
    /* The machine first and always — the models are shared, expensive and
       breakable, and they are the reason anybody opens this. Then whichever
       app you are standing in, which on the front page is none. */
    function lamps() {
      /* The machine first and always, then everything true of where this page
         is — by the same prefix rule the commands use. In a room that is the
         app and the room; in front of the box it is the app alone, because
         "idle" and which pill is in hand are answers about a room and there
         is no room in front of the box. */
      const found = [health.get('machine')];
      for (const [key, h] of health) {
        if (key === 'machine') continue;
        if (APP === key || APP.startsWith(key + '/')) found.push(h);
      }
      const rows = found.filter(Boolean);
      /* Which build this is, kept out of the way on the right until somebody
         wants it — and they want it exactly once, when they are telling
         somebody else what happened. The server writes it onto <html>; a page
         served by something else says nothing rather than guessing. */
      const build = document.documentElement.dataset.lucid;
      const stamp = build
        ? `<span class="hatch-build" title="the version of Lucid Dream this is">`
          + `${safe(build)}</span>`
        : '';
      if (!rows.length) {
        bar.innerHTML = '<span class="hatch-quiet">nothing running yet</span>' + stamp;
        return;
      }
      /* A rule divides one thing from another thing, not a name from its own
         facts: the room's row has no name because it belongs to the app named
         just before it, so it is set beside it rather than across a line. */
      bar.innerHTML = rows.map((h, i) => {
        const dots = (h.parts || []).map(p =>
          `<span class="hatch-lamp ${safe(p.state || 'off')}" title="${safe(p.title || p.name)}">`
          + `<i></i>${safe(p.name)}</span>`).join('');
        const facts = (h.facts || []).map(f =>
          `<span class="hatch-fact">${safe(f)}</span>`).join('');
        // Only what was given a name gets one. The room's row is facts alone —
        // it belongs to the app named just before it, and printing its key
        // there said LUCID-TALK/ROOM at somebody.
        const who = h.name ? `<span class="hatch-app">${safe(h.name)}</span>` : '';
        return (i && h.name ? '<span class="hatch-rule"></span>' : '') + who + dots + facts;
      }).join('') + stamp;
    }

    // ---- the scrollback ----
    function draw(lines) {
      const frag = document.createDocumentFragment();
      for (const l of lines) {
        const row = el('div', 'hatch-line ' + l.level);
        row.innerHTML = `<span class="t">${clock(l.at)}</span>`
                      + `<span class="w">${safe(l.source)}</span>`
                      + `<span class="m">${safe(l.text)}</span>`;
        frag.appendChild(row);
        if (l.at > newest) newest = l.at;
        // Read as it arrives while the console is open; otherwise it is only
        // trouble if it happened after the last thing that was read.
        if (open) readUpTo(l.at);
        else if (l.level === 'error' && l.at > seen) mark(true);
      }
      list.appendChild(frag);
      while (list.children.length > 1200) list.removeChild(list.firstChild);
      if (follow) list.scrollTop = list.scrollHeight;
    }

    // A dot on the knob when something has gone wrong since you last looked.
    // Quiet until it matters is the whole idea; this is the part that tells
    // you it has started to matter.
    function mark(on) {
      trouble = on;
      if (knob) knob.classList.toggle('trouble', on);
    }

    // ---- typing ----
    function suggest() {
      const v = input.value;
      if (!v.startsWith('/')) { hints.hidden = true; return; }
      const want = v.slice(1).split(' ')[0].toLowerCase();
      /* Matched on any word of the name, not only the first.

         The names read subject first — room_clear, ai_models_start — which is
         what makes the list sort into families when you read it down. It also
         puts the verb last, and the verb is what somebody types: they want to
         start something and type "start", which under a prefix match found
         nothing at all and looked like the command did not exist.

         Whole-name matches still come first, so typing the beginning of a name
         gets that name at the top rather than buried among its relatives. */
      const score = (name) => {
        const n = name.toLowerCase();
        if (n.startsWith(want)) return 0;
        return n.split('_').some(part => part.startsWith(want)) ? 1 : -1;
      };
      const near = every().map(o => [score(o.name), o])
                          .filter(([s]) => s >= 0)
                          .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
                          .map(([, o]) => o);
      if (!near.length) { hints.hidden = true; return; }
      hints.innerHTML = near.map((o, i) =>
        `<button type="button" class="hatch-hint${i ? '' : ' on'}" data-name="${safe(o.name)}">`
        + `<span class="what"><b>/${safe(o.name)}</b>`
        + `${o.args ? ` <em>${safe(o.args)}</em>` : ''}</span>`
        + `<span class="why">${safe(o.about)}</span></button>`).join('');
      hints.hidden = false;
      hints.querySelectorAll('.hatch-hint').forEach(b =>
        b.addEventListener('click', () => { take(b.dataset.name); }));
    }
    const take = name => {
      input.value = '/' + name + ' ';
      hints.hidden = true;
      input.focus();
    };
    function key(e) {
      const on = hints.hidden ? null : hints.querySelector('.on');
      if (!hints.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const all = [...hints.querySelectorAll('.hatch-hint')];
        let i = all.indexOf(on) + (e.key === 'ArrowDown' ? 1 : -1);
        i = (i + all.length) % all.length;
        all.forEach(b => b.classList.remove('on'));
        all[i].classList.add('on');
        return;
      }
      if (!hints.hidden && (e.key === 'Tab' || e.key === 'Enter') && on) {
        /* Enter completes what you started, but runs what you have already
           finished: typing the whole of /where and pressing return should do
           the thing, not politely finish the word you just typed. */
        const typed = input.value.slice(1).split(' ')[0].toLowerCase();
        if (e.key === 'Enter' && every().some(o => o.name === typed)) {
          e.preventDefault();
          hints.hidden = true;
          send();
          return;
        }
        e.preventDefault();
        take(on.dataset.name);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {         // what you typed before
        if (!past.length) return;
        e.preventDefault();
        recall = e.key === 'ArrowUp' ? Math.min(recall + 1, past.length - 1)
                                     : Math.max(recall - 1, -1);
        input.value = recall < 0 ? '' : past[recall];
      }
      if (e.key === 'Escape') { e.stopPropagation(); show(false); }
    }
    function send() {
      const line = input.value.trim();
      if (!line) return;
      past.unshift(line);
      recall = -1;
      input.value = '';
      hints.hidden = true;
      draw([{at: Date.now() / 1000, source: 'you', level: 'debug', text: line}]);
      const [name, ...rest] = line.replace(/^\//, '').split(' ');
      const here = local.get(name.toLowerCase());
      if (here) {
        Promise.resolve()
          .then(() => here.run(rest.join(' ').trim()))
          .then(said => said && draw([{at: Date.now() / 1000, source: 'console',
                                       level: 'info', text: said}]))
          .catch(e => draw([{at: Date.now() / 1000, source: 'console', level: 'error',
                             text: `${name} failed: ${e && e.message || e}`}]));
      } else {
        tell({run: line});
      }
      Sound.tick();
    }

    // ---- the wire ----
    /* Held until there is a socket to put it on. The things most worth
       saying happen while the page is still starting — a room that would not
       load, a machine with no WebGL — and this used to drop them on the floor
       for the second or so before the console had dialled. */
    const outbox = [];
    function tell(msg) {
      if (ws && ws.readyState === 1) return ws.send(JSON.stringify(msg));
      outbox.push(msg);
      while (outbox.length > 60) outbox.shift();
    }
    function dial() {
      try {
        // Where we are standing, so the command list is the one that makes
        // sense from here: an app's pills mean nothing on the front page.
        ws = new WebSocket(location.origin.replace(/^http/, 'ws')
                           + '/shared/log/ws?at=' + encodeURIComponent(APP));
      } catch { return; }
      ws.onopen = () => {
        tries = 0;
        while (outbox.length) ws.send(JSON.stringify(outbox.shift()));
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'backlog') {
          orders = m.orders || [];
          health.clear();
          (m.health || []).forEach(h => health.set(h.app, h));
          /* First time, this is the whole log. On a reconnect it is a *new*
             server's log, and what is already on screen is the old one's —
             which is exactly what somebody restarting wants to keep looking
             at. So it is kept, with a line drawn under it. */
          if (seeded) {
            const rule = el('div', 'hatch-since');
            rule.textContent = 'the server came back';
            list.appendChild(rule);
          } else {
            list.innerHTML = '';
          }
          seeded = true;
          draw(m.lines || []);
          lamps();
        } else if (m.type === 'log') {
          draw(m.lines || []);
        } else if (m.type === 'health') {
          health.set(m.of.app, m.of);
          lamps();
        } else if (m.type === 'cleared') {
          list.innerHTML = '';
        }
      };
      // The console is the thing you look at when the server has gone. It
      // keeps trying, slower each time, and says so in its own scrollback.
      ws.onclose = () => {
        ws = null;
        if (tries === 0) draw([{at: Date.now() / 1000, source: 'console',
                                level: 'warn', text: 'lost the server — retrying'}]);
        tries++;
        setTimeout(dial, Math.min(700 * tries, 5000));
      };
    }

    function show(on) {
      make();
      open = on;
      document.documentElement.classList.toggle('hatched', on);
      hatch.classList.toggle('open', on);
      if (on) {
        mark(false);
        readUpTo(newest);            // everything on the list has been seen
        follow = true;
        list.scrollTop = list.scrollHeight;
        setTimeout(() => input.focus(), 120);
      } else if (document.activeElement === input) {
        input.blur();
      }
      Sound.tick();
    }

    /* Anything the page itself trips over goes up the same wire, so there is
       one timeline and not two halves to line up by eye. */
    function watch() {
      addEventListener('error', e => tell({say: {
        level: 'error',
        text: `${e.message} — ${(e.filename || '').split('/').pop()}:${e.lineno}`}}));
      /* A rejection nobody caught, at the level it deserves.
       *
       * Some of these are the browser telling you it changed its mind, not
       * that anything broke: a view transition that was skipped because
       * another navigation overtook it, a play() abandoned when the next
       * chunk arrived, a fetch cut off by leaving the page. They happen in
       * the ordinary run of things, they are already handled by whatever
       * happens next, and raising a red dot for them is what teaches somebody
       * to stop looking at the dot.
       *
       * Matched on the browser's own words, which are stable enough for this
       * and are the only thing these have in common. Anything unrecognised is
       * still an error: an unhandled rejection is a bug until it is shown to
       * be a shrug. */
      const SHRUG = /transition was skipped|the operation was aborted|AbortError|user aborted|interrupted by a (new )?load|removed from the document/i;
      addEventListener('unhandledrejection', e => {
        const said = (e.reason && e.reason.message) || String(e.reason);
        tell({say: {level: SHRUG.test(said) ? 'warn' : 'error',
                    text: 'unhandled: ' + said}});
      });
    }

    return {
      attach(button) {
        knob = button;
        make();
        button.addEventListener('click', e => { e.stopPropagation(); show(!open); });
        button.addEventListener('pointerenter', () => Sound.hover(), {passive: true});
        /* The tilde, as consoles have opened since Quake — but never while
           somebody is writing, which in this program is most of the time. */
        /* Escape closes it from anywhere, not only from the line you type
           into: having clicked something in the scrollback, the way out
           should still be the key everybody reaches for. Captured, so the
           sheet takes it before whatever is underneath — and only while it is
           open, or it would be stealing the key from the page. */
        addEventListener('keydown', e => {
          if (e.key !== 'Escape' || !open) return;
          e.preventDefault();
          e.stopPropagation();
          show(false);
        }, true);
        addEventListener('keydown', e => {
          if (e.key !== '`' && e.key !== '~') return;
          const el2 = document.activeElement;
          const typing = el2 && (el2.tagName === 'INPUT' || el2.tagName === 'TEXTAREA'
                                 || el2.isContentEditable);
          if (typing && el2 !== input) return;
          e.preventDefault();
          show(!open);
        });
        dial();
        watch();
      },
      show,
      /* A page's own way in. Anything an app knows and the server does not —
         what the browser's microphone is doing, whether echo cancellation is
         on — belongs in the same timeline as everything else. */
      say(text, level = 'info') { tell({say: {text, level}}); },
      /* What this page can do that the server cannot. Registered by the page
         itself, listed beside the server's own, and run here. */
      command(name, about, run, {args = ''} = {}) {
        local.set(name, {name, about, run, args});
      },
    };
  })();
  window.Hatch = Console;

  // ---- the corner furniture ------------------------------------------------
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const SPEAKER = on => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z"/>
      ${on ? '<path d="M15.4 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.6a7.6 7.6 0 0 1 0 10.8"/>'
           : '<path d="M16 10l4.5 4.5M20.5 10L16 14.5"/>'}</svg>`;

  const PHONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M11 18.6h2"/></svg>`;

  const TERM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2.5" y="4" width="19" height="16" rx="2.2"/>
      <path d="M6.5 9.5L9.5 12l-3 2.5"/><path d="M12.5 15h5"/></svg>`;

  const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/>
      <circle cx="12" cy="12" r="2.6"/><path d="M4 20L20 4"/></svg>`;

  /* One sentence, said twice: to a screen reader and to a pointer resting on
     it. They used to be set separately, which is how a control ends up with
     one and not the other. */
  const say = (node, words) => {
    node.setAttribute('aria-label', words);
    node.setAttribute('title', words);
  };

  function build() {
    if (document.querySelector('.corners')) return;
    const corners = el('div', 'corners');

    // ---- what you can hear ----
    const audio = el('div', 'corner');
    const audioBtn = el('button', 'knob', SPEAKER(Sound.level > 0));
    say(audioBtn, 'How loud the interface is. Its voice is set separately.');
    const audioPop = el('div', 'pop vol',
      `<button class="hush" type="button" data-quiet></button>
       <div class="stepper">
         <button class="step" data-step="-1" aria-label="quieter">&minus;</button>
         <input type="range" min="0" max="100" step="1" value="${Math.round(Sound.level * 100)}"
                aria-label="volume">
         <button class="step" data-step="1" aria-label="louder">+</button>
       </div>
       <label class="calm" data-quiet
              title="interface sounds at half; the voice is untouched">
         <input type="checkbox"${Sound.calm ? ' checked' : ''}> Calm interface
       </label>`);
    audio.append(audioBtn, audioPop);

    const hushBtn = audioPop.querySelector('.hush');
    const paint = () => {
      const quiet = Sound.hush || Sound.level === 0;
      audioBtn.innerHTML = SPEAKER(!quiet);
      audioBtn.classList.toggle('muted', quiet);
      /* A verdict under the name, in both states. Everybody knows what a mute
         does, so the line is never about the mechanism: before, that we would
         rather they did not; after, what they are left with. */
      hushBtn.innerHTML = SPEAKER(!Sound.hush) + '<span class="what">'
        + `<b>${Sound.hush ? 'Muted' : 'Mute everything'}</b>`
        + `<em>${Sound.hush ? 'the game is boring' : 'not recommended'}</em>`
        + '</span>';
      hushBtn.classList.toggle('on', Sound.hush);
    };
    /* One press for "not now". It takes the interface *and* the voice, which
       is the only version of a mute anybody means when they reach for one in
       a hurry — and the voice is the loud thing. It plays no sound of its own
       going on, for the obvious reason, and one going off so you know it came
       back. */
    hushBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Sound.setHush(!Sound.hush);
      paint();
      if (!Sound.hush) Sound.tick();
    });
    const slider = audioPop.querySelector('input[type=range]');
    const apply = (v) => {
      slider.value = Math.round(v * 100);
      Sound.setLevel(v);
      paint();
      // No tick of its own: the press that got here already made one. It used
      // to add a second, and a press that answers twice reads as a stutter.
    };
    // Dragging fires input every few pixels, and a tick per event is a
    // machine-gun. The drag itself is silent; letting go plays one short
    // breath at the level you landed on, which is what you were listening for.
    slider.addEventListener('input', () => apply(slider.value / 100));
    slider.addEventListener('change', () => Sound.whoosh({dur: 0.42, peak: 0.4}));
    audioPop.querySelectorAll('.step').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      apply(Sound.level + 0.1 * +b.dataset.step);
    }));
    // Joe mode: the clicks and the air step back, the voice does not. Ticking
    // it plays a tick, so you hear the difference you just asked for.
    const calmBox = audioPop.querySelector('.calm input');
    calmBox.addEventListener('change', () => { Sound.setCalm(calmBox.checked); Sound.tick(); });
    paint();

    // ---- take it with you ----
    const phone = el('div', 'corner');
    phone.hidden = true;                       // until the server says otherwise
    const phoneBtn = el('button', 'knob', PHONE);
    say(phoneBtn, 'Open this on your phone — scan the code, same wifi, no account.');
    const phonePop = el('div', 'pop qr',
      '<b>Play on phone</b><div class="code"></div><div class="url"></div>');
    phone.append(phoneBtn, phonePop);

    /* ---- none of this leaves the room ----
       No caption any more. It said OFFLINE in the corner, which reads as a
       status — something that might one day say the other thing — when it is
       actually a promise about how the program is built. The crossed eye says
       that on its own, and the panel says it in words for anyone who asks. */
    const off = el('div', 'corner');
    const offBtn = el('button', 'knob', EYE);
    say(offBtn, 'Nothing leaves this machine. Nobody is on the other end.');
    const offPop = el('div', 'pop tale',
      `<b>Nothing leaves this room.</b>
       <p>No account. No key. Nobody on the other end. The drugs and the dreams
          stay on this machine — pull the plug on the network and nothing here
          notices.</p>`);
    off.append(offBtn, offPop);

    /* ---- the console ----
       Not a popover like the other three: it is a sheet that comes down over
       the page, so it belongs to the document rather than to the rail. What
       lives here is the way in — and a lamp, because the state of the
       machine is worth knowing at a glance without opening anything. */
    const term = el('div', 'corner');
    const termBtn = el('button', 'knob term', TERM);
    // Its own, because the tilde and Escape open it too and they are not
    // presses on anything.
    termBtn.dataset.quiet = '';
    say(termBtn, 'The console — what the machine is doing, and how to tell it '
               + 'to do something. Type / in it for the list.');
    term.append(termBtn);

    /* One rail, in one corner, in the order you would reach for them: what you
       can hear, how to take it with you, what it promises, and the way under
       the hood. */
    const rail = el('div', 'rail');
    rail.append(audio, phone, off, term);
    corners.append(rail);
    document.body.appendChild(corners);

    Console.attach(termBtn);

    // ---- one popover open at a time ----
    const all = [audio, phone, off];
    const close = except => all.forEach(c => { if (c !== except) c.classList.remove('open'); });
    all.forEach(c => {
      const btn = c.querySelector('.knob');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = c.classList.contains('open');
        close(null);
        if (!open) c.classList.add('open');
      });
      btn.addEventListener('pointerenter', () => Sound.hover(), {passive: true});
    });
    // A click inside a panel is not a click away from it — dragging the
    // volume slider used to close the very thing you were dragging.
    all.forEach(c => c.querySelector('.pop').addEventListener('click', e => e.stopPropagation()));
    document.addEventListener('click', () => close(null));
    addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });

    // ---- the phone address, and its picture ----
    fetch('/shared/where').then(r => r.json()).then(w => {
      if (!w.phone || !w.urls.length) return;      // started without a phone
      phone.hidden = false;
      // The code carries the whole address, path and all, so scanning it from
      // a conversation opens that conversation in your hand rather than the
      // front door. The line underneath is only there to tell you which
      // machine you are about to reach, so it is just the host.
      const url = w.urls[0] + location.pathname + location.search;
      phonePop.querySelector('.url').textContent = w.urls[0].replace(/^https?:\/\//, '');
      const box = phonePop.querySelector('.code');
      try {
        const m = window.QR.matrix(url);
        box.style.setProperty('--n', m.length);
        box.innerHTML = m.flat().map(on => `<i class="${on ? 'on' : ''}"></i>`).join('');
      } catch (e) {
        box.textContent = 'could not draw the code — the address is below';
      }
    }).catch(e => {
      // The knob simply stays hidden, which looks identical to a machine that
      // was started without phone access. Worth one line to tell them apart.
      Console.say('could not ask about phone access — ' + (e && e.message || e), 'debug');
    });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', build);
  else build();

  // Every press tries to wake the audio, not just the first: Safari suspends
  // the context again when the page has been in the background, and one missed
  // gesture would otherwise leave the whole interface mute for the session.
  // touchend and click are the gestures iOS counts as activation; pointerdown
  // is the one that arrives first on a Mac.
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown'])
    addEventListener(ev, () => Sound.wake(true), {passive: true});

  /* ---- and every press makes a sound --------------------------------------
   *
   * Here rather than at each control, and this is the whole point of it. It
   * used to be a Sound.tick() written into one handler at a time, which meant
   * the four knobs in the corner had a voice and everything invented after
   * them did not: the deck, the sheets, the rows on the box's dashboard, the
   * way back down a conversation. Nobody forgot — there was simply nothing to
   * remember, and the interface got quieter as it grew.
   *
   * So the shell listens for presses on anything that behaves like a control,
   * and an app gets the sound by using a button. Which is also the rule this
   * enforces: if it is pressable it is a button, an anchor or an input, and if
   * it is one of those it sounds like one.
   *
   * Captured, because half the controls in here stop the click going any
   * further — a press inside a popover is not a press away from it — and a
   * listener on the way down hears them all regardless.
   */
  const CONTROLS = 'button, [role="button"], a[href], summary, select, ' +
                   'input[type="checkbox"], input[type="radio"]';
  // A switch, either way round: something that will be in the other state
  // when you let go. The heavier sound says so.
  const SWITCHES = '[aria-pressed], input[type="checkbox"], input[type="radio"]';

  function pressed(target) {
    const el = target && target.closest && target.closest(CONTROLS);
    // Nothing for a key that is not offering anything — a press that does not
    // work should not sound like one that did. And `data-quiet` is for the
    // few that make their own sound, at their own moment: the console's
    // clatter, the tick that plays *after* Calm has changed so that what you
    // hear is the level you just asked for.
    if (!el || el.disabled || el.closest('[data-quiet]')) return null;
    return el;
  }

  function press(el) {
    if (el.matches(SWITCHES)) Sound.latch(); else Sound.tick();
  }

  addEventListener('pointerdown', e => {
    const el = pressed(e.target);
    if (el) press(el);
  }, {capture: true, passive: true});

  // The keyboard presses things too, and a button reached by tab and space is
  // still a button. Space and Enter are what a control answers to; pointerdown
  // never fires for either, so there is no double.
  addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.repeat) return;                        // held down is one press
    const el = pressed(document.activeElement);
    if (el) press(el);
  }, {capture: true, passive: true});
})();
