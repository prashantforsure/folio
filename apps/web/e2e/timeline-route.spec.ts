import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Timeline route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** Nothing placed, no thread; the
 *      column at 250px; `?view=grid` is a 404.
 *   2. **Story time is authored, never parsed.** Two episodes are imported
 *      with `DAY` and `NIGHT` sluglines and the route is still empty - no
 *      scene has a day until the writer gives it one. `Assume continuous`
 *      puts every scene on Day 1 in one write; the chronology is one column
 *      and the continuity view has nothing to say.
 *   3. **A finding is a scene whose story time precedes the scene before it
 *      on the page**, and it is a flag: E2 Sc 3 set earlier than E2 Sc 2
 *      shows `↶` on its card, `1` on the Continuity tab, and one card in
 *      the view; marking it a flashback keeps the time, drops the card,
 *      and counts it in the footer.
 *   4. **Threads are authored and linked by hand** - made in the column,
 *      linked from the panel, the card moves to the thread's row, the row
 *      dims when hidden, a rename sticks, a delete unlinks every scene.
 *   5. **Everything survives a reload**, and the chronology draws the
 *      days, both themes.
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

EXT. WATER TANKER - DAY

First tanker. Meera is fourth in line.

DRIVER
Name?

EXT. CHAWL COURTYARD - DAWN

Buckets hold places in the queue.

MEERA
Mine was here first.

INT. MEERA'S ROOM - NIGHT

The blue bucket is filled to a pencil line.
`

const EPISODE_TWO = `INT. WARD OFFICE - DAY

The meter reading does not match the bill.

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

/** Wait for the workspace to hydrate before clicking anything in it. */
const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-timeline-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
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

/** The card for `E<episode> Sc <number>`, found by its printed reference. */
const card = (page: Page, ref: string) => page.locator('[data-scene-card]').filter({ hasText: ref })

/** Give the selected scene a story time through the panel. */
const setStoryTime = async (page: Page, day: string, clock: string): Promise<void> => {
  const panel = page.locator('aside[data-scene-panel]')
  await panel.getByLabel('Story day').fill(day)
  await panel.getByLabel('Story clock').fill(clock)
  await panel.locator('[data-save-story-time]').click()
  await saved(page)
}

let scriptUrl = ''
let projectUrl = ''
let timelineUrl = ''

test('empty state, both themes; a bad view is a 404', async ({ page, account }) => {
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
  await expect(main.getByText('Timeline · 0 scenes')).toBeVisible()
  await expect(main.locator('[data-assume-continuous]')).toHaveCount(0)
  const column = page.locator('aside[data-context-column="timeline"]')
  await expect(column).toBeVisible()
  expect(await column.evaluate((el) => el.getBoundingClientRect().width)).toBe(250)
  await expect(column.locator('[data-story-span]')).toHaveText('—')
  await expect(column.locator('[data-unplaced-count]')).toHaveText('0')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/timeline-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${timelineUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
})

test('story time is authored, not parsed: DAY and NIGHT place nothing; Assume continuous places everything', async ({ page, account }) => {
  await signIn(page, account)
  await importFountain(page, scriptUrl, 'one.fountain', EPISODE_ONE, 4)
  await page.getByRole('button', { name: 'New episode' }).click()
  await page.waitForURL(/\/ep_002\/script$/)
  await importFountain(page, page.url(), 'two.fountain', EPISODE_TWO, 3)

  await page.goto(timelineUrl)
  const main = page.locator('main[data-route="timeline"]')
  // Seven scenes with DAY, NIGHT and DAWN in their sluglines, and not one is placed.
  await expect(main).toHaveAttribute('data-timeline-state', 'empty')
  await expect(main.getByText('Timeline · 7 scenes')).toBeVisible()
  await expect(page.locator('[data-unplaced-count]')).toHaveText('7')
  await ready(page)

  await main.locator('[data-assume-continuous]').click()
  await saved(page)
  await expect(main).toHaveAttribute('data-timeline-state', 'story', { timeout: 60_000 })
  await expect(page.locator('[data-scene-card]')).toHaveCount(7)
  await expect(page.locator('[data-grid-column]')).toHaveCount(2)
  await expect(page.locator('[data-grid-column="ep_001"]')).toContainText('4 placed')
  await expect(page.locator('[data-grid-column="ep_002"]')).toContainText('3 placed')
  await expect(page.locator('[data-grid-row="none"]')).toBeVisible()
  await expect(page.locator('[data-unplaced-strip]')).toHaveCount(0)
  await expect(page.locator('[data-unplaced-count]')).toHaveText('0')
  await expect(page.locator('[data-story-span]')).toHaveText('1 day')
  await expect(page.locator('[data-scene-chip]').first()).toHaveText('Day 1')
  await expect(main.locator('footer')).toContainText('7 scenes · 0 threads · 0 flashbacks')

  await page.goto(`${timelineUrl}?view=chrono`)
  await expect(main).toHaveAttribute('data-sub-view', 'chrono')
  await expect(page.locator('[data-grid-column]')).toHaveCount(1)
  await expect(page.locator('[data-grid-column="1"]')).toContainText('7 scenes')

  await page.goto(`${timelineUrl}?view=continuity`)
  await expect(main).toHaveAttribute('data-sub-view', 'continuity')
  await expect(page.locator('[data-continuity-clear]')).toContainText('agree everywhere')
  await expect(page.locator('[data-finding]')).toHaveCount(0)
})

test('a finding is a flag: earlier than the scene before it on the page, and a flashback is legitimate', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  await ready(page)
  const panel = page.locator('aside[data-scene-panel]')

  // The last scene moves to Day 2: later than everything before it, so nothing to report.
  await card(page, 'E2 Sc 3').click()
  await eventually(panel).toContainText('E2 Sc 3 · page')
  await eventually(panel).toContainText('EXT. CHAWL ROOFTOP - DAY')
  await eventually(panel).toContainText('No one speaks or is mentioned.')
  await setStoryTime(page, '2', '06:40')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 2 · 06:40')
  await eventually(page.locator('[data-continuity-badge]')).toHaveCount(0)
  await eventually(page.locator('[data-story-span]')).toHaveText('2 days')

  // The scene before it on the page moves to 09:15 the same day: now E2 Sc 3 at 06:40
  // precedes E2 Sc 2 - a finding, on the card, the tab and the panel.
  await card(page, 'E2 Sc 2').click()
  await setStoryTime(page, '2', '09:15')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-jump]')).toHaveAttribute('data-scene-jump', 'back')
  await eventually(page.locator('[data-continuity-badge]')).toHaveText('1')
  await card(page, 'E2 Sc 3').click()
  await eventually(panel.locator('[data-scene-flag]')).toHaveAttribute('data-scene-flag', 'order')
  await eventually(panel).toContainText("Happens before E2 Sc 2 (Day 2 · 09:15) though it's on the page after it.")
  await eventually(panel.locator('[data-story-time-note]')).toHaveText('Earlier than E2 Sc 2 (Day 2 · 09:15)')

  // A clock without a day is refused by the contract, and the panel says so.
  await card(page, 'E1 Sc 4').click()
  await panel.getByLabel('Story day').fill('')
  await panel.getByLabel('Story clock').fill('22:15')
  await panel.locator('[data-save-story-time]').click()
  await eventually(panel.locator('[data-story-time-note]')).toHaveText('A clock needs a day.')
  await eventually(card(page, 'E1 Sc 4').locator('[data-scene-chip]')).toHaveText('Day 1')

  await page.goto(`${timelineUrl}?view=continuity`)
  await ready(page)
  const finding = page.locator('[data-finding]')
  await eventually(finding).toHaveCount(1)
  await eventually(finding).toContainText('E2 Sc 3 happens before E2 Sc 2, but comes after it on the page.')
  await eventually(finding).toContainText('E2 Sc 3 is set at Day 2 · 06:40.')
  await eventually(page.locator('main[data-route="timeline"] header')).toContainText('1 place where page order and story time disagree')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/timeline-continuity-${theme}.png`, fullPage: false })
  }
  await ready(page)

  // Flashbacks are legitimate: the flag keeps the time and drops the card.
  await finding.locator('[data-mark-flashback]').click()
  await saved(page)
  await eventually(page.locator('[data-finding]')).toHaveCount(0)
  await eventually(page.locator('[data-flashback-note]')).toContainText('1 flashback is earlier than the scene before it on the page, as flagged.')
  await eventually(page.locator('[data-continuity-badge]')).toHaveCount(0)
  await eventually(page.locator('main[data-route="timeline"] footer')).toContainText('1 flashback')

  await page.goto(timelineUrl)
  await ready(page)
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 2 · 06:40')
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-jump]')).toHaveCount(0)
  await card(page, 'E2 Sc 3').click()
  await eventually(panel.locator('[data-flashback-toggle]')).toHaveAttribute('aria-checked', 'true')
  await eventually(panel.locator('[data-story-time-note]')).toHaveText('Flashback. Sits outside the day count.')
  await eventually(panel.locator('[data-scene-flag]')).toHaveAttribute('data-scene-flag', 'flashback')
  // The span counts the frame story only; the flashback sits outside it.
  await eventually(page.locator('[data-story-span]')).toHaveText('2 days + 1 flashback')
})

test('threads are authored and linked by hand', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  await ready(page)
  const column = page.locator('aside[data-context-column="timeline"]')

  await column.locator('[data-new-thread]').click()
  const editor = column.locator('[data-thread-editor]')
  await editor.getByLabel('Thread name').fill('Water queue')
  await editor.getByRole('radio', { name: 'moss' }).click()
  await editor.getByRole('button', { name: 'Create' }).click()
  const row = column.locator('[data-thread-row]')
  await eventually(row).toHaveCount(1, { timeout: 60_000 })
  await eventually(row).toContainText('Water queue')
  await eventually(row).toContainText('0')
  await eventually(page.locator('[data-grid-row]')).toHaveCount(2)
  await eventually(page.locator('main[data-route="timeline"] footer')).toContainText('1 thread')

  // Link E1 Sc 1 from the panel: the card moves to the thread's row.
  await card(page, 'E1 Sc 1').click()
  const panel = page.locator('aside[data-scene-panel]')
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByLabel('Add to thread').selectOption({ label: 'Water queue' })
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toContainText('Water queue', { timeout: 60_000 })
  await eventually(row).toContainText('1')
  const threadId = await row.getAttribute('data-thread-row')
  const threadRow = page.locator(`[data-grid-row="${threadId ?? ''}"]`)
  await eventually(threadRow.locator('[data-scene-card]')).toHaveCount(1)
  await eventually(threadRow).toContainText('E1 Sc 1')
  await eventually(page.locator('[data-grid-row="none"]').locator('[data-scene-card]')).toHaveCount(6)

  // Hide: the column row and the grid row dim.
  await row.getByRole('button', { name: 'Hide Water queue' }).click()
  await eventually(row).toHaveAttribute('data-hidden', 'true')
  expect(await threadRow.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.35')
  await row.getByRole('button', { name: 'Show Water queue' }).click()
  await eventually(row).toHaveAttribute('data-hidden', 'false')

  // Rename and recolour in place.
  await row.getByRole('button', { name: 'Water queue', exact: true }).click()
  await editor.getByLabel('Thread name').fill('Water')
  await editor.getByRole('radio', { name: 'slate' }).click()
  await editor.getByRole('button', { name: 'Save' }).click()
  await eventually(row).toContainText('Water', { timeout: 60_000 })
  await eventually(row).not.toContainText('queue')
  await eventually(page.locator('[data-scene-thread]')).toContainText('Water')

  // Unlink from the panel, relink, then delete the thread: every link goes with it.
  await panel.getByRole('button', { name: 'Remove from Water' }).click()
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(0, { timeout: 60_000 })
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByLabel('Add to thread').selectOption({ label: 'Water' })
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(1, { timeout: 60_000 })
  await row.getByRole('button', { name: 'Water', exact: true }).click()
  await editor.locator('[data-delete-thread]').click()
  await eventually(row).toHaveCount(0, { timeout: 60_000 })
  await eventually(panel.locator('[data-scene-thread]')).toHaveCount(0)
  await eventually(page.locator('[data-grid-row]')).toHaveCount(1)
  await eventually(page.locator('[data-grid-row="none"]').locator('[data-scene-card]')).toHaveCount(7)

  // Leave one thread behind for the reload.
  await column.locator('[data-new-thread]').click()
  await editor.getByLabel('Thread name').fill('Billing fraud')
  await editor.getByRole('button', { name: 'Create' }).click()
  await eventually(column.locator('[data-thread-row]')).toHaveCount(1, { timeout: 60_000 })
  await card(page, 'E2 Sc 1').click()
  await panel.locator('[data-add-to-thread]').click()
  await panel.getByLabel('Add to thread').selectOption({ label: 'Billing fraud' })
  await saved(page)
  await eventually(panel.locator('[data-scene-thread]')).toContainText('Billing fraud', { timeout: 60_000 })
})

test('everything survives a reload, and the chronology draws the days in both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(timelineUrl)
  await ready(page)
  await eventually(card(page, 'E2 Sc 3').locator('[data-scene-chip]')).toHaveText('Day 2 · 06:40')
  await eventually(card(page, 'E2 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 2 · 09:15')
  await eventually(card(page, 'E1 Sc 2').locator('[data-scene-chip]')).toHaveText('Day 1')
  await eventually(page.locator('aside[data-context-column="timeline"] [data-thread-row]')).toContainText('Billing fraud')
  await eventually(page.locator('[data-grid-row]')).toHaveCount(2)
  await eventually(page.locator('main[data-route="timeline"] footer')).toContainText('7 scenes · 1 thread · 1 flashback')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await ready(page)
    await card(page, 'E2 Sc 3').click()
    await eventually(page.locator('aside[data-scene-panel]')).toContainText('E2 Sc 3 · page')
    await page.screenshot({ path: `test-results/timeline-story-${theme}.png`, fullPage: false })
  }

  await page.goto(`${timelineUrl}?view=chrono`)
  await eventually(page.locator('[data-grid-column]')).toHaveCount(2)
  await eventually(page.locator('[data-grid-column="1"]')).toContainText('5 scenes')
  await eventually(page.locator('[data-grid-column="2"]')).toContainText('2 scenes')
  // In story-time order: 06:40 before 09:15, whatever the page says.
  const dayTwo = page.locator('[data-grid-row="none"] > div').nth(2)
  await eventually(dayTwo.locator('[data-scene-card]').nth(0)).toContainText('E2 Sc 3')
  await eventually(dayTwo.locator('[data-scene-card]').nth(1)).toContainText('E2 Sc 2')
  await eventually(card(page, 'E2 Sc 2').locator('[data-scene-chip]')).toHaveText(/^E2 · (p\.\d+|Sc 2)$/)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/timeline-chrono-${theme}.png`, fullPage: false })
  }
})
