import { expect, test } from '@playwright/test'

/**
 * What exists, walked in both themes.
 *
 * **This is not the smoke test AGENTS.md asks for.** That one "walks all
 * fourteen routes in both themes and both states"; none of the fourteen is
 * built. Naming the difference here rather than letting the file title imply
 * coverage it does not have.
 *
 * Nobody is signed in for any of this. The Supabase project in
 * `playwright.config.ts` is a dummy, and `getUser()` with no session cookie
 * fails locally without a network call - which is exactly the state route
 * protection is about. The signed-in half of the walk needs a real project and
 * a test account and is flagged in the phase report as not done.
 */

test.describe('route protection', () => {
  test('/app sends a signed-out visitor to sign-in, carrying where they were going', async ({
    page,
  }) => {
    await page.goto('/app')
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp/)
  })

  test('a deep link under /app is preserved through the bounce', async ({ page }) => {
    await page.goto('/app/screenwriting')
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fscreenwriting/)
  })

  test('/ forwards a signed-out visitor to sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in$/)
  })
})

test.describe('the sign-in page', () => {
  test('offers both methods', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('offers a way out of a forgotten password, which is why the auth model changed', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Forgotten your password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(page.getByRole('button', { name: 'Send a reset link' })).toBeVisible()
  })

  test('reaches sign-up', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Create one' }).click()
    await expect(page).toHaveURL(/\/sign-up$/)
  })

  test('shows a bounced callback problem where the person can act on it', async ({ page }) => {
    await page.goto('/sign-in?problem=Email+link+is+invalid+or+has+expired')
    await expect(page.getByRole('alert')).toContainText('Email link is invalid or has expired')
  })

  /**
   * The one test here that needs the page to be *alive*, and it is deliberate.
   *
   * A Next dev server that considers the request cross-origin serves a page
   * that renders perfectly and never hydrates: every Client Component is inert
   * and every `useEffect` silently never runs. Nothing else in this suite would
   * notice - the rest is server-rendered HTML and `page.evaluate`. This is the
   * canary, and `playwright.config.ts` records what tripped it.
   *
   * It is also an honest end-to-end check of the whole server-action path -
   * form, `useActionState`, the action, the discriminated result, the error
   * rendered beside the field it belongs to - and it needs no Supabase project,
   * because Zod refuses the address before any Supabase call is made.
   *
   * **The address is `a@b`, not `not-an-address`, and that is the point.** The
   * input is `type="email" required`, so the browser's own constraint
   * validation refuses an obviously malformed address and the form never
   * submits - which is correct, and which makes it useless for testing the
   * server. `a@b` is an address the browser accepts and Zod does not (it wants a
   * dot and a two-letter TLD), so it reaches the action. Two validators
   * disagreeing is normal; the server is the one that decides.
   */
  test('a bad address is refused by the server action and shown beside the field', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill('a@b')
    await page.getByLabel('Password').fill('whatever-goes-here')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('That does not look like an email address.')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    // Still on the page: a refused sign-in must not navigate.
    await expect(page).toHaveURL(/\/sign-in$/)
  })
})

for (const theme of ['dark', 'light'] as const) {
  test(`the signed-out routes render in the ${theme} theme`, async ({ page }) => {
    for (const path of ['/sign-in', '/sign-up', '/forgot-password']) {
      await page.goto(path)
      await page.evaluate((next) => {
        localStorage.setItem('folio.theme', next)
      }, theme)
      await page.reload()
      await page.evaluate(() => document.fonts.ready)

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      const name = path.replace('/', '')
      await page.screenshot({ path: `test-results/${name}-${theme}.png` })
    }
  })
}
