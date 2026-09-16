import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Characters route, walked in a browser against the real backend -
 * the v2 pass (`docs/ui design/Route - Characters v2.dc.html`): the
 * sidebar card, the cast grid, the queue, the drawer, the graph, the
 * sheet.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** The 440px card with the busiest
 *      cues; the sidebar card with no rows; `?view=` outside `cast |
 *      relationships | sheet` is a 404, and so is a path that is not a UUID.
 *   2. **Records come from cues; near-misses are the queue, never a second
 *      Meera.** Three cards, the banner counting three, the rail badge the
 *      same; the card whose record a cue proposes wears the `--warn` border
 *      and the conflict block.
 *   3. **The queue is rows, and a decision persists.** `It's MEERA` on the
 *      card binds; `Review` unfolds the queue; `Not a character` rejects
 *      for good; `Someone else… → New character` mints.
 *   4. **The drawer authors the record and survives a reload**: role, age,
 *      description, status, wants, needs - and the sidebar's `Defined`
 *      widget moves.
 *   5. **A record-level rename rewrites every cue and keeps the profile.**
 *   6. **The graph, the sheet, the filter, both themes.** Delete is refused
 *      while the record is in the script.
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

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** The card whose face carries exactly this name. */
const card = (page: Page, name: string) =>
  page.locator('[data-character-card]').filter({
    has: page.locator('[data-card-name]', { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }),
  })

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
  await expect(main).toHaveAttribute('data-sub-view', 'cast')
  await expect(main).toHaveAttribute('data-characters-state', 'empty')
  await expect(main.getByText('No characters yet')).toBeVisible()
  await expect(main.getByText('Deriving costs nothing and never changes the script.')).toBeVisible()
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  // The shell: the sidebar card with no rows, the crumb, no mode pill, the status bar.
  await expect(page.locator('aside[data-sidebar] [data-cast-empty]')).toBeVisible()
  await expect(page.locator('[data-defined-count]')).toHaveText('0 / 0')
  await expect(page.locator('[data-route-crumb]')).toHaveText('Characters')
  await expect(page.locator('[data-mode-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-id]')).toHaveText('characters')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${charactersUrl}?view=overview`)
  expect(bogus?.status()).toBe(404)
  const notARecord = await page.goto(`${charactersUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from cues; near-misses are the queue and a conflict on the card', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  await page.goto(charactersUrl)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-characters-state', 'cast')
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await expect(card(page, 'MEERA')).toBeVisible()
  await expect(card(page, 'SURESH KADAM')).toBeVisible()
  await expect(card(page, 'CLERK')).toBeVisible()
  // Meera has two spellings in two scenes - the courtyard's `MEERA PAWAR`
  // is still in the queue, so it is not hers yet.
  await expect(card(page, 'MEERA').locator('[data-card-scenes]')).toHaveText('2 scenes')
  await expect(card(page, 'MEERA').locator('[data-episode-bars]')).toHaveAttribute('title', 'E1 2')
  await expect(card(page, 'MEERA').locator('[data-card-status]')).toHaveText('Draft')
  // Three cues with nowhere to point: the badge, the banner; and the two
  // whose proposals name a record are conflicts on those cards.
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('3')
  await expect(page.locator('[data-unmatched-count]')).toHaveText("3 names in the script don't match a character")
  await expect(card(page, 'MEERA')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'MEERA').locator('[data-conflict-block]').first()).toContainText('reads like MEERA')
  await expect(card(page, 'SURESH KADAM')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'CLERK')).toHaveAttribute('data-conflict', 'false')
  // The sidebar groups: MEERA leads, the rest follow.
  await expect(page.locator('[data-cast-group="principal"] [data-cast-row]')).toHaveCount(3)
  await expect(page.locator('[data-defined-count]')).toHaveText('0 / 3')
})

test("the queue is rows: It's MEERA binds, Not a character is never asked again, Someone else… mints", async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)

  // The conflict block on Meera's card: accept the change.
  const meera = card(page, 'MEERA')
  await meera.locator('[data-conflict-accept]').first().click()
  await saved(page)
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('2', { timeout: 60_000 })
  await expect(meera.locator('[data-card-scenes]')).toHaveText('3 scenes', { timeout: 60_000 })

  // Review unfolds the queue.
  await page.locator('[data-unmatched-review]').click()
  const youngMeera = page.locator('[data-unmatched-row="YOUNG MEERA"]')
  await expect(youngMeera.locator('[data-unmatched-match]')).toContainText('This is MEERA')
  const suresh = page.locator('[data-unmatched-row="SURESH"]')
  await expect(suresh.locator('[data-unmatched-match]')).toContainText('This is SURESH KADAM')

  // Not a character: YOUNG MEERA is nobody.
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
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)
  await expect(page.locator('[data-character-card]')).toHaveCount(4)
  await expect(card(page, 'SURESH')).toBeVisible()

  // The decisions persist: a reload shows no banner and no conflict.
  await page.reload()
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)
  await expect(page.locator('[data-character-card][data-conflict="true"]')).toHaveCount(0)
})

test('the drawer authors the record and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await card(page, 'MEERA').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('MEERA')
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('3 scenes')
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('E1 Sc 1 → E1 Sc 3')
  await expect(drawer.locator('[data-arc]')).toHaveAttribute('data-arc', '3')
  await expect(page.locator('[data-route-id]')).toContainText('characters/')
  await expect(page.locator('aside[data-sidebar] [data-cast-row][aria-current="page"]')).toContainText('MEERA')

  await drawer.locator('[data-field="role"]').fill('Laundress, second floor')
  await drawer.locator('[data-field="age"]').fill('38')
  await drawer.locator('[data-field="bio"]').fill("Does other people's washing and knows how much water every family on the floor uses.")
  await drawer.locator('[data-status="defined"]').click()
  await expect(drawer.locator('[data-status="defined"]')).toHaveAttribute('aria-pressed', 'true')
  await drawer.locator('[data-field="wants"]').fill('Water at six, like before.')
  await drawer.locator('[data-field="needs"]').fill('To be the one who decides.')
  await drawer.locator('[data-drawer-save]').click()
  await saved(page)
  await page.waitForURL(/\/characters$/)

  await expect(card(page, 'MEERA').locator('[data-card-status]')).toHaveText('Defined', { timeout: 60_000 })
  await expect(card(page, 'MEERA').locator('[data-card-line]')).toContainText("Does other people's washing")
  await expect(page.locator('[data-defined-count]')).toHaveText('1 / 4')
  await expect(page.locator('[data-defined-note]')).toHaveText('3 still drafts')

  await page.reload()
  await card(page, 'MEERA').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  await expect(drawer.locator('[data-field="role"]')).toHaveValue('Laundress, second floor')
  await expect(drawer.locator('[data-field="wants"]')).toHaveValue('Water at six, like before.')
  await expect(drawer.locator('[data-status="defined"]')).toHaveAttribute('aria-pressed', 'true')
  await drawer.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/characters$/)
})

test('a record-level rename rewrites every cue in the script and keeps the profile', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await card(page, 'MEERA').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')

  await drawer.locator('[data-field="name"]').fill('Meera Pawar')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.getByText('Rename everywhere?')).toBeVisible()
  await drawer.locator('[data-rename-confirm]').click()
  await saved(page)
  await page.waitForURL(/\/characters$/)
  await expect(card(page, 'Meera Pawar')).toBeVisible({ timeout: 60_000 })
  await expect(card(page, 'Meera Pawar')).toContainText('Laundress, second floor')

  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const cues = page.locator('[data-sheet] [data-type="character"]')
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

test('the graph, the sheet and the filter, both themes; delete refuses a record in the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${charactersUrl}?view=relationships`)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'relationships')
  await expect(page.locator('[data-view-tab="relationships"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-graph-node]')).toHaveCount(4)
  // Meera and Suresh Kadam share the corridor: one edge with a count.
  await expect(page.locator('[data-edge-label="1"]').first()).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-relationships-${theme}.png`, fullPage: false })
  }

  await page.goto(`${charactersUrl}?view=sheet`)
  await expect(page.locator('[data-sheet-row]')).toHaveCount(4)
  const meeraRow = page.locator('[data-sheet-row]').filter({ hasText: 'Meera Pawar' })
  await expect(meeraRow).toContainText('Defined')
  await expect(meeraRow).toContainText('E1 Sc 1')
  await page.screenshot({ path: 'test-results/characters-sheet-light.png', fullPage: false })

  // The filter narrows the sheet and the cast.
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="status:defined"]').click()
  await expect(page.locator('[data-sheet-row]')).toHaveCount(1)
  await page.goto(charactersUrl)
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="status:draft"]').click()
  await expect(page.locator('[data-character-card]')).toHaveCount(3)

  // Delete is refused while the record is in the script: the button says so.
  await card(page, 'CLERK').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer.locator('[data-drawer-delete]')).toBeDisabled()
  await expect(drawer.locator('[data-drawer-delete]')).toHaveAttribute('title', /Still in the script/)
  await expect(drawer.locator('[data-drawer-upload]')).toBeDisabled()
  await page.screenshot({ path: 'test-results/characters-drawer-light.png', fullPage: false })
})
