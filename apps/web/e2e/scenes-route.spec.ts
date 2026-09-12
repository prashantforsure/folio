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
 *      counts to `0`; `?view=` outside `cards | index | list` is a 404.
 *   2. **Scenes are derived from headings, and a malformed heading is not
 *      one.** An import with two real headings and an `INTERCUT - PHONE
 *      CALL` line gives two cards, never a third at location `ERCUT`. Every
 *      card carries a real excerpt, a page and eighths from the measurement
 *      record, dialogue-line and cast-size counts, and cast chips whose
 *      names are the records the cues bound to.
 *   3. **The synopsis is authored on the record.** Written in the detail
 *      card, it survives a reload; the list view's Status column follows it.
 *   4. **Three views over one read**, both themes.
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

let scriptUrl = ''
let scenesUrl = ''

test('empty state, both themes; a bad view is a 404', async ({ page, account }) => {
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
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/scenes-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${scenesUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
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
  await expect(page.locator('main[data-route="scenes"] header')).toContainText('2')
})

test('the synopsis is authored on the record and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scenesUrl)
  const cards = page.locator('[data-scene-card]')
  await expect(cards).toHaveCount(2)
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
  await page.goto(`${scenesUrl}?view=index`)
  await expect(page.locator('main[data-route="scenes"]')).toHaveAttribute('data-sub-view', 'index')
  await expect(page.locator('[data-index-card]')).toHaveCount(2)
  await expect(page.locator('[data-index-card]').nth(0)).toContainText('Meera waits on a kettle')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/scenes-index-${theme}.png`, fullPage: false })
  }

  await page.goto(`${scenesUrl}?view=list`)
  await expect(page.locator('main[data-route="scenes"]')).toHaveAttribute('data-sub-view', 'list')
  const rows = page.locator('[data-scene-row]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Ready')
  await expect(rows.nth(1)).toContainText('Draft')
  await expect(rows.nth(1)).toContainText('No synopsis yet')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/scenes-list-${theme}.png`, fullPage: false })
  }

  await page.goto(scenesUrl)
  await expect(page.locator('[data-scene-card]')).toHaveCount(2)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/scenes-cards-${theme}.png`, fullPage: false })
  }
})
