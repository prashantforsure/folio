import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Scenes route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No script; the nav's Scenes row
 *      counts to `0`; the header's three tabs are buttons, a click switches
 *      the view without moving the URL, and a stale `?view=` - a real view
 *      or not - opens the cards, not a 404 (the views are state since
 *      2026-09-17).
 *   2. **Scenes are derived from headings, and a malformed heading is not
 *      one.** An import with two real headings and an `INTERCUT - PHONE
 *      CALL` line gives two cards, never a third at location `ERCUT`. Every
 *      card - a node on the canvas since 2026-09-17 - carries a real
 *      excerpt, a page and eighths from the measurement record,
 *      dialogue-line and cast-size counts, and cast chips whose names are
 *      the records the cues bound to; the canvas opens fitted on the row
 *      and the cards are threaded in story order.
 *   3. **The script tile opens the reading modal.** The whole scene in
 *      Courier on the sheet; `Asian` shows the engine's refusal (open
 *      decision 8), never a guessed A4; Escape closes it.
 *   4. **The synopsis is authored on the record.** Written in the detail
 *      dialog, it survives a reload; the list view's Status column follows it.
 *   5. **Three views over one read**, each opened by its header tab, both
 *      themes.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Scenes walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. MEERA'S FLAT - NIGHT

A kettle on the hob. MEERA, 30s, watches it not boil.

INTERCUT - PHONE CALL

MEERA
Come on. Come on.

RAVI (O.S.)
It's business, not charity.

EXT. STAIRWELL - CONTINUOUS

Rain on the skylight. RAVI, 40s, climbs with a tiffin in each hand.

RAVI
Meera?
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

/**
 * Two frames have painted. An attribute assertion passes on the DOM the moment React commits,
 * which on a dev server busy hydrating can be well before Chrome recalculates style and paints:
 * a screenshot taken straight after showed the previous tab lit under a DOM that said otherwise.
 */
const painted = async (page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      }),
  )
}

/** The workspace has hydrated. A click before that is replayed only once hydration finishes, which on a dev server can be seconds. */
const waitMounted = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-scenes-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

/** The view is state (ruled 2026-09-17): a full load starts on the cards, and the header's tab - not a `?view=` - opens the index or the list. */
const toView = async (page: Page, view: 'cards' | 'index' | 'list'): Promise<void> => {
  await waitMounted(page)
  const tab = page.locator(`[data-writing-header] [data-view-tab="${view}"]`)
  await tab.click()
  await expect(page.locator('main[data-route="scenes"]')).toHaveAttribute('data-sub-view', view)
  await expect(tab).toHaveAttribute('aria-current', 'page')
}

let scriptUrl = ''
let scenesUrl = ''

test('empty state, both themes; the tabs switch in place and a stale view is not a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Scenes walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  scenesUrl = scriptUrl.replace(/\/script$/, '/scenes')

  await page.goto(scenesUrl)
  const main = page.locator('main[data-route="scenes"]')
  await expect(main).toHaveAttribute('data-sub-view', 'cards')
  await expect(page.getByRole('heading', { name: 'No script yet' })).toBeVisible()
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('0')
  // The header's centre is the route's three tabs, as buttons over state, the first lit.
  const headerPill = page.locator('[data-writing-header] [data-header-views="scenes"] [data-view-pill]')
  await expect(headerPill.locator('button[data-view-tab]')).toHaveText(['Cards', 'Index cards', 'Scene list'])
  await expect(headerPill.locator('[data-view-tab] svg')).toHaveCount(3)
  await expect(headerPill.locator('[data-view-tab="cards"]')).toHaveAttribute('aria-current', 'page')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await painted(page)
    await page.screenshot({ path: `test-results/scenes-empty-${theme}.png`, fullPage: false })
  }
  // A tab switches the view and the URL does not move (ruled 2026-09-17).
  await headerPill.locator('[data-view-tab="index"]').click()
  await expect(main).toHaveAttribute('data-sub-view', 'index')
  await expect(headerPill.locator('[data-view-tab="index"]')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(scenesUrl)
  await expect(page.locator('[data-empty-state="no-script"]')).toBeVisible()
  // The tabs are state, not `?view=`: a stale view link is ignored, not a 404 - a real view or not.
  const stale = await page.goto(`${scenesUrl}?view=index`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'cards')
  const bogus = await page.goto(`${scenesUrl}?view=grid`)
  expect(bogus?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'cards')
})

test('scenes come from headings; INTERCUT is not one; every card is read from a table', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('2', { timeout: 60_000 })

  await page.goto(scenesUrl)
  const board = page.locator('[data-scene-board]')
  await expect(board).toHaveAttribute('data-scene-count', '2')
  const cards = page.locator('[data-scene-card]')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toHaveAttribute('data-scene-number', '1')
  await expect(cards.nth(0)).toContainText("INT. MEERA'S FLAT - NIGHT")
  await expect(cards.nth(1)).toHaveAttribute('data-scene-number', '2')
  await expect(cards.nth(1)).toContainText('EXT. STAIRWELL - CONTINUOUS')
  // "A malformed heading does not silently become a scene": two cards, and the
  // INTERCUT line is inside scene 1's excerpt as the text the writer typed,
  // not a third card at location ERCUT.
  await expect(page.locator('[data-scene-card][data-scene-number="3"]')).toHaveCount(0)
  await expect(cards.nth(0)).toContainText('INTERCUT - PHONE CALL')
  await expect(cards.nth(1)).not.toContainText('INTERCUT')

  // The excerpt is real lines; the page and eighths are the measurement's; the counts are derivation's.
  const first = cards.nth(0)
  await expect(first).toContainText('A kettle on the hob.')
  await expect(first.locator('[data-scene-page]')).toHaveText('pg 1')
  await expect(first.locator('[data-scene-eighths]')).not.toHaveText('—')
  await expect(first.locator('[data-scene-eighths]')).toContainText('/8')
  await expect(first).toContainText('2 chars')
  await expect(first).toContainText('2 lines')
  await expect(first.getByText('MEERA', { exact: true })).toBeVisible()
  await expect(first.getByText('RAVI', { exact: true })).toBeVisible()
  await expect(cards.nth(1)).toContainText('1 chars')
  await expect(cards.nth(1)).toContainText('1 lines')
  // The toolbar's label; the board's `data-scene-count` is the number the walk read above.
  await expect(page.locator('[data-scenes-header] [data-scene-count]')).toContainText('2 scenes')

  // The canvas: the ground is fitted on the row (never asserted at 100% - the viewport decides),
  // and one thread joins the two cards in story order.
  const ground = page.locator('[data-canvas-ground]')
  await expect(ground).toHaveAttribute('data-zoom', /^\d+$/)
  await expect(page.locator('[data-threads] path')).toHaveCount(1)
  await expect(cards.nth(0)).toHaveAttribute('data-selected', 'false')
  await waitMounted(page)
  await cards.nth(0).locator('[data-node-grip]').click()
  await expect(cards.nth(0)).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('[data-selected-scene]')).toContainText("INT. MEERA'S FLAT - NIGHT")
})

test('the script tile opens the scene on the sheet; Asian is the refusal, not a guess', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scenesUrl)
  const cards = page.locator('[data-scene-card]')
  await expect(cards).toHaveCount(2)
  await waitMounted(page)
  await cards.nth(0).locator('[data-scene-script]').click()
  const modal = page.locator('[data-script-modal]')
  await expect(modal).toBeVisible()
  await expect(modal).toHaveAttribute('data-script-format', 'hollywood')
  const sheet = modal.locator('[data-script-sheet]')
  await expect(sheet.locator('[data-type="scene"]')).toHaveText("INT. MEERA'S FLAT - NIGHT")
  await expect(sheet).toContainText('A kettle on the hob.')
  await expect(sheet.locator('[data-type="character"]').first()).toHaveText('MEERA')
  await expect(sheet).toContainText('INTERCUT - PHONE CALL')
  await expect(sheet).not.toContainText('Rain on the skylight')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme) // reloads; the modal is component state, so the tile opens it again
    await waitMounted(page)
    await cards.nth(0).locator('[data-scene-script]').click()
    await expect(modal).toBeVisible()
    await painted(page)
    await page.screenshot({ path: `test-results/scenes-modal-${theme}.png`, fullPage: false })
  }

  await modal.locator('[data-reading-format="asian"]').click()
  await expect(modal).toHaveAttribute('data-script-format', 'asian')
  await expect(modal.locator('[data-script-refusal]')).toContainText('open decision 8')
  await expect(modal.locator('[data-script-sheet]')).toHaveCount(0)
  await modal.locator('[data-read-hollywood]').click()
  await expect(modal.locator('[data-script-sheet]')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('the synopsis is authored on the record and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scenesUrl)
  const cards = page.locator('[data-scene-card]')
  await expect(cards).toHaveCount(2)
  await waitMounted(page)
  await cards.nth(0).getByRole('button', { name: /No synopsis yet/ }).click()
  const detail = page.locator('[data-scene-detail]')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText("INT. MEERA'S FLAT - NIGHT")
  const editor = detail.locator('[data-synopsis-editor]')
  await editor.locator('textarea').fill('Meera waits on a kettle and a call that is only business.')
  await editor.getByRole('button', { name: 'Save synopsis' }).click()
  await expect(editor.getByRole('status')).toHaveText('Saved to the scene record', { timeout: 60_000 })
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toBeHidden()

  await page.reload()
  await expect(cards.nth(0)).toContainText('Meera waits on a kettle and a call that is only business.')
  await expect(cards.nth(1).getByRole('button', { name: /No synopsis yet/ })).toBeVisible()
})

test('index and list views draw the same scenes, both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scenesUrl)
  await expect(page.locator('[data-scene-card]')).toHaveCount(2)
  // The switch is in place: the same two cards, the URL still the bare path.
  await toView(page, 'index')
  await expect(page).toHaveURL(scenesUrl)
  await expect(page.locator('[data-index-card]')).toHaveCount(2)
  await expect(page.locator('[data-index-card]').nth(0)).toContainText('Meera waits on a kettle')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme) // reloads, which lands on the cards; the tab brings the index back
    await toView(page, 'index')
    await painted(page)
    await page.screenshot({ path: `test-results/scenes-index-${theme}.png`, fullPage: false })
  }

  await toView(page, 'list')
  await expect(page).toHaveURL(scenesUrl)
  // The list's rows; the writing sidebar's Scenes group marks its rows the same way.
  const rows = page.locator('[data-scene-board] [data-scene-row]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Ready')
  await expect(rows.nth(1)).toContainText('Draft')
  await expect(rows.nth(1)).toContainText('No synopsis yet')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await toView(page, 'list')
    await painted(page)
    await page.screenshot({ path: `test-results/scenes-list-${theme}.png`, fullPage: false })
  }

  await toView(page, 'cards')
  await expect(page.locator('[data-scene-card]')).toHaveCount(2)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await painted(page)
    await page.screenshot({ path: `test-results/scenes-cards-${theme}.png`, fullPage: false })
  }
})
