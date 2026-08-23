/* Can everything in a room still be pressed?
 *
 *     node tools/reach.mjs [url-of-a-running-server]
 *
 * Everything a room remembers survives being rearranged — the save is a count
 * per name, and where a thing has got to is worked out from where it lives
 * now. What does not survive is *reachability*, and nothing complains when it
 * breaks: a chair moved eighteen inches puts itself in front of a lamp, a
 * table pushed along brings its own lid over the glass standing on it, and
 * the cursor goes on promising the room is touchable while the wrong thing
 * answers. Three of those were found by hand in one evening, each of them
 * only because somebody happened to press the right pixel.
 *
 * So this presses every one of them, at a desk size and at a phone size, and
 * says what answered. It is the one check here that needs a browser, and it
 * needs the server to be up, which is why it is not in the fast suite that
 * runs before every commit — see check.sh, which runs this too when it can.
 *
 * Playwright is not vendored. It is found in the checkout, or wherever
 * LUCID_PLAYWRIGHT says, and if it is nowhere this says so and stops rather
 * than failing as though a room were broken.
 */
import {MISSING, playwright} from './browsers.mjs';

const WHERE = process.argv[2] || 'https://127.0.0.1:6969';
const ROOMS = ['lover', 'thinker'];
/* Desk sizes only, and on purpose. A phone shows the window with a room
   somewhere behind it — there is no room around the words to put a hand into,
   and the game of pushing things about is not what anybody opened it on a
   phone for. Asking anyway printed "0 of 23 reach themselves" every run,
   which is a true sentence about a thing nobody wants, and a check that
   reports a decision as a fault is a check somebody eventually silences by
   breaking the decision. See the note on `portrait` in room3d.js. */
const SIZES = [[1440, 900], [1280, 860], [1100, 800]];

const pw = await playwright();
if (!pw) {
  console.log(MISSING);
  process.exit(0);
}
const {chromium} = pw;

/* Two things a press can land on that are not faults.
 *
 * A stack gives you the book on top of it, which is what a stack is — so a
 * thing reached by something of its own kind is fine. And anything the
 * projected conversation covers belongs to the conversation, which is
 * deliberate; it is worth printing, because something worth pressing should
 * not live *only* behind the words, but it is not a broken room.
 */
const kind = (name) => String(name).split('-')[0];
const fault = (r) => r.ok === false
  && !/off the screen|behind the words/.test(r.why)
  && !(/reaches (.+)$/.test(r.why) && kind(RegExp.$1) === kind(r.name));

const b = await chromium.launch({args: ['--mute-audio']});
let bad = 0, looked = 0;
for (const room of ROOMS) {
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ignoreHTTPSErrors: true, viewport: {width: w, height: h}});
    const p = await ctx.newPage();
    const broke = [];
    p.on('pageerror', e => broke.push(String(e)));
    try {
      await p.goto(`${WHERE}/lucid-talk/${room}`, {waitUntil: 'load', timeout: 20000});
    } catch (e) {
      console.log(`  ${room} ${w}×${h}: could not open it — is the server up?`);
      await ctx.close();
      bad++;
      continue;
    }
    await p.waitForTimeout(5200);            // the room mounts, the page settles
    /* And the room goes back to how it opens for somebody who has never
       touched it. Otherwise this reports an evening's play as faults: a
       cushion that has been pushed onto the table is genuinely in front of
       the table, and saying so every run teaches whoever reads it to stop
       reading it. What is being asked is whether the room as *built* can be
       pressed, which is the thing a rearrangement breaks. */
    await p.evaluate(() => Room.room.knows({state: {}}));
    await p.waitForTimeout(900);
    const all = await p.evaluate(
      () => (window.Room && Room.room.reach) ? Room.room.reach() : null);
    await ctx.close();
    if (!all) { console.log(`  ${room} ${w}×${h}: no room mounted`); bad++; continue; }
    looked++;
    const faults = all.filter(fault);
    const hidden = all.filter(r => r.ok === false && !fault(r));
    bad += faults.length;
    console.log(`  ${room} ${String(w).padStart(4)}×${h}  `
      + `${all.filter(r => r.ok).length}/${all.length} reach themselves`
      + (hidden.length ? `, ${hidden.length} out of view` : '')
      + (broke.length ? `  [page errors: ${broke.length}]` : ''));
    for (const r of faults) console.log(`      ✗ ${r.name} — ${r.why}`);
  }
}
await b.close();
console.log(bad ? `\n${bad} thing${bad > 1 ? 's are' : ' is'} in the way of something else.`
                : `\nnothing is in the way of anything, at ${looked} sizes.`);
process.exit(bad ? 1 : 0);
