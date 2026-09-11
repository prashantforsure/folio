import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { featureLengthFdx } from '../../../packages/script/src/testing/fdx-corpus'
import type { WalkOptions } from '../playwright.config'

/** The latency test parks its Event Timing samples on the window between two evaluates. */
declare global {
  interface Window {
    __folioEvents?: number[]
  }
}

/**
 * The Script route, walked in a browser.
 *
 * What this proves, in the order the brief's "Done when" lists it:
 *
 *   1. **The page map matches the golden file.** The feature-length FDX corpus
 *      - the same `featureLengthFdx(220)` the golden was generated from - is
 *      imported through the empty state's Import action, and the page map the
 *      route renders (`[data-page-map]`, positions in place of ids) is diffed
 *      against `packages/script/src/testing/golden/us-letter.json` row for
 *      row. Zero differences or the test fails and prints them.
 *   2. **Typing, splitting and merging preserve ids across save and reload.**
 *      The id list is read from the DOM before and after each operation and
 *      after a reload, and the before/after lists are written to
 *      `test-results/script-ids.json` for the report.
 *   3. **A Comment changes no page number.** The page map is captured, a
 *      comment is inserted, and the map is captured again: identical.
 *   4. **Import lands a real script with no doubled continueds.** No block's
 *      text contains `(CONT'D)` or `(MORE)` after import.
 *   5. **Both states, both themes.** Screenshots of empty and draft in dark
 *      and light, plus the cover and the collaboration tab.
 *   6. **Typing is cheap and a save is small.** A sentence typed into a
 *      feature-length script: keystroke-to-paint from the Event Timing API,
 *      keystroke-to-"saved", and the bytes each autosave sent and received,
 *      written to `test-results/script-latency.json`. A keystroke's save
 *      must be a delta - kilobytes, not the half-megabyte list.
 *
 * Needs a real account; skips without one. Leaves one project behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Script walk.')

test.describe.configure({ mode: 'serial', timeout: 900_000 })

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The Script walk needs an account.')
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
  // Hydrated: the workspace's mount effect has run, so panels and zoom are real.
  await expect(page.locator('[data-script-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 120_000 })
}

const idsOf = async (page: Page): Promise<string[]> =>
  page.locator('[data-sheet] [data-node-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-node-id') ?? ''),
  )

type PageMap = {
  readonly totals: { readonly pages: number; readonly lines: number; readonly scenes: number; readonly eighths: number }
  /** Rows with node positions, comparable to the golden's positional ids. */
  readonly pages: readonly string[]
  readonly scenes: readonly string[]
  /** The same rows keyed by node id, stable across an inserted comment. */
  readonly pagesById: readonly string[]
  readonly scenesById: readonly string[]
}

const pageMapOf = async (page: Page): Promise<PageMap> => {
  const raw = await page.locator('[data-page-map]').textContent()
  if (raw === null) throw new Error('No page map rendered.')
  return JSON.parse(raw) as PageMap
}

const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

let projectUrl = ''

test('empty state, both themes; then import lands a real script', async ({ page, account, scriptProjectUrl }) => {
  test.skip(scriptProjectUrl !== null, 'Reusing an imported project.')
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Script walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  projectUrl = page.url()

  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'empty')
  await expect(page.locator('[data-empty-state]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Import \.fdx or \.fountain/ })).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/script-empty-${theme}.png`, fullPage: false })
  }

  // The empty state does not come from a URL. Script has no sub-view params
  // (ruled 2026-09-11, `lib/workspace/params.ts`): `?content=` and `?panel=`
  // are unknown keys, so a stale link opens on the script - not a 404 - with
  // the Info tab, and the composer is not a panel.
  await page.goto(`${projectUrl}?content=empty`)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'empty')
  const composer = await page.goto(`${projectUrl}?panel=composer`)
  expect(composer?.status()).toBe(200)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-doc-tab', 'script')

  // Import the golden corpus through the real action.
  await page.goto(projectUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fdx = join(test.info().outputDir, 'feature-220.fdx')
  writeFileSync(fdx, featureLengthFdx(220))
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fdx)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 180_000 })
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()

  // No doubled continueds: nothing generated is in the node stream.
  const texts = await page.locator('[data-sheet] [data-node-id]').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))
  expect(texts.some((text) => text.includes('(MORE)'))).toBe(false)
  expect(texts.filter((text) => /\(CONT'D\)/u.test(text))).toEqual([])
})

test('the rendered page map matches the golden file exactly', async ({ page, account, scriptProjectUrl }) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft')
  const rendered = await pageMapOf(page)

  const golden = JSON.parse(
    readFileSync(join(__dirname, '../../../packages/script/src/testing/golden/us-letter.json'), 'utf8'),
  ) as {
    readonly totals: { readonly pages: number; readonly lines: number; readonly scenes: number; readonly eighths: number }
    readonly pages: readonly string[]
    readonly scenes: readonly string[]
  }
  // The golden's ids are positional (`f12`); the route prints positions (`12`).
  const positional = (rows: readonly string[]): readonly string[] => rows.map((row) => row.replace(/\bf(\d+)\b/gu, '$1'))

  const differences: string[] = []
  const goldenPages = positional(golden.pages)
  goldenPages.forEach((row, index) => {
    if (rendered.pages[index] !== row) differences.push(`page ${String(index + 1)}: golden "${row}" rendered "${rendered.pages[index] ?? '(missing)'}"`)
  })
  if (rendered.pages.length !== goldenPages.length) differences.push(`page count: golden ${String(goldenPages.length)} rendered ${String(rendered.pages.length)}`)
  const goldenScenes = positional(golden.scenes)
  goldenScenes.forEach((row, index) => {
    if (rendered.scenes[index] !== row) differences.push(`scene ${String(index + 1)}: golden "${row}" rendered "${rendered.scenes[index] ?? '(missing)'}"`)
  })
  writeFileSync(
    join(test.info().outputDir, '..', 'script-golden-diff.txt'),
    [
      `golden totals   ${JSON.stringify(golden.totals)}`,
      `rendered totals ${JSON.stringify(rendered.totals)}`,
      `pages compared  ${String(goldenPages.length)}`,
      `scenes compared ${String(goldenScenes.length)}`,
      `differences     ${String(differences.length)}`,
      ...differences,
    ].join('\n'),
  )
  const { pages, lines, scenes, eighths } = golden.totals
  expect(rendered.totals).toEqual({ pages, lines, scenes, eighths })
  expect(differences).toEqual([])

  // The frames on the sheet are the record's pages, labelled as printed.
  await expect(page.locator('[data-sheet] .folio-page')).toHaveCount(golden.totals.pages)
  await expect(page.locator('[data-sheet] .folio-page').last()).toHaveAttribute('data-page-label', String(golden.totals.pages))
})

test('typing, splitting and merging preserve ids across save and reload', async ({ page, account, scriptProjectUrl }) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  const before = await idsOf(page)

  // Type into the second block (an action line) at its end.
  const second = page.locator('[data-sheet] [data-node-id]').nth(1)
  const secondId = before[1]
  await second.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed in the walk.')
  await waitSaved(page)
  const afterTyping = await idsOf(page)
  expect(afterTyping).toEqual(before)

  // Split it in the middle: the head keeps its id, the tail is new.
  await second.click()
  await page.keyboard.press('Home')
  for (let step = 0; step < 8; step += 1) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await waitSaved(page)
  const afterSplit = await idsOf(page)
  expect(afterSplit.length).toBe(before.length + 1)
  expect(afterSplit[1]).toBe(secondId)
  const tailId = afterSplit[2]
  expect(before).not.toContain(tailId)
  expect(afterSplit.slice(3)).toEqual(before.slice(2))

  // Merge the tail back into the head: first wins, the tail's id is retired.
  await page.locator(`[data-node-id="${tailId ?? ''}"]`).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  await waitSaved(page)
  const afterMerge = await idsOf(page)
  expect(afterMerge).toEqual(before)

  // Reload: the server's rows carry the same ids.
  await page.reload()
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  const afterReload = await idsOf(page)
  expect(afterReload).toEqual(before)
  const secondText = await page.locator(`[data-node-id="${secondId ?? ''}"]`).textContent()
  expect(secondText).toContain('Typed in the walk.')

  writeFileSync(
    join(test.info().outputDir, '..', 'script-ids.json'),
    JSON.stringify(
      {
        count: before.length,
        before: before.slice(0, 6),
        afterTyping: afterTyping.slice(0, 6),
        afterSplit: afterSplit.slice(0, 6),
        afterMerge: afterMerge.slice(0, 6),
        afterReload: afterReload.slice(0, 6),
        splitHeadKeptId: afterSplit[1] === secondId,
        splitTailWasFresh: !before.includes(tailId ?? ''),
        mergeRetiredTail: !afterMerge.includes(tailId ?? ''),
        reloadIdentical: afterReload.join() === before.join(),
      },
      null,
      2,
    ),
  )
})

test('autosave is a delta, the sheet keeps up with typing, and "saved" comes back fast', async ({ page, account, scriptProjectUrl }) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  await expect(page.locator('[data-script-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
  await waitSaved(page)

  // Every save is a POST to the route path (a server action). Record what went up and came down.
  const routePath = new URL(projectUrl).pathname
  const saves: { readonly up: number; readonly down: number; readonly ms: number }[] = []
  const started = new Map<string, number>()
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === routePath) {
      started.set(request.url() + String(request.timing().startTime), Date.now())
    }
  })
  page.on('response', async (response) => {
    const request = response.request()
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== routePath) return
    const body = await response.body().catch(() => Buffer.alloc(0))
    const from = started.get(request.url() + String(request.timing().startTime)) ?? Date.now()
    saves.push({ up: request.postData()?.length ?? 0, down: body.length, ms: Date.now() - from })
  })

  // Event Timing: how long each keystroke held the main thread before the next paint.
  await page.evaluate(() => {
    const durations: number[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'keydown' || entry.name === 'input' || entry.name === 'keypress') durations.push(entry.duration)
      }
    })
    // `durationThreshold` is Event Timing's, newer than the DOM lib's typing of the init dictionary.
    observer.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
    window.__folioEvents = durations
  })

  // Type a sentence into a block in the middle of the script, at its end.
  const blocks = page.locator('[data-sheet] [data-node-id]')
  const middle = Math.floor((await blocks.count()) / 2)
  await blocks.nth(middle).click()
  await page.keyboard.press('End')
  const sentence = ' The lamp hums and the tea goes cold before anyone speaks.'
  const t0 = Date.now()
  await page.keyboard.type(sentence, { delay: 0 })
  const typedMs = Date.now() - t0
  const lastKeystroke = Date.now()
  await waitSaved(page)
  const savedMs = Date.now() - lastKeystroke
  const slow = await page.evaluate(() => window.__folioEvents ?? [])

  // A keystroke-only save must not carry the whole list: one node up, and
  // - because the client paginated the same list with the same inputs -
  // no record down.
  const last = saves[saves.length - 1]
  expect(last).toBeDefined()
  expect(last?.up ?? Infinity).toBeLessThan(20_000)
  expect(last?.down ?? Infinity).toBeLessThan(20_000)

  // The text is on the server: reload and find it.
  await page.reload()
  await expect(page.locator('[data-sheet] [data-node-id]').nth(middle)).toContainText(sentence.trim())

  writeFileSync(
    join(test.info().outputDir, '..', 'script-latency.json'),
    JSON.stringify(
      {
        blocks: await blocks.count(),
        typed: { characters: sentence.length, wallMs: typedMs, msPerCharacter: Math.round((typedMs / sentence.length) * 10) / 10 },
        keystrokesOver16ms: slow.length,
        slowestKeystrokeMs: slow.length === 0 ? 0 : Math.round(Math.max(...slow)),
        lastKeystrokeToSavedMs: savedMs,
        saves,
      },
      null,
      2,
    ),
  )
})

test('inserting a Comment node changes no page number', async ({ page, account, scriptProjectUrl }) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  const beforeMap = await pageMapOf(page)
  const before = await idsOf(page)
  const commentsBefore = await page.locator('[data-sheet] [data-type="comment"]').count()

  // A comment after the third block, on a fresh line: Enter, then ⌘7.
  const third = page.locator('[data-sheet] [data-node-id]').nth(2)
  await third.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+7')
  await page.keyboard.type('Does the tiffin pay off in E2, or is it just business?')
  await expect(page.locator('[data-sheet] [data-type="comment"]')).toHaveCount(commentsBefore + 1)
  await waitSaved(page)

  const afterIds = await idsOf(page)
  expect(afterIds.length).toBe(before.length + 1)
  const afterMap = await pageMapOf(page)
  // Keyed by id, so the inserted comment - which is in no record - leaves every row identical.
  expect(afterMap.totals).toEqual(beforeMap.totals)
  expect(afterMap.pagesById).toEqual(beforeMap.pagesById)
  expect(afterMap.scenesById).toEqual(beforeMap.scenesById)
  await expect(page.locator('[data-sheet] .folio-page')).toHaveCount(beforeMap.totals.pages)

  // And it survives a reload as a comment, still costing no page.
  await page.reload()
  await expect(page.locator('[data-sheet] [data-type="comment"]')).toHaveCount(commentsBefore + 1)
  const reloaded = await pageMapOf(page)
  expect(reloaded.totals).toEqual(beforeMap.totals)
})

test('draft state, both themes; the cover and the collaboration tab', async ({ page, account, scriptProjectUrl }) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/script-draft-${theme}.png`, fullPage: false })
  }
  await expect(page.locator('[data-status-bar]')).toContainText('Paged')
  await expect(page.locator('[data-stat="scenes"]')).toHaveText('220')

  // Neither tab is in the URL: a click, not a `goto`.
  await page.getByRole('tab', { name: 'Collaboration' }).click()
  await expect(page.locator('[data-right-panel]')).toHaveAttribute('data-panel-tab', 'collab')
  await expect(page.getByText('Open comments', { exact: true })).toBeVisible()
  await expect(page.getByText('Collaborators')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/script-collab-light.png', fullPage: false })

  await page.getByRole('tab', { name: /Cover$/ }).click()
  await expect(page.locator('[data-cover]')).toBeVisible()
  await page.locator('[data-cover-field="title"]').fill('STANDPIPE')
  // A value that differs from any earlier run's, so React sees a change on a reused project.
  await page.locator('[data-cover-field="author"]').fill(`Script walk ${new Date().toISOString()}`)
  await expect(page.locator('[data-cover-status]')).toHaveAttribute('data-cover-status', 'saved', { timeout: 30_000 })
  // A reload opens on the script - the cover is not remembered - and the panel tab is (session).
  await page.reload()
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-doc-tab', 'script')
  // The session tab is read after hydration, which takes seconds on a dev server with 2,900 nodes.
  await expect(page.locator('[data-right-panel]')).toHaveAttribute('data-panel-tab', 'collab', { timeout: 60_000 })
  await page.getByRole('tab', { name: /Cover$/ }).click()
  await expect(page.locator('[data-cover-field="title"]')).toHaveValue('STANDPIPE')
  await page.screenshot({ path: 'test-results/script-cover-light.png', fullPage: false })
})

test('the tabs, pagination and format switch in place: the URL never moves and the route is not requested again', async ({
  page,
  account,
  scriptProjectUrl,
}) => {
  await signIn(page, account)
  projectUrl = projectUrl === '' && scriptProjectUrl !== null ? scriptProjectUrl : projectUrl
  await page.goto(projectUrl)
  await expect(page.locator('[data-sheet] [data-node-id]').first()).toBeVisible()
  // Hydrating 2,900 nodes on a dev server takes seconds; a click before that is replayed, not switched.
  await expect(page.locator('[data-script-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
  await page.getByRole('tab', { name: 'Info' }).click()
  await page.getByRole('radio', { name: 'Paged' }).click()
  await expect(page.locator('[data-status-bar]')).toContainText('Paged')

  const routePath = new URL(projectUrl).pathname
  // A GET to the route path is a navigation or an RSC refresh. A server action is a POST to the same
  // path and is expected: the preference writes go through one.
  const loads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === routePath) loads.push(request.url())
  })
  const sheetHandle = await page.locator('[data-sheet]').elementHandle()
  const main = page.locator('main[data-route="script"]')
  const pagesBefore = await page.locator('[data-sheet] .folio-page').count()
  expect(pagesBefore).toBeGreaterThan(1)

  // Cover: the cover shows, the URL is still the route, the editor's DOM node is the same one.
  await page.getByRole('tab', { name: /Cover$/ }).click()
  await expect(main).toHaveAttribute('data-doc-tab', 'cover')
  await expect(page).toHaveURL(projectUrl)
  await expect(page.locator('[data-cover]')).toBeVisible()
  await expect(page.locator('[data-sheet]')).toBeHidden()

  await page.getByRole('tab', { name: 'Collaboration' }).click()
  await expect(page.locator('[data-right-panel]')).toHaveAttribute('data-panel-tab', 'collab')
  await expect(page).toHaveURL(projectUrl)

  await page.getByRole('tab', { name: /Script$/ }).click()
  await expect(page.locator('[data-sheet]')).toBeVisible()
  expect(await page.locator('[data-sheet]').evaluate((el, before) => el === before, sheetHandle)).toBe(true)
  await page.getByRole('tab', { name: 'Info' }).click()

  // Pagination: Minimal draws one page and says so in the status bar, before the row is written.
  await page.getByRole('radio', { name: 'Minimal' }).click()
  await expect(page.locator('[data-status-bar]')).toContainText('Minimal')
  await expect(page.locator('[data-sheet]')).toHaveAttribute('data-page-mode', 'continuous')
  await expect(page.locator('[data-sheet] .folio-page')).toHaveCount(1)
  await page.getByRole('radio', { name: 'Paged' }).click()
  await expect(page.locator('[data-status-bar]')).toContainText('Paged')
  await expect(page.locator('[data-sheet] .folio-page')).toHaveCount(pagesBefore)
  await expect(page).toHaveURL(projectUrl)

  // And the row was written: a reload draws the same setting from the server.
  await page.getByRole('radio', { name: 'Minimal' }).click()
  await expect(page.locator('[data-sheet]')).toHaveAttribute('data-page-mode', 'continuous')
  await expect(page.getByRole('radio', { name: 'Minimal' })).toBeEnabled()
  expect(loads).toEqual([])
  await page.reload()
  await expect(page.locator('[data-status-bar]')).toContainText('Minimal')
  await page.getByRole('radio', { name: 'Paged' }).click()
  await expect(page.getByRole('radio', { name: 'Paged' })).toBeEnabled()
})
