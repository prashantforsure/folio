import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Characters route, walked in a browser against the real backend -
 * the second pass: the card grid, the drawer, the graphs, the table.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record, no column; `?view=`
 *      outside `overview | relationships | casting` is a 404.
 *   2. **Records come from cues through the alias table, and near-misses
 *      are ghost cards, not records.** A script with `MEERA`, `MEERA
 *      (V.O.)`, `MEERA PAWAR`, `SURESH KADAM`, `SURESH`, `YOUNG MEERA` and
 *      `CLERK` derives three cards - never a second Meera - and three ghost
 *      cards with a proposal each. The rail badge is that count.
 *   3. **The queue is rows, and a decision persists.** `This is …` binds a
 *      spelling; `Not a character` rejects every candidate and the ghost
 *      leaves for good; `Someone else… → New character` mints.
 *   4. **The drawer authors the card and survives a reload**: gender, age,
 *      role, colour, bio, appearance, and an alias bound by hand.
 *   5. **A record-level rename rewrites every cue and keeps the profile.**
 *      The Script route shows the new spelling on every cue that was the
 *      name; the modifier survives; the alias does not move.
 *   6. **Merge folds one record into another**, and the loser's spelling
 *      resolves to the winner. Delete refuses a record still in the script.
 *   7. **The three graphs and the table**, both themes. Upload is disabled
 *      with its reason when storage is not configured.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Characters walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. KAMATHI CHAWL - CORRIDOR - NIGHT

The tap coughs twice and gives up.

MEERA
Two buckets. I counted.

SURESH KADAM
Madam, the paper is the paper.

MEERA (V.O.)
You've shown me the paper.

EXT. KAMATHI CHAWL - COURTYARD - DAY

MEERA PAWAR
Show me the meter.

SURESH
Tomorrow.

YOUNG MEERA
Amma?

INT. WARD OFFICE - DAY

MEERA
I opened it. Nobody else was going to.

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
  await expect(page.locator('[data-characters-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** The card whose tile carries this name. */
const card = (page: Page, name: string) =>
  page.locator('[data-character-card]').filter({ has: page.getByText(name, { exact: true }) })

let scriptUrl = ''
let charactersUrl = ''

test('empty state, both themes; a bad view is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Characters walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  charactersUrl = scriptUrl.replace(/\/ep_001\/script$/, '/characters')

  await page.goto(charactersUrl)
  const main = page.locator('main[data-route="characters"]')
  await expect(main).toHaveAttribute('data-sub-view', 'overview')
  await expect(main).toHaveAttribute('data-characters-state', 'empty')
  await expect(main.getByText('No characters yet')).toBeVisible()
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('aside[data-context-column]')).toHaveCount(0)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${charactersUrl}?view=profile`)
  expect(bogus?.status()).toBe(404)
  const notARecord = await page.goto(`${charactersUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from cues; near-misses are ghost cards, never a second Meera', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  await page.goto(charactersUrl)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-characters-state', 'overview')
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await expect(card(page, 'MEERA')).toBeVisible()
  await expect(card(page, 'SURESH KADAM')).toBeVisible()
  await expect(card(page, 'CLERK')).toBeVisible()
  // Meera has two spellings in two scenes - the courtyard's `MEERA PAWAR`
  // is still a ghost, so it is not hers yet.
  await expect(card(page, 'MEERA')).toContainText('2 scenes')
  // Three cues with nowhere to point: the badge, the footer, the ghosts.
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('3')
  await expect(page.locator('[data-unmatched-count]')).toContainText('3 unmatched names')
  await expect(page.locator('[data-unmatched-card]')).toHaveCount(3)
})

test('the queue is rows: This is… binds, Not a character is never asked again, Someone else… mints', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)

  const meeraPawar = page.locator('[data-unmatched-card="MEERA PAWAR"]')
  await expect(meeraPawar.locator('[data-unmatched-match]')).toContainText('This is')
  await expect(meeraPawar.locator('[data-unmatched-match]')).toContainText('MEERA')
  await expect(meeraPawar.locator('[data-unmatched-match]')).toContainText('likely')
  const youngMeera = page.locator('[data-unmatched-card="YOUNG MEERA"]')
  await expect(youngMeera.locator('[data-unmatched-match]')).toContainText('possible')
  const suresh = page.locator('[data-unmatched-card="SURESH"]')
  await expect(suresh.locator('[data-unmatched-match]')).toContainText('SURESH KADAM')

  // This is Meera: the spelling binds; the ghost settles into her card.
  await meeraPawar.locator('[data-unmatched-match]').click()
  await saved(page)
  await expect(meeraPawar).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('2')
  await expect(card(page, 'MEERA')).toContainText('3 scenes', { timeout: 60_000 })

  // Not a character: YOUNG MEERA is nobody. The ghost leaves the badge and the grid.
  await youngMeera.locator('[data-unmatched-walk-on]').click()
  await saved(page)
  await expect(youngMeera).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('1')

  // Someone else… → New character: SURESH is not Suresh Kadam.
  await suresh.locator('[data-unmatched-other]').click()
  await suresh.locator('[data-unmatched-pick]').selectOption('new-record')
  await saved(page)
  await expect(suresh).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('[data-character-card]')).toHaveCount(4)
  await expect(card(page, 'SURESH')).toBeVisible()

  // The decisions persist: a reload shows no ghost.
  await page.reload()
  await expect(page.locator('[data-unmatched-card]')).toHaveCount(0)
  await expect(page.locator('[data-character-card]')).toHaveCount(4)
})

test('the drawer authors the card and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  await card(page, 'MEERA').locator('[data-card-edit]').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('MEERA')
  await expect(drawer.locator('[data-cue-chip="MEERA PAWAR"]')).toContainText('× 1')

  await drawer.locator('[data-field="gender"]').selectOption('female')
  await drawer.locator('[data-field="age"]').fill('38')
  await drawer.locator('[data-field="role"]').fill('Laundress, second floor')
  await drawer.locator('[data-field="bio"]').fill('Does other people’s washing and knows exactly how much water every family on the floor uses.')
  await drawer.locator('[data-field="appearance"]').fill('wiry, forearms like rope, a faded blue sari')
  await drawer.locator('[data-color-picker]').click()
  await drawer.locator('[data-color-option="chip-7"]').click()
  await drawer.locator('[data-save-character]').click()
  await saved(page)

  // An alias bound by hand: the Devanagari spelling is Meera, at × 0 until written.
  await drawer.locator('[data-add-alias]').click()
  await drawer.locator('[data-alias-input]').fill('मीरा')
  await drawer.locator('[data-alias-input]').press('Enter')
  await saved(page)
  await expect(drawer.locator('[data-cue-chip="मीरा"]')).toContainText('× 0', { timeout: 60_000 })

  await page.reload()
  await ready(page)
  await expect(page.locator('[data-character-drawer]').locator('[data-field="role"]')).toHaveValue('Laundress, second floor')
  await expect(page.locator('[data-character-drawer]').locator('[data-field="gender"]')).toHaveValue('female')
  await expect(page.locator('[data-character-drawer]').locator('[data-cue-chip="मीरा"]')).toBeVisible()
  await page.locator('[data-drawer-close]').click()
  await page.waitForURL(/\/characters$/)
  await expect(card(page, 'MEERA')).toContainText('Female · 38 y/o · Laundress, second floor')
  await expect(card(page, 'MEERA')).toContainText('Does other people’s washing')
})

test('a record-level rename rewrites every cue in the script and keeps the profile', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  await card(page, 'MEERA').locator('[data-card-edit]').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')

  await drawer.locator('[data-field="name"]').fill('Meera Pawar')
  await drawer.locator('[data-save-character]').click()
  const confirm = drawer.locator('[data-rename-confirm]')
  await expect(confirm).toContainText('3 cues will be rewritten')
  await confirm.locator('[data-rename-everywhere]').click()
  await saved(page)
  await expect(drawer.locator('[data-renamed]')).toContainText('3 cues rewritten across 1 episode', { timeout: 120_000 })
  // The profile came along; the alias the writer bound did not move.
  await expect(drawer.locator('[data-cue-chip="MEERA PAWAR"]')).toContainText('× 3', { timeout: 60_000 })
  await expect(drawer.locator('[data-cue-chip="MEERA PAWAR (V.O.)"]')).toContainText('× 1')
  await expect(drawer.locator('[data-cue-chip="मीरा"]')).toBeVisible()
  await expect(drawer.locator('[data-field="role"]')).toHaveValue('Laundress, second floor')

  // The script says so too: every cue that was the name, in document order,
  // and nothing else. The `(V.O.)` is a node attribute the sheet does not
  // print in the cue's text; the drawer's `MEERA PAWAR (V.O.) × 1` above is
  // where it shows.
  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const cues = page.locator('[data-sheet] [data-node-id][data-type="character"]')
  await expect(cues).toHaveCount(8)
  expect(await cues.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))).toEqual([
    'MEERA PAWAR',
    'SURESH KADAM',
    'MEERA PAWAR',
    'MEERA PAWAR',
    'SURESH',
    'YOUNG MEERA',
    'MEERA PAWAR',
    'CLERK',
  ])
})

test('merge folds a record into another; delete refuses a record still in the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  await card(page, 'SURESH').locator('[data-card-edit]').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('SURESH')
  await expect(drawer.locator('[data-delete-button]')).toBeDisabled()

  const loserUrl = page.url()
  await drawer.locator('[data-merge-button]').click()
  await drawer.locator('[data-merge-into]').selectOption({ label: 'SURESH KADAM' })
  await drawer.getByRole('button', { name: 'Merge', exact: true }).click()
  // The merge awaits a re-derive, then lands on the survivor's drawer.
  await page.waitForURL((url) => url.toString() !== loserUrl && /\/characters\/[0-9a-f-]{36}$/.test(url.toString()), {
    timeout: 120_000,
  })
  await ready(page)
  await expect(page.locator('[data-character-drawer]').locator('[data-field="name"]')).toHaveValue('SURESH KADAM', {
    timeout: 60_000,
  })
  await expect(page.locator('[data-character-drawer]').locator('[data-cue-chip="SURESH"]')).toContainText('× 1', {
    timeout: 60_000,
  })
  await page.locator('[data-drawer-close]').click()
  await page.waitForURL(/\/characters$/)
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
})

test('the graphs and the table, both themes; upload is gated on storage', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${charactersUrl}?view=relationships`)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'relationships')
  await ready(page)
  for (const mode of ['force', 'dialogue', 'chord'] as const) {
    await page.locator(`[data-graph-mode="${mode}"]`).click()
    await expect(page.locator('[data-relationships]')).toHaveAttribute('data-graph', mode)
    await expect(page.locator('[data-graph-node]')).toHaveCount(3)
  }
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-relationships-${theme}.png`, fullPage: false })
  }

  await page.goto(`${charactersUrl}?view=casting`)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'casting')
  await expect(page.locator('[data-casting-row]')).toHaveCount(3)
  await expect(page.locator('[data-casting-row]').first()).toContainText('Meera Pawar')
  await page.locator('[data-sort="name"]').click()
  await expect(page.locator('[data-casting-row]').first()).toContainText('CLERK')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-casting-${theme}.png`, fullPage: false })
  }

  await page.goto(charactersUrl)
  await ready(page)
  const upload = card(page, 'Meera Pawar').locator('[data-card-upload]')
  const storage = await upload.isEnabled()
  if (!storage) await expect(upload).toHaveAttribute('title', /not set up/)
  await expect(card(page, 'Meera Pawar').locator('[data-card-generate]')).toBeDisabled()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-overview-${theme}.png`, fullPage: false })
  }
})
