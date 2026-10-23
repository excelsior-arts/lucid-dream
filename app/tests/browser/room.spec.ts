/* Does the room still come up?
 *
 * The narrowest possible question, and the one nothing else asks. When this
 * page throws it does it quietly: the deck is drawn by the same code that
 * failed, so what you get is a room with a dead panel in it, no error anywhere
 * a person would look, and a reload that does the same thing again.
 *
 * Every one of these was once asked of a script-scope global — paintPlay,
 * streaming, lastVoiceAt — and a bundler renames all of those. So each is
 * asked of `window.__lucid` instead, which is the whole point of that shelf
 * existing.
 *
 * A Python backend is expected: the room is a conversation, and a page with
 * no socket has nothing to draw. Which page is being asked -- the dev server
 * or a built one being served -- is playwright.config's business.
 */
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

/* The shelf, as this file needs it. Written down here rather than imported:
   what a browser test may reach for is exactly this, and a type that says so
   is the fence. */
interface Shelf {
  room?: {
    renderer: {domElement: HTMLCanvasElement};
    room: {knows: (told?: {mood?: {warmth?: number; temper?: number}})
      => {warmth: number; temper: number}};
  };
  receive?: (m: unknown) => void;
  store?: {getState: () => {transcript: {role: string}[]}};
}
/* Written out at every use rather than kept in a helper: everything inside a
   page.evaluate is serialized and run in the browser, where nothing this file
   declares exists. The cast itself is erased before it gets there. */
type Windowish = Window & {__lucid?: Shelf};
const ROOMS = ['lover', 'thinker'];

/** Everything the page itself considered an error, from the first byte. */
function watch(page: Page): string[] {
  const wrong: string[] = [];
  page.on('pageerror', (e) => wrong.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') wrong.push('console: ' + m.text()); });
  return wrong;
}

async function open(page: Page, slug: string) {
  await page.goto(`/talk/${slug}`);
  // Until the room has been tried there is no telling which of the two this
  // is, so both are held back behind a mark that says the place is opening.
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('waking'), null, {timeout: 15000});
  await page.waitForTimeout(600);
}

for (const slug of ROOMS) {
  test(`${slug} comes up clean, with a room in it`, async ({page}) => {
    const wrong = watch(page);
    await open(page, slug);

    expect(await page.evaluate(() => document.documentElement.dataset.room)).toBe(slug);
    // A room, not the flat page: the flat page is the app working correctly on
    // a machine that cannot draw, and this machine can.
    expect(await page.evaluate(() => document.documentElement.classList.contains('flat')))
      .toBe(false);
    expect(await page.evaluate(
      () => !!(window as Windowish).__lucid?.room?.renderer.domElement)).toBe(true);

    /* The one door. Everything a test is allowed to reach for is on it.
       `link` was the socket, and a room running its own conversation opens
       none — so what is left on the shelf is the sound, the console, the way a
       message is handed to the page, the room and the store. */
    const doors = await page.evaluate(
      () => Object.keys((window as Windowish).__lucid ?? {}).sort());
    expect(doors).toEqual(['audio', 'hatch', 'receive', 'room', 'store']);

    expect(wrong).toEqual([]);
  });

  test(`${slug} is lit by how the pill is holding you`, async ({page}) => {
    await open(page, slug);
    /* Not the exact numbers — those are a curve somebody may well retune — but
       that there is a filter there at all and that it runs the right way,
       which is the whole of what the effect promises. */
    const grade = await page.evaluate(() => {
      const it = (window as Windowish).__lucid!.room!;
      const canvas = it.renderer.domElement;
      const was = it.room.knows();
      const sat = (f: string) => +(/saturate\(([\d.]+)\)/.exec(f) || ['', '-1'])[1]!;
      it.room.knows({mood: {warmth: -90, temper: -20}});
      const cold = sat(canvas.style.filter);
      it.room.knows({mood: {warmth: 90, temper: 20}});
      const hot = sat(canvas.style.filter);
      it.room.knows({mood: {warmth: was.warmth, temper: was.temper}});
      return {cold, hot};
    });
    expect(grade.cold).toBeGreaterThanOrEqual(0);
    expect(grade.hot).toBeGreaterThan(grade.cold);
  });
}

test('the deck is there, and stopped', async ({page}) => {
  await open(page, 'lover');
  const keys = await page.evaluate(() => [...document.querySelectorAll('#deck .key')]
    .map((b) => `${b.id}:${(b as HTMLButtonElement).disabled ? 'off' : 'on'}`));
  expect(keys.map((k) => k.split(':')[0])).toEqual(
    ['t-back', 't-play', 't-pause', 't-stop', 't-skip', 't-rec', 't-type', 't-eject']);
  // Nothing is sounding and nothing is running, so the two keys that are only
  // about stopping something mean nothing.
  expect(keys).toContain('t-pause:off');
  expect(keys).toContain('t-stop:off');
  // No clock off a run: it is there only while a dose is playing.
  expect(await page.locator('#tape').count()).toBe(0);
});

test('a message drawn is a message that came the same way a real one does',
  async ({page}) => {
    const wrong = watch(page);
    await open(page, 'lover');
    await page.evaluate(() => {
      const receive = (window as Windowish).__lucid!.receive!;
      receive({type: 'assistant_delta', text: 'the rain is doing the thing it does'});
    });
    // Waited for rather than looked at after a fixed beat: the words go
    // through the pacer and React before they are on the glass, and on a
    // cold server a beat was not always enough.
    await page.waitForFunction(() => (document.querySelector('#chat .msg:last-child .body')
      ?.textContent ?? '').includes('the rain is doing the thing it does'), null, {timeout: 5000});
    expect(await page.locator('#chat .msg').count()).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

test('a line typed is not a line said', async ({page}) => {
  const wrong = watch(page);
  await open(page, 'lover');
  // The Type key opens the line; nothing is sent until return, which is why
  // this stops short of pressing it.
  if (await page.locator('#say').isHidden()) await page.locator('#t-type').click();
  await page.locator('#text').fill('a sentence nobody meant to send');
  await page.waitForTimeout(300);
  expect(await page.locator('#text').inputValue()).toBe('a sentence nobody meant to send');
  expect(await page.evaluate(() => document.querySelectorAll('#chat .msg.you').length))
    .toBe(await page.evaluate(() => (window as Windowish).__lucid!.store!.getState().transcript
      .filter((t) => t.role === 'user').length));
  expect(wrong).toEqual([]);
});

/* And on a phone, where the glass is the screen and scrolling it is the only
   thing anybody does. A scrolling box inside a 3D transform is one a finger
   cannot move — the browser hands the drag to the transformed layer and the
   words stay put — so at that framing the page must be laid on a plain 2D
   matrix. It looks the same and it is not the same thing to a touch. */
test.describe('on a phone', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
            deviceScaleFactor: 2});

  test('the conversation is laid flat enough for a finger', async ({page}) => {
    const wrong = watch(page);
    await open(page, 'lover');
    const how = await page.evaluate(
      () => getComputedStyle(document.getElementById('glass')!).transform);
    expect(how).toMatch(/^matrix\(/);
    expect(wrong).toEqual([]);
  });
});
