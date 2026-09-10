import { expect, test } from '@playwright/test'

test('the browser harness runs', async ({ page }) => {
  // Trivial by design: this proves Playwright is installed, configured and
  // driving a real browser. It is not the smoke test AGENTS.md asks for --
  // that one walks all fourteen routes in both themes and both states, and it
  // cannot be written until routes exist.
  await page.setContent('<main id="folio">Folio</main>')
  await expect(page.locator('#folio')).toHaveText('Folio')
})
