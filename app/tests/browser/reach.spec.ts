/* Can everything in a room still be pressed?
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
 * So this presses every one of them, at three desk sizes, and says what
 * answered. The engine's own `reach()` is what answers — it points at where
 * each thing actually is and reports what a press there would land on — and
 * `__lucid.room` is how a test gets a hand on it.
 */
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

const ROOMS = ['lover', 'thinker'];
/* Desk sizes only, and on purpose. A phone shows the window with a room
   somewhere behind it — there is no room around the words to put a hand into,
   and the game of pushing things about is not what anybody opened it on a
   phone for. Asking anyway printed "0 of 23 reach themselves" every run,
   which is a true sentence about a thing nobody wants, and a check that
   reports a decision as a fault is a check somebody eventually silences by
   breaking the decision. See the note on `portrait` in room3d.js. */
const SIZES = [
  {width: 1440, height: 900},
  {width: 1280, height: 860},
  {width: 1100, height: 800},
];

/** What `reach()` reports for one target, as the engine's spec has it: itself,
    something else, or nothing. Written down rather than imported, for the same
    reason the shelf below is: what a browser test may reach for is exactly
    this much. `null` is "the question does not apply here". */
interface Reached {
  name: string;
  ok: boolean | null;
  why: string;
}

interface Shelf {
  room?: {room: {knows: (told?: {state?: object}) => unknown; reach: () => Reached[]}};
}
type Windowish = Window & {__lucid?: Shelf};

/* Two things a press can land on that are not faults.
 *
 * A stack gives you the book on top of it, which is what a stack is — so a
 * thing reached by something of its own kind is fine. And anything the
 * projected conversation covers belongs to the conversation, which is
 * deliberate; it is worth knowing, because something worth pressing should
 * not live *only* behind the words, but it is not a broken room.
 */
const kind = (name: string) => String(name).split('-')[0];
const fault = (r: Reached) =>
  r.ok === false
  && !/off the screen|behind the words/.test(r.why)
  && !(/reaches (.+)$/.test(r.why) && kind(RegExp.$1) === kind(r.name));

/** The room as it opens for somebody who has never touched it. */
async function asBuilt(page: Page, slug: string): Promise<Reached[]> {
  await page.goto(`/talk/${slug}`);
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('waking'), null, {timeout: 20000});
  await page.waitForFunction(
    () => !!(window as Windowish).__lucid?.room, null, {timeout: 20000});
  await page.waitForTimeout(2500);           // the room finishes building itself
  /* And it goes back to how it opens. Otherwise this reports an evening's
     play as faults: a cushion that has been pushed onto the table is genuinely
     in front of the table, and saying so every run teaches whoever reads it to
     stop reading it. What is being asked is whether the room as *built* can be
     pressed, which is the thing a rearrangement breaks. */
  await page.evaluate(() => (window as Windowish).__lucid!.room!.room.knows({state: {}}));
  await page.waitForTimeout(900);
  return page.evaluate(() => (window as Windowish).__lucid!.room!.room.reach());
}

for (const size of SIZES) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({viewport: size});

    for (const slug of ROOMS) {
      test(`nothing in ${slug}'s room is in the way of anything`, async ({page}) => {
        const broke: string[] = [];
        page.on('pageerror', (e) => broke.push(String(e)));

        const all = await asBuilt(page, slug);
        expect(all.length, 'no room mounted').toBeGreaterThan(0);

        const faults = all.filter(fault);
        expect(faults.map((r) => `${r.name} — ${r.why}`)).toEqual([]);
        expect(broke).toEqual([]);
      });
    }
  });
}
