import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Bible route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No entry; `?view=` outside
 *      `entry | check | glossary` is a 404; `/bible/not-a-uuid` is a 404;
 *      no rail badge. The check and the glossary each say they are empty
 *      rather than reporting that zero rules hold.
 *   2. **Start with sections** creates the Pitch - kind `pitch`, in
 *      Premise, seven fields - the four sections and the Glossary row
 *      appear in the nav, and a field edit survives a reload.
 *   3. **An entry is authored and its facts cite derived scenes.** A rule
 *      is added, cites `E1 Sc 1` from the picker, and a conflict is
 *      recorded against `E1 Sc 3`. As a draft the entry counts for nothing:
 *      no badge, no dot, the check is empty. **Promoted to canon** the same
 *      conflict is the badge, the nav dot, the check tab's count and the
 *      check view's one card, with the two scenes' opening lines quoted.
 *      **Retired**, it is ignored again. That is the status gate, seen from
 *      the outside.
 *   4. **A decision clears a conflict.** `Rule is right · flag scene`
 *      decides it; the badge goes; "N other rules hold" is arithmetic.
 *   5. **The glossary's use count is derived.** `Tanker` is said three
 *      times, first in `E1 Sc 1`; `monsoon` is never said and reads `—`,
 *      `0`, in amber. A duplicate spelling is refused.
 *   6. **The entry view, both themes.**
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Bible walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. KAMATHI CHAWL - CORRIDOR - NIGHT

The tanker's horn at 06:40. MEERA is already fourth in line.

MEERA
Two buckets. The tanker never waits.

EXT. KAMATHI CHAWL - COURTYARD - DAY

The tanker idles. Nobody moves.

KADAM
Tomorrow.

INT. WARD OFFICE - DAY

MEERA waits for a nine o'clock tanker that never comes.

CLERK
Next.
`

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

/** Wait for the workspace to hydrate before clicking anything in it. */
const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-bible-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** Edit an in-place field: click its button, type, Enter. */
const edit = async (page: Page, label: string, value: string): Promise<void> => {
  await page.getByRole('button', { name: label, exact: true }).click()
  const input = page.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press('Enter')
}

let scriptUrl = ''
let bibleUrl = ''
let entryUrl = ''

test('empty state, both themes; a bad view and a bad id are 404s', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Bible walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  bibleUrl = scriptUrl.replace(/\/ep_001\/script$/, '/bible')

  await page.goto(bibleUrl)
  const main = page.locator('main[data-route="bible"]')
  await expect(main).toHaveAttribute('data-sub-view', 'entry')
  await expect(main).toHaveAttribute('data-bible-state', 'empty')
  await expect(main.getByText('The rules of the world live here')).toBeVisible()
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveCount(0)
  const column = page.locator('aside[data-context-column="bible"]')
  await expect(column).toBeVisible()
  expect((await column.boundingBox())?.width).toBe(252)
  await expect(page.locator('[data-nav-readable]')).toHaveText('—')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/bible-empty-${theme}.png`, fullPage: false })
  }

  await page.goto(`${bibleUrl}?view=check`)
  await expect(page.locator('[data-no-canon]')).toBeVisible()
  await page.goto(`${bibleUrl}?view=glossary`)
  await expect(page.locator('[data-no-terms]')).toBeVisible()

  const bogus = await page.goto(`${bibleUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
  const notAnEntry = await page.goto(`${bibleUrl}/not-a-uuid`)
  expect(notAnEntry?.status()).toBe(404)
  const unknown = await page.goto(`${bibleUrl}/00000000-0000-4000-8000-000000000000`)
  expect(unknown?.status()).toBe(404)
})

test('Start with sections creates the Pitch, and a field survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(bibleUrl)
  await ready(page)
  await page.locator('[data-start-with-sections]').click()
  await page.waitForURL(/\/bible\/[0-9a-f-]{36}$/, { timeout: 120_000 })
  await ready(page)

  await expect(page.locator('main[data-route="bible"]')).toHaveAttribute('data-bible-state', 'entry')
  await expect(page.locator('[data-entry-kind="pitch"]')).toBeVisible()
  await expect(page.locator('[data-entry-section]')).toHaveText('Premise')
  await expect(page.locator('[data-entry-status="draft"]')).toBeVisible()
  await expect(page.locator('[data-pitch-field]')).toHaveCount(7)
  await expect(page.locator('[data-pitch-field="Logline"]')).toBeVisible()
  for (const section of ['premise', 'how_things_work', 'history', 'themes', 'reference']) {
    await expect(page.locator(`[data-bible-section="${section}"]`)).toBeVisible()
  }
  await expect(page.locator('[data-bible-row-status="draft"]')).toHaveCount(1)
  await expect(page.locator('[data-entry-count]')).toHaveText('1')

  await edit(page, 'Logline', 'When a chawl loses its water for nine days, a laundress learns who controls the tanker.')
  await saved(page)
  await page.reload()
  await ready(page)
  await expect(page.locator('[data-pitch-field="Logline"]')).toContainText('who controls the tanker')
})

test('a rule cites a scene; a recorded conflict counts only while the entry is canon', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  // ＋ Entry: a rules entry in How things work, opened as a draft.
  await page.goto(bibleUrl)
  await ready(page)
  await page.locator('[data-new-entry]').click()
  const form = page.locator('[data-new-entry-form]')
  await form.getByLabel('Section').selectOption('how_things_work')
  await form.getByLabel('Entry title').fill('How water works in the chawl')
  await form.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/bible\/[0-9a-f-]{36}$/, { timeout: 120_000 })
  entryUrl = page.url()
  await ready(page)
  await expect(page.locator('[data-entry-section]')).toHaveText('How things work')
  await expect(page.locator('[data-bible-section="how_things_work"] [data-bible-row]')).toHaveCount(1)
  await expect(page.locator('[data-entry-count]')).toHaveText('2')

  // A rule, uncited, then cited.
  await page.locator('[data-add-rule]').fill('The tanker comes once, in the morning, and never waits.')
  await page.locator('[data-add-rule]').press('Enter')
  await saved(page)
  const rule = page.locator('[data-rule]')
  await expect(rule).toHaveCount(1, { timeout: 60_000 })
  await expect(rule.locator('[data-uncited]')).toHaveText('not yet on the page')
  await rule.locator('[data-add-cite]').selectOption({ index: 1 })
  await saved(page)
  await expect(rule.locator('[data-cite]')).toHaveCount(1, { timeout: 60_000 })
  await expect(rule.locator('[data-cite]')).toContainText('E1 Sc 1')
  await expect(rule.locator('[data-uncited]')).toHaveCount(0)
  await expect(page.locator('[data-mentions]')).toHaveText('1')
  await expect(page.locator('[data-linked-characters]')).toContainText('MEERA')

  // A conflict, recorded against the ward office scene.
  await rule.locator('[data-record-conflict]').click()
  const conflictForm = rule.locator('[data-conflict-form]')
  await conflictForm.getByLabel('Contradicting scene').selectOption({ index: 3 })
  await conflictForm.getByLabel('What the scene says that the rule forbids').fill('Meera waits for a nine o’clock tanker that never comes.')
  await conflictForm.locator('[data-conflict-record]').click()
  await saved(page)
  await expect(rule.locator('[data-rule-conflict]')).toBeVisible({ timeout: 60_000 })
  await expect(rule.locator('[data-rule-conflict]')).toContainText('E1 Sc 3')

  // Draft: recorded, but not checked. No badge, no dot, nothing in the check.
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveCount(0)
  await expect(page.locator('[data-contradicted]')).toHaveCount(0)
  await expect(page.locator('[data-check-badge]')).toHaveCount(0)
  await expect(page.locator('[data-nav-conflicts]')).toHaveText('0')
  await expect(page.locator('[data-nav-readable]')).toHaveText('—')

  // Canon: the same conflict is now the badge, the dot, the tab and the card.
  await page.locator('[data-status-tab="canon"]').click()
  await saved(page)
  await expect(page.locator('[data-entry-status="canon"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-status-note]')).toHaveText('Canon rules are checked against every draft and readable by Insights.')
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveText('1')
  await expect(page.locator('[data-contradicted]')).toHaveCount(1)
  await expect(page.locator('[data-check-badge]')).toHaveText('1')
  await expect(page.locator('[data-nav-conflicts]')).toHaveText('1')
  await expect(page.locator('[data-nav-canon-facts]')).toHaveText('1')
  await expect(page.locator('[data-nav-readable]')).toHaveText('on')

  await page.goto(`${bibleUrl}?view=check`)
  await ready(page)
  await expect(page.locator('main[data-route="bible"]')).toHaveAttribute('data-sub-view', 'check')
  const card = page.locator('[data-conflict]')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('How water works in the chawl')
  await expect(card).toContainText('Established · E1 Sc 1')
  await expect(card).toContainText("The tanker's horn at 06:40.")
  await expect(card).toContainText('Contradicts · E1 Sc 3')
  await expect(card).toContainText("MEERA waits for a nine o'clock tanker that never comes.")
  await expect(page.locator('[data-rules-holding]')).toContainText('0 other rules hold across the episode.')

  // Retired: ignored again, and the check is empty of it.
  await page.goto(entryUrl)
  await ready(page)
  await page.locator('[data-retire]').click()
  await saved(page)
  await expect(page.locator('[data-entry-status="retired"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveCount(0)
  await expect(page.locator('[data-nav-conflicts]')).toHaveText('0')
  await expect(page.locator('[data-bible-row-status="retired"]')).toHaveCount(1)
})

test('a decision clears the conflict, and the rules that hold are counted', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(entryUrl)
  await ready(page)
  await page.locator('[data-status-tab="canon"]').click()
  await saved(page)
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveText('1', { timeout: 60_000 })

  // A second rule, so the arithmetic has something to count.
  await page.locator('[data-add-rule]').fill('Every family gets two buckets per tanker visit.')
  await page.locator('[data-add-rule]').press('Enter')
  await saved(page)
  await expect(page.locator('[data-rule]')).toHaveCount(2, { timeout: 60_000 })

  await page.goto(`${bibleUrl}?view=check`)
  await ready(page)
  await expect(page.locator('[data-conflict]')).toHaveCount(1)
  await expect(page.locator('[data-rules-holding]')).toContainText('1 other rule holds across the episode.')
  await page.locator('[data-decide-rule]').click()
  await saved(page)
  await expect(page.locator('[data-conflict]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="bible"]')).toHaveCount(0)
  await expect(page.locator('[data-rules-holding]')).toContainText('2 other rules hold across the episode.')
  await expect(page.locator('[data-check-badge]')).toHaveCount(0)

  // The decision persists.
  await page.reload()
  await ready(page)
  await expect(page.locator('[data-conflict]')).toHaveCount(0)
  await page.goto(entryUrl)
  await ready(page)
  await expect(page.locator('[data-rule-conflict]')).toHaveCount(0)
})

test('the glossary counts uses from the script and refuses a duplicate spelling', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${bibleUrl}?view=glossary`)
  await ready(page)
  await expect(page.locator('main[data-route="bible"]')).toHaveAttribute('data-sub-view', 'glossary')

  await page.locator('[data-add-term]').fill('Tanker')
  await page.locator('[data-add-term-definition]').fill('The private truck that replaces the pipe.')
  await page.locator('[data-add-term]').press('Enter')
  await saved(page)
  const tanker = page.locator('[data-term="Tanker"]')
  await expect(tanker).toBeVisible({ timeout: 60_000 })
  // "tanker's" ×1 and "tanker" ×3 across the three scenes: four whole-word uses, first in Sc 1.
  await expect(tanker.locator('[data-uses]')).toHaveText('4')
  await expect(tanker.locator('[data-first-said]')).toHaveText('E1 Sc 1')

  await page.locator('[data-add-term]').fill('monsoon')
  await page.locator('[data-add-term]').press('Enter')
  await saved(page)
  const monsoon = page.locator('[data-term="monsoon"]')
  await expect(monsoon).toBeVisible({ timeout: 60_000 })
  await expect(monsoon.locator('[data-uses]')).toHaveText('0')
  await expect(monsoon.locator('[data-first-said]')).toHaveText('—')
  await expect(monsoon.locator('[data-uses]')).toHaveClass(/text-note/)
  await expect(page.locator('[data-bible-glossary-row]')).toContainText('2 terms')

  await page.locator('[data-add-term]').fill('TANKER')
  await page.locator('[data-add-term]').press('Enter')
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'error', { timeout: 60_000 })
  await expect(page.locator('[data-save-state]')).toContainText('already in the glossary')
  await expect(page.locator('[data-term]')).toHaveCount(2)
})

test('the entry view, both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(entryUrl)
  await ready(page)
  await expect(page.locator('[data-entry-panel]')).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await ready(page)
    await page.screenshot({ path: `test-results/bible-entry-${theme}.png`, fullPage: false })
  }
})
