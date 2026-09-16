import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Locations route, walked in a browser against the real backend - the
 * v2 pass (`docs/ui design/Route - Locations v2.dc.html`).
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record; the shell is the
 *      sidebar card (no rows, `Scouted 0 / 0`), the `Project / Locations`
 *      crumb with no mode pill, the status bar. `?view=` outside
 *      `places | scenes | sheet` is a 404, and so is a non-UUID id.
 *   2. **Records come from headings through the alias table, and
 *      near-misses go to the queue, not to a record.** Seven headings in
 *      five places derive four cards - `WATER TANKER` is a shorter form of
 *      `WATER TANKER STAND` and `CORRIDOR` of `KAMATHI CHAWL - CORRIDOR`,
 *      so each is a banner row with a guess. The rail badge is that count.
 *      The two `KAMATHI CHAWL - …` sets read like parts of a primary set
 *      nobody has made: a `--warn` border and a conflict block on each.
 *   3. **The queue is rows, and the tree is authored from it.** `This is …`
 *      binds a set text; `Somewhere else… → New location` mints one; `Move
 *      it inside` on the conflict block mints the primary set and hangs the
 *      sub-set under it; `It's deliberate` is never asked again.
 *   4. **The drawer authors the record and survives a reload**: a
 *      description, an address, a status, the `Part of` edge - and the
 *      sidebar's `Scouted` widget counts the status.
 *   5. **A record-level rename rewrites every heading and keeps the
 *      record.** The Script route shows the new set on every heading that
 *      was the name; the description is still there.
 *   6. **The three views and the filter, both themes.** `Scenes here`
 *      lists every scene under its place; the sheet has one row per record
 *      in tree order; `All locations ▾` narrows every view. Delete on a
 *      record in the script offers a merge instead.
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

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** The card whose tile carries exactly this name. */
const card = (page: Page, name: string) =>
  page.locator('[data-location-card]').filter({
    has: page.locator('[data-card-name]', { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }),
  })

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
  await expect(main).toHaveAttribute('data-sub-view', 'places')
  await expect(main).toHaveAttribute('data-locations-state', 'empty')
  await expect(main.getByText('No locations yet')).toBeVisible()
  await expect(main.getByText('Sluglines stay as written and point at the record.')).toBeVisible()
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  // The shell: the sidebar card with no rows, the crumb, no mode pill, the status bar.
  await expect(page.locator('aside[data-sidebar] [data-locations-empty]')).toBeVisible()
  await expect(page.locator('[data-scouted-count]')).toHaveText('0 / 0')
  await expect(page.locator('[data-route-crumb]')).toHaveText('Locations')
  await expect(page.locator('[data-mode-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-id]')).toHaveText('locations')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${locationsUrl}?view=record`)
  expect(bogus?.status()).toBe(404)
  const notARecord = await page.goto(`${locationsUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from headings; near-misses are the banner; a proposed edge is a conflict on the card', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('7', { timeout: 60_000 })

  await page.goto(locationsUrl)
  await expect(page.locator('main[data-route="locations"]')).toHaveAttribute('data-locations-state', 'places')
  // Four records, all primary sets: the count chip, the grid, the sidebar.
  await expect(page.locator('[data-location-count]')).toHaveText('4')
  await expect(page.locator('[data-location-card]')).toHaveCount(4)
  await expect(page.locator('[data-location-row]')).toHaveCount(4)
  await expect(page.locator('[data-scouted-count]')).toHaveText('0 / 4')
  // Two sluglines with nowhere to point: the badge and the banner.
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('2')
  await expect(page.locator('[data-unmatched-count]')).toHaveAttribute('data-unmatched-count', '2')

  // The corridor: two scenes, INT, recurring; Meera on its foot. `INT.
  // CORRIDOR` is still in the queue, so it is not the corridor's yet.
  const corridor = card(page, 'KAMATHI CHAWL - CORRIDOR')
  await expect(corridor.locator('[data-card-kind]')).toHaveText('INT · Recurring interior')
  await expect(corridor.locator('[data-card-scenes]')).toContainText('2 scenes')
  await expect(corridor.locator('[data-card-status]')).toHaveText('Pending')
  await expect(corridor.locator('[data-card-cast]')).toHaveAttribute('data-card-cast', '1')
  // The two `KAMATHI CHAWL - …` sets read like parts of one primary set: a conflict each.
  await expect(corridor).toHaveAttribute('data-conflict', 'true')
  await expect(corridor.locator('[data-conflict-block]')).toContainText('reads like part of a set called KAMATHI CHAWL')
  await expect(card(page, 'KAMATHI CHAWL - COURTYARD')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'WARD OFFICE')).toHaveAttribute('data-conflict', 'false')
})

test("the queue is rows: This is … binds, Somewhere else… mints; Move it inside builds the tree, It's deliberate is never asked again", async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await page.locator('[data-unmatched-review]').click()
  await expect(page.locator('[data-unmatched-row]')).toHaveCount(2)

  // `WATER TANKER` reads like `WATER TANKER STAND`: take the proposal.
  const tanker = page.locator('[data-unmatched-row]').filter({ hasText: 'WATER TANKER' }).first()
  await expect(tanker.locator('[data-unmatched-match]')).toHaveText('This is WATER TANKER STAND')
  await tanker.locator('[data-unmatched-match]').click()
  await saved(page)
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('1')
  await expect(card(page, 'WATER TANKER STAND').locator('[data-card-scenes]')).toContainText('2 scenes')

  // `CORRIDOR` is somewhere else: a new location. The queue stays unfolded across the re-read.
  if ((await page.locator('[data-unmatched-banner]').getAttribute('data-open')) !== 'true') await page.locator('[data-unmatched-review]').click()
  const corridor = page.locator('[data-unmatched-row]').filter({ hasText: 'CORRIDOR' }).first()
  await corridor.locator('[data-unmatched-other]').click()
  await corridor.locator('[data-unmatched-pick]').selectOption('new-record')
  await saved(page)
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  await expect(page.locator('[data-location-count]')).toHaveText('5')
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)

  // The courtyard's conflict: move it inside a primary set nobody has made.
  const courtyard = card(page, 'KAMATHI CHAWL - COURTYARD')
  await courtyard.locator('[data-conflict-accept]').click()
  await saved(page)
  await expect(page.locator('[data-location-count]')).toHaveText('6')
  await expect(card(page, 'KAMATHI CHAWL').locator('[data-card-kind]')).toHaveText('EXT · Primary set')
  await expect(card(page, 'KAMATHI CHAWL - COURTYARD').locator('[data-card-kind]')).toHaveText('EXT · Inside KAMATHI CHAWL')
  await expect(card(page, 'KAMATHI CHAWL - COURTYARD')).toHaveAttribute('data-conflict', 'false')

  // The corridor's: it's deliberate. The block goes and does not come back.
  const chawlCorridor = card(page, 'KAMATHI CHAWL - CORRIDOR')
  await chawlCorridor.locator('[data-conflict-deliberate]').click()
  await saved(page)
  await expect(chawlCorridor).toHaveAttribute('data-conflict', 'false')
  await page.reload()
  await expect(card(page, 'KAMATHI CHAWL - CORRIDOR')).toHaveAttribute('data-conflict', 'false')
  // The primary set's roll-up counts the courtyard's scene; the sidebar shows the tree in one group.
  await expect(card(page, 'KAMATHI CHAWL').locator('[data-card-scenes]')).toContainText('1 scene')
  await expect(page.locator('[data-location-group="primary"] [data-location-row]')).toHaveCount(2)
})

test('the drawer authors the record and survives a reload; the widget counts the status', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await card(page, 'WARD OFFICE').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('1 scene')
  await expect(drawer.locator('[data-field="ie"]')).toHaveText('INT')
  await expect(drawer.locator('[data-field="kind"]')).toHaveText('One-off')
  await expect(drawer.locator('[data-slugline-note]')).toHaveText('1 in the script')
  await expect(drawer.locator('[data-people]')).toContainText('MEERA')
  // The sidebar's row is lit, the status bar names the record.
  await expect(page.locator('[data-location-row][aria-current="page"]')).toContainText('WARD OFFICE')
  await expect(page.locator('[data-status-left]')).toContainText('WARD OFFICE')

  await drawer.locator('[data-field="address"]').fill('Ward 14, off the main road')
  await drawer.locator('[data-field="description"]').fill('A form, a queue, a stamp.')
  await drawer.locator('[data-status="scouted"]').click()
  await drawer.locator('[data-field="parent"]').selectOption({ label: 'Inside KAMATHI CHAWL' })
  await drawer.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)

  await expect(page.locator('[data-scouted-count]')).toHaveText('1 / 6')
  await expect(page.locator('[data-scouted-note]')).toHaveText('5 still pending')
  const ward = card(page, 'WARD OFFICE')
  await expect(ward.locator('[data-card-status]')).toHaveText('Scouted')
  await expect(ward.locator('[data-card-line]')).toHaveText('A form, a queue, a stamp.')
  await expect(ward.locator('[data-card-kind]')).toHaveText('INT · Inside KAMATHI CHAWL')
  await expect(card(page, 'KAMATHI CHAWL').locator('[data-card-scenes]')).toContainText('2 scenes')

  await page.reload()
  await card(page, 'WARD OFFICE').click()
  await expect(page.locator('[data-location-drawer] [data-field="address"]')).toHaveValue('Ward 14, off the main road')
  await expect(page.locator('[data-location-drawer] [data-status="scouted"]')).toHaveAttribute('aria-pressed', 'true')
  // Move it back out, for the sheet's order below.
  await page.locator('[data-location-drawer] [data-field="parent"]').selectOption('')
  await page.locator('[data-location-drawer] [data-drawer-save]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)
})

test('a record-level rename rewrites every heading in the script and keeps the record', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await card(page, 'WARD OFFICE').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await drawer.locator('[data-field="name"]').fill('MUNICIPAL WARD OFFICE')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.getByText('Rename everywhere?')).toBeVisible()
  await expect(drawer.getByText('1 heading in the script will read MUNICIPAL WARD OFFICE')).toBeVisible()
  await drawer.locator('[data-rename-confirm]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)
  const renamed = card(page, 'MUNICIPAL WARD OFFICE')
  await expect(renamed).toHaveCount(1)
  await expect(renamed.locator('[data-card-line]')).toHaveText('A form, a queue, a stamp.')
  await expect(renamed.locator('[data-card-status]')).toHaveText('Scouted')

  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('main[data-route="script"]')).toContainText('INT. MUNICIPAL WARD OFFICE - DAY')
  await expect(page.locator('main[data-route="script"]')).not.toContainText('INT. WARD OFFICE - DAY')
})

test('the three views and the filter, both themes; delete on a record in the script offers a merge', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${locationsUrl}?view=scenes`)
  const main = page.locator('main[data-route="locations"]')
  await expect(main).toHaveAttribute('data-sub-view', 'scenes')
  await expect(page.locator('[data-view-tab="scenes"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-scenes-group]')).toHaveCount(6)
  // The primary set lists its sub-set's scene; the sub-set lists it too.
  const chawl = page.locator('[data-scenes-group]').filter({ has: page.locator('[data-scenes-open]', { hasText: /^KAMATHI CHAWL$/ }) })
  await expect(chawl.locator('[data-scene-row]')).toHaveCount(1)
  await expect(chawl).toContainText('EXT. KAMATHI CHAWL - COURTYARD - DAY')

  await page.goto(`${locationsUrl}?view=sheet`)
  await expect(main).toHaveAttribute('data-sub-view', 'sheet')
  await expect(page.locator('[data-sheet-row]')).toHaveCount(6)
  await expect(page.locator('[data-sheet-row]').first()).toContainText('KAMATHI CHAWL')
  await expect(page.locator('[data-sheet-row]').filter({ hasText: 'MUNICIPAL WARD OFFICE' })).toContainText('Scouted')
  // The filter narrows the sheet.
  await page.locator('[data-location-filter]').click()
  await page.locator('[data-filter-option="scouted"]').click()
  await expect(page.locator('[data-sheet-row]')).toHaveCount(1)
  await page.locator('[data-location-filter]').click()
  await page.locator('[data-filter-option="all"]').click()
  await expect(page.locator('[data-sheet-row]')).toHaveCount(6)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-sheet-${theme}.png`, fullPage: false })
  }

  await page.goto(locationsUrl)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-places-${theme}.png`, fullPage: false })
  }
  // Delete on a record still in the script offers a merge in the foot instead.
  await card(page, 'CORRIDOR').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await drawer.locator('[data-drawer-delete]').click()
  await expect(drawer.getByText('Still in the script')).toBeVisible()
  await drawer.locator('[data-merge-into]').selectOption({ label: 'KAMATHI CHAWL - CORRIDOR' })
  await drawer.locator('[data-merge-confirm]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await saved(page)
  await expect(page.locator('[data-location-count]')).toHaveText('5')
  await expect(page.locator('[data-location-drawer] [data-slugline-note]')).toHaveText('3 in the script')
})
