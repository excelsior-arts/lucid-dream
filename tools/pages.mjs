/* Does the page still come up?
 *
 *     node tools/pages.mjs [url-of-a-running-server]
 *
 * The narrowest possible question, and the one nothing else here asks. The
 * fast suite is Python and never opens a page; the reach check opens one but
 * only ever asks it about the room. Neither notices a script that threw on the
 * way up — and when this page throws, it does it quietly: the deck is drawn by
 * the same script that failed, so what you get is a room with a dead panel in
 * it, no error anywhere a person would look, and a reload that does the same
 * thing again.
 *
 * Every one of these was reachable from an ordinary edit. A `let` moved below
 * its first use, a function renamed on one side of a call, a stray brace in a
 * template — all of them silent in review, all of them the whole app.
 *
 * So: open each room, wait for it to settle, and fail on anything the page
 * itself considered an error. Then ask it for the handful of names the deck is
 * actually built out of, because a script can also fail halfway and leave the
 * page looking fine.
 *
 * Playwright is found the way tools/reach.mjs finds it, and this says so and
 * stops rather than failing as though a page were broken.
 */
import {MISSING, playwright} from './browsers.mjs';

const WHERE = process.argv[2] || 'https://127.0.0.1:6969';
const ROOMS = ['lover', 'thinker'];

/* What the deck is made of. Not a list of everything — a list of the things
   whose absence is invisible until somebody presses the key that needs them.
   Add to it when a fix turns out to hinge on one more. */
const PARTS = ['letGo', 'clearChat', 'dropGrowth', 'lastSaid', 'paintCounter',
               'setGone', 'softStop',
               'paintPlay', 'lockDeck', 'stopWav', 'holdWav', 'suspendMic',
               'resumeMic', 'setElsewhere', 'send'];

const pw = await playwright();
if (!pw) {
  console.log(MISSING);
  process.exit(0);
}
const {chromium} = pw;

/* Muted, because these run while somebody may be in the room next door and a
   page that opens with a voice in it is a page that says so out loud. */
const browser = await chromium.launch({args: ['--mute-audio'],
                                       ignoreHTTPSErrors: true});
const wrong = [];

for (const room of ROOMS) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900},
                                      ignoreHTTPSErrors: true});
  page.on('pageerror', e => wrong.push(`${room}: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') wrong.push(`${room}: console — ${m.text()}`);
  });
  try {
    await page.goto(`${WHERE}/lucid-talk/${room}`, {waitUntil: 'networkidle',
                                                    timeout: 20000});
    await page.waitForTimeout(2500);        // the room builds itself after load
    /* Asked one at a time, as an expression rather than a lookup on window:
       most of these are top-level `const` in a plain script, which is a real
       binding that nothing is a property of. */
    /* And that the room is still lit by how the pill is holding you. Not the
       exact numbers — those are a curve somebody may well retune — but that
       there is a filter there at all and that it runs the right way, which is
       the whole of what the effect promises. */
    const grade = await page.evaluate(`(() => {
      const c = Room.renderer.domElement, k = Room.room.knows();
      const was = {warmth: k.warmth, temper: k.temper};
      Room.room.knows({mood: {warmth: -90, temper: -20}});
      const cold = c.style.filter;
      Room.room.knows({mood: {warmth: 90, temper: 20}});
      const hot = c.style.filter;
      Room.room.knows({mood: was});
      const sat = (f) => +(/saturate\\(([\\d.]+)\\)/.exec(f) || [0, -1])[1];
      return {cold: sat(cold), hot: sat(hot), lit: c.style.filter};
    })()`);
    if (!(grade.cold >= 0 && grade.hot > grade.cold)) {
      wrong.push(`${room}: the room is not lit by how the pill holds you `
                 + `(cold ${grade.cold}, hot ${grade.hot})`);
    }

    /* And that the waiting pulse only ever fires before the first voice.
       It answers one question — does the sound work at all — and that question
       is asked once. Marking every gap after it marks nothing. */
    const pulse = await page.evaluate(`(() => {
      const asked = [];
      const real = Lucid.sound.waiting.bind(Lucid.sound);
      Lucid.sound.waiting = (on) => { asked.push(!!on); return real(on); };
      const was = lastVoiceAt;
      lastVoiceAt = Date.now() - 60000;   // a voice has been heard
      streaming = {};                     // and a reply is on its way
      paintPlay();
      lastVoiceAt = was;
      streaming = null;
      Lucid.sound.waiting = real;
      return asked;
    })()`).catch(() => null);
    if (pulse && pulse.some(Boolean)) {
      wrong.push(`${room}: the waiting pulse asks to play mid-conversation`);
    }

    for (const part of PARTS) {
      const there = await page.evaluate(`typeof ${part} === 'function'`)
                              .catch(() => false);
      if (!there) wrong.push(`${room}: ${part}() is not there`);
    }
  } catch (e) {
    wrong.push(`${room}: never came up — ${e.message}`);
  }
  await page.close();
}

/* And on a phone, where the glass is the screen and scrolling it is the only
   thing anybody does. A scrolling box inside a 3D transform is one a finger
   cannot move — the browser hands the drag to the transformed layer and the
   words stay put — so at that framing the page must be laid on a plain 2D
   matrix. It looks the same and it is not the same thing to a touch. */
{
  const page = await browser.newPage({viewport: {width: 390, height: 844},
                                      isMobile: true, hasTouch: true,
                                      deviceScaleFactor: 2,
                                      ignoreHTTPSErrors: true});
  page.on('pageerror', e => wrong.push(`phone: ${e.message}`));
  try {
    await page.goto(`${WHERE}/lucid-talk/lover`, {waitUntil: 'networkidle',
                                                  timeout: 20000});
    await page.waitForTimeout(3000);
    const how = await page.evaluate(
      `getComputedStyle(document.getElementById('glass')).transform`);
    if (/^matrix3d/.test(how)) {
      wrong.push('phone: the conversation is laid on a 3D transform, and a '
                 + 'finger cannot scroll one');
    } else if (!/^matrix\(/.test(how)) {
      wrong.push(`phone: the conversation is not laid on the glass at all (${how})`);
    }
  } catch (e) {
    wrong.push(`phone: never came up — ${e.message}`);
  }
  await page.close();
}

await browser.close();

if (wrong.length) {
  for (const w of wrong) console.log('  ' + w);
  console.log(`\n  ${wrong.length} thing${wrong.length > 1 ? 's' : ''} wrong on the way up.`);
  process.exit(1);
}
console.log(`  both rooms come up clean, with every part of the deck in them.`);
