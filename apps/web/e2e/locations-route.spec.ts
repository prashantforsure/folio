import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Locations route, walked in a browser against the real backend - the
 * rebuild (2026-09-18, the plan is the spec).
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record; the sidebar card has no
 *      rows, no find field and no widget; the `Project / Locations` crumb
 *      with the three views in the header's centre as buttons; the status
 *      bar. A stale `?view=` is not a 404 - the views are state - but a
 *      non-UUID id is.
 *   2. **Records come from headings through the alias table, and
 *      near-misses go to the queue, not to a record.** Seven headings in
 *      five places derive four cards; the queue says *why* it is asking
 *      (`starts the same`), the sidebar lists the decisions, the widget
 *      counts them. The card quotes the script's first action line under
 *      the set and links its span into the script; the tree's structure
 *      proposals are conflict blocks.
 *   3. **The queue is rows, and every decision can be taken back.** `This
 *      is …` binds and the status bar offers `Undo`, which unbinds;
 *      `Somewhere else… → + New location` mints; `Move it inside` on the
 *      conflict block mints the primary set and hangs the sub-set under it
 *      - and the sub-set is then drawn *inside* the parent's card; `It's
 *      deliberate` is never asked again.
 *   4. **The drawer reads the script back and authors the record**: the
 *      alias table with provenance, everyone in `Who's here`, the quadrant,
 *      the Production fold (status, address, shooting days, description),
 *      `Part of`; it survives a reload; the widget counts the status and
 *      the roll-up counts the days.
 *   5. **A record-level rename rewrites every heading, keeps the record,
 *      and can be undone from the status bar.**
 *   6. **The three views, both themes.** `Scenes here` lists a primary set's
 *      scenes once with the sub-set named on the row, every row a link into
 *      the script; the sheet sorts, totals and exports; the filter narrows
 *      every view. Merge lives in the foot of a record still in the script.
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

MEERA
Two buckets. I counted.

The tap coughs twice and gives up.

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

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The card whose name link carries exactly this name. */
const card = (page: Page, name: string) =>
  page.locator('[data-location-card]').filter({
    has: page.locator('[data-card-name]', { hasText: new RegExp(`^\\s*${escape(name)}\\s*$`) }),
  })

/** The sidebar row for this name - a sub-set has no card of its own. */
const sidebarRow = (page: Page, name: string) => page.locator('[data-location-row]').filter({ hasText: new RegExp(`^\\s*${escape(name)}\\b`) }).first()

const openDrawer = async (page: Page, name: string): Promise<void> => {
  await sidebarRow(page, name).click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-location-drawer]')).toBeVisible()
}

let scriptUrl = ''
let locationsUrl = ''

test('empty state, both themes; a stale view opens the places, a bad id is a 404', async ({ page, account }) => {
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
  await expect(page.locator('[data-locations-toolbar]')).toHaveCount(0)
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  // The shell: the sidebar card with no rows, no find, no widget; the crumb; the views as buttons; the status bar.
  await expect(page.locator('aside[data-sidebar] [data-locations-empty]')).toBeVisible()
  await expect(page.locator('[data-testid="location-find"]')).toHaveCount(0)
  await expect(page.locator('[data-locations-widget]')).toHaveCount(0)
  await expect(page.locator('[data-route-crumb]')).toHaveText('Locations')
  const tabs = page.locator('[data-writing-header] [data-view-pill] [data-view-tab]')
  await expect(tabs).toHaveText(['Places', 'Scenes here', 'Sheet'])
  await expect(tabs.first()).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-locations-toolbar] [data-view-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-id]')).toHaveText('locations')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-empty-${theme}.png`, fullPage: false })
  }
  // The views are state (ruled 2026-09-18): a stale `?view=` is an unknown key, not a 404.
  const stale = await page.goto(`${locationsUrl}?view=sheet`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'places')
  const notARecord = await page.goto(`${locationsUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from headings; the queue says why; the card quotes the page and links its span', async ({ page, account }) => {
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
  // Four records, all primary sets: the count chip, the grid, the sidebar, the widget.
  await expect(page.locator('[data-location-count]')).toHaveText('4')
  await expect(page.locator('[data-location-card]')).toHaveCount(4)
  await expect(page.locator('[data-location-row]')).toHaveCount(4)
  await expect(page.locator('[data-scouted-count]')).toHaveText('0 of 4')
  // Two sluglines with nowhere to point: the badge, the queue (never dismissible), the sidebar group, the widget row.
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('2')
  await expect(page.locator('[data-unmatched-count]')).toHaveAttribute('data-unmatched-count', '2')
  await expect(page.locator('[data-unmatched-dismiss]')).toHaveCount(0)
  await expect(page.locator('[data-unmatched-row]')).toHaveCount(2)
  await expect(page.locator('[data-location-group="decisions"] [data-decision-row]')).toHaveCount(2)
  await expect(page.locator('[data-decisions-total]')).toHaveText('2')
  // The queue says why: `WATER TANKER` starts the same as `WATER TANKER STAND`, likely, a solid button; its citations link into the script.
  const tanker = page.locator('[data-unmatched-row="WATER TANKER"]')
  await expect(tanker.locator('[data-unmatched-reason]')).toHaveText('starts the same')
  await expect(tanker.locator('[data-unmatched-match]')).toHaveText('This is WATER TANKER STAND')
  await expect(tanker.locator('[data-unmatched-match]')).toHaveAttribute('data-confidence', 'likely')
  await expect(tanker.locator('[data-cite-link]').first()).toHaveAttribute('href', /\/ep_001\/script#n-[0-9a-f-]{36}$/)

  // The corridor: two scenes, `INT · 1 D · 1 N`, the first action under it quoted, the span linked, Meera on its foot.
  const corridor = card(page, 'KAMATHI CHAWL - CORRIDOR')
  await expect(corridor.locator('[data-card-kind]')).toHaveText('INT · 1 D · 1 N')
  await expect(corridor.locator('[data-card-scenes]')).toContainText('2 sc')
  await expect(corridor.locator('[data-card-status]')).toHaveAttribute('data-card-status', 'pending')
  await expect(corridor.locator('[data-card-line]')).toHaveAttribute('data-card-line', 'intro')
  await expect(corridor.locator('[data-card-line]')).toHaveText('The tap coughs twice and gives up.')
  await expect(corridor.locator('[data-card-span] [data-cite-link]')).toHaveCount(2)
  await expect(corridor.locator('[data-card-span] [data-cite-link]').first()).toHaveText('E1 Sc 1')
  await expect(corridor.locator('[data-card-cast]')).toHaveAttribute('data-card-cast', '1')
  await expect(corridor.locator('[data-presence-strip]')).toHaveCount(1)
  // The whole card is a link; the name is the anchor.
  await expect(corridor.locator('[data-card-link]')).toHaveAttribute('href', /\/locations\/[0-9a-f-]{36}$/)
  // The two `KAMATHI CHAWL - …` sets read like parts of one primary set: a conflict each.
  await expect(corridor).toHaveAttribute('data-conflict', 'true')
  await expect(corridor.locator('[data-conflict-block]')).toContainText('reads like part of a set called KAMATHI CHAWL')
  await expect(card(page, 'KAMATHI CHAWL - COURTYARD')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'WARD OFFICE')).toHaveAttribute('data-conflict', 'false')
  // The sidebar row prints the split; the ward office has no action line and says so on the card.
  await expect(sidebarRow(page, 'KAMATHI CHAWL - CORRIDOR').locator('[data-row-line]')).toHaveText('INT · 1 D · 1 N')
  await expect(card(page, 'WARD OFFICE').locator('[data-card-line]')).toHaveAttribute('data-card-line', 'none')
})

test("the queue is rows with an Undo; Somewhere else mints; Move it inside builds the tree and draws the sub-set inside the parent; It's deliberate is never asked again", async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)

  // `WATER TANKER` reads like `WATER TANKER STAND`: take the proposal, then take it back, then take it.
  const tanker = page.locator('[data-unmatched-row="WATER TANKER"]')
  await tanker.locator('[data-unmatched-match]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText("WATER TANKER is WATER TANKER STAND's now.")
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('1')
  await expect(card(page, 'WATER TANKER STAND').locator('[data-card-scenes]')).toContainText('2 sc')
  await page.locator('[data-status-undo]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('WATER TANKER is back in the queue.')
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('2')
  await expect(page.locator('[data-unmatched-row="WATER TANKER"]')).toHaveCount(1)
  await page.locator('[data-unmatched-row="WATER TANKER"] [data-unmatched-match]').click()
  await saved(page)
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveText('1')

  // `CORRIDOR` is somewhere else: a new location, from the menu.
  const corridor = page.locator('[data-unmatched-row="CORRIDOR"]')
  await corridor.locator('[data-unmatched-other]').click()
  await expect(corridor.locator('[role="menu"] [data-unmatched-pick]')).toHaveCount(5)
  await corridor.locator('[data-unmatched-pick="new-record"]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('CORRIDOR is a new location.')
  await expect(page.locator('[data-rail-badge="locations"]')).toHaveCount(0)
  await expect(page.locator('[data-location-count]')).toHaveText('5')
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)
  await expect(page.locator('[data-decisions-total]')).toHaveText('0')

  // The courtyard's conflict: move it inside a primary set nobody has made. The sub-set is then inside the parent's card, not a card of its own.
  await card(page, 'KAMATHI CHAWL - COURTYARD').locator('[data-conflict-accept]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('KAMATHI CHAWL - COURTYARD is inside KAMATHI CHAWL now.')
  await expect(page.locator('[data-location-count]')).toHaveText('6')
  await expect(card(page, 'KAMATHI CHAWL - COURTYARD')).toHaveCount(0)
  const chawl = card(page, 'KAMATHI CHAWL')
  await expect(chawl.locator('[data-card-kind]')).toHaveText('EXT · 1 D · 0 N')
  await expect(chawl.locator('[data-card-inside]')).toHaveAttribute('data-card-inside', '1')
  await expect(chawl.locator('[data-card-sub]')).toHaveText('KAMATHI CHAWL - COURTYARD 1')
  await expect(chawl.locator('[data-card-scenes]')).toContainText('1 sc')
  await expect(page.locator('[data-location-group="primary"] [data-location-row]')).toHaveCount(2)

  // The corridor's: it's deliberate. The block goes and does not come back.
  const chawlCorridor = card(page, 'KAMATHI CHAWL - CORRIDOR')
  await chawlCorridor.locator('[data-conflict-deliberate]').click()
  await saved(page)
  await expect(chawlCorridor).toHaveAttribute('data-conflict', 'false')
  await page.reload()
  await expect(card(page, 'KAMATHI CHAWL - CORRIDOR')).toHaveAttribute('data-conflict', 'false')
})

test('the drawer reads the script back, authors the record and survives a reload; the widget counts the status', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await card(page, 'WARD OFFICE').locator('[data-card-link]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('1 scene')
  await expect(drawer.locator('[data-meta-first]')).toHaveAttribute('href', /#n-[0-9a-f-]{36}$/)
  await expect(drawer.locator('[data-drawer-open-script]')).toHaveCount(1)
  await expect(drawer.locator('[data-drawer-ask]')).toHaveCount(1)
  // The evidence: no action line, the strip, the alias table with provenance, the quadrant, everyone here.
  await expect(drawer.locator('[data-drawer-intro]')).toHaveAttribute('data-drawer-intro', 'none')
  await expect(drawer.locator('[data-presence-strip]')).toHaveCount(1)
  await expect(drawer.locator('[data-alias-row]')).toHaveCount(1)
  await expect(drawer.locator('[data-alias-row="WARD OFFICE"] [data-alias-name]')).toHaveCount(1)
  await expect(drawer.locator('[data-alias-row="WARD OFFICE"] [data-alias-by]')).toHaveAttribute('data-alias-by', 'derived')
  await expect(drawer.locator('[data-alias-row="WARD OFFICE"] [data-alias-occurrences]')).toHaveAttribute('data-alias-occurrences', '1')
  await expect(drawer.locator('[data-slugline-note]')).toContainText('1 in the script')
  await expect(drawer.locator('[data-drawer-quadrant] [data-box="intDay"]')).toContainText('1')
  await expect(drawer.locator('[data-drawer-scenes]')).toHaveAttribute('data-drawer-scenes', '1')
  await expect(drawer.locator('[data-scene-row] [data-cite-link]')).toHaveCount(1)
  await expect(drawer.locator('[data-people]')).toHaveAttribute('data-people', '1')
  await expect(drawer.locator('[data-people]')).toContainText('MEERA')
  await expect(drawer.locator('[data-clips]')).toHaveAttribute('data-clips', 'none')
  // The sidebar's row is lit, the status bar names the record.
  await expect(page.locator('[data-location-row][aria-current="page"]')).toContainText('WARD OFFICE')
  await expect(page.locator('[data-status-left]')).toContainText('WARD OFFICE')
  await expect(page.locator('[data-route-id]')).toHaveText(/^locations\/[0-9a-f]{8}$/)

  // The Production fold authors the record; `Part of` hangs it under the chawl.
  await expect(drawer.locator('[data-drawer-production]')).toHaveAttribute('open', '')
  await drawer.locator('[data-field="address"]').fill('Ward 14, off the main road')
  await drawer.locator('[data-field="description"]').fill('A form, a queue, a stamp.')
  await drawer.locator('[data-field="days"]').fill('2')
  await drawer.locator('[data-status="scouted"]').click()
  await drawer.locator('[data-field="parent"]').selectOption({ label: 'Inside KAMATHI CHAWL' })
  await drawer.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)

  await expect(page.locator('[data-scouted-count]')).toHaveText('1 of 6')
  // A sub-set now: inside the chawl's card, not a card of its own; the chawl's roll-up counts its scene and its days.
  await expect(card(page, 'WARD OFFICE')).toHaveCount(0)
  const chawl = card(page, 'KAMATHI CHAWL')
  await expect(chawl.locator('[data-card-inside]')).toHaveAttribute('data-card-inside', '2')
  await expect(chawl.locator('[data-card-scenes]')).toContainText('2 sc')
  await expect(sidebarRow(page, 'WARD OFFICE')).toHaveCount(1)

  await page.reload()
  await openDrawer(page, 'WARD OFFICE')
  await expect(drawer.locator('[data-field="address"]')).toHaveValue('Ward 14, off the main road')
  await expect(drawer.locator('[data-field="days"]')).toHaveValue('2')
  await expect(drawer.locator('[data-status="scouted"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('INT')
  // The parent's drawer prints the roll-up: 2 days from the ward office under 0 of its own.
  await drawer.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/locations$/)
  await openDrawer(page, 'KAMATHI CHAWL')
  await expect(drawer.locator('[data-days-rollup]')).toHaveAttribute('data-days-rollup', '2')
  await expect(drawer.locator('[data-drawer-subsets]')).toHaveAttribute('data-drawer-subsets', '2')
  await expect(drawer.locator('[data-drawer-subset]')).toHaveCount(2)
  // Move the ward office back out, for the sheet's order below.
  await drawer.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/locations$/)
  await openDrawer(page, 'WARD OFFICE')
  await drawer.locator('[data-field="parent"]').selectOption('')
  await drawer.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)
  await expect(card(page, 'WARD OFFICE').locator('[data-card-line]')).toHaveText('A form, a queue, a stamp.')
  await expect(card(page, 'WARD OFFICE').locator('[data-card-line]')).toHaveAttribute('data-card-line', 'description')
})

test('a record-level rename rewrites every heading, keeps the record, and undoes from the status bar', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  await card(page, 'WARD OFFICE').locator('[data-card-link]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await drawer.locator('[data-field="name"]').fill('MUNICIPAL WARD OFFICE')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.locator('[data-rename-confirm]')).toContainText('Rename everywhere? 1 heading in the script will read MUNICIPAL WARD OFFICE')
  await expect(drawer.locator('[data-rename-stays]')).toHaveText('No other set text is bound.')
  await drawer.locator('[data-rename-confirm-button]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('Renamed · 1 heading in 1 episode → MUNICIPAL WARD OFFICE.')
  await expect(card(page, 'MUNICIPAL WARD OFFICE')).toHaveCount(1)
  // Undo puts the heading and the name back.
  await page.locator('[data-status-undo]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('Undone.')
  await expect(card(page, 'WARD OFFICE')).toHaveCount(1)
  await expect(card(page, 'MUNICIPAL WARD OFFICE')).toHaveCount(0)
  // And again, kept this time.
  await card(page, 'WARD OFFICE').locator('[data-card-link]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await drawer.locator('[data-field="name"]').fill('MUNICIPAL WARD OFFICE')
  await drawer.locator('[data-drawer-save]').click()
  await drawer.locator('[data-rename-confirm-button]').click()
  await page.waitForURL(/\/locations$/)
  await saved(page)
  const renamed = card(page, 'MUNICIPAL WARD OFFICE')
  await expect(renamed).toHaveCount(1)
  await expect(renamed.locator('[data-card-line]')).toHaveText('A form, a queue, a stamp.')
  await expect(renamed.locator('[data-card-status]')).toHaveAttribute('data-card-status', 'scouted')

  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('main[data-route="script"]')).toContainText('INT. MUNICIPAL WARD OFFICE - DAY')
  await expect(page.locator('main[data-route="script"]')).not.toContainText('INT. WARD OFFICE - DAY')
})

test('the three views and the filter, both themes; merge lives in the foot of a record in the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(locationsUrl)
  const main = page.locator('main[data-route="locations"]')
  // The tabs are buttons: the URL stays put.
  await page.locator('[data-writing-header] [data-view-tab="scenes"]').click()
  await expect(main).toHaveAttribute('data-sub-view', 'scenes')
  expect(page.url()).toBe(locationsUrl)
  await expect(page.locator('[data-view-tab="scenes"]')).toHaveAttribute('aria-current', 'page')
  // One section per primary set; the chawl lists its sub-set's scene once, with the sub-set named on the row; every row links into the script.
  await expect(page.locator('[data-scenes-group]')).toHaveCount(5)
  const chawl = page.locator('[data-scenes-group]').filter({ has: page.locator('[data-scenes-open]', { hasText: /^KAMATHI CHAWL$/ }) })
  await expect(chawl.locator('[data-scene-row]')).toHaveCount(1)
  await expect(chawl).toContainText('EXT. KAMATHI CHAWL - COURTYARD - DAY')
  await expect(chawl.locator('[data-scene-at]')).toHaveText('in KAMATHI CHAWL - COURTYARD')
  await expect(chawl.locator('[data-scenes-quadrant] [data-box="extDay"]')).toContainText('1')
  await expect(chawl.locator('[data-scene-row] [data-cite-link]')).toHaveAttribute('href', /#n-[0-9a-f-]{36}$/)
  await expect(page.locator('[data-scene-row] [data-scene-ie]').first()).toHaveText(/^(INT|EXT)$/)

  await page.locator('[data-writing-header] [data-view-tab="sheet"]').click()
  await expect(main).toHaveAttribute('data-sub-view', 'sheet')
  await expect(page.locator('[data-sheet-row]')).toHaveCount(6)
  await expect(page.locator('[data-sheet-row]').first()).toContainText('KAMATHI CHAWL')
  await expect(page.locator('[data-sheet-row]').filter({ hasText: 'MUNICIPAL WARD OFFICE' })).toContainText('Scouted')
  await expect(page.locator('[data-sheet-totals]')).toBeVisible()
  await expect(page.locator('[data-sort="scenes"]')).toHaveAttribute('aria-sort', 'descending')
  await page.locator('[data-sort="name"]').click()
  await expect(page.locator('[data-sort="name"]')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.locator('[data-sheet-row]').first()).toContainText('CORRIDOR')
  const download = page.waitForEvent('download')
  await page.locator('[data-sheet-export]').click()
  expect((await download).suggestedFilename()).toBe('locations.csv')
  // The filter narrows the sheet; `Show all` clears it.
  await page.locator('[data-location-filter]').click()
  await page.locator('[data-filter-option="scouted"]').click()
  await expect(page.locator('[data-sheet-row]')).toHaveCount(1)
  await expect(page.locator('[data-location-count]')).toHaveText('1 of 6')
  await page.locator('[data-location-filter]').click()
  await page.locator('[data-filter-option="all"]').click()
  await expect(page.locator('[data-sheet-row]')).toHaveCount(6)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.locator('[data-writing-header] [data-view-tab="sheet"]').click()
    await page.screenshot({ path: `test-results/locations-sheet-${theme}.png`, fullPage: false })
  }

  await page.goto(locationsUrl)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/locations-places-${theme}.png`, fullPage: false })
  }
  // A record still in the script cannot be deleted; its foot offers the merge instead.
  await card(page, 'CORRIDOR').locator('[data-card-link]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-location-drawer]')
  await expect(drawer.locator('[data-drawer-delete]')).toHaveCount(0)
  await drawer.locator('[data-drawer-merge]').click()
  await drawer.locator('[data-merge-into]').selectOption({ label: 'KAMATHI CHAWL - CORRIDOR' })
  await drawer.locator('[data-merge-confirm]').click()
  await page.waitForURL(/\/locations\/[0-9a-f-]{36}$/)
  await saved(page)
  await expect(page.locator('[data-location-count]')).toHaveText('5')
  await expect(page.locator('[data-location-drawer] [data-alias-row]')).toHaveCount(2)
  await expect(page.locator('[data-location-drawer] [data-slugline-note]')).toContainText('3 in the script')
})
