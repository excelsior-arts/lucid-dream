/* The models panel: what Lucid Talk runs on, what is here, and what there is
 * to download. Three sections, each with how much it matters -- the language
 * model required, the voice recommended, the microphone optional -- and one
 * total and one bar for whatever is coming down.
 *
 * Opened four ways, and the same panel each time. By itself, the first time a
 * pill is opened with no language model (Room.tsx: the required part first,
 * the rest ticked); by the gear in the corner of the box's lid, always, a Mac
 * with everything seeing it all downloaded and nothing to do; by the rail's
 * voice switch or the microphone when they find their part missing, at that
 * part's section; and by /model_choose in a room.
 *
 * Two places it runs, and the question is the same with different answers.
 * On a Mac with the machine behind the page it offers the three sizes of Qwen
 * the machine ships (machine/models.json), the smallest the minimum and the
 * one this Mac's memory is good for recommended, by setup.sh's rule; the voice
 * is Chatterbox Turbo and the microphone's ear Parakeet, one of each, ticked
 * where they are missing. On a page with no machine it offers the small
 * builds that run in this browser -- the 2B first, the 0.8B for a weaker
 * device, the 4B only where the GPU looks strong -- or, with no WebGPU, says
 * so and points at the full thing; the voice engines its GPU can run -- Turbo
 * suggested, Nano only with shader-f16, Sopro -- or no voice; and the ears
 * this browser can run on its processor, or none, typing only. A voice chosen
 * while the page is silent is fetched into the browser's cache and loaded when
 * the sound comes back (page/voice.ts); an ear is fetched and loaded when the
 * microphone is turned on (page/ear.ts).
 *
 * What is offered, what is here, what is in use and how a download is going
 * all come from `GET /machine` (llm.offer, llm.size, llm.here, llm.fetch,
 * shelf), which the machine and the page's stand-in both answer; the panel
 * only reads it, and asks with one `models.fetchAll`. A size already here and
 * chosen goes the same way: the machine finds it whole and only starts it, the
 * page's stand-in loads it from its cache, and either writes llm.size.
 *
 * And in a browser, what is downloaded can be taken back off the disk: a
 * delete on each row that is here and not in use, its confirmation in the
 * sheet's foot with what it frees, read off the cache (page/forget.ts). The
 * one in use has none: this panel is already where another is put in use,
 * or none -- No voice, No microphone -- and once it is, the delete is there.
 * Taking the words out from under a room would leave it with no pill and
 * nothing said about why. A Mac's rows have no delete: its disk is setup.sh's.
 */
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {forgetModel, heedShelf, models, status} from '@lucid/machine';
import type {Facts, Offer, Part, PartKind} from '@lucid/machine';
import {hatch, host, Mark, RunOnMac, sound, useLimited} from '@lucid/shell';
import type {CardSection} from '@lucid/shell';
import './ModelCard.css';

/* What each size is, in a line, by the name the offer carries. The machine's
   are AGENTS.md's table (the replay of September); the browser's are the
   spike of 10-08. A size nobody has written a line for is offered by its
   repository's name alone. */
const WORDS: Record<string, {name: string; note: string}> = {
  sm: {name: 'Qwen3.5 4B', note: 'runs on 8 GB; proves the machine works, and loses the character'},
  md: {name: 'Qwen3.5 9B', note: 'for 16 GB; quick, with a narrower register'},
  lg: {name: 'Qwen3.8 27B', note: 'for 32 GB and more; the one the pills were written against'},
  '0.8b': {name: 'Qwen3.5 0.8B', note: 'for a phone or a weak GPU; drifts, and echoes you'},
  '2b': {name: 'Qwen3.5 2B', note: 'the one to start with; holds a character, mostly'},
  '4b': {name: 'Qwen3.5 4B', note: 'better company, and needs a strong GPU'},
};

const gb = (n: number | undefined) => (n == null ? '' : n < 1 ? `${Math.round(n * 1000)} MB`
  : `${n.toFixed(n < 10 ? 1 : 0)} GB`);

/** How often the panel asks how a download is going. */
const EVERY_MS = 700;

/** How long the panel waits for its first answer before it says it has none,
    rather than its dots: the stand-in bounds each of its own questions
    (page/machine.ts), so this is a page whose machine stopped answering. */
export const SILENT_MS = 10_000;

/* What each voice and ear is, in a line, by the id the shelf gives it: the
   machine's from AGENTS.md, the browser's from the measurements of 10-08
   (ENGINES in machine/src/page/voice.ts). */
const PARTS: Record<string, string> = {
  tts: 'the voice the pills were written for, cloned from each one’s clip',
  stt: 'hears what you say and writes it down for the pill',
  turbo: 'the Mac’s own voice, cloned from the pill’s clip, sighs and laughs performed',
  nano: 'the small Chatterbox; a little flatter, the same tags',
  sopro: 'the smallest; clones well, performs no tags',
  moonshine: 'small and quick; hears a clear voice well, a noisy room less so',
  parakeet: 'the Mac’s own ear: hears through a noisy room; bigger, and slower to answer',
};

/** The words a page with no voice falls back to. */
const NO_VOICE = '';
/** And a page with no ear: typing only. */
const NO_EAR = '';

/** A row's delete: what it is, and -- once the cache has been asked -- what
    deleting it frees. */
interface Forgetting {
  part: PartKind;
  id: string;
  name: string;
  bytes: number | null;
  doing?: boolean;
}

/** What the in-use tag says on hover in a browser, where the other rows have a
    delete and this one has not. */
const KEPT_IN_USE = {
  llm: 'in use — put another size in use, and this one can be deleted',
  part: 'in use — choose another, or none, and this one can be deleted',
};

/** The row and, beside it, its delete: outside the label, so a press on it
    is not a press on the row's choice. */
function Row({forget, pressed, onForget, children}: {
  forget?: string; pressed?: boolean; onForget?: () => void; children: ReactNode;
}) {
  if (!onForget) return <>{children}</>;
  return (
    <div className="model-item">
      {children}
      <button type="button" className="model-forget" aria-pressed={!!pressed}
              aria-label={`Delete ${forget ?? ''} from this browser`} onClick={onForget}>delete</button>
    </div>
  );
}

/** How much a section matters, as its badge says it. */
type Need = 'required' | 'recommended' | 'optional';

function Section({id, title, need, line, limit, children}: {
  id: string; title: string; need: Need; line: ReactNode; limit?: string; children?: ReactNode;
}) {
  /* A part that is off or smaller in this browser wears the mark by its
     name (the shell's list); nothing on the machine. */
  const limited = useLimited(limit ?? '');
  return (
    <section className="model-section" aria-labelledby={`model-${id}`} data-section={id}>
      <h4 className="model-head" id={`model-${id}`}>
        <span>{title}{limited && <Mark title={`${limited.here}`} />}</span>
        <span className={`model-need ${need}`}>{need}</span>
      </h4>
      <p className="model-line">{line}</p>
      {children}
    </section>
  );
}

export default function ModelCard({onReady, onLeave, onBox, focus}: {
  onReady: () => void; onLeave: () => void; onBox?: () => void; focus?: CardSection;
}) {
  const page = !host().machine;
  const where = page ? 'in this browser' : 'on this Mac';
  const [facts, setFacts] = useState<Facts | null>(null);
  const [pick, setPick] = useState('');
  /** The browser's voice: an engine's id, or NO_VOICE. Unset until touched. */
  const [voicePick, setVoicePick] = useState<string | null>(null);
  /** The browser's ear: an ear's id, or NO_EAR. Unset until touched. */
  const [earPick, setEarPick] = useState<string | null>(null);
  /** The Mac's two parts, ticked unless somebody unticked them. */
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [asked, setAsked] = useState<{llm: boolean; parts: boolean} | null>(null);
  /** A delete pressed and not yet confirmed (or under way). */
  const [forgetting, setForgetting] = useState<Forgetting | null>(null);
  const [forgetFailed, setForgetFailed] = useState('');
  /** No answer yet, and why: said in place of the dots once SILENT_MS is up. */
  const [silent, setSilent] = useState('');
  const body = useRef<HTMLDivElement>(null);

  /* A download already under way when the panel opens -- closed and opened
     again, or opened from the box while a room's card brings it down -- is
     shown as this panel's own, its bar and its end, rather than offered
     again as if nothing were coming. Read off the first answer. */
  const pickUp = (f: Facts) => {
    const lf0 = f.llm?.fetch;
    const words = !!lf0 && (lf0.state === 'fetching' || lf0.state === 'starting');
    const rest = f.shelf?.fetch?.state === 'fetching';
    if (!words && !rest) return;
    if (words) setPick(lf0.size);
    setAsked({llm: words, parts: rest});
  };

  useEffect(() => {
    let gone = false;
    /* One read at a time: a read slower than the tick is not asked again
       on top of itself, which only queues more behind it. */
    let reading = false;
    let got = false;
    const read = () => {
      if (reading) return;
      reading = true;
      void status().then((f) => {
        if (!gone && !got) pickUp(f);
        got = true;
        if (!gone) { setFacts(f); setSilent(''); }
      }, (e: unknown) => {
        if (!gone && !got) setSilent((e as Error)?.message || String(e));
      }).finally(() => { reading = false; });
    };
    read();
    const timer = setInterval(read, EVERY_MS);
    const late = setTimeout(() => {
      if (!gone && !got) setSilent((was) => was || 'no answer');
    }, SILENT_MS);
    return () => { gone = true; clearInterval(timer); clearTimeout(late); };
  }, []);


  const llm = facts?.llm ?? null;
  const offer: Offer[] = llm?.offer ?? [];
  /* The size in use: the one the machine runs (or would start), and in a
     browser the one chosen there, as long as it is here. A size of this
     Mac's own, named in its config and not in the manifest, is in use and
     listed, and nothing else is said about it. */
  const using = llm?.here ? llm.size ?? '' : '';
  const ownSize = !!using && !offer.some((o) => o.size === using);
  const chosen = pick || using || offer.find((o) => o.suggested)?.size || offer[0]?.size || '';
  const row = offer.find((o) => o.size === chosen);
  /** A size to download, or one here to put in use: either is a fetch. */
  const llmNeeded = !!row && chosen !== using;
  const smallest = offer.reduce<Offer | null>((a, o) => (!a || o.gb < a.gb ? o : a), null);

  const voices: Part[] = facts?.shelf?.voice ?? [];
  const ears: Part[] = facts?.shelf?.ear ?? [];
  /* In a browser, the engine in use, else none; first-open (nothing to run
     yet) or opened at the voice, the suggested one is what is offered. */
  const voiceUsing = voices.find((v) => v.using)?.id ?? NO_VOICE;
  /* One that failed here is not offered again by itself: the suggested one
     is (after Turbo fails, the smallest -- see voice.ts `parts`). */
  const usingFailed = !!voices.find((v) => v.id === voiceUsing)?.error;
  const voiceChosen = voicePick
    ?? ((!usingFailed && voiceUsing)
      || (!llm?.here || focus === 'voice' || usingFailed ? voices.find((v) => v.suggested)?.id ?? NO_VOICE
        : NO_VOICE));
  const voiceRow = page ? voices.find((v) => v.id === voiceChosen) : undefined;
  const voiceNeeded = page && voices.length > 0
    && (voiceChosen !== voiceUsing || (!!voiceRow && !voiceRow.here));
  /* The ear, the same way, except that it is optional: offered ticked only
     when somebody reached for the microphone and found it missing. */
  const earUsing = ears.find((p) => p.using)?.id ?? NO_EAR;
  const earChosen = earPick
    ?? (earUsing || (focus === 'ear' ? ears.find((p) => p.suggested)?.id ?? NO_EAR : NO_EAR));
  const earRow = page ? ears.find((p) => p.id === earChosen) : undefined;
  const earNeeded = page && ears.length > 0
    && (earChosen !== earUsing || (!!earRow && !earRow.here));
  /* On a Mac, what is missing is offered ticked; what is here is listed. */
  const macParts = page ? [] : [...voices, ...ears].filter((p) => !p.here);
  const ticked = macParts.filter((p) => !skip[p.id]);

  /* What runs on the GPU, which a browser needs room for; the ear runs on
     the processor and is not in that count. */
  const onGpu = (llmNeeded && !row?.here ? row?.gb ?? 0 : 0)
    + (voiceNeeded && voiceRow && !voiceRow.here ? voiceRow.gb : 0);
  const total = onGpu + (earNeeded && earRow && !earRow.here ? earRow.gb : 0)
    + ticked.reduce((n, p) => n + p.gb, 0);
  const toDo = llmNeeded || voiceNeeded || earNeeded || ticked.length > 0;

  const lf = llm?.fetch ?? null;
  const pf = facts?.shelf?.fetch ?? null;
  const mine = asked?.llm && lf && lf.size === chosen ? lf : null;
  const parts = asked?.parts ? pf : null;
  const busy = mine?.state === 'fetching' || mine?.state === 'starting' || parts?.state === 'fetching';
  const done = !!asked && (!asked.llm || mine?.state === 'done') && (!asked.parts || parts?.state === 'done');
  /* The words up and the voice (or the ear) failed beside them: nothing
     closes by itself -- the failure is the row's to say -- and the words
     are not kept from anybody: going on is one press. */
  const wordsUp = !!asked?.llm && mine?.state === 'done';
  const partsFailed = !!asked?.parts && parts?.state === 'error';
  const failed = (mine?.state === 'error' && mine.error)
    || (partsFailed && (wordsUp
      ? `the voice did not start — ${parts?.error ?? 'it would not load'}. The words are ready: go on without it, `
        + 'or choose another voice.'
      : `the voice did not start — ${parts?.error ?? 'it would not load'}.`)) || '';

  useEffect(() => {
    if (!done) return;
    hatch.say(asked?.llm ? `the ${chosen} model is ready` : 'it is here');
    // A Mac's voice switch and microphone hear what came down.
    if (!page) void heedShelf();
    const t = setTimeout(onReady, 500);
    return () => clearTimeout(t);
  }, [done, chosen, onReady, asked, page]);

  /* Opened for the voice or the microphone: that section, in view. */
  const ready = !!facts;
  useEffect(() => {
    if (!ready || !focus) return;
    body.current?.querySelector(`[data-section="${focus}"]`)?.scrollIntoView?.({block: 'start'});
  }, [ready, focus]);

  if (!facts || !llm) {
    /* Never the dots for good: what did not answer, and the way out. */
    if (silent) {
      return (
        <>
          <div className="sheet-body">
            <p className="sheet-say model-error">
              {page ? 'This browser did not say which models it holds' : 'This Mac did not say which models it has'}
              {silent === 'no answer' ? ` in ${SILENT_MS / 1000} seconds.` : `: ${silent}.`} It is still
              being asked; this fills in when it answers. Reloading the page asks afresh.
            </p>
          </div>
          <div className="sheet-foot">
            <span />
            <button type="button" className="sheet-no" onClick={onLeave}>Close</button>
          </div>
        </>
      );
    }
    return <div className="sheet-body"><div className="sheet-wait">…</div></div>;
  }

  if (page && llm.why) {
    return (
      <>
        <div className="sheet-body">
          <p className="sheet-say">
            {llm.why === 'limits'
              ? llm.said ?? 'This browser’s graphics can’t run the pill yet. A browser update may lift that. '
                + 'Chrome, Edge and Safari run it, or run it on your Mac.'
              : <>This browser cannot run the pill: it has no WebGPU, or only a software one, which
                 would take about a minute to say its first word. Chrome or Edge on a computer can,
                 and Safari 26.</>}
          </p>
          <p className="sheet-say model-more">
            The full Lucid Talk — a 27B model, a voice and a microphone — runs on your own Mac.
          </p>
          <div className="model-mac"><RunOnMac /></div>
        </div>
        {/* From a room, the room is still worth a look: it draws (WebGL, not
            WebGPU), and steps in with no pill -- the line marked, the keys
            that would ask for a turn dark. From the box, only the way back. */}
        <div className="sheet-foot">
          <span />
          {onBox ? (
            <>
              <button type="button" className="sheet-no" onClick={onBox}>Back to the box</button>
              <button type="button" className="sheet-yes" onClick={onLeave}>Step in anyway</button>
            </>
          ) : (
            <button type="button" className="sheet-no" onClick={onLeave}>Back to the box</button>
          )}
        </div>
      </>
    );
  }

  /* A row's delete, pressed: what it frees is asked of the cache, and the
     foot asks whether to. Pressed again, put away. */
  const askForget = (part: PartKind, id: string, name: string) => {
    setForgetFailed('');
    if (forgetting?.part === part && forgetting.id === id) { setForgetting(null); return; }
    setForgetting({part, id, name, bytes: null});
    void forgetModel(part, id, {dry: true}).then(
      (got) => setForgetting((was) => (was?.part === part && was.id === id ? {...was, bytes: got.bytes} : was)),
      (e: unknown) => { setForgetting(null); setForgetFailed((e as Error)?.message ?? String(e)); });
  };
  const doForget = () => {
    if (!forgetting) return;
    const it = forgetting;
    setForgetting({...it, doing: true});
    void forgetModel(it.part, it.id).then((got) => {
      hatch.say(`${it.name} deleted from this browser — ${gb(got.bytes / 1e9)} freed`);
      setForgetting(null);
      // Read again now rather than at the next tick, so the row says so at once.
      void status().then(setFacts, () => {});
    }, (e: unknown) => { setForgetting(null); setForgetFailed((e as Error)?.message ?? String(e)); });
  };
  /** A row's delete, where it has one: in a browser, here, not in use, and
      nothing coming down. */
  const forgetFor = (part: PartKind, id: string, name: string, here: boolean, inUse: boolean) =>
    (page && here && !inUse && !busy ? {
      forget: name, pressed: forgetting?.part === part && forgetting.id === id,
      onForget: () => askForget(part, id, name),
    } : {});

  const go = () => {
    const want: {size?: string; voice?: string; ear?: boolean | string} = {};
    if (llmNeeded) want.size = chosen;
    if (voiceNeeded) want.voice = voiceChosen;
    if (earNeeded) want.ear = earChosen;
    if (!page) {
      const v = ticked.find((p) => p.id === 'tts');
      if (v) want.voice = v.id;
      if (ticked.some((p) => p.id === 'stt')) want.ear = true;
    }
    const partsAsked = !!want.voice || !!want.ear;
    if (!want.size && want.voice === undefined && want.ear === undefined) { onReady(); return; }
    /* One already here goes the same way: the machine finds it whole and
       only starts it, and the page's stand-in loads it from its cache. Marked
       as asked once the answer is back, so a `done` left over from an earlier
       fetch is not read as this one's. */
    void models.fetchAll(want).then(
      () => setAsked({llm: !!want.size, parts: partsAsked}),
      (e: unknown) => hatch.say(`could not fetch that: ${(e as Error)?.message ?? e}`, 'error'));
  };

  // A size already here is a load, not a download: it is not in the bar.
  const llmBytes = asked?.llm && !row?.here;
  const got = (llmBytes ? mine?.got_gb ?? 0 : 0) + (parts?.got_gb ?? 0);
  const whole = (llmBytes ? mine?.gb ?? row?.gb ?? 0 : 0) + (asked?.parts ? parts?.gb ?? 0 : 0);
  const share = whole ? Math.min(1, got / whole) : done ? 1 : 0;
  const showBar = !!asked && (busy || done);

  /* A part that is here, on a Mac: listed, in use, nothing to press. */
  const kept = (p: Part) => (
    <div key={p.id} className="model-row still">
      <b>{p.name}</b>
      <span className="model-gb">{gb(p.gb)}</span>
      <span className="model-tag here">{where}</span>
      <span className="model-tag using">in use</span>
      <span className="model-note">{PARTS[p.id] ?? ''}</span>
    </div>
  );
  /* And one that is not: ticked, unless left out. */
  const missing = (p: Part) => (
    <label key={p.id} className={`model-row${skip[p.id] ? '' : ' on'}`}>
      <input type="checkbox" checked={!skip[p.id]} disabled={busy}
             onChange={(e) => setSkip((was) => ({...was, [p.id]: !e.target.checked}))} />
      <b>{p.name}</b>
      <span className="model-gb">{gb(p.gb)}</span>
      <span className="model-tag none">not downloaded</span>
      <span className="model-note">{PARTS[p.id] ?? ''}
        {p.id === 'tts' ? ' — without it, the words at a reading pace'
          : ' — without it, typing only'}</span>
    </label>
  );

  return (
    <>
      <div className="sheet-body" ref={body}>
        <p className="sheet-say">
          {focus === 'voice'
            ? (page ? <>A voice for the pills, run in this browser like the words: downloaded once
                 from Hugging Face and kept here.</>
               : <>The voice is not on this Mac yet. It downloads once and stays on this Mac.</>)
            : focus === 'ear'
              ? (page ? <>Speaking, run in this browser like the words: a small model that hears
                   what you say, downloaded once from Hugging Face and kept here. Nothing you say
                   leaves this browser.</>
                 : <>The microphone&rsquo;s speech recognition is not on this Mac yet: without it
                   the pills can only read what you type. It downloads once and stays on this
                   Mac.</>)
              : !llm.here
                ? (page
                  ? <>This page runs the pill in your browser, on your own computer; nothing you say
                     leaves it. It needs a small language model, and a voice if you want one,
                     downloaded once from Hugging Face and kept in this browser.</>
                  : <>The pill needs a language model on this Mac, and there is none yet. Choose a
                     size to download; it stays on this Mac.
                     {macParts.length > 0 && <> The voice it speaks in and the speech recognition
                       it listens with come down beside it, unless you leave them out.</>}</>)
                : !toDo && (page || macParts.length === 0)
                  ? <>What Lucid Talk runs {where}. Everything it needs is downloaded.</>
                  : <>What Lucid Talk runs {where}, and what else it could download.</>}
        </p>

        <Section id="words" title="Language model" need="required" limit="words"
                 line={<>The words. One is needed; the smallest is the minimum
                   {page ? ', and the recommended one is what this browser’s GPU looks able to run.'
                     : `, and the recommended one fits this Mac’s ${llm.ram_gb ?? '?'} GB.`}</>}>
          <div className="model-offer" role="radiogroup" aria-label="Language model">
            {offer.map((o) => {
              const w = WORDS[o.size];
              const inUse = o.size === using;
              const name = w?.name ?? o.repo.split('/').pop() ?? o.size;
              return (
                <Row key={o.size} {...forgetFor('llm', o.size, name, o.here, inUse)}>
                <label className={`model-row${o.size === chosen ? ' on' : ''}`}>
                  <input type="radio" name="model" value={o.size} checked={o.size === chosen}
                         disabled={busy} onChange={() => setPick(o.size)} />
                  <b>{name}</b>
                  <span className="model-gb">{gb(o.gb)}</span>
                  {o === smallest && <span className="model-tag">minimum</span>}
                  {o.suggested && <span className="model-tag">
                    {page ? 'recommended' : `recommended for ${llm.ram_gb ?? '?'} GB`}</span>}
                  {o.here ? <span className="model-tag here">{where}</span>
                    : o.unknown ? <span className="model-tag none"
                                        title="this browser’s storage did not answer in time">not checked</span>
                      : <span className="model-tag none">not downloaded</span>}
                  {inUse && <span className="model-tag using"
                                   title={page ? KEPT_IN_USE.llm : undefined}>in use</span>}
                  {w && <span className="model-note">{w.note}</span>}
                </label>
                </Row>
              );
            })}
            {ownSize && (
              <label className={`model-row${chosen === using ? ' on' : ''}`}>
                <input type="radio" name="model" value={using} checked={chosen === using}
                       disabled={busy} onChange={() => setPick(using)} />
                <b>{using}</b>
                <span className="model-tag here">{where}</span>
                <span className="model-tag using">in use</span>
                <span className="model-note">named in this Mac&rsquo;s own config</span>
              </label>
            )}
          </div>
        </Section>

        <Section id="voice" title="Voice" need="recommended"
                 line={<>For the full experience: each pill speaks in its own voice. Without one,
                   the words appear at a reading pace.</>}>
          {page ? (
            <>
              <div className="model-offer" role="radiogroup" aria-label="Voice">
                {[...voices, null].map((v) => {
                  const id = v?.id ?? NO_VOICE;
                  return (
                    <Row key={id || 'none'} {...(v ? forgetFor('voice', v.id, v.name, v.here, id === voiceUsing) : {})}>
                    <label className={`model-row${id === voiceChosen ? ' on' : ''}`}>
                      <input type="radio" name="voice" value={id} checked={id === voiceChosen}
                             disabled={busy} onChange={() => setVoicePick(id)} />
                      <b>{v ? v.name : 'No voice'}</b>
                      {v && <span className="model-gb">{gb(v.gb)}</span>}
                      {v?.suggested && <span className="model-tag">recommended</span>}
                      {v?.error ? <span className="model-tag failed">failed</span>
                        : v && (v.here ? <span className="model-tag here">{where}</span>
                          : <span className="model-tag none">not downloaded</span>)}
                      {/* Chosen and still coming down (or let go of by the
                          browser's cache) is chosen, not in use. */}
                      {id === voiceUsing && <span className="model-tag using"
                                                  title={v?.here ? KEPT_IN_USE.part : undefined}>
                        {!v || v.here ? 'in use' : 'chosen'}</span>}
                      <span className="model-note">{v ? PARTS[v.id] ?? '' : 'text only: the words at a reading pace'}</span>
                      {v?.error && <span className="model-note model-why">
                        Did not start here: {v.error}.{' '}
                        {v.suggested ? 'Try it again, or choose No voice.'
                          : `Try ${voices.find((o) => o.suggested && !o.error)?.name ?? 'another voice'}, or No voice.`}
                      </span>}
                    </label>
                    </Row>
                  );
                })}
              </div>
              {sound.silent && voiceChosen !== NO_VOICE && voiceNeeded && (
                <p className="sheet-say model-more">The sound is off: the voice comes down now and
                  loads when the sound is back.</p>
              )}
            </>
          ) : (
            <div className="model-offer" aria-label="Voice">
              {voices.map((p) => (p.here ? kept(p) : missing(p)))}
            </div>
          )}
        </Section>

        <Section id="ear" title="Microphone" need="optional" limit="ear"
                 line={<>Lucid Talk takes two inputs: typing and speaking. Typing is enough; the
                   microphone lets you talk instead.</>}>
          {page ? (
            <>
              <div className="model-offer" role="radiogroup" aria-label="Microphone">
                {[...ears, null].map((p) => {
                  const id = p?.id ?? NO_EAR;
                  return (
                    <Row key={id || 'none'} {...(p ? forgetFor('ear', p.id, p.name, p.here, id === earUsing) : {})}>
                    <label className={`model-row${id === earChosen ? ' on' : ''}`}>
                      <input type="radio" name="ear" value={id} checked={id === earChosen}
                             disabled={busy} onChange={() => setEarPick(id)} />
                      <b>{p ? p.name : 'No microphone'}</b>
                      {p && <span className="model-gb">{gb(p.gb)}</span>}
                      {p?.suggested && <span className="model-tag">recommended</span>}
                      {p && (p.here ? <span className="model-tag here">{where}</span>
                        : <span className="model-tag none">not downloaded</span>)}
                      {id === earUsing && <span className="model-tag using"
                                                title={p?.here ? KEPT_IN_USE.part : undefined}>
                        {!p || p.here ? 'in use' : 'chosen'}</span>}
                      <span className="model-note">{p ? PARTS[p.id] ?? '' : 'typing only'}</span>
                    </label>
                    </Row>
                  );
                })}
              </div>
              {ears.length > 0 && (
                <p className="sheet-say model-more">It listens in this browser, on the
                  computer&rsquo;s processor: nothing you say leaves it.</p>
              )}
            </>
          ) : (
            <div className="model-offer" aria-label="Microphone">
              {ears.map((p) => (p.here ? kept(p) : missing(p)))}
            </div>
          )}
        </Section>

        {page && (
          <>
            <p className="sheet-say model-more">
              A sketch of the real thing, which runs a 27B model with a voice and a microphone on
              your own Mac.
            </p>
            <div className="model-mac"><RunOnMac /></div>
          </>
        )}
      </div>
      {/* Under the choices and above the buttons, where it is seen however
          far the list scrolls. */}
      {showBar && (
        <div className="model-progress">
          <div className="model-bar"><i style={{width: `${Math.round(share * 100)}%`}} /></div>
          <span>
            {done ? 'ready'
              : mine?.state === 'starting' && parts?.state !== 'fetching' ? 'starting it…'
                : `downloading — ${gb(got)} of ${gb(whole)}`}
          </span>
        </div>
      )}
      {(failed || forgetFailed) && <p className="sheet-say model-error model-fail">
        That did not work: {failed || forgetFailed}</p>}
      {forgetting ? (
        /* The delete's question, where the sheet asks everything else: what
           goes, what it frees, and that it can come back. Keep is the easy
           answer and comes first. */
        <div className="sheet-foot model-forgetting" role="group" aria-label="Delete a model">
          <span>{forgetting.bytes === null
            ? `Delete ${forgetting.name}? Measuring what it frees…`
            : `Delete ${forgetting.name} from this browser? It frees ${gb(forgetting.bytes / 1e9)}; `
              + 'it can be downloaded again.'}</span>
          <button type="button" className="sheet-no" onClick={() => setForgetting(null)}
                  disabled={forgetting.doing}>Keep it</button>
          <button type="button" className="sheet-yes danger" onClick={doForget}
                  disabled={forgetting.bytes === null || forgetting.doing}>
            {forgetting.doing ? 'Deleting…' : 'Delete'}</button>
        </div>
      ) : (
      <div className="sheet-foot">
        <span>{total > 0 ? `${gb(total)} in all` : ''}{page && onGpu > 0
          ? ` · about ${onGpu < total ? gb(2 * onGpu) : 'twice that'} free on the GPU` : ''}</span>
        {toDo ? (
          <>
            {wordsUp && partsFailed ? (
              <button type="button" className="sheet-no" onClick={onReady}>
                Go on without it
              </button>
            ) : (
              <button type="button" className="sheet-no" onClick={onLeave} disabled={busy}>
                Not now
              </button>
            )}
            <button type="button" className="sheet-yes" onClick={go} disabled={busy || !chosen}>
              {total > 0 ? 'Download' : 'Use it'}
            </button>
          </>
        ) : (
          <button type="button" className="sheet-no" onClick={onLeave}>Close</button>
        )}
      </div>
      )}
    </>
  );
}
