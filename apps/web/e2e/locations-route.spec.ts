import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Locations route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record; `?view=` outside
 *      `record | breakdown | resolve` is a 404, and so is a non-UUID id.
 *   2. **Records come from headings through the alias table, and
 *      near-misses go to the queue, not to a record.** Seven headings in
 *      five places derive four records - `WATER TANKER` is a shorter form
 *      of `WATER TANKER STAND` and `CORRIDOR` of `KAMATHI CHAWL - CORRIDOR`,
 *      so each is a queue row with a guess and a confidence. The rail badge
 *      and the column's "Unmatched sluglines" row are that count. And the
 *      two `KAMATHI CHAWL - …` sets propose a primary set nobody has made.
 *   3. **The queue is rows, and the tree is authored from it.** Match binds
 *      a set text; New record mints one; Create and attach mints the
 *      primary set and hangs the sub-set under it; Attach hangs the second.
 *      The nav shows the tree and the roll-up counts.
 *   4. **The record is authored on the record and survives a reload**: a
 *      description, an arc note for E1, an alias bound by hand, and the
 *      `Inside` edge moved by hand.
 *   5. **A record-level rename rewrites every heading and keeps the
 *      record.** The Script route shows the new set on every heading that
 *      was the name, the time of day survives, the sub-set under the same
 *      primary set does not move, the description and the note are still
 *      there.
 *   6. **Merge folds one record into another**, and the loser's heading
 *      resolves to the winner. Delete refuses a record still in the script.
 *   7. **The breakdown**, both themes: one row per record in tree order,
 *      the primary set's cell the roll-up.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Locations walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. KAMATHI CHAWL - CORRIDOR - NIGHT

The tap coughs twice and gives up.

MEERA
Two buckets. I counted.

EXT. KAMATHI CHAWL - COURTYARD - DAY

MEERA
Show me the meter.

ANIL
Tomorrow.

INT. KAMATHI CHAWL - CORRIDOR - DAY

Meera hangs the washing.

INT. WARD OFFICE - DAY

MEERA
I opened it. Nobody else was going to.

EXT. WATER TANKER STAND - DAWN

The queue is already forty deep.

EXT. WATER TANKER - DAY

ANIL
He is not coming today.

INT. CORRIDOR - NIGHT

Kadam's man counts doors.
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
  await expect(page.locator('[data-locations-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** Edit an in-place field: click its button, type, Enter (⌘-Enter for a multiline field). */
const edit = async (page: Page, label: string, value: string, multiline = false): Promise<void> => {
  await page.getByRole('button', { name: label, exact: true }).click()
  const input = page.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press(multiline ? 'Control+Enter' : 'Enter')
}

let scriptUrl = ''
let locationsUrl = ''

test('empty state, both themes; a bad view and a bad id are 404s', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Locations walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  locationsUrl = scriptUrl.replace(/\/ep_001\/script$/, '/locations')

  await page.goto(locationsUrl)
  const main = page.locator('main[data-route="locations"]')
  await expect(main).toHaveAttribute('data-sub-view', 'record')
  await expect(main).toHaveAttribute('data-locations-state', 'empty')
  await expect(main.getByText('No locations yet')).toBeVisible()
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  await expect(page.locator('aside[data-context-column="locations"]')).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${locationsUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
  const notARecord = await page.goto(`${locationsUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from headings; near-misses are queue rows; the tree is proposed, never written', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('7', { timeout: 60_000 })

  await page.goto(locationsUrl)
  await expect(page.locator('main[data-route="locations"]')).toHaveAttribute('data-locations-state', 'record')
  // Four records, all primary sets: the header pill, the column, the footer.
  await expect(page.locator('[data-location-count]')).toHaveText('4')
  const rows = page.locator('[data-location-row]')
  await expect(rows).toHaveCount(4)
  await expect(page.locator('[data-location-list]')).toContainText('KAMATHI CHAWL - CORRIDOR')
  await expect(page.locator('[data-location-list]')).toContainText('KAMATHI CHAWL - COURTYARD')
  await expect(page.locator('[data-location-list]')).toContainText('WARD OFFICE')
  await expect(page.locator('[data-location-list]')).toContainText('WATER TANKER STAND')
  // Two sluglines with nowhere to point: the badge, the column row, the tab.
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('2')
  await expect(page.locator('[data-unmatched-row]')).toContainText('2')
  await expect(page.locator('[data-resolve-badge]')).toHaveText('2')

  // The first record in tree order is the corridor: two scenes, one day and
  // one night, INT, seen first at Sc 1 and last at Sc 3. `INT. CORRIDOR` is
  // still in the queue, so it is not the corridor's yet.
  const record = page.locator('[data-location-record]')
  await expect(record.getByRole('button', { name: 'Name', exact: true })).toHaveText('KAMATHI CHAWL - CORRIDOR')
  await expect(record.locator('[data-ie]')).toHaveText('INT')
  await expect(record.locator('[data-kind]')).toHaveText('Recurring interior')
  await expect(record.locator('[data-slugline-chip="INT. KAMATHI CHAWL - CORRIDOR - NIGHT"]')).toContainText('× 1')
  await expect(record.locator('[data-slugline-chip="INT. KAMATHI CHAWL - CORRIDOR - DAY"]')).toContainText('× 1')
  await expect(page.locator('[data-fact="Scenes"]')).toContainText('2')
  await expect(page.locator('[data-fact="First seen"]')).toContainText('E1 Sc 1')
  await expect(page.locator('[data-fact="Last seen"]')).toContainText('E1 Sc 3')
  await expect(page.locator('[data-day-night-split]')).toHaveText('1 / 1')
  await expect(page.locator('[data-scene-row]')).toHaveCount(2)
  // Meera is in both corridor scenes.
  await expect(page.locator('[data-people]')).toContainText('MEERA')
})

test('the queue is rows: Match binds, New record mints, and the tree is built from proposals', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${locationsUrl}?view=resolve`)
  await ready(page)
  await expect(page.locator('main[data-route="locations"]')).toHaveAttribute('data-sub-view', 'resolve')
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '2')

  const tanker = page.locator('[data-resolve-row="WATER TANKER"]')
  await expect(tanker).toContainText('WATER TANKER STAND')
  await expect(tanker.locator('[data-confidence]')).toHaveText('likely')
  const corridor = page.locator('[data-resolve-row="CORRIDOR"]')
  await expect(corridor).toContainText('KAMATHI CHAWL - CORRIDOR')
  await expect(corridor.locator('[data-confidence]')).toHaveText('possible')
  // Two sets read like sub-sets of a primary set nobody has made.
  await expect(page.locator('[data-structure-count]')).toHaveAttribute('data-structure-count', '2')
  await expect(page.locator('[data-structure-row="KAMATHI CHAWL - CORRIDOR"]')).toContainText('KAMATHI CHAWL')

  // Match: WATER TANKER is the tanker stand. The set text binds; the row settles.
  await tanker.locator('[data-resolve-match]').click()
  await saved(page)
  await expect(tanker).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '1')
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('1')

  // New record: CORRIDOR is its own place, not the chawl's corridor.
  await corridor.locator('[data-resolve-new-record]').click()
  await saved(page)
  await expect(corridor).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  await expect(page.locator('[data-location-row]')).toHaveCount(5)

  // Create and attach: mint KAMATHI CHAWL and hang the corridor under it.
  await page.locator('[data-structure-row="KAMATHI CHAWL - CORRIDOR"] [data-structure-attach]').click()
  await saved(page)
  await expect(page.locator('[data-structure-row="KAMATHI CHAWL - CORRIDOR"]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-location-row]')).toHaveCount(6)
  // The courtyard's proposal is now an attach to the record that exists.
  const courtyard = page.locator('[data-structure-row="KAMATHI CHAWL - COURTYARD"]')
  await expect(courtyard.locator('[data-structure-attach]')).toHaveText('Attach', { timeout: 60_000 })
  await courtyard.locator('[data-structure-attach]').click()
  await saved(page)
  await expect(courtyard).toHaveCount(0, { timeout: 60_000 })

  // The tree: the chawl first with the roll-up of three, its two sub-sets under it.
  const first = page.locator('[data-location-row]').first()
  await expect(first).toContainText('KAMATHI CHAWL')
  await expect(first).toContainText('3')
  await expect(page.locator('[data-location-row][data-location-depth="1"]')).toHaveCount(2)
  await expect(page.locator('[data-location-count]')).toHaveText('4')

  // The decisions persist: a reload shows the same queue.
  await page.reload()
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '0')
  await expect(page.locator('[data-structure-count]')).toHaveCount(0)
})

test('the record is authored on the record and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await ready(page)
  const record = page.locator('[data-location-record]')
  await expect(record.getByRole('button', { name: 'Name', exact: true })).toHaveText('KAMATHI CHAWL')
  await expect(record.locator('[data-kind]')).toHaveText('Primary set · 2 sub-locations')
  await expect(record.locator('[data-ie]')).toHaveText('INT/EXT')
  await expect(record.locator('[data-sub-location]')).toHaveCount(2)
  await expect(record.locator('[data-scenes-here]')).toHaveAttribute('data-scenes-here', '3')

  await edit(page, 'Description', 'A three-storey chawl off Falkland Road. One shared tap per floor.', true)
  await saved(page)
  await edit(page, 'Note for E1', 'Introduced dry. The tap coughs; nobody panics yet.', true)
  await saved(page)

  // An alias bound by hand: THE CHAWL resolves here, at × 0 until written.
  await page.locator('[data-add-alias]').click()
  await page.locator('[data-alias-input]').fill('THE CHAWL')
  await page.locator('[data-alias-input]').press('Enter')
  await saved(page)
  await expect(record.locator('[data-slugline-chip="THE CHAWL"]')).toContainText('× 0', { timeout: 60_000 })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Description', exact: true })).toContainText('Falkland Road')
  await expect(page.getByRole('button', { name: 'Note for E1', exact: true })).toContainText('Introduced dry')
  await expect(page.locator('[data-slugline-chip="THE CHAWL"]')).toBeVisible()

  // The edge, by hand: the minted CORRIDOR record goes inside the chawl.
  await page.locator('[data-location-row]').filter({ has: page.getByText('CORRIDOR', { exact: true }) }).click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await ready(page)
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('CORRIDOR')
  await page.locator('[data-parent-select]').selectOption({ label: 'KAMATHI CHAWL' })
  await saved(page)
  await expect(page.locator('[data-parent-link]')).toHaveText('KAMATHI CHAWL', { timeout: 60_000 })
  await expect(page.locator('[data-location-row]').first()).toContainText('4')
  await expect(page.locator('[data-location-row][data-location-depth="1"]')).toHaveCount(3)
})

test('a record-level rename rewrites every heading in the script and keeps the record', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await ready(page)
  await page.locator('[data-location-row]').filter({ has: page.getByText('KAMATHI CHAWL - CORRIDOR', { exact: true }) }).click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await ready(page)
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('KAMATHI CHAWL - CORRIDOR')

  await edit(page, 'Name', 'Chawl Corridor')
  const confirm = page.locator('[data-rename-confirm]')
  await expect(confirm).toContainText('2 headings will be rewritten')
  await confirm.locator('[data-rename-everywhere]').click()
  await saved(page)
  await expect(page.locator('[data-renamed]')).toContainText('2 headings rewritten across 1 episode', { timeout: 120_000 })
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('Chawl Corridor', { timeout: 60_000 })
  // Still inside the chawl; the counted headings carry the new set.
  await expect(page.locator('[data-parent-link]')).toHaveText('KAMATHI CHAWL')
  await expect(page.locator('[data-slugline-chip="INT. CHAWL CORRIDOR - NIGHT"]')).toContainText('× 1')
  await expect(page.locator('[data-slugline-chip="INT. CHAWL CORRIDOR - DAY"]')).toContainText('× 1')

  // The script says so too: every heading that was the name, in document
  // order, with its time of day; the courtyard and the bare corridor untouched.
  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const headings = page.locator('[data-sheet] [data-node-id][data-type="scene"]')
  await expect(headings).toHaveCount(7)
  expect(await headings.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))).toEqual([
    'INT. CHAWL CORRIDOR - NIGHT',
    'EXT. KAMATHI CHAWL - COURTYARD - DAY',
    'INT. CHAWL CORRIDOR - DAY',
    'INT. WARD OFFICE - DAY',
    'EXT. WATER TANKER STAND - DAWN',
    'EXT. WATER TANKER - DAY',
    'INT. CORRIDOR - NIGHT',
  ])
})

test('merge folds a record into another; delete refuses a record still in the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await ready(page)
  await page.locator('[data-location-row]').filter({ has: page.getByText('CORRIDOR', { exact: true }) }).click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await ready(page)
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('CORRIDOR')
  await expect(page.locator('[data-delete-button]')).toBeDisabled()

  const loser = page.url()
  await page.locator('[data-merge-button]').click()
  await page.locator('[data-merge-into]').selectOption({ label: '— Chawl Corridor' })
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  await page.waitForURL((url) => url.toString() !== loser && /\/locations\/[0-9a-f-]{36}$/.test(url.toString()), { timeout: 180_000 })
  await ready(page)
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('Chawl Corridor')
  await expect(page.locator('[data-slugline-chip="INT. CORRIDOR - NIGHT"]')).toContainText('× 1', { timeout: 60_000 })
  await expect(page.locator('[data-fact="Scenes"]')).toContainText('3')
  await expect(page.locator('[data-location-row]')).toHaveCount(5)

  // The loser's URL follows the tombstone to the survivor.
  await page.goto(loser)
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-location-record]').getByRole('button', { name: 'Name', exact: true })).toHaveText('Chawl Corridor', { timeout: 60_000 })
})

test('the breakdown, both themes', async ({ page, account }) => {
  await signIn(page, account)
  for (const theme of ['dark', 'light'] as const) {
    await page.goto(`${locationsUrl}?view=breakdown`)
    await setTheme(page, theme)
    await expect(page.locator('main[data-route="locations"]')).toHaveAttribute('data-sub-view', 'breakdown')
    const rows = page.locator('[data-breakdown-row]')
    await expect(rows).toHaveCount(5)
    // The chawl first, the roll-up of its two sub-sets: 3 + 1.
    await expect(rows.first()).toContainText('KAMATHI CHAWL')
    await expect(rows.first().locator('[data-breakdown-total]')).toHaveText('4')
    await expect(rows.first().locator('[data-breakdown-cell]').first()).toHaveAttribute('data-breakdown-cell', '4')
    await page.screenshot({ path: `test-results/locations-breakdown-${theme}.png`, fullPage: false })
  }
})
