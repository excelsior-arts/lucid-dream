import {expect, test} from '@playwright/test';

/* Shelf → box → room, and back again, in one document.
 *
 * These three were three page loads and are now three routes, which is the
 * whole of phase 3: the box has to arrive as the inside of the thing that was
 * just opened, and the back button has to bring the box back rather than fetch
 * it. The marker below is how the last of those is checked — anything set on
 * `window` survives a route change and nothing survives a document load.
 *
 * Wants the Python backend on :6969 for the pills and the ledger, which the
 * dev server proxies; the pill cards come off the socket, not out of the
 * bundle.
 */

/** Nothing may be said on the console on the way through. */
function watch(page: import('@playwright/test').Page) {
  const trouble: string[] = [];
  page.on('pageerror', (e) => trouble.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') trouble.push(`console: ${m.text()}`);
  });
  return trouble;
}

test('the box is opened, a pill is taken, and the back button brings the box back', async ({
  page,
}) => {
  const trouble = watch(page);

  await page.goto('/');
  await expect(page.locator('.object')).toHaveCount(1);
  await expect(page.locator('.plaque span')).toHaveText('Lucid Talk');

  // The lid goes up, and only then does the address change.
  await page.locator('.object').click();
  await page.waitForURL('**/lucid-talk');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.card b')).toHaveText(['Purple', 'Gold']);

  // What the box knows about you, on the inside of the lid.
  await expect(page.locator('.line')).toHaveCount(2);
  await expect(page.locator('.line .tag')).toHaveText(['Purple', 'Gold']);
  await expect(page.locator('.totals .tally')).toContainText('Doses');

  // Nothing here reloads the document, and this is how that is known.
  await page.evaluate(() => {
    (window as unknown as {__flow: string}).__flow = 'the same document';
  });

  await page.locator('.card', {hasText: 'Purple'}).click();
  await page.waitForURL('**/lucid-talk/lover');
  // The room's stylesheet is scoped under html[data-page="room"]; a route
  // that arrives after another has left must still be the one <html> names,
  // or the glass and the deck are laid out as plain blocks under the stage.
  await expect(page.locator('html')).toHaveAttribute('data-page', 'room');
  await expect(page.locator('#glass')).toHaveCSS('position', 'fixed');

  await page.goBack();
  await page.waitForURL('**/lucid-talk');
  await expect(page.locator('.card')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as {__flow?: string}).__flow)).toBe(
    'the same document',
  );

  expect(trouble).toEqual([]);
});

test('a sheet says what a pill remembers, and escape puts it away', async ({page}) => {
  const trouble = watch(page);

  await page.goto('/lucid-talk');
  await expect(page.locator('.line')).toHaveCount(2);
  await page
    .locator('.line', {hasText: 'Purple'})
    .getByTitle(/remembers about you/)
    .click();
  await expect(page.locator('.sheet-head b')).toHaveText('Purple — memory');
  await expect(page.locator('.sheet-text')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);

  expect(trouble).toEqual([]);
});
