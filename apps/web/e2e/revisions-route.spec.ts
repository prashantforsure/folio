import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Revisions route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **Both empty states, both themes.** No script; then a script with no
 *      revision, in both views. `?view=` outside `diff | history` is a 404.
 *   2. **Issuing a revision is a snapshot plus a row.** `Draft 1` is White,
 *      the header count and the nav meta move, and the history card prints
 *      the counts the diff computed (`+N −0`, one scene per heading).
 *   3. **The diff is drawn from real edits.** Two edits on the Script route -
 *      text typed into an action line, a dialogue line merged away - show up
 *      on the sheet as a changed line and a struck one, with asterisks, and
 *      "Changes only" cuts the page down to them.
 *   4. **The colour sequence and the lock.** `Draft 2` is Blue and locked in
 *      the same act; the Script status bar reads `Rev. Blue`.
 *   5. **Restore creates a new version and destroys nothing.** Restoring
 *      `Draft 1` puts the old text back on the Script route, both revision
 *      rows are still listed, and the footer names the version it wrote.
 *   6. **Any two drafts compare.** `Draft 1 → Draft 2` through the pickers
 *      prints the same counts the `Draft 2` card stored.
 *
 * Needs a real account; skips without one. Leaves one project behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Revisions walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. MEERA'S FLAT - NIGHT

A kettle on the hob. MEERA, 30s, watches it not boil.

MEERA
Come on. Come on.

The kettle clicks off. She does not move.

EXT. STAIRWELL - CONTINUOUS

Rain on the skylight. RAVI, 40s, climbs with a tiffin in each hand.

RAVI
(calling up)
Meera? It's business, not charity.

MEERA (O.S.)
Then send an invoice.

CUT TO:

INT. MEERA'S FLAT - LATER

The tiffins on the table, untouched. Meera opens one anyway.
`

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The Revisions walk needs an account.')
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

/**
 * Saved, and settled. A keystroke that lands while a save is in flight is
 * picked up by a second autosave 1.5s later, and the state reads `saved`
 * between the two - so wait for it, let the second one fire, and wait again.
 */
const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await page.waitForTimeout(2_500)
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

/** Hydrated: the header control's mount effect has run, so pickers and buttons are live. */
const waitMounted = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-issue-revision-control]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

let scriptUrl = ''
let revisionsUrl = ''

const counts = async (page: Page): Promise<{ added: number; removed: number; changed: number }> => ({
  added: Number(await page.locator('[data-count-added]').textContent()),
  removed: Number(await page.locator('[data-count-removed]').textContent()),
  changed: Number(await page.locator('[data-count-changed]').textContent()),
})

test('empty states, both themes; a bad view is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Revisions walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  revisionsUrl = scriptUrl.replace(/\/script$/, '/revisions')

  await page.goto(revisionsUrl)
  await expect(page.locator('main[data-route="revisions"]')).toHaveAttribute('data-sub-view', 'diff')
  await expect(page.getByRole('heading', { name: 'No script yet' })).toBeVisible()
  await expect(page.locator('[data-issue-revision]')).toBeDisabled()
  await expect(page.locator('[data-nav-meta="revisions"]')).toHaveText('—')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/revisions-no-script-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${revisionsUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)

  // A script with no revision yet: both views say so, in their own words.
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })

  await page.goto(revisionsUrl)
  await expect(page.getByRole('heading', { name: 'Nothing to compare yet' })).toBeVisible()
  await expect(page.locator('[data-issue-revision]')).toBeEnabled()
  await page.goto(`${revisionsUrl}?view=history`)
  await expect(page.getByRole('heading', { name: 'No drafts yet' })).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/revisions-no-drafts-${theme}.png`, fullPage: false })
  }
})

test('issuing Draft 1 takes a snapshot and cuts a White row with the counts the diff computed', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${revisionsUrl}?view=history`)
  await waitMounted(page)
  await page.locator('[data-issue-revision]').click()
  const form = page.locator('[data-issue-form]')
  await expect(form).toBeVisible()
  await expect(form).toContainText('White pages')
  await expect(form.getByPlaceholder('Draft 1')).toBeVisible()
  await form.getByLabel(/^Note/).fill('First complete draft.')
  await form.getByLabel(/^Tags/).fill('first draft, walk')
  await page.locator('[data-issue-submit]').click()
  await expect(form).toBeHidden({ timeout: 60_000 })

  const card = page.locator('[data-revision-card]')
  await expect(card).toHaveCount(1, { timeout: 60_000 })
  await expect(card).toContainText('Draft 1')
  await expect(card).toContainText('White pages')
  await expect(card).toContainText('1 pp')
  await expect(card).toContainText('First complete draft.')
  await expect(card).toContainText('first draft')
  await expect(card).toHaveAttribute('data-revision-locked', 'false')
  // Every line was added; nothing was there to delete; three headings, three scenes.
  await expect(card).toContainText('−0')
  await expect(card).toContainText('3 scenes touched')
  const added = await card.locator('.text-add').textContent()
  expect(Number((added ?? '').replace('+', ''))).toBeGreaterThan(10)

  await expect(page.locator('[data-nav-meta="revisions"]')).toHaveText('Draft 1')
  await expect(page.locator('main[data-route="revisions"] header').getByText('1', { exact: true })).toBeVisible()

  // The compare view now has something to compare: Draft 1 -> Current, identical.
  await page.goto(revisionsUrl)
  await expect(page.locator('[data-compare-bar]')).toBeVisible()
  await expect(page.locator('[data-footer-pair]')).toHaveText('Draft 1 → Current')
  expect(await counts(page)).toEqual({ added: 0, removed: 0, changed: 0 })
  await expect(page.locator('article[data-page-ordinal]')).toHaveCount(1)
  await expect(page.locator('[data-line-kind="same"]').first()).toBeVisible()
  await expect(page.locator('[data-line-kind="added"]')).toHaveCount(0)
})

test('real edits on the Script route show up as changed and struck lines with asterisks', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  await expect(page.locator('[data-script-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })

  // Type at the end of the second block: "A kettle on the hob..." grows a line.
  // Slate takes the click's selection on the next `selectionchange`, so each
  // step waits for it before the next key, and the DOM is checked before the
  // save is trusted.
  const blocks = page.locator('[data-sheet] [data-node-id]')
  const before = await blocks.count()
  const second = blocks.nth(1)
  await second.click()
  await page.waitForTimeout(300)
  await page.keyboard.press('End')
  await page.waitForTimeout(150)
  await page.keyboard.type(' Revised in the walk.', { delay: 20 })
  await expect(second).toHaveText(/not boil. Revised in the walk.$/)
  await waitSaved(page)

  // Merge "Come on. Come on." into the cue above it: a node leaves the script.
  const speech = blocks.nth(3)
  await expect(speech).toContainText('Come on.')
  await speech.click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Home')
  await page.waitForTimeout(150)
  await page.keyboard.press('Backspace')
  await expect(blocks).toHaveCount(before - 1)
  await waitSaved(page)

  await page.goto(revisionsUrl)
  await expect(page.locator('[data-footer-pair]')).toHaveText('Draft 1 → Current')
  const totals = await counts(page)
  // The typed text overflowed the action's single line, so it is a new line
  // under an unchanged one; the merged speech is a struck line.
  expect(totals.added).toBeGreaterThanOrEqual(1)
  expect(totals.removed).toBeGreaterThanOrEqual(1)
  await expect(page.locator('[data-line-kind="added"]').first()).toContainText('Revised in the walk.')
  await expect(page.locator('[data-line-kind="deleted"]').first()).toContainText('Come on.')
  // A struck line is drawn with the base's text and the head's page label.
  await expect(page.locator('article[data-page-ordinal="1"]')).toHaveAttribute('data-page-label', '1')
  const marks = await page.locator('article [data-line-kind]:not([data-line-kind="same"])').count()
  expect(marks).toBe(totals.added + totals.removed + totals.changed)
  await expect(page.locator('[data-footer-differ]')).toHaveText(`${String(marks)} lines differ on this page`)

  // "Changes only" keeps the changed lines and the heading and cue that place them.
  const fullLines = await page.locator('article [data-line-kind]').count()
  await page.locator('[data-diff-filter="changes"]').click()
  const cutLines = await page.locator('article [data-line-kind]').count()
  expect(cutLines).toBeLessThan(fullLines)
  expect(cutLines).toBeGreaterThanOrEqual(marks)
  await expect(page.locator('article [data-diff-node]').first()).toHaveAttribute('data-diff-kind', 'same')

  await page.locator('[data-diff-filter="all"]').click()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/revisions-diff-${theme}.png`, fullPage: false })
  }
})

test('Draft 2 is Blue, locked in the same act, and the Script status bar reads Rev. Blue', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${revisionsUrl}?view=history`)
  await waitMounted(page)
  await page.locator('[data-issue-revision]').click()
  const form = page.locator('[data-issue-form]')
  await expect(form).toContainText('Blue pages')
  await form.getByLabel(/^Note/).fill('Pages locked for the table read.')
  await form.getByLabel(/^Lock pages/).check()
  await page.locator('[data-issue-submit]').click()
  await expect(form).toBeHidden({ timeout: 60_000 })

  const cards = page.locator('[data-revision-card]')
  await expect(cards).toHaveCount(2, { timeout: 60_000 })
  const draft2 = cards.first()
  await expect(draft2).toContainText('Draft 2')
  await expect(draft2).toContainText('Blue pages')
  await expect(draft2).toContainText('Pages locked')
  await expect(draft2).toHaveAttribute('data-revision-locked', 'true')
  await expect(draft2).toContainText('1 scene touched')
  await expect(cards.last()).toContainText('Draft 1')
  await expect(page.locator('[data-nav-meta="revisions"]')).toHaveText('Draft 2')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/revisions-history-${theme}.png`, fullPage: false })
  }

  await page.goto(scriptUrl)
  await expect(page.locator('[data-status-bar]')).toContainText('Rev. Blue', { timeout: 60_000 })
})

test('restoring Draft 1 creates a new version and destroys nothing', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${revisionsUrl}?view=history`)
  await waitMounted(page)
  const draft1 = page.locator('[data-revision-card]').last()
  await expect(draft1).toContainText('Draft 1')
  await draft1.locator('[data-restore]').click()
  await expect(draft1.locator('[data-restore-confirm]')).toContainText('Restore Draft 1?')
  await draft1.locator('[data-restore-yes]').click()
  await expect(page.locator('[data-footer-differ]')).toContainText(/Restored Draft 1 as version \d+/, { timeout: 60_000 })

  // Both rows are still here. Nothing was destroyed.
  await expect(page.locator('[data-revision-card]')).toHaveCount(2)
  await expect(page.locator('[data-nav-meta="revisions"]')).toHaveText('Draft 2')

  // The script is Draft 1's text again: the typed line is gone, the merged speech is back.
  await page.goto(scriptUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  const texts = await page.locator('[data-sheet] [data-node-id]').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))
  expect(texts.some((text) => text.includes('Revised in the walk.'))).toBe(false)
  expect(texts.some((text) => text.trim() === 'Come on. Come on.')).toBe(true)

  // And the working document now matches Draft 1 line for line.
  await page.goto(revisionsUrl)
  await waitMounted(page)
  await page.locator('[data-draft-picker="base"]').selectOption({ label: 'Draft 1' })
  await expect(page.locator('[data-footer-pair]')).toHaveText('Draft 1 → Current')
  await expect(page.locator('[data-count-changed]')).toHaveText('0', { timeout: 60_000 })
  expect(await counts(page)).toEqual({ added: 0, removed: 0, changed: 0 })
})

test('any two drafts compare: Draft 1 → Draft 2 prints the counts the Draft 2 row stored', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${revisionsUrl}?view=history`)
  const draft2 = page.locator('[data-revision-card]').first()
  const stored = {
    added: Number(((await draft2.locator('.text-add').textContent()) ?? '').replace('+', '')),
    removed: Number(((await draft2.locator('.text-del').textContent()) ?? '').replace('−', '')),
  }

  await page.goto(revisionsUrl)
  await waitMounted(page)
  await page.locator('[data-draft-picker="base"]').selectOption({ label: 'Draft 1' })
  await page.locator('[data-draft-picker="head"]').selectOption({ label: 'Draft 2 · locked' })
  await expect(page.locator('[data-footer-pair]')).toHaveText('Draft 1 → Draft 2')
  await expect(page.locator('article[data-page-ordinal]').first()).toContainText('Draft 2', { timeout: 60_000 })
  const live = await counts(page)
  // A changed line counts once on each side of the stored pair.
  expect(live.added + live.changed).toBe(stored.added)
  expect(live.removed + live.changed).toBe(stored.removed)
  // The head is a locked draft: its page label is the locked label.
  await expect(page.locator('article[data-page-ordinal="1"]')).toHaveAttribute('data-page-locked', 'true')

  // "Compare to current" from a card lands on the compare view with that pair.
  await page.goto(`${revisionsUrl}?view=history`)
  await waitMounted(page)
  await page.locator('[data-revision-card]').first().locator('[data-compare-to-current]').click()
  await page.waitForURL(/\?view=diff$/)
  await expect(page.locator('[data-footer-pair]')).toHaveText('Draft 2 → Current')
})
