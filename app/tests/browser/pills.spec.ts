/* Does a page know which conversation it is in?
 *
 * There was one stack behind this app — one model, one voice, one mic — so
 * there was one conversation at a time, and every page connected heard about
 * it whether or not it was the page that asked. Every message carried a return
 * address, and a page kept what was its own and turned away the rest.
 *
 * That address was the single most breakable thing here, and it broke four
 * different ways: a room showing another room's transcript, one pill's voice
 * over the other's, a page that kept the "another window has the machine"
 * banner forever, and a Thinker page whose address bar said it was in a
 * conversation of Lover's.
 *
 * Each page runs its own conversation now — its own loop, its own mic, its own
 * session file — so three of those four cannot happen at all, and the banner
 * they were reported through is gone with the claim. What is left is the one
 * that still can, and it is the one that matters: a room drawing an evening
 * that is not its pill's. It is still not a thing a unit test catches, because
 * what is wrong is only wrong across a walk between rooms.
 *
 * So this walks the evening somebody actually has — one pill, the box, the
 * other pill, back again — and after every step asks whether this page is in a
 * conversation belonging to the pill whose door it is.
 *
 * Everything below is asked of the one door a test may use: the page's own
 * address bar, the banners it is wearing, and `window.__lucid.store`.
 *
 * `LUCID_ROUNDS` says how many times; the default is enough to have caught the
 * race above.
 */
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

const ROUNDS = +(process.env.LUCID_ROUNDS || 3);

/* What this file asks the page for, and nothing else. Written down here rather
   than imported: what a browser test may reach for is exactly this much. */
interface Shelf {
  store?: {
    getState: () => {
      sid: string;
      persona: string;
      room: {persona: string} | null;
    };
  };
}
/* Written out at every use rather than kept in a helper: everything inside a
   page.evaluate runs in the browser, where nothing this file declares exists. */
type Windowish = Window & {__lucid?: Shelf};

/* The size the old script used, and the one this was found at: a window with
   a room in it rather than a phone showing only the words. */
test.use({viewport: {width: 1100, height: 800}});

/** Open a door and wait for the machine to have arrived behind it. */
async function room(page: Page, where: string) {
  await page.goto(`/lucid-talk/${where}`);
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('waking'), null, {timeout: 20000});
  // The pill in the address is the pill the machine says it is on, and there
  // is a conversation with a name. Going to a door is enough to make both
  // true — that is what the persona switch does.
  await page.waitForFunction(
    (slug) => (window as Windowish).__lucid?.store?.getState().persona === slug,
    where.split('?')[0], {timeout: 20000});
  await page.waitForFunction(
    () => !!new URLSearchParams(location.search).get('session'), null, {timeout: 20000});
  /* And then a moment of nothing. What breaks here is a message that arrives
     wearing the wrong address, which is a message the page has not been sent
     yet at the instant it looks settled. */
  await page.waitForTimeout(1200);
}

/* A conversation is named for the pill it belongs to — see store.start — so
   the page's own address bar is enough to catch every one of these. */
async function check(page: Page, slug: string) {
  const at = await page.evaluate(() => {
    const now = (window as Windowish).__lucid?.store?.getState();
    return {
      sid: new URLSearchParams(location.search).get('session') || '',
      gone: document.getElementById('gone')?.hidden === false,
      persona: now?.persona ?? '',
      room: now?.room?.persona ?? '',
    };
  });
  expect(at.sid, `the ${slug} page is in ${at.sid} — another pill's conversation`)
    .toMatch(new RegExp(`_${slug}$`));
  expect(at.gone,
    `the ${slug} page says its conversation is not there`)
    .toBe(false);
  expect(at.persona, `the ${slug} page is in ${at.persona}'s conversation`).toBe(slug);
  if (at.room) expect(at.room, `the ${slug} page is holding ${at.room}'s room`).toBe(slug);
}

for (let round = 1; round <= ROUNDS; round++) {
  test(`round ${round}: every page knows which conversation it is in`, async ({page}) => {
    const wrong: string[] = [];
    page.on('pageerror', (e) => wrong.push(`pageerror: ${e.message}`));

    /* An evening with both pills in it, which is the shape that breaks. Going
       to a door is enough to open a conversation there, so by the third step
       there is a thinker conversation to come back to, and coming back takes
       the resume path rather than the starting one. The two address themselves
       at different moments, which is where this went wrong. */
    await room(page, 'thinker');
    await check(page, 'thinker');

    await room(page, 'lover');
    await check(page, 'lover');

    await page.goto('/lucid-talk');                 // the lid: back to the box
    await expect(page.locator('.card')).toHaveCount(2);
    await room(page, 'thinker');                    // and take the gold one again
    await check(page, 'thinker');

    /* And the ordinary way of picking an old evening out of the box: the doses
       list is deep links, and following one has to bring the conversation with
       it. It arrived stamped with the conversation it replaced once, so the
       page turned its own transcript away and sat there empty — no error, no
       empty state, just a room with nothing said in it. Worth a step of its
       own, because it is the one thing here somebody does on purpose to get
       something back. */
    const sid = await page.evaluate(
      () => new URLSearchParams(location.search).get('session') || '');
    const before = await page.evaluate(
      () => document.querySelectorAll('#chat .msg').length);

    await room(page, 'lover');                      // somewhere else first
    await room(page, `thinker?session=${sid}`);     // then back, by the link
    const back = await page.evaluate(() => ({
      sid: new URLSearchParams(location.search).get('session'),
      bubbles: document.querySelectorAll('#chat .msg').length,
    }));
    expect(back.sid, `asked for ${sid}, landed in ${back.sid}`).toBe(sid);
    if (before > 0) {
      expect(back.bubbles,
        `${sid} had ${before} messages and the page came up empty`).toBeGreaterThan(0);
    }
    await check(page, 'thinker');

    expect(wrong).toEqual([]);
  });
}
