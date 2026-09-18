import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Timeline route, walked in a browser against the real backend - the
 * rebuild (2026-09-18): the sidebar card, the header's view pill, the
 * lanes, the drawer and the status bar.
 *
 * What this proves, in order:
 *
 *   1. **The shell and the empty state, both themes.** The sidebar card at
 *      236px with the Threads group, the header's three tabs, the 440px
 *      card; a stale `?view=grid` opens story order, not a 404.
 *   2. **Story time is authored, never parsed - but the page is read as
 *      evidence.** Two episodes are imported with `DAY`, `CONTINUOUS`,
 *      `LATER` and "the next morning" on the page and the route is still
 *      empty - no scene has a day until the writer says so. `Place 7
 *      scenes` opens the proposal queue: a day per scene with its reason
 *      and its citation; `Accept all` writes them in one statement, the
 *      status bar offers `Undo`, which takes it back; one row accepted on
 *      its own re-counts the rest. The chronology draws the days the cues
 *      gave; the continuity view has notes, no flags. The tabs switch
 *      without the URL moving.
 *   3. **A finding is a flag, and the writer answers it**: E2 Sc 3 set
 *      earlier than E2 Sc 2 shows `↶` and `⚠`, `1` on the Continuity tab,
 *      one card; `It's deliberate` files it under the fold and `Reopen`
 *      brings it back; a `NIGHT` heading clocked at 14:00 is a
 *      `light-vs-clock` finding; the Flashback toggle keeps the time and
 *      drops the card.
 *   4. **Threads are authored and linked by hand** - made in the sidebar,
 *      linked from the drawer's menu (a half-typed day in the drawer
 *      survives that write's refresh), the card moves to the thread's row
 *      and a second thread draws a ghost, `▲` makes it the row, solo dims
 *      the other rows, a rename sticks, a drag reorders the sidebar, a
 *      delete unlinks every scene in one statement.
 *   5. **Everything survives a reload**; the scope narrows the grid; the
 *      lanes swap to the cast and the sets; the chronology draws the days
 *      and takes a dragged card; the keys move a scene a day; the reader
 *      walks story order; the export downloads; both themes.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

/**
 * After a write the page re-reads through the Sydney pooler; the Characters
 * walk gives that a minute, and so does this one.
 */
const eventually = expect.configure({ timeout: 60_000 })

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Timeline walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const EPISODE_ONE = `INT. CHAWL CORRIDOR - DAY

Meera hangs washing. The tap coughs.

MEERA
Two buckets. I counted.

EXT. WATER TANKER - CONTINUOUS

First tanker. Meera is fourth in line.

DRIVER
Name?

EXT. CHAWL COURTYARD - DAWN

The next morning. Buckets hold places in the queue.

MEERA
Mine was here first.

INT. MEERA'S ROOM - LATER

The blue bucket is filled to a pencil line.
`

const EPISODE_TWO = `INT. WARD OFFICE - DAY

Three days later. The meter reading does not match the bill.

MEERA
Show me the meter.

INT. CHAWL CORRIDOR - NIGHT

Kadam's man counts doors.

EXT. CHAWL ROOFTOP - DAY

The tank is opened.
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

const importFountain = async (page: Page, scriptUrl: string, name: string, text: string, scenes: number): Promise<void> => {
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const path = join(test.info().outputDir, name)
  writeFileSync(path, text)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(path)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText(String(scenes), { timeout: 60_000 })
}

/** The card for `E<episode> Sc <number>`, by its reference (the text would also match a mark that names it). */
const card = (page: Page, ref: string) => page.locator(`[data-scene-card][data-scene-ref="${ref}"]`)

/** The header's tab for a view - a button, the URL does not move. */
const tab = (page: Page, view: 'story' | 'chrono' | 'continuity') => page.locator(`[data-writing-header] [data-view-tab="${view}"]`)

const drawer = (page: Page) => page.locator('aside[data-timeline-drawer]')

/** Give the drawer's scene a story time and save. */
const setStoryTime = async (page: Page, day: string, clock: string): Promise<void> => {
  const panel = drawer(page)
  await panel.getByLabel('Story day').fill(day)
  if (clock !== '') await panel.getByLabel('Story clock').fill(clock)
  await panel.locator('[data-save-story-time]').click()
  await saved(page)
}

let scriptUrl = ''
let projectUrl = ''
let timelineUrl = ''

test('the shell and the empty state, both themes; a stale view opens story order', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Timeline walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  projectUrl = scriptUrl.replace(/\/ep_001\/script$/, '')
  timelineUrl = `${projectUrl}/timeline`

  await page.goto(timelineUrl)
  const main = page.locator('main[data-route="timeline"]')
  await expect(main).toHaveAttribute('data-sub-view', 'story')
  await expect(main).toHaveAttribute('data-timeline-state', 'empty')
  await expect(main.getByText('Your scenes have a page order, not a story time')).toBeVisible()
  await expect(main.locator('[data-place-all]')).toHaveCount(0)
  await expect(main.locator('[data-place-by-hand]')).toBeVisible()
  // The shell: the sidebar card, the header's crumb and tabs, the status bar.
  const sidebar = page.locator('aside[data-sidebar]')
  await expect(sidebar).toBeVisible()
  expect(await sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(236)
  await expect(sidebar.locator('[data-threads-empty]')).toBeVisible()
  await expect(sidebar.locator('[data-placed-card]')).toHaveCount(0)
  await expect(page.locator('[data-writing-header]')).toContainText('Timeline')
  await expect(page.locator('[data-writing-header] [data-view-tab]')).toHaveText(['Story order', 'Chronology', 'Continuity'])
  await expect(page.locator('aside[data-context-column]')).toHaveCount(0)
  await expect(page.locator('[data-status-left]')).toContainText('nothing placed')
  await expect(page.locator('[data-route-id]')).toHaveText('/timeline')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/timeline-empty-${theme}.png`, fullPage: false })
  }
  const stale = await page.goto(`${timelineUrl}?view=grid`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'story')
})

test('story time is authored, not parsed: the queue proposes a day per scene from the page, Accept all writes them, Undo takes it back', async ({ page, account }) => {
  await signIn(page, account)
  await importFountain(page, scriptUrl, 'one.fountain', EPISODE_ONE, 4)
  // `New episode` opens a name form since 2026-09-16; Enter on the blank field makes `Episode 2`.
  await page.getByRole('button', { name: 'New episode' }).click()
  await page.locator('[data-episode-form="create"] [data-episode-name]').press('Enter')
  await page.waitForURL(/\/ep_002\/script$/, { timeout: 120_000 })
  await importFountain(page, page.url(), 'two.fountain', EPISODE_TWO, 3)

  await page.goto(timelineUrl)
  const main = page.locator('main[data-route="timeline"]')
  // Seven scenes with DAY, CONTINUOUS, LATER and "the next morning" on the page, and not one is placed.
  await expect(main).toHaveAttribute('data-timeline-state', 'empty')
  await expect(page.locator('[data-placed-count]')).toHaveText('0 / 7')
  await expect(page.locator('[data-placed-note]')).toHaveText('7 scenes have no time yet')

  // `Place 7 scenes` opens the queue over the grid: a proposal per scene, with its reason.
  await main.locator('[data-place-all]').click()
  await expect(main).toHaveAttribute('data-timeline-state', 'story')
  const queue = page.locator('[data-proposal-queue]')
  await expect(queue).toBeVisible()
  await expect(page.locator('[data-proposal-count]')).toHaveText('7 scenes to place')
  await expect(page.locator('[data-proposal-row]')).toHaveCount(6)
  await page.locator('[data-proposal-fold]').click()
  await expect(page.locator('[data-proposal-row]')).toHaveCount(7)
  const rowOf = (ref: string) => page.locator(`[data-proposal-row][data-proposal-ref="${ref}"]`)
  await expect(rowOf('E1 Sc 1')).toHaveAttribute('data-proposal-reason', 'carried')
  await expect(rowOf('E1 Sc 1').locator('[data-proposal-line]')).toHaveText('no cue → Day 1, carried from the start')
  await expect(rowOf('E1 Sc 2')).toHaveAttribute('data-proposal-reason', 'continuous')
  await expect(rowOf('E1 Sc 2').locator('[data-proposal-line]')).toHaveText('CONTINUOUS → same day and clock as E1 Sc 1')
  await expect(rowOf('E1 Sc 3')).toHaveAttribute('data-proposal-reason', 'cue')
  await expect(rowOf('E1 Sc 3').locator('[data-proposal-line]')).toHaveText('"The next morning" → Day 2')
  await expect(rowOf('E1 Sc 4')).toHaveAttribute('data-proposal-reason', 'later')
  await expect(rowOf('E2 Sc 1').locator('[data-proposal-line]')).toHaveText('"Three days later" → Day 5')
  await expect(rowOf('E2 Sc 3').locator('[data-proposal-line]')).toHaveText('no cue → Day 5, carried from E2 Sc 2')
  // The evidence is a chip into the script at the line it was read from.
  await expect(rowOf('E1 Sc 3').locator('[data-cite-link]')).toHaveText('The next morning')

  // Accept all: one write, every scene placed, and the status bar offers Undo.
  await page.locator('[data-proposal-accept-all]').click()
  await saved(page)
  await expect(queue).toHaveCount(0)
  await eventually(page.locator('[data-scene-card]')).toHaveCount(7)
  await expect(page.locator('[data-status-toast]')).toContainText('Placed 7 scenes')
  await eventually(card(page, 'E1 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 2')
  await eventually(card(page, 'E2 Sc 1').locator('[data-scene-chip]')).toHaveText('Day 5')
  // Undo: back to nothing placed, and the empty card returns.
  await page.locator('[data-status-undo]').click()
  await saved(page)
  await eventually(page.locator('[data-placed-count]')).toHaveText('0 / 7')
  await page.reload()
  await expect(main).toHaveAttribute('data-timeline-state', 'empty')

  // Accept one row on its own: the drawer's write, and the rows below re-count from it.
  await main.locator('[data-place-all]').click()
  await rowOf('E1 Sc 1').locator('[data-proposal-accept]').click()
  await saved(page)
  await eventually(page.locator('[data-proposal-count]')).toHaveText('6 scenes to place')
  await eventually(card(page, 'E1 Sc 1').locator('[data-scene-chip]')).toHaveText('Day 1')
  await page.locator('[data-proposal-accept-all]').click()
  await saved(page)
  await eventually(page.locator('[data-placed-count]')).toHaveText('7 / 7')
  await expect(page.locator('[data-grid-column]')).toHaveCount(2)
  await expect(page.locator('[data-grid-column="ep_001"]')).toContainText('4 placed')
  await expect(page.locator('[data-grid-column="ep_002"]')).toContainText('3 placed')
  await expect(page.locator('[data-grid-row="none"]')).toBeVisible()
  await expect(page.locator('[data-unplaced-banner]')).toHaveCount(0)
  await expect(page.locator('[data-place-scenes]')).toHaveCount(0)
  await eventually(page.locator('[data-status-left]')).toHaveText('7 placed · 0 unplaced · 0 threads · 0 flashbacks')
  await expect(page.locator('[data-timeline-count]')).toHaveText('7 placed')

  // The tabs are buttons: the view changes, the URL does not. The days are the cues'.
  await tab(page, 'chrono').click()
  await expect(main).toHaveAttribute('data-sub-view', 'chrono')
  await expect(page).toHaveURL(new RegExp(`/timeline$`))
  await expect(page.locator('[data-grid-column]:not([data-grid-column="new-day"])')).toHaveCount(3)
  await expect(page.locator('[data-grid-column="1"]')).toContainText('2 scenes')
  await expect(page.locator('[data-grid-column="2"]')).toContainText('2 scenes')
  await expect(page.locator('[data-grid-column="5"]')).toContainText('3 scenes')
  await expect(page.locator('[data-lane-ruler]')).toHaveCount(3)

  // Nothing steps back; the unclocked pairs are notes, not flags.
  await tab(page, 'continuity').click()
  await expect(main).toHaveAttribute('data-sub-view', 'continuity')
  await expect(page.locator('[data-continuity-clear]')).toContainText('agree everywhere')
  await expect(page.locator('[data-finding]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-count]')).toHaveText('0 flags')
  await expect(page.locator('[data-continuity-notes]')).toHaveAttribute('data-continuity-notes', '4')
  await page.locator('[data-continuity-fold="notes"]').click()
  await expect(page.locator('[data-finding][data-finding-kind="same-day-unclocked"]')).toHaveCount(4)
})

test('a finding is a flag the writer answers: earlier than the scene before it, deliberate, reopened, light against the clock, a flashback', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  const panel = drawer(page)

  // The last scene moves to Day 6: later than everything before it, so nothing to report.
  await card(page, 'E2 Sc 3').click()
  await eventually(panel).toContainText('E2 Sc 3')
  await eventually(panel.locator('[data-drawer-heading]')).toHaveText('EXT. CHAWL ROOFTOP - DAY')
  await eventually(panel).toContainText('No one speaks or is mentioned.')
  await eventually(panel.locator('[data-relative-line]')).toHaveText('Same day as E2 Sc 2')
  await eventually(panel.locator('[data-cue-heading]')).toHaveText('DAY')
  await setStoryTime(page, '6', '06:40')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 6 · 06:40')
  await eventually(page.locator('[data-view-badge]')).toHaveCount(0)
  await eventually(panel.locator('[data-relative-line]')).toHaveText('1 day after E2 Sc 2.')

  // The scene before it on the page moves to 21:15 the same day: now E2 Sc 3 at 06:40
  // precedes E2 Sc 2 - a finding, on the card, the tab and the drawer.
  await card(page, 'E2 Sc 2').click()
  await setStoryTime(page, '6', '21:15')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-jump]')).toHaveAttribute('data-scene-jump', 'back')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-mark]')).toHaveAttribute('data-scene-mark', 'flag')
  await eventually(page.locator('[data-view-badge]')).toHaveText('1')
  await card(page, 'E2 Sc 3').click()
  const finding = panel.locator('[data-drawer-finding]')
  await eventually(finding).toHaveCount(1)
  await eventually(finding).toContainText("Happens before E2 Sc 2 (Day 6 · 21:15) though it's on the page after it.")

  // Escape closes the drawer; the selection is state, so a reload opens with none.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // A clock without a day cannot be typed, and a malformed clock is refused before the write.
  await card(page, 'E1 Sc 4').click()
  await panel.getByLabel('Story day').fill('')
  await expect(panel.getByLabel('Story clock')).toBeDisabled()
  await panel.getByLabel('Story day').fill('1')
  await panel.getByLabel('Story clock').fill('25:99')
  await panel.locator('[data-save-story-time]').click()
  await eventually(panel.locator('[data-drawer-notice]')).toHaveText('A clock is HH:MM, 24-hour.')
  await eventually(card(page, 'E1 Sc 4').locator('[data-scene-chip]')).toHaveText('Day 2')

  await tab(page, 'continuity').click()
  const open = page.locator('[data-finding][data-finding-kind="order"]')
  await eventually(open).toHaveCount(1)
  await eventually(open).toContainText('E2 Sc 3')
  await eventually(open).toContainText("Happens before E2 Sc 2 (Day 6 · 21:15) though it's on the page after it.")
  await eventually(page.locator('[data-timeline-count]')).toHaveText('1 flag')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await tab(page, 'continuity').click()
    await page.screenshot({ path: `test-results/timeline-continuity-${theme}.png`, fullPage: false })
  }

  // `It's deliberate` files the finding under the fold; `Reopen` brings it back.
  await open.locator('[data-finding-verdict="deliberate"]').click()
  await saved(page)
  await eventually(open).toHaveCount(0)
  await eventually(page.locator('[data-timeline-count]')).toHaveText('0 flags')
  await eventually(page.locator('[data-continuity-deliberate]')).toHaveAttribute('data-continuity-deliberate', '1')
  await page.reload()
  await tab(page, 'continuity').click()
  await eventually(page.locator('[data-continuity-deliberate]')).toHaveAttribute('data-continuity-deliberate', '1')
  await page.locator('[data-continuity-fold="deliberate"]').click()
  await page.locator('[data-finding-verdict="reopen"]').click()
  await saved(page)
  await eventually(open).toHaveCount(1)
  await eventually(page.locator('[data-timeline-count]')).toHaveText('1 flag')

  // A NIGHT heading clocked at 14:00 is a light-vs-clock finding; back to no clock and it goes.
  await open.locator('[data-finding-open]').click()
  await expect(page.locator('main[data-route="timeline"]')).toHaveAttribute('data-sub-view', 'story')
  await card(page, 'E2 Sc 2').click()
  await eventually(panel.locator('[data-drawer-heading]')).toHaveText('INT. CHAWL CORRIDOR - NIGHT')
  await setStoryTime(page, '6', '14:00')
  await eventually(panel.locator('[data-drawer-finding]').filter({ hasText: 'Light vs clock' })).toContainText('The heading says NIGHT but the clock says 14:00.')
  await eventually(page.locator('[data-view-badge]')).toHaveText('2')
  await setStoryTime(page, '6', '21:15')
  await eventually(page.locator('[data-view-badge]')).toHaveText('1')

  // The flashback flag keeps the time and drops the card.
  await card(page, 'E2 Sc 3').click()
  await eventually(panel).toContainText('E2 Sc 3')
  await panel.locator('[data-flashback-toggle]').click()
  await panel.locator('[data-save-story-time]').click()
  await saved(page)
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-mark]')).toHaveAttribute('data-scene-mark', 'flashback')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-jump]')).toHaveCount(0)
  await eventually(page.locator('[data-view-badge]')).toHaveCount(0)
  await eventually(page.locator('[data-status-left]')).toContainText('1 flashback')
  await eventually(panel.locator('[data-relative-line]')).toHaveText('Flashback. Sits outside the day count.')
  await tab(page, 'continuity').click()
  await eventually(page.locator('[data-finding][data-finding-kind="order"]')).toHaveCount(0)
  await eventually(page.locator('[data-flashback-note]')).toContainText('1 flashback sits outside the frame, as flagged.')
})

test('threads are authored and linked by hand', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  const sidebar = page.locator('aside[data-sidebar]')

  await sidebar.locator('[data-sidebar-new-thread]').click()
  const editor = sidebar.locator('[data-thread-editor]')
  await editor.getByLabel('Thread name').fill('Water queue')
  await editor.getByRole('radio', { name: 'Moss' }).click()
  await editor.locator('[data-thread-submit]').click()
  await saved(page)
  const row = sidebar.locator('[data-thread-row]')
  await eventually(row).toHaveCount(1, { timeout: 60_000 })
  await eventually(row).toContainText('Water queue')
  await eventually(row.locator('[data-thread-span]')).toHaveText('no scenes yet')
  await eventually(page.locator('[data-thread-count]')).toHaveText('1')
  await eventually(page.locator('[data-grid-row]')).toHaveCount(2)
  await eventually(page.locator('[data-status-left]')).toContainText('1 thread')

  // Link E1 Sc 1 from the drawer's menu: the card moves to the thread's row - and a half-typed
  // day in the same drawer survives the write's refresh (the draft is keyed on the scene, not reset by props).
  await card(page, 'E1 Sc 1').click()
  const panel = drawer(page)
  await panel.getByLabel('Story day').fill('9')
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByRole('menuitem', { name: 'Water queue' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toContainText('Water queue', { timeout: 60_000 })
  await expect(panel.getByLabel('Story day')).toHaveValue('9')
  await expect(panel.locator('[data-save-story-time]')).toBeEnabled()
  await panel.getByLabel('Story day').fill('1')
  await expect(panel.locator('[data-save-story-time]')).toBeDisabled()
  await eventually(row.locator('[data-thread-lanes]')).toHaveText('1')
  await eventually(row.locator('[data-thread-span]')).toHaveText('E1 · 1 scene')
  const threadId = await row.getAttribute('data-thread-row')
  const threadRow = page.locator(`[data-grid-row="${threadId ?? ''}"]`)
  await eventually(threadRow.locator('[data-scene-card]')).toHaveCount(1)
  await eventually(threadRow).toContainText('E1 Sc 1')
  await eventually(page.locator('[data-grid-row="none"]').locator('[data-scene-card]')).toHaveCount(6)
  await eventually(page.locator('[data-episode-bars]').first()).toHaveAttribute('title', 'E1 1 · E2 0')

  // Solo: the row lights and every other lane dims.
  await row.click()
  await eventually(row).toHaveAttribute('data-solo', 'true')
  await eventually(threadRow).toHaveAttribute('data-dimmed', 'false')
  await eventually(page.locator('[data-grid-row="none"]')).toHaveAttribute('data-dimmed', 'true')
  await row.click()
  await eventually(row).toHaveAttribute('data-solo', 'false')
  await eventually(page.locator('[data-grid-row="none"]')).toHaveAttribute('data-dimmed', 'false')

  // Rename and recolour in place.
  await row.hover()
  await sidebar.locator(`[data-thread-edit="${threadId ?? ''}"]`).click()
  await editor.getByLabel('Thread name').fill('Water')
  await editor.getByRole('radio', { name: 'Slate' }).click()
  await editor.locator('[data-thread-submit]').click()
  await saved(page)
  await eventually(row).toContainText('Water', { timeout: 60_000 })
  await eventually(row).not.toContainText('queue')
  await eventually(page.locator('[data-scene-thread]')).toContainText('Water')

  // Unlink from the drawer, relink, then delete the thread: every link goes with it.
  await panel.getByRole('button', { name: 'Remove from Water' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(0, { timeout: 60_000 })
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByRole('menuitem', { name: 'Water' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(1, { timeout: 60_000 })
  await row.hover()
  await sidebar.locator(`[data-thread-edit="${threadId ?? ''}"]`).click()
  await editor.locator('[data-delete-thread]').click()
  await saved(page)
  await eventually(row).toHaveCount(0, { timeout: 60_000 })
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(0)
  await eventually(page.locator('[data-grid-row]')).toHaveCount(1)
  await eventually(page.locator('[data-grid-row="none"]').locator('[data-scene-card]')).toHaveCount(7)

  // Two threads: a scene on both draws a card in the first's row and a ghost in the second's;
  // `▲` makes the second the row. Dragging a sidebar row onto the other reorders them.
  for (const name of ['Billing fraud', 'Love']) {
    await sidebar.locator('[data-sidebar-new-thread]').click()
    await editor.getByLabel('Thread name').fill(name)
    await editor.locator('[data-thread-submit]').click()
    await saved(page)
    await eventually(sidebar.locator('[data-thread-row]').filter({ hasText: name })).toHaveCount(1, { timeout: 60_000 })
  }
  const rows = sidebar.locator('[data-thread-row]')
  await eventually(rows).toHaveText([/Billing fraud/, /Love/])
  await card(page, 'E2 Sc 1').click()
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByRole('menuitem', { name: 'Billing fraud' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(1, { timeout: 60_000 })
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByRole('menuitem', { name: 'Love' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(2, { timeout: 60_000 })
  const fraudId = await rows.nth(0).getAttribute('data-thread-row')
  const loveId = await rows.nth(1).getAttribute('data-thread-row')
  await eventually(page.locator(`[data-grid-row="${fraudId ?? ''}"] [data-scene-card]`)).toHaveCount(1)
  await eventually(page.locator(`[data-grid-row="${loveId ?? ''}"] [data-scene-ghost]`)).toHaveCount(1)
  await panel.getByRole('button', { name: 'Make Love the row' }).click()
  await saved(page)
  await eventually(page.locator(`[data-grid-row="${loveId ?? ''}"] [data-scene-card]`)).toHaveCount(1, { timeout: 60_000 })
  await eventually(page.locator(`[data-grid-row="${fraudId ?? ''}"] [data-scene-ghost]`)).toHaveCount(1)
  await eventually(panel.locator('[data-scene-thread]').first()).toContainText('Love')
  await rows.nth(1).locator('..').dragTo(rows.nth(0).locator('..'))
  await saved(page)
  await eventually(rows).toHaveText([/Love/, /Billing fraud/], { timeout: 60_000 })
  await eventually(page.locator('[data-grid-row]').first()).toHaveAttribute('data-grid-row', loveId ?? '')
})

test('everything survives a reload; the scope, the lanes, a drag, the keys, the reader and the export; both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 6 · 06:40')
  await eventually(card(page, 'E2 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 6 · 21:15')
  await eventually(card(page, 'E1 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 1')
  await eventually(page.locator('aside[data-sidebar] [data-thread-row]')).toHaveCount(2)
  await eventually(page.locator('[data-grid-row]')).toHaveCount(3)
  await eventually(page.locator('[data-status-left]')).toHaveText('7 placed · 0 unplaced · 2 threads · 1 flashback')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await card(page, 'E2 Sc 3').click()
    await eventually(drawer(page)).toContainText('E2 Sc 3')
    await page.screenshot({ path: `test-results/timeline-story-${theme}.png`, fullPage: false })
  }
  await page.keyboard.press('Escape')

  // The scope: one episode's column, and the rows it leaves.
  await page.locator('[data-timeline-scope]').click()
  await page.locator('[data-filter-option="ep_002"]').click()
  await eventually(page.locator('[data-grid-column]')).toHaveCount(1)
  await eventually(page.locator('[data-scene-card]')).toHaveCount(3)
  await page.locator('[data-timeline-scope]').click()
  await page.locator('[data-filter-option="all"]').click()
  await eventually(page.locator('[data-grid-column]')).toHaveCount(2)

  // The lanes: by character (Meera and Driver from the cues), by location (the sets), back to threads.
  await page.locator('[data-timeline-lanes]').click()
  await page.locator('[data-filter-option="character"]').click()
  await eventually(page.locator('main[data-route="timeline"]')).toHaveAttribute('data-lanes', 'character')
  await eventually(page.locator('[data-grid-row]').first()).toContainText(/meera/i)
  await page.locator('[data-timeline-lanes]').click()
  await page.locator('[data-filter-option="location"]').click()
  await eventually(page.locator('[data-grid-row]').first()).toContainText(/Chawl Corridor/i)
  await page.locator('[data-timeline-lanes]').click()
  await page.locator('[data-filter-option="thread"]').click()
  await eventually(page.locator('[data-grid-row]')).toHaveCount(3)

  // The keys: `]` moves the focused scene a day later, `[` back; Enter opens the drawer.
  await card(page, 'E1 Sc 2').focus()
  await page.keyboard.press(']')
  await saved(page)
  await eventually(card(page, 'E1 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 2')
  await page.keyboard.press('[')
  await saved(page)
  await eventually(card(page, 'E1 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 1')
  await page.keyboard.press('Enter')
  await eventually(drawer(page)).toContainText('E1 Sc 2')
  await page.keyboard.press('Escape')

  await tab(page, 'chrono').click()
  const columns = page.locator('[data-grid-column]:not([data-grid-column="new-day"])')
  await eventually(columns).toHaveCount(4)
  await eventually(page.locator('[data-grid-column="1"]')).toContainText('2 scenes')
  await eventually(page.locator('[data-grid-column="5"]')).toContainText('1 scene')
  await eventually(page.locator('[data-grid-column="6"]')).toContainText('2 scenes')
  // In story-time order: 06:40 before 21:15, whatever the page says.
  await eventually(card(page, 'E2 Sc 2').locator('[data-scene-chip]')).toHaveText(/^E2 · (p\.\d+|Sc 2)$/)
  // A card dragged onto a day column takes that day; onto the new-day column, a day after the
  // frame. Each drop is checked in the cell it landed in, then again after a reload - the
  // patch is instant, the row is what the reload proves. Every column is kept inside the viewport:
  // Playwright's HTML5 drag scrolls an off-screen target into view between the mouse-down and
  // the move that starts the drag, and the card that slides under the pointer is what it drags.
  await page.setViewportSize({ width: 1900, height: 900 })
  const inCell = (cell: string, ref: string) => page.locator(`[data-cell="${cell}"] [data-scene-card][data-scene-ref="${ref}"]`)
  const dragTo = async (ref: string, cell: string, day: string): Promise<void> => {
    await card(page, ref).dragTo(page.locator(`[data-cell="${cell}"]`))
    await saved(page)
    await eventually(inCell(`none:${day}`, ref)).toHaveCount(1)
    await page.reload()
    await tab(page, 'chrono').click()
    await eventually(inCell(`none:${day}`, ref)).toHaveCount(1)
  }
  await dragTo('E1 Sc 2', 'none:5', '5')
  await eventually(page.locator('[data-grid-column="5"]')).toContainText('2 scenes')
  await eventually(page.locator('[data-grid-column="1"]')).toContainText('1 scene')
  await dragTo('E1 Sc 2', 'none:new-day', '7')
  await eventually(page.locator('[data-grid-column="7"]')).toContainText('1 scene')
  await dragTo('E1 Sc 2', 'none:1', '1')
  await eventually(page.locator('[data-grid-column="1"]')).toContainText('2 scenes')
  await eventually(inCell('none:2', 'E1 Sc 3')).toHaveCount(1)
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await tab(page, 'chrono').click()
    await page.screenshot({ path: `test-results/timeline-chrono-${theme}.png`, fullPage: false })
  }

  // The reader walks story order; the export downloads the chronology.
  await page.locator('[data-timeline-more]').click()
  await page.locator('[data-timeline-read]').click()
  const reader = page.locator('[data-read-modal]')
  await eventually(reader).toBeVisible()
  await eventually(reader).toContainText('1 of 7 · E1 Sc 1 · Day 1')
  await eventually(reader.locator('[data-script-sheet]')).toContainText('CHAWL CORRIDOR')
  await reader.locator('[data-read-next]').click()
  await eventually(reader).toContainText('2 of 7')
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.locator('[data-timeline-more]').click()
  await page.locator('[data-timeline-export]').click()
  expect((await download).suggestedFilename()).toMatch(/-chronology\.md$/)
  await eventually(page.locator('[data-status-toast]')).toContainText('Exported')
})
