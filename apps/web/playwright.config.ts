import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests.
 *
 * ## What is checked here and could not be checked anywhere else
 *
 * Three things in this phase are claims about *rendering*, and a unit test
 * cannot make them:
 *
 *   - whether each of AGENTS.md's eighteen glyphs actually draws, rather than
 *     drawing a notdef box, in the font stack we ship;
 *   - whether the revision colours come out identical after a theme switch,
 *     which is AGENTS.md, UI fidelity's "must survive a theme switch intact";
 *   - whether the theme applies before first paint, with no flash.
 *
 * ## This is not yet the smoke test AGENTS.md asks for
 *
 * "The E2E smoke test walks all fourteen routes in both themes and both states."
 * Those routes do not exist. What is here walks what does exist, in both
 * themes, and it is named honestly rather than allowed to look like the real
 * thing.
 *
 * ## The dev server, and the environment it is given
 *
 * `next dev` rather than a production build: it is faster to start and this
 * suite tests rendering, not output optimisation.
 *
 * The two `NEXT_PUBLIC_SUPABASE_*` values are **deliberate dummies**, and they
 * are passed explicitly rather than read from `.env` so the suite is
 * deterministic on any machine, including one with a real project configured.
 * Nothing here signs in: `getUser()` with no session cookie fails locally,
 * without a network call, which is exactly the state route protection is about.
 * A signed-in end-to-end walk needs a real project and a test account, and is
 * flagged in the phase report as not done.
 */

const PORT = 3210

/**
 * The account the signed-in walk uses, or `null` to skip it.
 *
 * Read here, because this file is the one test-runner config that may read
 * `process.env` (see `eslint.config.mjs`), and handed to the spec as a
 * Playwright option rather than re-read there. `shell-routes.spec.ts` picks it
 * up with `test.extend`.
 */
export type WalkOptions = {
  readonly account: { readonly email: string; readonly password: string } | null
}

const EMAIL = process.env['E2E_EMAIL']
const PASSWORD = process.env['E2E_PASSWORD']
const ACCOUNT: WalkOptions['account'] =
  typeof EMAIL === 'string' && typeof PASSWORD === 'string' ? { email: EMAIL, password: PASSWORD } : null

/** Both set: the signed-in walk runs and the dev server keeps its real `.env`. */
const SIGNED_IN_WALK = ACCOUNT !== null

/*
 * `localhost`, not `127.0.0.1`.
 *
 * Next 16's dev server treats a request whose Host is `127.0.0.1` as
 * cross-origin unless the address is listed in `allowedDevOrigins`, and refuses
 * some of its own internal assets. The visible symptom is not an error page: it
 * is a page that renders perfectly and never hydrates, so every Client
 * Component is inert and every `useEffect` silently never runs - which looks
 * exactly like a broken component and is why `smoke.spec.ts` now has a test
 * that fails if hydration stops happening.
 *
 * Using the hostname the dev server already trusts is the fix, and it keeps
 * `next.config.ts` free of a setting that exists only for the test harness.
 */

export default defineConfig<WalkOptions>({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    account: ACCOUNT,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/sign-in`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    /*
     * The signed-in walk (`shell-routes.spec.ts`) is the one suite that needs
     * a real Supabase project and a real account, and it runs only when
     * `E2E_EMAIL` and `E2E_PASSWORD` are set. In that case the dummies are not
     * injected: an environment variable that is already set beats `.env`, so
     * injecting them would point the dev server at a project that does not
     * exist and every sign-in would fail. Without the two variables the walk
     * skips itself and the signed-out suites run against the dummies exactly
     * as before.
     */
    env: SIGNED_IN_WALK
      ? {}
      : {
          NEXT_PUBLIC_SUPABASE_URL: 'https://e2e-not-a-real-project.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key-not-a-real-key-0000000000',
        },
  },
})
