/* Does a page know which conversation it is in?
 *
 *     node tools/pills.mjs [url-of-a-running-server]
 *
 * There is one stack behind this app — one model, one voice, one mic — so
 * there is one conversation at a time, and every page connected hears about
 * it whether or not it is the page that asked. Every message therefore carries
 * a return address, and a page keeps what is its own and turns away the rest.
 *
 * That address is the single most breakable thing here, and it has broken
 * four different ways: a room showing another room's transcript, one pill's
 * voice over the other's, a page that kept the "another window has the
 * machine" banner forever, and a Thinker page whose address bar said it was in
 * a conversation of Lover's. The last one was a race — the address was put on
 * as the message was *sent* rather than as it was *made*, so a line written
 * before a pill was swapped could go out wearing the new pill's name over the
 * old conversation's id.
 *
 * None of that has a unit test worth the name, because what is wrong is only
 * wrong across two pages, a socket and a persona switch. So this walks the
 * evening somebody actually has — one pill, the box, the other pill, back
 * again — and after every step asks the one question that catches all four:
 * is this page in a conversation belonging to the pill whose door it is.
 *
 * Being a race, it is worth running more than once. `LUCID_ROUNDS` says how
 * many; the default is enough to have caught the one above.
 */
import {MISSING, playwright} from './browsers.mjs';

const WHERE = process.argv[2] || 'https://127.0.0.1:6969';
const ROUNDS = +(process.env.LUCID_ROUNDS || 3);

const pw = await playwright();
if (!pw) {
  console.log(MISSING);
  process.exit(0);
}
const {chromium} = pw;

const browser = await chromium.launch({args: ['--mute-audio'],
                                       ignoreHTTPSErrors: true});
const wrong = [];

/* A conversation is named for the pill it belongs to — see store.start — so
   the page's own address bar is enough to catch every one of these. */
async function check(page, slug, step) {
  const at = await page.evaluate(() => ({
    search: location.search,
    taken: !!(document.getElementById('taken')
              && !document.getElementById('taken').hidden),
    room: (window.RoomLink && window.RoomLink.last || {}).persona || '',
  }));
  const sid = new URLSearchParams(at.search).get('session') || '';
  if (sid && !sid.endsWith('_' + slug)) {
    wrong.push(`${step}: the ${slug} page is in ${sid} — another pill's conversation`);
  }
  if (at.taken) {
    wrong.push(`${step}: the ${slug} page says another window has the machine, `
               + `and nothing else is open`);
  }
  if (at.room && at.room !== slug) {
    wrong.push(`${step}: the ${slug} page is holding ${at.room}'s room`);
  }
}

for (let round = 1; round <= ROUNDS; round++) {
  const page = await browser.newPage({viewport: {width: 1100, height: 800},
                                      ignoreHTTPSErrors: true});
  page.on('pageerror', e => wrong.push(`round ${round}: ${e.message}`));
  const go = async (where, wait) => {
    await page.goto(`${WHERE}/lucid-talk/${where}`, {waitUntil: 'networkidle',
                                                     timeout: 20000});
    await page.waitForTimeout(wait);
  };
  try {
    /* An evening with both pills in it, which is the shape that breaks. Going
       to a door is enough to open a conversation there — that is what the
       persona switch does — so by the third step there is a thinker
       conversation to come back to, and coming back takes the resume path
       rather than the starting one. The two address themselves at different
       moments, which is where this went wrong. */
    await go('thinker', 2800);
    await check(page, 'thinker', `round ${round}, thinker first`);

    await go('lover', 2800);
    await check(page, 'lover', `round ${round}, then lover`);

    await go('', 1200);                       // the lid: back to the box
    await go('thinker', 3200);                // and take the gold one again
    await check(page, 'thinker', `round ${round}, back to thinker`);

    /* And the ordinary way of picking an old evening out of the box: the doses
       list is deep links, and following one has to bring the conversation with
       it. It arrived stamped with the conversation it replaced once, so the
       page turned its own transcript away and sat there empty — no error, no
       empty state, just a room with nothing said in it. Worth a step of its
       own, because it is the one thing here somebody does on purpose to get
       something back. */
    const sid = await page.evaluate(() =>
      new URLSearchParams(location.search).get('session'));
    const before = await page.evaluate(() =>
      document.querySelectorAll('#chat .msg').length);
    if (sid) {
      await go('lover', 2200);                  // somewhere else first
      await go(`thinker?session=${sid}`, 3200); // then back, by the link
      const back = await page.evaluate(() => ({
        sid: new URLSearchParams(location.search).get('session'),
        bubbles: document.querySelectorAll('#chat .msg').length,
      }));
      if (back.sid !== sid) {
        wrong.push(`round ${round}, deep link: asked for ${sid}, `
                   + `landed in ${back.sid}`);
      } else if (before > 0 && back.bubbles === 0) {
        wrong.push(`round ${round}, deep link: ${sid} had ${before} messages `
                   + `and the page came up empty`);
      }
      await check(page, 'thinker', `round ${round}, deep link`);
    }
  } catch (e) {
    wrong.push(`round ${round}: never got through the evening — ${e.message}`);
  }
  await page.close();
}
await browser.close();

if (wrong.length) {
  for (const w of wrong) console.log('  ' + w);
  console.log(`\n  ${wrong.length} wrong, over ${ROUNDS} times through.`);
  process.exit(1);
}
console.log(`  every page knew which conversation it was in, ${ROUNDS} times through.`);
