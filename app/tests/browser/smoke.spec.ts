import {expect, test} from '@playwright/test';

// The whole of phase 1's promise: three routes that mount and say nothing on
// the console. A page that throws while booting still renders its markup, so
// "it looked right" is not the check -- the console is.
const ROUTES = ['/', '/lucid-talk', '/lucid-talk/lover'];

for (const route of ROUTES) {
  test(`${route} boots clean`, async ({page}) => {
    const trouble: string[] = [];
    page.on('pageerror', (e) => trouble.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') trouble.push(`console: ${m.text()}`);
    });
    await page.goto(route);
    await expect(page.locator('#app')).not.toBeEmpty();
    expect(trouble).toEqual([]);
  });
}
