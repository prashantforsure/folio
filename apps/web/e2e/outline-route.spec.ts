import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'

/**
 * The Outline route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No outline; the nav's Outline row
 *      prints `—`.
 *   2. **The outline is a document.** Starting one writes a `kind = 'outline'`
 *      document; typing a heading (`⌘1`), prose and a numbered beat through
 *      the slash menu autosaves; a reload reads it back block for block; the
 *      nav's Outline row prints `1 act` and the panel counts the beat.
 *
 * The Beats route this walk once continued into was removed
 * (`docs/build-decisions.md`, "Beats route removed"); a beat is still one of
 * the outline's blocks and is typed and read back here.
 *
 * Needs a real account; skips without one. Leaves one project behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Outline walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The walk needs an account.')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\/new$/)
}

const choose = async (page: Page, name: RegExp): Promise<void> => {
  const radio = page.getByRole('radio', { name })
  await radio.locator('..').click()
  await expect(radio).toBeChecked()
}

const setTheme = async (page: Page, theme: 'dark' | 'light'): Promise<void> => {
  await page.evaluate((next) => {
    localStorage.setItem('folio.theme', next)
  }, theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

/** Saved, and settled: wait, let a trailing autosave fire, wait again. */
const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await page.waitForTimeout(2_000)
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Hydrated: the route header's mount effect has run, so buttons and fields are live. */
const waitMounted = async (page: Page, header: 'outline'): Promise<void> => {
  await expect(page.locator(`[data-${header}-header]`)).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

let outlineUrl = ''

test('the empty state, both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Outline walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  outlineUrl = page.url().replace(/\/script$/, '/outline')

  await page.goto(outlineUrl)
  await expect(page.locator('main[data-route="outline"]')).toHaveAttribute('data-outline-state', 'empty')
  await expect(page.locator('[data-empty-state]')).toBeVisible()
  await expect(page.locator('[data-start-outline]')).toBeVisible()
  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('—')
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveCount(0)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/outline-empty-${theme}.png`, fullPage: false })
  }
})

test('starting the outline and typing blocks saves them, and a reload reads them back', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(outlineUrl)
  await waitMounted(page, 'outline')
  await page.locator('[data-start-outline]').click()
  await expect(page.locator('main[data-route="outline"]')).toHaveAttribute('data-outline-state', 'draft', { timeout: 60_000 })
  await waitMounted(page, 'outline')
  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('0 acts')

  const blocks = page.locator('[data-sheet] [data-node-id]')
  await expect(blocks).toHaveCount(1)
  await blocks.first().click()
  await page.waitForTimeout(300)

  // A heading by shortcut, prose under it, then a beat through the slash menu.
  await page.keyboard.press(`${modifier}+1`)
  await expect(blocks.first()).toHaveAttribute('data-type', 'h1')
  await expect(page.locator('[data-caret-block]')).toContainText('Heading 1')
  await page.keyboard.type('Logline', { delay: 20 })
  await page.keyboard.press('Enter')
  await expect(blocks).toHaveCount(2)
  await expect(blocks.nth(1)).toHaveAttribute('data-type', 'body')
  await page.keyboard.type('On the edge of giving up, a boy meets an old man.', { delay: 10 })
  await page.keyboard.press('Enter')
  await expect(blocks).toHaveCount(3)
  await page.keyboard.type('/', { delay: 20 })
  await expect(page.locator('[data-slash-menu]')).toBeVisible()
  await page.keyboard.type('be', { delay: 20 })
  await expect(page.locator('[data-slash-choice="beat"]')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-slash-menu]')).toBeHidden()
  await expect(blocks.nth(2)).toHaveAttribute('data-type', 'beat')
  await page.keyboard.type('Opening Image: empty pitch, Ade training alone.', { delay: 10 })
  await expect(blocks.nth(2)).toContainText('1')
  await expect(blocks.nth(2).locator('.folio-outline-lead')).toHaveText('Opening Image:')
  await waitSaved(page)

  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('1 act')
  await expect(page.locator('[data-block-count]')).toHaveText('3')
  await expect(page.locator('[data-outline-blocks]')).toHaveText('3')
  await expect(page.locator('[data-stat="beats"]')).toHaveText('1')

  await page.reload()
  await expect(page.locator('main[data-route="outline"]')).toHaveAttribute('data-outline-state', 'draft')
  const texts = await blocks.evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-type'), node.textContent?.trim() ?? '']))
  expect(texts).toEqual([
    ['h1', 'Logline'],
    ['body', 'On the edge of giving up, a boy meets an old man.'],
    ['beat', '1Opening Image: empty pitch, Ade training alone.'],
  ])
  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('1 act')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/outline-draft-${theme}.png`, fullPage: false })
  }
})
