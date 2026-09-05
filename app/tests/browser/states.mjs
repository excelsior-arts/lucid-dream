/* The room in every state it can be in, without a model loaded.
 *
 *   node app/tests/browser/states.mjs [outdir] [session-id]
 *
 * Against the dev server by default. LUCID_WEB names another page, which is
 * how the built one is looked at — the same two modes playwright.config has:
 *
 *   LUCID_WEB=http://127.0.0.1:6969 node app/tests/browser/states.mjs tmp/after
 *
 * The script that took the baseline off the old page was the same walk with a
 * different way in: it reached for that page's own script-scope names (handle,
 * showMusing, setElsewhere, Sheets, Hatch), and a bundler renames all of
 * those. So this asks `window.__lucid` instead, and every state that can be
 * reached by handing the page a message is reached that way: `receive` is the
 * same door a real one comes through, the reducer and all. There is no socket
 * behind it any more — the page runs the conversation — so the two states that
 * were about the wire are reached the way they now happen: an address that is
 * nobody's, and a machine that will not answer.
 *
 * A past conversation is opened by its deep link, so the transcript is real.
 * What the models would have added is only the words; the look of each state
 * is the page's.
 */
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {MISSING, playwright} from '../../../tools/browsers.mjs';

const BASE = process.env.LUCID_WEB || 'http://127.0.0.1:5173';
const OUT = process.argv[2] || 'tmp/after-p4';
/* Whose conversations these pictures are of. The default is the player this
   Mac is set up as; LUCID_USER names another, which is how a run against a
   throwaway player looks at that player's evenings rather than at nothing. */
const SESSIONS = `userdata/players/${process.env.LUCID_USER || 'player1'}`
  + '/lucid-talk/sessions';

function latest(slug) {
  const all = readdirSync(SESSIONS).filter(f => f.endsWith(`_${slug}.jsonl`)).sort();
  return all.length ? all[all.length - 1].replace(/\.jsonl$/, '') : '';
}

const REPLY = 'I was hoping you would say that. Not because it settles anything, '
  + 'but because it means you were listening to the part I was not sure I said out loud. '
  + 'Stay a minute. The rain is doing the thing it does against the glass.';

/* A tick is the whole machine at once, and the reducer takes it at its word:
   a partial one would blank the persona's name and the session with it. So
   each of these is the last one the page had, with the two or three fields
   this state is about written over the top. */
const TICK = `(over) => {
  const now = window.__lucid.store.getState();
  window.__lucid.receive({
    type: 'tick',
    state: now.state, running: now.running,
    input_mode: now.input_mode, continuous: now.continuous,
    continuous_min: now.continuous_min, mic_follow: now.mic_follow,
    persona: now.persona, persona_name: now.persona_name,
    session_id: now.session_id, status: now.status, memory: now.memory,
    standing: now.standing, tts: {}, mic_barge: 'auto',
    ...over,
  });
}`;

/* Each state: a name, and what to do to a freshly opened room. Everything
   inside evaluate() runs against the debug shelf, which is the whole of what a
   test may reach for. (There was a third field — what to arrange before the
   room was opened at all — and it existed for one state, which was reached by
   wrapping WebSocket. Nothing is reached that way now.) */
const STATES = [
  ['conversation', async () => {}],
  ['thinking', async p => p.evaluate(`(() => {
    window.__lucid.receive({type: 'state', state: 'thinking'});
    (${TICK})({state: 'thinking', running: true});
  })()`)],
  ['streaming', async p => p.evaluate(`(() => {
    window.__lucid.receive({type: 'state', state: 'speaking'});
    (${TICK})({state: 'speaking', running: true});
    // Nothing has been heard, so the pacer holds nothing back: the words that
    // arrive are the words shown.
    window.__lucid.receive({type: 'assistant_delta', text: ${JSON.stringify(REPLY)}.slice(0, 90)});
  })()`)],
  ['replied', async p => p.evaluate(`(() => {
    const text = ${JSON.stringify(REPLY)};
    window.__lucid.receive({type: 'assistant_delta', text});
    window.__lucid.receive({type: 'assistant_done', text});
    window.__lucid.receive({type: 'state', state: 'idle'});
    (${TICK})({state: 'idle', running: true});
  })()`)],
  /* The meter is the page's own now — the level and the floor are the
     detector's, off this device — so it is moved by handing the detector
     something to hear rather than by a number in a tick. Two blocks, which is
     one short of arming a turn: the picture wanted is a microphone that can
     hear you, and a third block would start saying something to the machine
     this page is really connected to. */
  ['listening', async p => p.evaluate(`(() => {
    window.__lucid.receive({type: 'state', state: 'listening'});
    (${TICK})({state: 'listening', running: true, input_mode: 'mic'});
    const block = new Float32Array(512);
    for (let i = 0; i < block.length; i++) block[i] = 0.32 * Math.sin(i / 4);
    for (let i = 0; i < 2; i++) window.__lucid.audio.vad.feed(block);
  })()`)],
  ['continuous', async p => p.evaluate(`(() => {
    window.__lucid.receive({type: 'continuous', on: true, minutes: 20});
    (${TICK})({state: 'speaking', running: true, continuous: true, continuous_min: 20});
  })()`)],
  ['typing', async p => {
    if (await p.locator('#say').isHidden()) await p.locator('#t-type').click();
    await p.locator('#text').fill('Tell me about the window.');
  }],
  /* Gone is a page pointed at a conversation that is not there, reached the
     way it happens: an address naming something this room could never have
     made. It used to be an answer down the socket saying so; the page decides
     it for itself now, off the name.

     There were three banners. The third said another window had the machine,
     and it went with the machine being a thing one window at a time could
     hold: each page runs its own conversation now, so there is no such state
     left to photograph. */
  ['gone', async p => {
    const here = await p.evaluate(() => location.pathname);
    await p.goto(`${BASE}${here}?session=nobodys-conversation`);
    await p.waitForFunction(() => document.getElementById('gone')?.hidden === false,
                            null, {timeout: 10000});
  }],
  /* And adrift is the machine not answering. It is a fact about the machine
     rather than anything the page can be told, and the page finds it out the
     way it does in an evening: the five-second read of `GET /machine` stops
     coming back. So the conversation is opened for real and then that one
     route is cut, which is what a page whose Mac has gone to sleep is looking
     at, transcript and all. */
  ['adrift', async p => {
    await p.route('**/machine', route => route.abort());
    await p.waitForFunction(() => document.getElementById('adrift')?.hidden === false,
                            null, {timeout: 20000});
  }],
  /* The sheets are opened the way a person opens them from inside a room:
     by name, in the console, which is where those three doors are. */
  ['sheet-memory', async p => p.evaluate(`window.__lucid.hatch.send('memory_show')`)],
  ['sheet-sessions', async p => p.evaluate(`window.__lucid.hatch.send('sessions_list')`)],
  ['console', async p => p.evaluate(`window.__lucid.hatch.show(true)`)],
  /* By what the knob says it is rather than by where it sits: the classes are
     a stylesheet's business and this one is hashed by the bundler. */
  ['rail-volume', async p => { await p.locator('button[aria-label^="How loud"]').click(); }],
  ['rail-privacy', async p => { await p.locator('button[aria-label^="Nothing leaves"]').click(); }],
];

const pw = await playwright();
if (!pw) { console.error(MISSING); process.exit(2); }
mkdirSync(OUT, {recursive: true});
const browser = await pw.chromium.launch({args: ['--mute-audio']});

async function room(ctx, slug, sid) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  /* An empty box for every state. What was typed into one of these is kept
     across a reload on purpose — that is the whole of lucid.draft — and a run
     that types into the seventh state would otherwise be answering for the
     eight after it. Which one you were last using is a preference and stays. */
  await page.addInitScript(() => {
    try { localStorage.removeItem('lucid.draft'); localStorage.removeItem('lucid.unsent'); }
    catch { /* private window */ }
  });
  await page.goto(`${BASE}/lucid-talk/${slug}?session=${sid}`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(2500);
  try {
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('waking'), null, {timeout: 10000});
  } catch { /* the flat page is a state too */ }
  await page.waitForTimeout(600);
  return {page, errors};
}

async function run(slug, [w, h], opts, tag) {
  const sid = process.argv[3] || latest(slug);
  if (!sid) { console.log(`${slug}: no session on disk, skipping`); return; }
  const ctx = await browser.newContext({viewport: {width: w, height: h}, ...opts});
  for (const [name, apply] of STATES) {
    const {page, errors} = await room(ctx, slug, sid);
    let failed = '';
    try { await apply(page); } catch (e) { failed = String(e.message || e).split('\n')[0]; }
    await page.waitForTimeout(700);
    const file = `${slug}-${w}x${h}${tag}-${name}.png`;
    await page.screenshot({path: join(OUT, file)});
    const facts = await page.evaluate(() => ({
      msgs: document.querySelectorAll('#chat .msg').length,
      html: document.documentElement.className,
      deck: [...document.querySelectorAll('#deck button')].map(
        b => `${b.id}:${b.disabled ? 'off' : 'on'}`
             + `${b.getAttribute('aria-pressed') === 'true' ? ':pressed' : ''}`),
      banners: ['gone', 'adrift', 'say'].map(
        id => `${id}:${document.getElementById(id)?.hidden === false ? 'shown' : 'hidden'}`),
    }));
    writeFileSync(join(OUT, file.replace(/\.png$/, '.json')),
                  JSON.stringify({session: sid, errors, failed, facts}, null, 2));
    console.log(`${file}  ${failed ? 'FAILED ' + failed : errors.length ? errors.length + ' errors' : 'clean'}  msgs=${facts.msgs}`);
    await page.close();
  }
  await ctx.close();
}

await run('lover', [1440, 900], {}, '');
await run('thinker', [1440, 900], {}, '');
await run('lover', [390, 844], {isMobile: true, hasTouch: true}, '-phone');
await browser.close();
console.log('written to', OUT);
