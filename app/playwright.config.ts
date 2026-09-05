import {defineConfig, devices} from '@playwright/test';

/* Where the page is, and who is expected to have started it.
 *
 * Two ways to run these, and the difference is only which page is being
 * looked at. Nothing set: this starts `npm run dev` and points the tests at
 * it, which is the loop somebody works in. LUCID_WEB set to the address of a
 * running server -- `./run.sh`, serving what `npm run build` wrote -- and
 * nothing is started here at all, because the whole point of that run is to
 * look at the thing somebody is actually playing. That is what check.sh does.
 *
 * Either way the backend has to be up: a room is a conversation, and a page
 * with no socket has nothing to draw.
 */
const WEB = process.env.LUCID_WEB;
const DEV = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests/browser',
  /* The machine, awake, before the first assertion. See tests/browser/awake.ts:
     the first `GET /machine` builds the stack, and the first spec to run asks
     about the ledger inside five seconds. */
  globalSetup: './tests/browser/awake.ts',
  /* One at a time, because there is one machine behind all of this: one model,
     one voice, one microphone. Two browsers open at once is not a faster test
     run, it is two of them queueing for the same model and each blaming the
     other for the wait. */
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: WEB || DEV,
    // The certificate is this machine's own, and only exists so a phone can
    // hear you; a browser here has no reason to trust it and no reason to care.
    ignoreHTTPSErrors: true,
    // These run while somebody may be in the room next door, and a page that
    // opens with a voice in it is a page that says so out loud.
    launchOptions: {args: ['--mute-audio']},
  },
  projects: [{name: 'chromium', use: devices['Desktop Chrome']}],
  ...(WEB
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: DEV,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
