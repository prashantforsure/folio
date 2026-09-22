import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Storyboard route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No script; the sidebar's
 *      widget counts boards, not credits, and its Storyboard row is lit;
 *      the header's centre is `Boards · Canvas · Shot list`, iconed, with
 *      the board lit - three buttons over client state (ruled 2026-09-17),
 *      so a click switches the body and the URL stays `/storyboard`; a
 *      stale `?view=` link, a real view or not, is a 200 on the board.
 *   2. **A script is columns; Auto board proposes; accepting boards.** The
 *      imported script's two accepted headings are two columns (the
 *      `INTERCUT` line is neither a scene nor a column) and two rows in the
 *      sidebar's `Boards` group. Auto board writes a proposal whose mentions
 *      are real records - the location the heading resolved to, the
 *      characters the cues bound to. Nothing is counted until accepted; then
 *      the toolbar and the sidebar widget agree, and a reload reads
 *      the same rows back.
 *   3. **A card opens its canvas; the shot is authored there.** A click on
 *      a board card lands on the canvas view with its scene selected
 *      (2026-09-17 - until then the card became its editor in place); the
 *      node's `⋯ → Edit` takes the lens and a description with an
 *      `@mention` resolved through the label book, and the board card
 *      reads it back in its overlay; drag to reorder on the board, add by
 *      hand at the column's foot, remove from the node's `⋯`; the filter
 *      hides what has no frame.
 *   4. **The frame names its cost but cannot be drawn yet.** The node's
 *      `Generate` says the cost; with no runner behind the queue
 *      (`apps/worker` is empty and nothing stands in for it the way
 *      Production's `after()` runner does) the button is disabled and its
 *      title gives the reason, so nothing reserves credits it can never
 *      spend (defect 0.4).
 *   5. **Canvas and list draw the same rows.** The node's `⋯` moves it in
 *      the sequence; the zoom pill scales the world; a card dragged by its
 *      grip keeps its position across a reload while its number does not
 *      change; the `Lens` tab saves a select; `Add shot` in the canvas
 *      toolbar appends a node and `⋯ → Remove` takes it away; `Upload
 *      image` is refused with a reason without `R2_*` and stores a frame
 *      with it; the stepper and the sidebar pick the scene; the list's
 *      `Display` sorts.
 *
 * Needs a real account; skips without one. Leaves one project behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Storyboard walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

/** Two headings derivation accepts, one it must not, two speakers, an action to close on. */
const FOUNTAIN = `INT. MEERA'S FLAT - NIGHT

A kettle on the hob. MEERA, 30s, watches it not boil.

INTERCUT - PHONE CALL

MEERA
Come on. Come on.

RAVI (O.S.)
It's business, not charity.

MEERA
Then send an invoice.

The kettle clicks off. She does not move.

EXT. STAIRWELL - CONTINUOUS

Rain on the skylight. RAVI, 40s, climbs with a tiffin in each hand.

RAVI
Meera?
`

/** What the placeholder cost is, read from the page rather than assumed. */
let cost = 0

/** A 1×1 transparent PNG, for the upload walk. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

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

const waitMounted = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-storyboard-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

/** The view is state (ruled 2026-09-17): a full load starts on the board, and the header's tab - not a `?view=` - opens the canvas or the list. */
const toView = async (page: Page, view: 'board' | 'canvas' | 'list'): Promise<void> => {
  await page.locator(`[data-writing-header] [data-view-tab="${view}"]`).click()
  await expect(page.locator('main[data-route="storyboard"]')).toHaveAttribute('data-sub-view', view)
}

const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-storyboard-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

let scriptUrl = ''
let storyboardUrl = ''
let projectId = ''

test('empty state, both themes; a tab is a button and a stale view link is ignored', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Storyboard walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  storyboardUrl = scriptUrl.replace(/\/script$/, '/storyboard')
  projectId = /\/project\/([0-9a-f-]{36})\//.exec(scriptUrl)?.[1] ?? ''
  expect(projectId).not.toBe('')

  await page.goto(storyboardUrl)
  const main = page.locator('main[data-route="storyboard"]')
  await expect(main).toHaveAttribute('data-sub-view', 'board')
  await expect(main).toHaveAttribute('data-storyboard-state', 'no-script')
  await expect(page.locator('[data-empty-state="no-script"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No script yet' })).toBeVisible()
  await expect(page.locator('[data-shot-count]')).toHaveText('0 shots')
  // The sidebar counts boards here, not credits, and lights its Storyboard row (a row since 2026-09-17).
  await expect(page.locator('[data-boards-card] [data-boards-drawn]')).toHaveText('0 / 0')
  await expect(page.locator('aside[data-sidebar] a[data-episode-route][aria-current="page"]')).toHaveAttribute('data-episode-route', 'storyboard')
  // The header's centre is the three views, each an icon beside its name, the board lit - buttons over client state, not links.
  const headerPill = page.locator('[data-writing-header] [data-view-pill]')
  await expect(headerPill.locator('button[data-view-tab]')).toHaveText(['Boards', 'Canvas', 'Shot list'])
  await expect(headerPill.locator('[data-view-tab] svg')).toHaveCount(3)
  await expect(headerPill.locator('[data-view-tab="board"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-storyboard-header] [data-view-pill]')).toHaveCount(0)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-empty-${theme}.png`, fullPage: false })
  }
  // A tab switches the body and the URL does not move (ruled 2026-09-17).
  await headerPill.locator('[data-view-tab="list"]').click()
  await expect(main).toHaveAttribute('data-sub-view', 'list')
  await expect(headerPill.locator('[data-view-tab="list"]')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(storyboardUrl)
  await expect(page.locator('[data-empty-state="no-script"]')).toBeVisible()
  // The tabs are state, not `?view=`: a stale view link is ignored, not a 404 - a real view or not.
  const stale = await page.goto(`${storyboardUrl}?view=list`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'board')
  const bogus = await page.goto(`${storyboardUrl}?view=grid`)
  expect(bogus?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'board')
})

test('a script is columns; Auto board proposes real mentions; accepting boards them', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  // Two scenes, not three: `INTERCUT - PHONE CALL` is not an interior scene at `ERCUT`.
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('2', { timeout: 60_000 })

  await page.goto(storyboardUrl)
  await waitMounted(page)
  const main = page.locator('main[data-route="storyboard"]')
  await expect(main).toHaveAttribute('data-storyboard-state', 'board')
  const columns = page.locator('[data-scene-column]')
  await expect(columns).toHaveCount(2)
  await expect(columns.nth(0)).toHaveAttribute('data-scene-number', '1')
  await expect(columns.nth(0)).toContainText("MEERA'S FLAT")
  await expect(columns.nth(0)).toContainText('NIGHT')
  await expect(columns.nth(1)).toContainText('STAIRWELL')
  await expect(page.locator('[data-no-shots]')).toHaveCount(2)
  await expect(page.locator('[data-shot-count]')).toHaveText('0 shots')
  // The sidebar's Boards group lists both scenes; the first is selected; the widget counts none boarded.
  const rows = page.locator('[data-board-row]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(rows.nth(0)).toContainText('Scene 01')
  await expect(page.locator('[data-boards-drawn]')).toHaveText('0 / 2')
  await expect(page.locator('[data-boards-waiting]')).toHaveText('No shots yet')

  // Auto board on scene 1: establishing, two-shot, one MCU each, closing wide.
  await columns.nth(0).locator('[data-auto-board]').click()
  await waitSaved(page)
  const proposed = columns.nth(0).locator('[data-shot][data-shot-state="proposed"]')
  await expect(proposed).toHaveCount(5)
  await expect(page.locator('[data-proposed-count]')).toHaveText('5 proposed')
  await expect(page.locator('[data-shot-count]')).toHaveText('0 shots')
  await expect(proposed.nth(0)).toHaveAttribute('data-shot-number', '01-01')
  await expect(proposed.nth(0).locator('[data-shot-description]')).toContainText('Establishing wide of')
  // The location is the record the heading resolved to; the speakers are the records the cues bound to.
  await expect(proposed.nth(0).locator('[data-mention="location"]')).toHaveCount(1)
  await expect(proposed.nth(1).locator('[data-shot-description]')).toContainText('Two-shot:')
  await expect(proposed.nth(1).locator('[data-mention="character"]')).toHaveCount(2)
  await expect(proposed.nth(2).locator('[data-shot-description]')).toContainText('Come on. Come on.')
  await expect(proposed.nth(3).locator('[data-shot-description]')).toContainText("It's business, not charity.")
  await expect(proposed.nth(4).locator('[data-shot-description]')).toContainText('Closing wide.')

  // Open the last proposal: a card click lands on the canvas (2026-09-17), where a proposal accepts or discards and has no frame to draw.
  await proposed.nth(4).click()
  await expect(main).toHaveAttribute('data-sub-view', 'canvas')
  await expect(page).toHaveURL(storyboardUrl)
  const node = page.locator('[data-shot-node]').nth(4)
  await expect(node.locator('[data-accept-shot]')).toBeVisible()
  await expect(node.locator('[data-generate-frame]')).toHaveCount(0)
  await node.locator('[data-node-menu]').click()
  await page.locator('[data-discard-shot]').click()
  await waitSaved(page)
  await expect(page.locator('[data-shot-node]')).toHaveCount(4)
  await toView(page, 'board')
  await expect(proposed).toHaveCount(4)
  await columns.nth(0).locator('[data-accept-all]').click()
  await waitSaved(page)
  await expect(columns.nth(0).locator('[data-shot][data-shot-state="accepted"]')).toHaveCount(4)
  await expect(page.locator('[data-proposed-count]')).toHaveCount(0)
  await expect(page.locator('[data-shot-count]')).toHaveText('4 shots')
  await expect(page.locator('[data-boards-drawn]')).toHaveText('1 / 2')
  await expect(page.locator('[data-boards-waiting]')).toHaveText('4 shots waiting on a frame')
  await expect(rows.nth(0)).toContainText('4')

  // Survives a reload: rows, not state.
  await page.reload()
  await waitMounted(page)
  await expect(page.locator('[data-shot][data-shot-state="accepted"]')).toHaveCount(4)
  await expect(page.locator('[data-boards-drawn]')).toHaveText('1 / 2')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-board-${theme}.png`, fullPage: false })
  }
})

test('a card opens its canvas; a shot is authored: edit with an @mention, drag to reorder, add, remove, filter', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(storyboardUrl)
  await waitMounted(page)
  const main = page.locator('main[data-route="storyboard"]')
  const column = page.locator('[data-scene-column]').nth(0)
  const shots = column.locator('[data-shot]')
  const nodes = page.locator('[data-shot-node]')
  const toBoard = async (): Promise<void> => {
    await toView(page, 'board')
  }
  await expect(shots).toHaveCount(4)

  // A card opens the canvas on its scene - a button over state, so the URL stays put.
  await shots.nth(0).click()
  await expect(main).toHaveAttribute('data-sub-view', 'canvas')
  await expect(page).toHaveURL(storyboardUrl)
  await expect(page.locator('[data-shot-count]')).toHaveText('Scene 01 · 4 shots')
  await expect(nodes).toHaveCount(4)

  // Edit there: the lens and a description typed with @Meera, resolved through the label book.
  await nodes.nth(0).locator('[data-node-menu]').click()
  await page.locator('[data-edit-shot]').click()
  const editor = nodes.nth(0).locator('[data-shot-editor]')
  await expect(editor).toBeVisible()
  await editor.locator('[data-field="lens"]').fill('35')
  await editor.locator('[data-field="description"]').fill('Wide on @Meera by the kettle. @Nobody is not a record.')
  await editor.locator('[data-save-shot]').click()
  await waitSaved(page)

  // The board card reads the same row: the lens in its camera line, the mention once, the text in its overlay.
  await toBoard()
  await expect(shots.nth(0)).toContainText('35mm')
  await expect(shots.nth(0).locator('[data-mention="character"]')).toHaveCount(1)
  await expect(shots.nth(0).locator('[data-shot-description]')).toContainText('@Nobody is not a record.')

  // Drag: shot 01-02 dropped on 01-01 lands before it, and the numbers follow the order.
  const secondId = await shots.nth(1).getAttribute('data-shot')
  await shots.nth(1).dragTo(shots.nth(0))
  await waitSaved(page)
  await expect(main).toHaveAttribute('data-sub-view', 'board')
  await expect(shots.nth(0)).toHaveAttribute('data-shot', secondId ?? '')
  await expect(shots.nth(0)).toHaveAttribute('data-shot-number', '01-01')
  await expect(shots.nth(1)).toHaveAttribute('data-shot-number', '01-02')

  // Add by hand at the column's foot: born accepted, at the end.
  await column.locator('[data-add-shot]').click()
  const form = column.locator('[data-add-shot-form] [data-shot-editor]')
  await expect(form).toBeVisible()
  await form.locator('[data-field="size"]').selectOption('cu')
  await form.locator('[data-field="description"]').fill('Insert: the kettle.')
  await form.locator('[data-save-shot]').click()
  await waitSaved(page)
  await expect(shots).toHaveCount(5)
  await expect(shots.nth(4)).toHaveAttribute('data-shot-state', 'accepted')
  await expect(shots.nth(4)).toContainText('CU ·')
  await expect(page.locator('[data-shot-count]')).toHaveText('5 shots')

  // Remove it again: its card opens the canvas, and the node's `⋯ → Remove` takes it away.
  await shots.nth(4).click()
  await expect(main).toHaveAttribute('data-sub-view', 'canvas')
  await expect(nodes).toHaveCount(5)
  await nodes.nth(4).locator('[data-node-menu]').click()
  await page.locator('[data-delete-shot]').click()
  await waitSaved(page)
  await toBoard()
  await expect(shots).toHaveCount(4)
  await expect(page.locator('[data-shot-count]')).toHaveText('4 shots')

  // The filter, in the one Display menu, reads the same rows: nothing has a frame yet.
  await page.locator('[data-display-menu]').click()
  await page.locator('[data-filter="drawn"]').click()
  await expect(column.locator('[data-no-match]')).toBeVisible()
  await expect(shots).toHaveCount(0)
  await page.locator('[data-filter="all"]').click()
  await page.keyboard.press('Escape')
  await expect(shots).toHaveCount(4)
})

test('the frame names its cost but Draw frame is disabled - no runner exists yet (defect 0.4)', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(storyboardUrl)
  await waitMounted(page)
  await toView(page, 'canvas')
  const nodes = page.locator('[data-shot-node]')
  const generate = (index: number) => nodes.nth(index).locator('[data-generate-frame]')
  await expect(nodes).toHaveCount(4)

  cost = Number((await generate(0).getAttribute('data-cost')) ?? '0')
  expect(cost).toBeGreaterThan(0)
  await expect(generate(0)).toContainText(`Generate · ${String(cost)} cr`)
  // `apps/worker` is empty and, unlike Production, nothing stands in for it -
  // a queued job would never be drawn, so the button reserves nothing.
  await expect(generate(0)).toBeDisabled()
  await expect(generate(0)).toHaveAttribute('title', 'Needs a frame-drawing worker - not built yet')
  await expect(nodes.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'no frame')
})

test('canvas and list draw the same rows', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(storyboardUrl)
  await waitMounted(page)
  await toView(page, 'canvas')
  await expect(page.locator('[data-view-tab="canvas"]')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(storyboardUrl)
  await expect(page.locator('[data-shot-count]')).toHaveText('Scene 01 · 4 shots')
  const nodes = page.locator('[data-shot-node]')
  await expect(nodes).toHaveCount(4)
  // No runner exists to draw a frame (defect 0.4, `Draw frame` disabled), so
  // every shot is still without one.
  await expect(nodes.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'no frame')
  await expect(nodes.nth(0).locator('[data-node-state]')).toHaveText('no frame')
  await expect(nodes.nth(2).locator('[data-generate-frame]')).toContainText(`Generate · ${String(cost)} cr`)
  await expect(nodes.nth(2).locator('[data-frame]')).toHaveAttribute('data-frame', 'no frame')

  // The node's `⋯` moves it; the numbers follow.
  const thirdId = await nodes.nth(2).getAttribute('data-shot-node')
  await nodes.nth(2).locator('[data-node-menu]').click()
  await page.locator('[data-move-shot="up"]').click()
  await waitSaved(page)
  await expect(nodes.nth(1)).toHaveAttribute('data-shot-node', thirdId ?? '')
  await expect(nodes.nth(1)).toHaveAttribute('data-shot-number', '01-02')

  // The canvas opens fitted (never past 100%); the pill steps the zoom either side of it.
  const zoomLabel = page.locator('[data-zoom-label]')
  await expect(zoomLabel).toHaveText(/^\d+%$/)
  const fitted = Number.parseInt((await zoomLabel.textContent()) ?? '0', 10)
  expect(fitted).toBeLessThanOrEqual(100)
  await page.locator('[data-zoom-pill]').getByRole('button', { name: 'Zoom out' }).click()
  const out = Number.parseInt((await zoomLabel.textContent()) ?? '0', 10)
  expect(out).toBeLessThan(fitted)
  await page.locator('[data-zoom-pill]').getByRole('button', { name: 'Zoom in' }).click()
  await page.locator('[data-zoom-pill]').getByRole('button', { name: 'Zoom in' }).click()
  const back = Number.parseInt((await zoomLabel.textContent()) ?? '0', 10)
  expect(back).toBeGreaterThan(fitted)
  await page.locator('[data-zoom-fit]').click()
  await expect(zoomLabel).toHaveText(`${String(fitted)}%`)

  // Every card sits where the sequence lays it until dragged; the threads follow the sequence.
  await expect(page.locator('[data-threads] [data-thread]')).toHaveCount(3)
  const first = nodes.nth(0)
  const firstId = await first.getAttribute('data-shot-node')
  const autoX = await first.getAttribute('data-canvas-x')
  const grip = first.locator('[data-node-grip]')
  const box = await grip.boundingBox()
  if (box === null) throw new Error('The grip has no box.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 120, { steps: 6 })
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 160, { steps: 6 })
  await page.mouse.up()
  await waitSaved(page)
  const movedX = await first.getAttribute('data-canvas-x')
  expect(movedX).not.toBe(autoX)
  // Position is cosmetic: the card is still first in the sequence.
  await expect(first).toHaveAttribute('data-shot-number', '01-01')
  await page.reload()
  await waitMounted(page)
  await toView(page, 'canvas')
  await expect(nodes.nth(0)).toHaveAttribute('data-shot-node', firstId ?? '')
  await expect(nodes.nth(0)).toHaveAttribute('data-canvas-x', movedX ?? '')

  // The Lens tab saves on change, and the card's tags say so.
  await nodes.nth(2).locator('[data-node-tab="lens"]').click()
  await nodes.nth(2).locator('[data-lens-field="size"]').selectOption('cu')
  await waitSaved(page)
  await nodes.nth(2).locator('[data-node-tab="storyboard"]').click()
  await expect(nodes.nth(2)).toContainText('Close-up')
  await expect(nodes.nth(2).locator('[data-frame]')).toContainText('CU ·')

  // Add shot, in the canvas toolbar, appends a node to the sequence; its `⋯` removes it.
  await page.locator('[data-shot-canvas] [data-add-shot]').click()
  await waitSaved(page)
  await expect(nodes).toHaveCount(5)
  await expect(nodes.nth(4)).toHaveAttribute('data-shot-number', '01-05')
  await expect(page.locator('[data-threads] [data-thread]')).toHaveCount(4)
  await nodes.nth(4).locator('[data-node-menu]').click()
  await page.locator('[data-delete-shot]').click()
  await waitSaved(page)
  await expect(nodes).toHaveCount(4)

  // Upload image: refused with a reason without storage; a frame with it.
  await nodes.nth(2).locator('[data-node-menu]').click()
  const upload = page.locator('[data-upload-frame]')
  if (await upload.isDisabled()) {
    await expect(upload).toHaveAttribute('title', 'Frame storage is not set up on this server yet.')
    await page.keyboard.press('Escape')
  } else {
    await upload.click()
    await nodes.nth(2).locator('[data-upload-frame-input]').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
    await waitSaved(page)
    await expect(nodes.nth(2).locator('[data-frame]')).toHaveAttribute('data-frame', 'uploaded')
    await expect(nodes.nth(2).locator('[data-node-state]')).toHaveText('uploaded')
    await nodes.nth(2).locator('[data-node-menu]').click()
    await page.locator('[data-clear-frame]').click()
    await waitSaved(page)
    await expect(nodes.nth(2).locator('[data-frame]')).toHaveAttribute('data-frame', 'no frame')
  }

  // The stepper and the sidebar's Boards group pick the scene the canvas shows.
  await page.locator('[data-scene-step="next"]').click()
  await expect(page.locator('[data-shot-count]')).toHaveText('Scene 02 · 0 shots')
  await expect(page.locator('[data-shot-canvas] [data-auto-board]')).toBeVisible()
  await expect(page.locator('[data-board-row]').nth(1)).toHaveAttribute('aria-current', 'true')
  await page.locator('[data-board-row]').nth(0).click()
  await expect(nodes).toHaveCount(4)
  // `setTheme` reloads, and a full load starts on the board: back to the canvas before each shot.
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await waitMounted(page)
    await toView(page, 'canvas')
    await expect(nodes).toHaveCount(4)
    await page.screenshot({ path: `test-results/storyboard-canvas-${theme}.png`, fullPage: false })
  }

  await toView(page, 'list')
  await expect(page).toHaveURL(storyboardUrl)
  await expect(page.locator('[data-list-scene]')).toHaveCount(2)
  await expect(page.locator('[data-list-shot]')).toHaveCount(4)
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('01-01')
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('35mm')
  await expect(page.locator('[data-list-scene]').nth(1)).toContainText('No shots listed for this scene.')

  // Display sorts the list: by lens, the 35mm shot leads and the header says so.
  await page.locator('[data-display-menu]').click()
  await page.locator('[data-sort="lens"]').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-sorted-by]')).toHaveText('sorted by lens')
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('35mm')
  await page.locator('[data-display-menu]').click()
  await page.locator('[data-sort="sequence"]').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-sorted-by]')).toHaveCount(0)
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('01-01')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await waitMounted(page)
    await toView(page, 'list')
    await expect(page.locator('[data-list-shot]')).toHaveCount(4)
    await page.screenshot({ path: `test-results/storyboard-list-${theme}.png`, fullPage: false })
  }
})
