/* The piece, mounted into an element rather than into a document.
 *
 * This is Burning Man's main.ts -- the whole of what the standalone page ran at
 * the top level -- made into a function, so that a card in Lucid Trip's box can
 * open it and the lid can close on it again. Three things changed and nothing
 * else did: the document is a host element (the classes that were on <body>
 * are on the host, and every selector is looked up under it); the body's files
 * come out of the bundle rather than off a directory beside the page (see
 * ../assets.ts); and what the phone's pagehide used to do is also `dispose`,
 * which is what leaving the route does. The Studio -- the authoring panel, the
 * framing tool and the altar shortcuts, all behind __AUTHOR__ upstream -- is
 * not here: the score is authored in the Burning Man repository and arrives as
 * score.json.
 *
 * Mounted twice, it is two pieces: nothing in here is kept at module level
 * except what is pure data (the sand's surveys and the body's downloaded files
 * are cached across mounts, which is the point of them).
 */
import * as THREE from 'three/webgpu';
import {pass, uniform} from 'three/tsl';
import {bloom} from 'three/addons/tsl/display/BloomNode.js';
import {
  AdaptiveQuality,
  CoastalSea,
  createDesert,
  FollowCamera,
  FrameLoop,
  keepDiffuse185,
  QUALITY,
  renderPixelRatio,
  SandContacts,
  SmoothOrbit,
  viewportFraming,
  WalkKeys,
} from '@lucid/world/desert';
import {EARTH_ALTAR_WIDTH} from '../world/earth-alignment';
import {ElementalAltars} from '../world/altars';
import {BurningMan, preloadCharacter} from '../character/man';
import {WALK_FOOTFALLS} from '../character/walk-gait';
import {FallenAltar} from '../world/fallen-altar';
import {FALLEN_OBSTACLES} from '../world/fallen-site';
import {Soundscape} from '../audio/soundscape';
import {resolveMusicUrl} from '../audio/music-cdn';
import {
  DEFAULT_SCORE,
  Transport,
  pace,
  sampleScore,
  smooth,
  SETTLE_SECONDS,
  validateScore,
  risenAt,
  type Cue,
} from './score';
import {Walker, rehearse} from './walker';
import {WalkDirector, type WalkRoutine} from './director';
import {ScriptedWalk} from './rehearsal';
import {CameraDirector, REVEAL_ANGLE, sampleCameraShot, seawardRevealAngle} from './camera-director';
import {COASTAL_CLIMB, coastX, coastalCrest, geo, MAP} from '../landscape';
import {surveyJourney, travelBudget, journeyDirection, journeyHeading, type Journey} from './journey';
import {ASSETS} from '../assets';

/** What the piece can be asked to do once it is up. Browser tests and the
    console reach these through the shell's one door on window. */
export interface Controls {
  snapshot(): unknown;
  seek(time: number, reconstruct?: boolean): void;
  start(): Promise<void>;
  togglePause(): Promise<void>;
  reset(): void;
  applyScore(input: unknown): unknown;
  setQuality(mode: unknown): void;
  setRoutine(value: string): void;
  setView(value: string): void;
}

export interface Piece {
  /** The controls, once the first frame has been drawn and Let it is live.
      Rejects if the desert could not load, or with an AbortError when the
      piece was left before it was up. */
  ready: Promise<Controls>;
  /** Let go of everything: the loop, the renderer, the sound, every listener.
      Saying it twice is nothing. */
  dispose(): void;
  /** The listener's volume (1 is the mix as authored) and whether they hushed it. */
  hear(gain: number, hushed: boolean): void;
}

/** Why `ready` rejects when the piece is left before it is up. */
const left = () => new DOMException('the piece was left before it was up', 'AbortError');

/** Mount the piece into `host`, which is the stage built by ./stage.ts. */
export function play(host: HTMLElement): Piece {
  const $ = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const abort = new AbortController();
  const gone = () => abort.signal.aborted;
  /* What there is to let go of, as of the last thing built: the renderer
     alone while the world is still being assembled, everything once it is.
     Reassigned as the piece comes up, so a dispose() during any of the
     awaits below takes down exactly what exists. */
  let teardown = () => {};
  const dispose = () => {
    if (gone()) return;
    abort.abort();
    teardown();
  };
  /* Made before anything is awaited, so the volume the page hands in on mount
     has somewhere to go before the world is up. */
  const audio = new Soundscape();
  const ready = (async (): Promise<Controls> => {
  // The body's five files are the largest download by far. Ask for all of them
  // before anything else starts, so they arrive while the world is assembled.
  const characterBase = ASSETS;
  preloadCharacter(characterBase);
  // The ground survey runs on a worker while the body downloads and the renderer
  // starts, instead of holding this thread before anything can be drawn.
  const survey = geo.surveyReady();
  const transport = new Transport(),
    director = new WalkDirector(),
    cameraDirector = new CameraDirector();
  let score = structuredClone(DEFAULT_SCORE),
    routeCache: ReturnType<typeof rehearse> | undefined,
    budgetCache: number | undefined,
    journeysCache: ReturnType<typeof surveyJourney>[] | undefined,
    journey: Journey = 'sea',
    ready = false,
    rehearsal: ScriptedWalk | undefined,
    scrubbed = false,
    preview: Cue['clip'] | null = null,
    previewAt = 0,
    view = 'full';
  function followAudio() {
    audio.follow({...transport, visible: !document.hidden}, score);
  }
  audio.arm(score);
  // The opening heartbeat can unlock on any gesture, independently of Fire or asset readiness.
  const unlockOnGesture = () => {
    if (!audio.state.unlocked) void audio.unlock().catch(() => {});
  };
  for (const name of ['pointerdown', 'click', 'keydown'])
    document.addEventListener(name, unlockOnGesture, {capture: true, signal: abort.signal});
  // Multisampling belongs on the scene pass, where the dune and body silhouettes
  // are. Asking the renderer for it would also multisample the canvas, whose only
  // draw is the full-screen composite: a second full-resolution 4x colour and
  // depth attachment and a second resolve, for no edge anywhere.
  const renderer = new THREE.WebGPURenderer({
    canvas: $('#world'),
    antialias: false,
    powerPreference: 'high-performance',
  });
  await renderer.init();
  if (gone()) {
    renderer.dispose();
    throw left();
  }
  teardown = () => {
    audio.dispose();
    renderer.dispose();
  };
  const graphics = new AdaptiveQuality(
    new URLSearchParams(location.search).get('quality'),
    !!(renderer.backend as unknown as {isWebGPUBackend?: boolean}).isWebGPUBackend,
  );
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(49, host.clientWidth / host.clientHeight, 0.08, 2400);
  const controls = new SmoothOrbit(camera, $('#world'));
  await survey;
  if (gone()) throw left();
  const desert = createDesert(scene, geo),
    sea = new CoastalSea(renderer, scene, camera, QUALITY[graphics.tier].water),
    walker = new Walker(desert.field.height, FALLEN_OBSTACLES),
    contacts = new SandContacts(desert.field, WALK_FOOTFALLS);
  // What he has stood in the desert: the three monuments, moved by the hour and the wind.
  const altars = new ElementalAltars();
  scene.add(altars.object);
  desert.landmarks.push(altars);
  const man = new BurningMan(characterBase, {
    height: desert.field.height,
    sinkDepth: (x, z) => desert.field.support(x, z).sinkDepth,
  });
  scene.add(man.object);
  const opened = Promise.all([man.ready, sea.ready]);
  const fallen = new FallenAltar(characterBase, desert.field.height, desert.sandMaterial, opened);
  scene.add(fallen.object);
  /** While the viewer is walking him, nothing scripted stops him and no scripted
   * camera move runs: not the look-around, not the first fall, not the pause at
   * the crest. Let go and the piece takes itself back after the idle return. The
   * final kneel is not one of these. It comes on the clock wherever he stands. */
  function playerDriving(time = transport.time) {
    const mode = director.inspect(time, score).mode;
    return mode === 'player' || mode === 'keyboard';
  }
  /** Said once a take, and not until the keys would do anything: he stands through
   * the song's opening and cannot be walked until the third stage. */
  let hinted = false;
  /** The credits travel as ciphertext and are put together at render time. This
   * is not security: anybody with a browser can read them. It only means a
   * scraper that does not run scripts finds nothing to take, an address least of
   * all. Rebuild the line with: node lab/scripts/encode-credits.mjs */
  const CREDITS = 'OQ5QHAYCAg9XQy1CXFNXRhZVEwANTgZfGUNCD1xRX1NAT1ArHAkCQwhBOkRHRFtDDBsLBUtCRUUfBAgPCBJfVwsZBgFTCxJKCA8LWQpbclEPFBsCRw0IQE8cQlYQQl1aB1dITCQbFEQOQ0IPXFFfU0BPUCoADwtCChQLDRp5EmEDGwZOPQFHbwhBL0FdXlcfTlU4DwoFFEIDQS0DEnZAVwweUBNFFUVfAg0LDwgSYkQNEQcNHQcIQ09NTENTXVcUWFc3FgoLC14EDhwNc0JGRUBZUAYbCwEPV0MGWUZAQQxNWhUHHQYST0MCAUAdVUpVBxkBBwYcSkwfFR0PTxxJFBAaHgtLVEV+AhQcTlcSHhQMFB8LS1RFSgQVBlhQHlFZD1oXFgoLC14EDhwAU0JGRU0XBxwHBwlKQAwPQxAcEF4QEBRMU0wPWRkRHRcdH1VfFh0HDEcNCEBCBBZOV1xBXw0HXw8bGhQCDxQcQ1teVRsPFBxMFDM=';
  function fillCredits() {
    const key = new TextEncoder().encode('burning-man-2026');
    const cipher = Uint8Array.from(atob(CREDITS), (c) => c.charCodeAt(0));
    const lines = JSON.parse(
      new TextDecoder().decode(cipher.map((b, i) => b ^ key[i % key.length]!)),
    ) as {role?: string; name?: string; href?: string; fine?: string}[];
    const credits = $('.credits');
    credits.replaceChildren();
    for (const line of lines) {
      const row = document.createElement('p');
      if (line.fine) {
        row.className = 'credits-fine';
        row.textContent = line.fine;
      } else {
        const role = document.createElement('span');
        role.textContent = line.role ?? '';
        const name = document.createElement('em');
        if (line.href) {
          const link = document.createElement('a');
          link.href = line.href;
          link.textContent = line.name ?? '';
          if (line.href.startsWith('http')) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
          name.append(link);
        } else name.textContent = line.name ?? '';
        row.append(role, name);
      }
      credits.append(row);
    }
  }
  fillCredits();
  /** The piece is composed at one distance and closes a little at the end. A
   * viewer may pull back from that, and may not push in past it: coming closer
   * than the piece ever does puts the eye inside the fire. */
  function cameraRange() {
    const closest = Math.max(
      framing.minDistance,
      (score.cameraDistance - 1.2) * framing.distanceScale,
    );
    return {closest, furthest: score.cameraDistance * framing.distanceScale * 1.9};
  }
  function applyCameraRange() {
    const {closest, furthest} = cameraRange();
    controls.input.minDistance = view === 'face' ? 0.45 : closest;
    controls.input.maxDistance = furthest;
  }
  /** The camera's aim height on the body eases between poses: stepping it when the
   * knee touches and again when he stands was a jerk down and up around the first fall. */
  let aimHeight = 0.95;
  const target = new THREE.Vector3(),
    follow = new FollowCamera(camera, controls, desert.field.height);
  let framing = viewportFraming(host.clientWidth, host.clientHeight, camera.fov);
  follow.setDistanceScale(framing.distanceScale);
  const pipeline = new THREE.RenderPipeline(renderer),
    scenePass = pass(scene, camera, {samples: 4}),
    color = scenePass.getTextureNode('output');
  const glow = uniform(0.65);
  const bloomPass = bloom(color, 0.35, 0.5, 1);
  pipeline.outputNode = color.add(bloomPass.mul(glow));
  const keys = new WalkKeys(window, abort.signal, () => void togglePause());
  const frameLoop = new FrameLoop(frame);
  /** The finished piece keeps its fire and ocean, at a calmer cadence. */
  const ENDING_FPS = 24;
  let appliedFps = 0;
  function applyFrameCap(ending: boolean) {
    const budget = QUALITY[graphics.tier].fps;
    const fps = ending ? Math.min(ENDING_FPS, budget) : budget;
    if (fps === appliedFps) return;
    appliedFps = fps;
    frameLoop.setMaxFps(fps);
    graphics.setCap(fps);
  }
  applyFrameCap(false);
  frameLoop.setVisible(!document.hidden);
  controls.onInput = frameLoop.invalidate;
  const previousCamera = new THREE.Vector3(),
    previousTarget = new THREE.Vector3(),
    previousRotation = new THREE.Quaternion();
  let visualTime = 0,
    skyDrift = 0,
    sinceEnd = 0,
    songOffset: number | null = null,
    pressed = '',
    printed = 0,
    syncTime = 0;
  function applyScore(input: unknown) {
    score = validateScore(input);
    routeCache = undefined;
    journeysCache = undefined;
    budgetCache = undefined;
    rehearsal = undefined;
    if (transport.time > score.duration) {
      transport.seek(score.duration, score.duration);
      transport.playing = false;
    }
    desert.setCelestial(score.moonPhase, score.moonElevation, score.moonAzimuth, score.moonLight);
    desert.field.wind = {x: score.wind, z: 0};
    if (score.music !== audioPath) {
      audioPath = score.music;
      loadMusic(score.music);
    }
    followAudio();
    frameLoop.invalidate();
    return score;
  }
  /** The signer hands out an address that expires, so this is asked for again
   * whenever the element cannot play what it was given. */
  function loadMusic(wanted: string) {
    void resolveMusicUrl(wanted)
      .then((url) => {
        if (audioPath === wanted) audio.setTrack(url);
      })
      .catch(() => {
        if (audioPath === wanted) audio.setTrack(wanted);
      });
  }
  let audioPath = '';
  audio.onSourceFailed = () => {
    if (audioPath) loadMusic(audioPath);
  };
  applyScore(score);
  function syncPublicUI() {
    const ended = transport.time >= score.duration;
    host.classList.toggle('playing', transport.started);
    host.classList.toggle('score-ended', ended);
    // The title and the working chrome cross over on the body class, so the swap
    // is a fade rather than a blink. See .playing in the stylesheet.
    const pause = $<HTMLButtonElement>('#pause');
    pause.disabled = ended;
    const label = transport.playing || ended ? 'Pause' : 'Resume';
    if (pause.getAttribute('aria-label') !== label) {
      pause.setAttribute('aria-label', label);
      pause.title = label;
      pause
        .querySelector('path')!
        .setAttribute('d', label === 'Pause' ? 'M7 5h3v14H7zM14 5h3v14h-3z' : 'M8 5v14l11-7z');
    }
    const remaining = Math.ceil(Math.max(0, score.duration - transport.time));
    const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    if ($('#progress').textContent !== countdown) $('#progress').textContent = countdown;
  }
  function reset() {
    frameLoop.resetClock();
    graphics.resetSampling();
    transport.reset();
    preview = null;
    previewAt = 0;
    desert.resetSand();
    desert.field.time = 0;
    walker.reset(score.spawnX, score.spawnZ);
    contacts.reset();
    director.reset();
    cameraDirector.reset();
    host.classList.remove('hinting');
    hinted = false;
    scrubbed = false;
    man.clear();
    keys.clear();
    visualTime = 0;
    view = 'full';
    applyCameraRange();
    audio.pause();
    followAudio();
    void audio.sync(0, false, 1, true);
    aimHeight = 0.95;
    target.set(walker.state.position.x, walker.state.position.y + aimHeight, walker.state.position.z);
    snapCamera();
    syncPublicUI();
  }
  reset();
  async function applyGraphics() {
    const w = Math.max(1, renderer.domElement.clientWidth),
      h = Math.max(1, renderer.domElement.clientHeight);
    renderer.setPixelRatio(renderPixelRatio(w, h, devicePixelRatio, graphics.tier, graphics.scale));
    const profile = QUALITY[graphics.tier];
    bloomPass.setResolutionScale(profile.bloom);
    man.setDetail(profile.body);
    desert.setShadowResolution(profile.sunShadow, profile.moonShadow);
    // A tier change re-derives the cap; the ending keeps its own slower one.
    appliedFps = 0;
    renderer.setSize(w, h, false);
    sea.resize(w, h);
    await sea.setQuality(profile.water);
  }
  function setQuality(mode: unknown) {
    graphics.select(mode);
    graphicsPending = true;
    frameLoop.invalidate();
  }
  let graphicsPending = false;
  function resize() {
    const w = Math.max(1, renderer.domElement.clientWidth),
      h = Math.max(1, renderer.domElement.clientHeight);
    framing = viewportFraming(w, h, camera.fov);
    follow.setDistanceScale(framing.distanceScale);
    applyCameraRange();
    graphicsPending = true;
    graphics.resetSampling();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // A paused ending must recompose immediately after a portrait resize too.
    // Preserve an active manual orbit instead of resetting its director.
    if (
      ready &&
      cameraDirector.inspect(transport.time, score, cameraSteering(), cameraStudy()).mode ===
        'scripted'
    ) {
      follow.snap(target, orientShot(sampleCameraShot(transport.time, score, coastApproach(), revealAngle(), playerDriving())));
    }
    controls.snap();
    frameLoop.invalidate();
  }
  resize();
  window.addEventListener('resize', resize, {signal: abort.signal});
  window.visualViewport?.addEventListener('resize', resize, {signal: abort.signal});
  /** Unlock audio inside the gesture, but never let a browser that stalls
   * AudioContext.resume() (Safari does, on a second call in flight) hold the
   * transport hostage: the button acts now and the sound follows when it can. */
  function unlockAudio() {
    return Promise.race([
      audio.unlock().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 300)),
    ]);
  }
  /** A pointer between two arrows: shown rather than named, so the line reads as
   * quietly as it should. */
  function dragIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 12');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '11');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M4.5 3 1.5 6l3 3M19.5 3l3 3-3 3M1.5 6h21');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', '12');
    dot.setAttribute('cy', '6');
    dot.setAttribute('r', '2.1');
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('stroke', 'none');
    svg.append(path, dot);
    return svg;
  }
  /** Keys are only offered to something that has keys. A touch screen reports a
   * coarse pointer and no hover, and is told about touch instead. */
  function showHint() {
    const hint = $('#hint');
    const keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
    hint.replaceChildren();
    if (keys) {
      for (const key of ['W', 'A', 'S', 'D']) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        hint.append(cap);
      }
      hint.append(' to walk,\u2002', dragIcon(), '\u2002to look around');
    } else hint.append(dragIcon(), '\u2002to look around');
    host.classList.remove('hinting');
    void host.offsetWidth;
    host.classList.add('hinting');
  }
  async function start() {
    if (!ready) return;
    await unlockAudio();
    if (transport.started) reset();
    transport.start();
    hinted = false;
    followAudio();
    director.reset();
    scrubbed = false;
    preview = null;
    syncPublicUI();
    if (document.activeElement === $('#start')) $('#pause').focus();
    frameLoop.resetClock();
    graphics.resetSampling();
    frameLoop.invalidate();
    await audio.sync(0, true, transport.rate, true);
  }
  async function togglePause() {
    if (!transport.started || transport.time >= score.duration) return;
    // Toggle first: a click must always change the button, whatever audio does.
    transport.playing = !transport.playing;
    if (transport.playing) {
        scrubbed = false;
      preview = null;
    }
    followAudio();
    syncPublicUI();
    await unlockAudio();
    frameLoop.resetClock();
    graphics.resetSampling();
    frameLoop.invalidate();
    await audio.sync(transport.time, transport.playing, transport.rate, true);
  }
  $('#start').onclick = () => void start();
  $('#pause').onclick = () => void togglePause();

  window.addEventListener(
    'blur',
    () => {
      keys.clear();
      cameraDirector.release(transport.time);
    },
    {signal: abort.signal},
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      frameLoop.setVisible(!document.hidden);
      graphics.resetSampling();
      keys.clear();
      cameraDirector.release(transport.time);
      if (document.hidden) {
        transport.playing = false;
        audio.pause();
        syncPublicUI();
      }
      followAudio();
    },
    {signal: abort.signal},
  );
  controls.input.addEventListener('start', () => cameraDirector.begin(transport.time));
  controls.input.addEventListener('end', () => cameraDirector.end(transport.time));
  function seek(time: number, reconstruct = true) {
    if (!ready || !Number.isFinite(time)) return;
    frameLoop.resetClock();
    graphics.resetSampling();
    transport.seek(time, score.duration);
    transport.playing = false;
    scrubbed = true;
    preview = null;
    keys.clear();
    director.reset();
    const t = transport.time;
    let sample: (at: number) => typeof walker.state;
    if (reconstruct) {
      if (journey === 'sea') director.routine = 'story';
      desert.resetSand();
      rehearsal ??= new ScriptedWalk(score, journey, journey !== 'sea', FALLEN_OBSTACLES);
      sample = (at) => rehearsal!.sample(at);
      // Rebuild the nearby footprints without replaying old dust emissions. The
      // scrubber previews the authored route; free-walk detours are not recorded.
      const trailStart = Math.max(0, t - 30);
      contacts.reset(sample(trailStart).distance);
      for (let at = trailStart; at < t; at += 0.1) {
        desert.field.time = at;
        contacts.update(sample(at));
      }
      desert.field.drainBursts();
      desert.field.time = t;
      walker.restore(sample(t));
      contacts.reset(walker.state.distance);
    } else {
      const still = structuredClone(walker.state);
      still.speed = 0;
      still.velocity = {x: 0, y: 0, z: 0};
      sample = () => still;
      walker.restore(still);
    }
    visualTime = t;
    man.seek(sample, score, t);
    const cue = sampleScore(t, score, true, false);
    aimHeight = aimHeightFor(cue);
    target.set(
      walker.state.position.x,
      walker.state.position.y + aimHeight,
      walker.state.position.z,
    );
    if (reconstruct && view !== 'face') snapCamera();
    else {
      follow.snap(target);
      controls.snap();
    }
    syncPublicUI();
    followAudio();
    frameLoop.invalidate();
    void audio.sync(t, false, transport.rate, true);
  }
  function setRoutine(value: string) {
    if (!['story', 'keyboard', 'coast', 'air', 'fire', 'earth', 'circle', 'still'].includes(value))
      return;
    journey = value === 'air' || value === 'fire' || value === 'earth' ? value : 'sea';
    rehearsal = undefined;
    director.routine = value as WalkRoutine;
    director.reset();
    frameLoop.invalidate();
  }
  /** Where the camera aims on the body for a pose: the chest standing, lower
   * when he is on a knee, lower still once he has settled onto his heels. */
  function aimHeightFor(cue: Cue) {
    return view === 'face'
      ? 1.65
      : cue.clip === 'settle'
        ? 0.75 - 0.15 * smooth(0, SETTLE_SECONDS, cue.clipTime)
        : cue.clip === 'kneeling'
          ? 0.75
          : 0.95;
  }
  function snapCamera() {
    cameraDirector.reset();
    follow.snap(target, orientShot(sampleCameraShot(transport.time, score, coastApproach(), revealAngle(), playerDriving())));
    controls.snap();
    frameLoop.invalidate();
  }
  function cameraSteering() {
    return director.inspect(transport.time, score).mode === 'player';
  }
  function cameraStudy() {
    return (
      view === 'face' ||
      preview !== null ||
      !['story', 'air', 'fire', 'earth'].includes(director.routine)
    );
  }
  /** The climb of the last dune before the water, 0 at its foot and 1 on the crest.
   * The crest comes from the ground under the route, so retuning the pace or the
   * coastal profile keeps the turn on the climb instead of on a remembered second. */
  /** The sea walk reveals toward the moon; the altar journeys keep their rear view. */
  function revealAngle() {
    return journey === 'sea' ? seawardRevealAngle(score) : REVEAL_ANGLE;
  }
  function coastApproach() {
    const {x, z} = walker.state.position;
    const crest = coastalCrest(z);
    return 1 - THREE.MathUtils.smoothstep(x - coastX(z), crest, crest + COASTAL_CLIMB);
  }
  function orientShot(shot: ReturnType<typeof sampleCameraShot>) {
    const reveal = Math.max(
      THREE.MathUtils.smoothstep(transport.time, score.stage_08_kneel - 22, score.stage_08_kneel + 5),
      coastApproach(),
    );
    let [dx, dz] = journeyDirection(journey, score);
    const position = walker.state.position;
    // Compose an actual discovery, including one reached under WASD control.
    // The camera still yields to the viewer's active orbit/movement as usual.
    const altar = Object.values(MAP.altars).find(
      ([x, z]) => Math.hypot(x - position.x, z - position.z) < 25,
    );
    if (altar && reveal > 0) {
      const heading = Math.atan2(dx, dz);
      const toward = Math.atan2(altar[0] - position.x, altar[1] - position.z);
      const turn = Math.atan2(Math.sin(toward - heading), Math.cos(toward - heading));
      dx = Math.sin(heading + turn * reveal);
      dz = Math.cos(heading + turn * reveal);
    }
    // Portrait needs a view closer to directly behind to hold a distant landmark.
    const narrow = 1 - THREE.MathUtils.smoothstep(camera.aspect, 0.65, 1.15);
    const earth = altar === MAP.altars.earth;
    const turn = THREE.MathUtils.degToRad(earth ? 18 : 14 * narrow) * reveal;
    const x = shot.offset.x * Math.cos(turn) + shot.offset.z * Math.sin(turn);
    const z = shot.offset.z * Math.cos(turn) - shot.offset.x * Math.sin(turn);
    // The northern passage curls across the usual flank. Close from its open side
    // so the dune that conceals the altar does not also cover the final shot.
    const flank = altar === MAP.altars.air ? 1 - 2 * reveal : 1;
    let scale = 1;
    if (earth) {
      // All three peaks need room, especially in portrait. Preserve the viewer's
      // manual orbit; this only adjusts the scripted discovery shot.
      const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.aspect;
      const distance = Math.hypot(altar[0] - position.x, altar[1] - position.z);
      const behind = EARTH_ALTAR_WIDTH / (2 * halfWidth * 0.82) - distance;
      scale += (Math.max(1, behind / (Math.hypot(x, z) * framing.distanceScale)) - 1) * reveal;
    }
    const offset = {
      x: (-dx * x + dz * z * flank) * scale,
      y: shot.offset.y * scale,
      z: (-dz * x - dx * z * flank) * scale,
    };
    if (earth && scale > 1) {
      // Fitting the wide sculpture on a phone can put the camera behind the
      // eastern crest. Lift the shot enough to see the figure over that crest.
      const cx = target.x + offset.x * framing.distanceScale;
      const cz = target.z + offset.z * framing.distanceScale;
      let eyeY = target.y + offset.y * framing.distanceScale;
      for (let i = 1; i < 32; i++) {
        const f = i / 32;
        const ground = desert.field.height(cx + (target.x - cx) * f, cz + (target.z - cz) * f);
        eyeY = Math.max(eyeY, (ground + 0.25 - target.y * f) / (1 - f));
      }
      offset.y = (eyeY - target.y) / framing.distanceScale;
    }
    return {...shot, offset};
  }
  function setView(value: string) {
    view = value;
    applyCameraRange();
    const p = walker.state.position;
    aimHeight = view === 'face' ? 1.65 : 0.95;
    target.set(p.x, p.y + aimHeight, p.z);
    if (view !== 'face') {
      snapCamera();
      return;
    }
    controls.target.copy(target);
    camera.position
      .copy(target)
      .add(
        new THREE.Vector3(
          Math.sin(walker.state.facing) * 0.7,
          0.015,
          Math.cos(walker.state.facing) * 0.7 + 0.05,
        ),
      );
    follow.snap(target);
    controls.snap();
    frameLoop.invalidate();
  }
  function snapshot() {
    return {
      ready,
      time: transport.time,
      playing: transport.playing,
      started: transport.started,
      score: structuredClone(score),
      cue: sampleScore(transport.time, score, transport.started, playerDriving()),
      driving: playerDriving(),
      // The authored speed with the look-around's standing seconds put back in.
      pace: pace(score),
      motion: structuredClone(walker.state),
      direction: director.inspect(transport.time, score),
      camera: {
        ...cameraDirector.inspect(transport.time, score, cameraSteering(), cameraStudy()),
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        aspect: camera.aspect,
        fov: camera.fov,
        distanceScale: framing.distanceScale,
        minDistance: controls.input.minDistance,
      },
      rendering: frameLoop.inspect(),
      graphics: {
        ...graphics.inspect(),
        pixelRatio: renderer.getPixelRatio(),
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      },
      study: preview,
      fallen: fallen.inspect(),
      character: man.inspect(),
      lighting: desert.lighting,
      sand: desert.inspectSand(),
      sea: sea.inspect(),
      audio: audio.state,
      map: {
        layout: MAP,
        journey,
        budget: budgetCache ?? (budgetCache = travelBudget(score)),
        journeys:
          journeysCache ??
          (journeysCache = (['sea', 'air', 'fire', 'earth'] as const).map((name) =>
            surveyJourney(name, score),
          )),
      },
      route: routeCache ?? (routeCache = rehearse(score)),
      renderer: (renderer.backend as unknown as {isWebGPUBackend?: boolean}).isWebGPUBackend
        ? 'webgpu'
        : 'webgl',
    };
  }
  teardown = () => {
    frameLoop.dispose();
    audio.dispose();
    man.dispose();
    fallen.dispose();
    controls.dispose();
    desert.dispose();
    sea.dispose();
    pipeline.dispose();
    renderer.dispose();
  };
  await opened;
  if (gone()) throw left();
  // three r186's diffuse is given back what its Fresnel weighting took, per
  // pixel (see fresnel-186.ts): the assembled world, and the fallen one when it lands.
  keepDiffuse185(scene);
  // The fallen one is a mile off the walk and screened by a dune: nobody reaches
  // it who has not gone looking on foot. Holding the opening frame until it has
  // downloaded charges every viewer for a thing most of them never see, so it is
  // let in whenever it arrives and asks for one more frame when it does.
  void fallen.ready.then(
    () => {
      keepDiffuse185(fallen.object);
      frameLoop.invalidate();
    },
    () => {},
  );
  async function frame(elapsed: number): Promise<boolean> {
    // A frame is awaited twice below, and the route can leave in either gap:
    // what it would go on to draw with has been let go of by then.
    if (gone()) return false;
    // Resource changes happen only between frames, never during an awaited water pass.
    if (graphicsPending) {
      graphicsPending = false;
      await applyGraphics();
      if (gone()) return false;
    }
    const realDt = document.hidden ? 0 : elapsed;
    previousCamera.copy(camera.position);
    previousTarget.copy(controls.target);
    previousRotation.copy(camera.quaternion);
    const before = transport.time;
    // The song is the fixed thing: three minutes of it exist and it cannot be
    // hurried. The picture is what bends. One stalled frame would otherwise carry
    // the score past the music for the rest of the run, so the transport is
    // nudged back by a few parts in a hundred rather than the song being seeked,
    // a seek being the one thing here that is actually audible. The steady part
    // of the gap is the output latency Safari reports and is left alone: the
    // baseline only follows while the two are already together.
    let pull = 1;
    const song = audio.state;
    if (transport.playing && song.musicPlaying && song.musicTime > 0.05) {
      const gap = transport.time - song.musicTime;
      if (songOffset === null) songOffset = gap;
      const off = gap - songOffset;
      if (Math.abs(off) < 0.03) songOffset += off * Math.min(1, realDt / 4);
      pull = Math.min(1.03, Math.max(0.97, 1 - off * 0.5));
    } else songOffset = null;
    transport.advance(realDt * pull, score.duration);
    followAudio();
    const advance = transport.time - before;
    const manual = keys.direction(camera);
    if (advance > 0) {
      let t = before;
      while (t < transport.time) {
        const dt = Math.min(1 / 120, transport.time - t);
        // Taking the walk over as the look-around is due cancels it and the fall.
        const cue = sampleScore(t, score, true, playerDriving(t));
        const direction = director.direction(t, manual.x, manual.z, manual.engaged, score, [
          walker.state.position.x,
          walker.state.position.z,
        ]);
        walker.step(direction[0], direction[1], dt, cue.mobility, score, playerDriving(t));
        if (!playerDriving(t))
          walker.look(t + dt, score,
            journeyHeading(journey, score, [walker.state.position.x, walker.state.position.z]));
        contacts.update(walker.state);
        desert.field.update(dt);
        t += dt;
      }
    }
    // Not while the piece is doing the talking. He falls, kneels, looks around and
    // gets up, and only then, on the long walk to the dune, is the viewer told
    // there is something to take hold of. There is nothing to interrupt by then.
    if (
      !hinted &&
      transport.started &&
      transport.playing &&
      !scrubbed &&
      transport.time >= risenAt(score) + 1.5
    ) {
      hinted = true;
      showHint();
    }
    const cue = sampleScore(transport.time, score, transport.started, playerDriving());
    if (preview) {
      previewAt += Math.min(realDt, 0.05);
      cue.clip = preview;
      cue.clipTime = previewAt;
      cue.burn = preview === 'opening' ? 0 : 1;
      cue.bow = preview === 'settle' ? smooth(SETTLE_SECONDS, SETTLE_SECONDS + 3, previewAt) : 0;
      cue.mobility = 0;
      cue.phase = 'Pose study';
    }
    applyFrameCap(cue.ended && !scrubbed && preview === null);
    const effectsDt = document.hidden
      ? 0
      : transport.playing || (cue.ended && !scrubbed) || preview
        ? Math.min(realDt, 0.05)
        : 0;
    visualTime += effectsDt;
    man.update(walker.state, cue, score, visualTime, effectsDt, advance);
    const landings = contacts.updatePose(walker.state, man.feet, advance);
    desert.setContacts(man.contacts);
    // A knee presses a deeper, smaller pit than a footstep, right under the joint
    // that carries the weight. Each part prints once per pose, as it comes down,
    // rather than every frame, or he would dig himself in.
    if (cue.clip === 'kneefall' || cue.clip === 'kneeling' || cue.clip === 'settle') {
      if (pressed !== cue.clip) {
        pressed = cue.clip;
        printed = 0;
      }
      for (let i = 0; i < man.contacts.length; i++) {
        const contact = man.contacts[i]!;
        if (printed & (1 << i)) continue;
        if (contact.y - desert.field.height(contact.x, contact.z) > 0.03) continue;
        printed |= 1 << i;
        desert.field.contact({
          x: contact.x,
          z: contact.z,
          facing: walker.state.facing,
          force: 0.75,
          radius: contact.radius * 3,
          kind: 'kneel',
          load: true,
        });
      }
    } else {
      pressed = '';
      printed = 0;
    }
    aimHeight += (aimHeightFor(cue) - aimHeight) * (1 - Math.exp(-Math.min(realDt, 0.1) / 0.9));
    target.set(
      walker.state.position.x,
      walker.state.position.y + aimHeight,
      walker.state.position.z,
    );
    const shot = cameraDirector.update(
      transport.time,
      Math.min(advance, 0.1),
      score,
      cameraSteering(),
      cameraStudy(),
      coastApproach(),
      revealAngle(),
      playerDriving(),
    );
    follow.update(target, Math.min(realDt, 0.1), true, orientShot(shot));
    // The piece is finished with the sun a third of an hour after it started, and
    // the score's clock stops there. The sky need not. Left open, it goes on
    // turning at the rate the piece itself used, easing up to it the way the
    // piece eased out of it, so a page nobody closes gets full dark and then,
    // eventually, a sunrise. It costs nothing: this loop is already running for
    // the sea, and the reflection it rebuilds is cheap enough that thirty times
    // this rate did not move a frame time.
    if (cue.ended && !scrubbed && preview === null) {
      sinceEnd += effectsDt;
      skyDrift +=
        effectsDt * ((score.endHour - score.startHour) / score.duration) * smooth(0, 8, sinceEnd);
    } else sinceEnd = skyDrift = 0;
    desert.setTimeOfDay(cue.hour + skyDrift);
    desert.update(Math.min(advance, 0.1), target, visualTime);
    // The song ends, the ocean does not. Author scrubs and hidden tabs still freeze it.
    const seaDt = document.hidden
      ? 0
      : cue.ended && !scrubbed
        ? Math.min(realDt, 0.1)
        : Math.min(advance, 0.1);
    try {
      await sea.update(seaDt, camera, desert.seaLight);
    } catch (error) {
      // A readback that lands after the piece was left is not a fault of the sea's.
      if (gone()) return false;
      throw error;
    }
    if (document.hidden || gone()) return false;
    pipeline.render();
    audio.update(
      effectsDt,
      transport.time,
      walker.state.distance,
      walker.state.speed > 0.03,
      cue.burn,
      !document.hidden && (transport.playing || (cue.ended && !scrubbed)),
      score,
      {x: walker.state.position.x, z: walker.state.position.z, ground: desert.field.height},
      walker.state.gesture ? landings : undefined,
    );
    syncTime += realDt;
    if (syncTime > 0.3) {
      syncTime = 0;
      // The song ends, the score does not end it: the outro plays on over the
      // finished ending, the way the fire and the ocean do. A scrub still stops it.
      void audio.sync(transport.time, transport.playing || (cue.ended && !scrubbed), transport.rate);
    }
    syncPublicUI();
    host.dataset.phase = cue.phase;
    const cameraMoving =
      camera.position.distanceToSquared(previousCamera) > 1e-10 ||
      controls.target.distanceToSquared(previousTarget) > 1e-10 ||
      1 - Math.abs(camera.quaternion.dot(previousRotation)) > 1e-10;
    if (
      (transport.playing || (cue.ended && !scrubbed) || preview !== null) &&
      graphics.observe(realDt)
    )
      graphicsPending = true;
    return (
      graphicsPending ||
      transport.playing ||
      (cue.ended && !scrubbed) ||
      preview !== null ||
      controls.moving ||
      cameraMoving
    );
  }
  // A phone leaving the page freezes it for the back/forward cache and says so.
  // Letting go of the renderer, the audio and every listener at that point leaves
  // a corpse to come back to, and Safari, finding it cannot restore the page,
  // loads it again instead: the song starts from the top. So only let go when the
  // page is really going away, and wake back up when it is not. Leaving the
  // route inside the app is the other way out, and it is `dispose` below.
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    dispose();
  }, {signal: abort.signal});
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // Back from the freeze. The phone takes the audio clock away while it is
    // gone, so it is asked for again; the song is still where it was left, and
    // the first touch resumes a context the browser will not resume on its own.
    frameLoop.setVisible(!document.hidden);
    graphics.resetSampling();
    void audio.unlock().catch(() => {});
    followAudio();
    syncPublicUI();
  }, {signal: abort.signal});

  // Assets alone are not readiness: draw the water, skinned body and post processing first.
  await frameLoop.start();
  if (gone()) throw left();
  ready = true;
  $('#start').removeAttribute('disabled');
  $('#start').removeAttribute('aria-busy');
  return {snapshot, seek, start, togglePause, reset, applyScore, setQuality, setRoutine, setView};
  })();
  // The route reports what went wrong; a second report from here would be noise.
  ready.catch(() => {});
  return {ready, dispose, hear: (gain, hushed) => audio.hear(gain, hushed)};
}
