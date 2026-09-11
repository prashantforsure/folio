import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Outline and Beats routes, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **Both empty states, both themes.** No outline; the Beats route says
 *      so too. `?view=` outside `beats | arrangement` is a 404.
 *   2. **The outline is a document.** Starting one writes a `kind = 'outline'`
 *      document; typing a heading (`⌘1`), prose and a numbered beat through
 *      the slash menu autosaves; a reload reads it back block for block; the
 *      nav's Outline row prints `1 act` and its Beats row `1`.
 *   3. **A beat is an outline block.** The Beats route lists the beat typed
 *      in the outline with the name and line split at the colon; a beat added
 *      on the Beats route appears in the outline as block `2`.
 *   4. **Timing and placement are authored.** A duration typed on the sheet
 *      and a beat dropped on the arrangement track come back on reload, the
 *      footer sums placed minutes, and dragging a card back to the canvas
 *      unplaces it.
 *   5. **A beat names the scenes that deliver it.** With a script imported,
 *      linking a scene prints its chip on the beat and `Beats linked` on the
 *      Outline's panel moves; unlinking removes it.
 *
 * Needs a real account; skips without one. Leaves one project behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Outline / Beats walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. MEERA'S FLAT - NIGHT

A kettle on the hob. MEERA, 30s, watches it not boil.

MEERA
Come on. Come on.

EXT. STAIRWELL - CONTINUOUS

Rain on the skylight. RAVI, 40s, climbs with a tiffin in each hand.

RAVI
Meera? It's business, not charity.
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

/** Saved, and settled: wait, let a trailing autosave fire, wait again. */
const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await page.waitForTimeout(2_000)
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

let scriptUrl = ''
let outlineUrl = ''
let beatsUrl = ''

test('empty states, both themes; a bad Beats view is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Outline walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  outlineUrl = scriptUrl.replace(/\/script$/, '/outline')
  beatsUrl = scriptUrl.replace(/\/script$/, '/beats')

  await page.goto(outlineUrl)
  await expect(page.locator('main[data-route="outline"]')).toHaveAttribute('data-outline-state', 'empty')
  await expect(page.locator('[data-empty-state]')).toBeVisible()
  await expect(page.locator('[data-start-outline]')).toBeVisible()
  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('—')
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveText('—')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/outline-empty-${theme}.png`, fullPage: false })
  }

  await page.goto(beatsUrl)
  await expect(page.locator('main[data-route="beats"]')).toHaveAttribute('data-sub-view', 'beats')
  await expect(page.locator('main[data-route="beats"]')).toHaveAttribute('data-beats-state', 'no-outline')
  await expect(page.getByRole('heading', { name: 'No beats yet' })).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/beats-empty-${theme}.png`, fullPage: false })
  }
  await page.goto(`${beatsUrl}?view=arrangement`)
  await expect(page.locator('main[data-route="beats"]')).toHaveAttribute('data-sub-view', 'arrangement')
  await expect(page.getByRole('heading', { name: 'No beats yet' })).toBeVisible()
  const bogus = await page.goto(`${beatsUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
})

test('starting the outline and typing blocks saves them, and a reload reads them back', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(outlineUrl)
  await page.locator('[data-start-outline]').click()
  await expect(page.locator('main[data-route="outline"]')).toHaveAttribute('data-outline-state', 'draft', { timeout: 60_000 })
  await expect(page.locator('[data-outline-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
  await expect(page.locator('[data-nav-meta="outline"]')).toHaveText('0 acts')
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveText('0')

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
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveText('1')
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
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveText('1')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/outline-draft-${theme}.png`, fullPage: false })
  }
})

test('the Beats route lists the outline beat, and a beat added there lands in the outline', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(beatsUrl)
  await expect(page.locator('main[data-route="beats"]')).toHaveAttribute('data-beats-state', 'beats')
  const beats = page.locator('[data-beat]')
  await expect(beats).toHaveCount(1)
  await expect(beats.first().locator('[data-beat-name]')).toHaveValue('Opening Image')
  await expect(beats.first().locator('[data-beat-line]')).toHaveValue('empty pitch, Ade training alone.')
  await expect(beats.first().locator('[data-beat-unplaced]')).toHaveText('Not on the timeline yet')
  await expect(page.locator('main[data-route="beats"] header')).toContainText('1')

  await page.locator('[data-add-beat]').click()
  await expect(beats).toHaveCount(2, { timeout: 60_000 })
  const second = beats.nth(1)
  await second.locator('[data-beat-name]').fill('Catalyst')
  await second.locator('[data-beat-name]').press('Tab')
  await second.locator('[data-beat-line]').fill('The old man speaks from the shadow.')
  await second.locator('[data-beat-line]').blur()
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await expect(page.locator('[data-nav-meta="beats"]')).toHaveText('2')

  await page.reload()
  await expect(beats).toHaveCount(2)
  await expect(beats.nth(1).locator('[data-beat-name]')).toHaveValue('Catalyst')
  await expect(beats.nth(1).locator('[data-beat-line]')).toHaveValue('The old man speaks from the shadow.')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/beats-sheet-${theme}.png`, fullPage: false })
  }

  // And in the outline it is block 2 of the numbered list.
  await page.goto(outlineUrl)
  const blocks = page.locator('[data-sheet] [data-node-id]')
  await expect(blocks).toHaveCount(4)
  await expect(blocks.nth(3)).toHaveAttribute('data-type', 'beat')
  await expect(blocks.nth(3)).toHaveText('2Catalyst: The old man speaks from the shadow.')
})

test('duration and placement are authored: the arrangement places a beat and the footer sums it', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(beatsUrl)
  const beats = page.locator('[data-beat]')
  await expect(beats).toHaveCount(2)
  await beats.first().locator('[data-beat-duration]').fill('6')
  await beats.first().locator('[data-beat-duration]').blur()
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await beats.nth(1).locator('[data-beat-duration]').fill('10')
  await beats.nth(1).locator('[data-beat-duration]').blur()
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await expect(page.locator('[data-footer-placed]')).toHaveText('0m of 16m')

  await page.goto(`${beatsUrl}?view=arrangement`)
  await expect(page.locator('[data-unplaced-card]')).toHaveCount(2)
  await expect(page.locator('[data-placed-card]')).toHaveCount(0)

  // Drag the first card onto the track, at the 6' mark.
  const card = page.locator('[data-unplaced-card]').first()
  const track = page.locator('[data-beat-track]')
  const from = await card.boundingBox()
  const to = await track.boundingBox()
  if (from === null || to === null) throw new Error('The card or the track has no box.')
  await page.mouse.move(from.x + 40, from.y + 20)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 10, { steps: 4 })
  await page.mouse.move(to.x + 16 + 6 * 62 + 4, to.y + 40, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('[data-placed-card]')).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('[data-placed-card]').first()).toContainText("6'–12'")
  await expect(page.locator('[data-footer-placed]')).toHaveText('6m of 16m')
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })

  await page.reload()
  await expect(page.locator('[data-placed-card]')).toHaveCount(1)
  await expect(page.locator('[data-unplaced-card]')).toHaveCount(1)
  await expect(page.locator('[data-footer-placed]')).toHaveText('6m of 16m')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/beats-arrangement-${theme}.png`, fullPage: false })
  }

  // Back on the sheet the placement label says where it sits.
  await page.goto(beatsUrl)
  await expect(beats.first().locator('[data-beat-placement]')).toContainText("6'–12' · 6m")
  await expect(beats.first().locator('[data-beat-unplaced]')).toHaveCount(0)
  await expect(beats.nth(1).locator('[data-beat-placement]')).toContainText('unplaced · 10m')

  // And dragging it off the track unplaces it.
  await page.goto(`${beatsUrl}?view=arrangement`)
  const placed = page.locator('[data-placed-card]').first()
  const canvas = page.locator('[data-beat-canvas]')
  const placedBox = await placed.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (placedBox === null || canvasBox === null) throw new Error('The placed card or the canvas has no box.')
  await page.mouse.move(placedBox.x + 40, placedBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(placedBox.x + 60, placedBox.y + 30, { steps: 4 })
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 200, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('[data-placed-card]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-unplaced-card]')).toHaveCount(2)
  await expect(page.locator('[data-footer-placed]')).toHaveText('0m of 16m')
})

test('a beat names the scenes that deliver it', async ({ page, account }) => {
  await signIn(page, account)
  // A script, so there are scenes to name.
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('2', { timeout: 60_000 })

  await page.goto(beatsUrl)
  const beats = page.locator('[data-beat]')
  await expect(beats).toHaveCount(2)
  await expect(beats.first().locator('[data-beat-scene]')).toHaveCount(0)
  await beats.first().locator('[data-link-scene]').click()
  const picker = beats.first().locator('[data-scene-picker]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-scene-option]')).toHaveCount(2)
  await picker.locator('[data-scene-option]').first().click()
  await expect(beats.first().locator('[data-beat-scene]')).toHaveCount(1, { timeout: 60_000 })
  await expect(beats.first().locator('[data-beat-scene]').first()).toContainText('Scene 1')
  await expect(beats.first().locator('[data-beat-scene]').first()).toContainText('pg 1')
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })

  await page.reload()
  await expect(beats.first().locator('[data-beat-scene]')).toHaveCount(1)
  await expect(beats.nth(1).locator('[data-beat-scene]')).toHaveCount(0)

  await page.goto(outlineUrl)
  await expect(page.locator('[data-beats-linked]')).toHaveText('1 of 2')

  await page.goto(beatsUrl)
  await beats.first().locator('[data-beat-scene]').first().locator('[data-unlink-scene]').click()
  await expect(beats.first().locator('[data-beat-scene]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-beats-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await page.reload()
  await expect(beats.first().locator('[data-beat-scene]')).toHaveCount(0)
})
