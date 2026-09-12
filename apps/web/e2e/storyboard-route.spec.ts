import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Storyboard route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **Both empty states, both themes.** No script; the nav says `—`;
 *      `?view=` outside `board | canvas | list` is a 404.
 *   2. **A script is columns; Auto board proposes; accepting boards.** The
 *      imported script's two accepted headings are two columns (the
 *      `INTERCUT` line is neither a scene nor a column). Auto board writes a
 *      proposal whose mentions are real records - the location the heading
 *      resolved to, the characters the cues bound to. Nothing is counted
 *      until accepted; then the header, the footer and the nav agree, and a
 *      reload reads the same rows back.
 *   3. **A shot is authored.** Edit (lens, a description with an `@mention`
 *      resolved through the label book), move, add by hand, remove.
 *   4. **The frame names its cost, reserves it, and can be released.** With
 *      no credits the button still says the cost and the server refuses with
 *      the numbers; with a grant on the ledger a click writes a queued job
 *      and the balance drops by exactly the cost; a reload still shows it
 *      queued; cancelling releases it and the balance comes back.
 *   5. **Canvas and list draw the same rows.**
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run, with a grant of 8 credits on its ledger.
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

const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-storyboard-save]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

/**
 * A `grant` on the project's ledger, written the way a purchase webhook
 * would write one. Run inside `packages/db`, where the `postgres` driver
 * resolves, from the `.env` that package reads. A fixture, not a feature:
 * the app has no way to grant itself credits, and must not.
 */
const grantCredits = (rootDir: string, projectId: string, amount: number): void => {
  const cwd = resolve(rootDir, '../../../packages/db')
  const script = `
    import postgres from 'postgres'
    process.loadEnvFile('.env')
    const sql = postgres(process.env.DATABASE_URL_SESSION, { prepare: true })
    await sql\`insert into credit_ledger (project_id, kind, delta, idempotency_key, reason)
      values (\${'${projectId}'}, 'grant', \${${String(amount)}}, \${'e2e:grant:${projectId}'}, 'E2E storyboard walk')
      on conflict (project_id, idempotency_key) do nothing\`
    await sql.end()
  `
  const file = join(cwd, '.e2e-grant.mjs')
  writeFileSync(file, script)
  try {
    execFileSync('node', [file], { cwd, stdio: 'pipe' })
  } finally {
    // Not left behind: the file is a fixture and `packages/db` is a package.
    unlinkSync(file)
  }
}

let scriptUrl = ''
let storyboardUrl = ''
let projectId = ''

test('empty state, both themes; a bad view is a 404', async ({ page, account }) => {
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
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('—')
  await expect(page.locator('[data-shot-count]')).toHaveText('0')
  await expect(page.locator('[data-credits-available]')).toHaveText('0 credits')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-empty-${theme}.png`, fullPage: false })
  }
  await page.goto(`${storyboardUrl}?view=list`)
  await expect(main).toHaveAttribute('data-sub-view', 'list')
  await expect(page.locator('[data-empty-state="no-script"]')).toBeVisible()
  const bogus = await page.goto(`${storyboardUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
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
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('0 shots')

  await page.goto(storyboardUrl)
  await waitMounted(page)
  await expect(page.locator('main[data-route="storyboard"]')).toHaveAttribute('data-storyboard-state', 'board')
  const columns = page.locator('[data-scene-column]')
  await expect(columns).toHaveCount(2)
  await expect(columns.nth(0)).toHaveAttribute('data-scene-number', '1')
  await expect(columns.nth(0)).toContainText("MEERA'S FLAT")
  await expect(columns.nth(0)).toContainText('NIGHT')
  await expect(columns.nth(1)).toContainText('STAIRWELL')
  await expect(page.locator('[data-no-shots]')).toHaveCount(2)
  await expect(page.locator('[data-shot-count]')).toHaveText('0')
  await expect(page.locator('[data-footer-counts]')).toHaveText('2 scenes · 0 shots')
  await expect(page.locator('[data-footer-selected]')).toContainText("Scene 01 · INT. MEERA'S FLAT - NIGHT")
  const frameCost = await page.locator('[data-frame-cost]').textContent()
  cost = Number(/\d+/.exec(frameCost ?? '')?.[0] ?? '0')
  expect(cost).toBeGreaterThan(0)

  // Auto board on scene 1: establishing, two-shot, one MCU each, closing wide.
  await columns.nth(0).locator('[data-auto-board]').click()
  await waitSaved(page)
  const proposed = columns.nth(0).locator('[data-shot][data-shot-state="proposed"]')
  await expect(proposed).toHaveCount(5)
  await expect(page.locator('[data-proposed-count]')).toHaveText('5 proposed')
  await expect(page.locator('[data-shot-count]')).toHaveText('0')
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('0 shots')
  await expect(proposed.nth(0)).toHaveAttribute('data-shot-number', '01-01')
  await expect(proposed.nth(0).locator('[data-shot-description]')).toContainText('Establishing wide of')
  // The location is the record the heading resolved to; the speakers are the records the cues bound to.
  await expect(proposed.nth(0).locator('[data-mention="location"]')).toHaveCount(1)
  await expect(proposed.nth(1).locator('[data-shot-description]')).toContainText('Two-shot:')
  await expect(proposed.nth(1).locator('[data-mention="character"]')).toHaveCount(2)
  await expect(proposed.nth(2).locator('[data-shot-description]')).toContainText('Come on. Come on.')
  await expect(proposed.nth(3).locator('[data-shot-description]')).toContainText("It's business, not charity.")
  await expect(proposed.nth(4).locator('[data-shot-description]')).toContainText('Closing wide.')
  // A proposal has no frame to draw.
  await expect(proposed.nth(0).locator('[data-draw-frame]')).toHaveCount(0)

  // Discard one, accept the rest.
  await proposed.nth(4).locator('[data-discard-shot]').click()
  await waitSaved(page)
  await expect(proposed).toHaveCount(4)
  await columns.nth(0).locator('[data-accept-all]').click()
  await waitSaved(page)
  await expect(columns.nth(0).locator('[data-shot][data-shot-state="accepted"]')).toHaveCount(4)
  await expect(page.locator('[data-proposed-count]')).toHaveCount(0)
  await expect(page.locator('[data-shot-count]')).toHaveText('4')
  await expect(page.locator('[data-footer-counts]')).toHaveText('2 scenes · 4 shots')
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('4 shots')

  // Survives a reload: rows, not state.
  await page.reload()
  await waitMounted(page)
  await expect(page.locator('[data-shot][data-shot-state="accepted"]')).toHaveCount(4)
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('4 shots')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-board-${theme}.png`, fullPage: false })
  }
})

test('a shot is authored: edit with an @mention, move, add, remove', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(storyboardUrl)
  await waitMounted(page)
  const column = page.locator('[data-scene-column]').nth(0)
  const shots = column.locator('[data-shot]')
  await expect(shots).toHaveCount(4)

  // Edit: the lens and a description typed with @Meera, resolved through the label book.
  await shots.nth(0).locator('[data-edit-shot]').click()
  const editor = column.locator('[data-shot-editor]')
  await expect(editor).toBeVisible()
  await editor.locator('[data-field="lens"]').fill('35')
  await editor.locator('[data-field="description"]').fill('Wide on @Meera by the kettle. @Nobody is not a record.')
  await editor.locator('[data-save-shot]').click()
  await waitSaved(page)
  await expect(shots.nth(0)).toContainText('35mm')
  await expect(shots.nth(0).locator('[data-mention="character"]')).toHaveCount(1)
  await expect(shots.nth(0).locator('[data-shot-description]')).toContainText('@Nobody is not a record.')

  // Move: shot 01-02 up becomes 01-01, and the numbers follow the order.
  const secondId = await shots.nth(1).getAttribute('data-shot')
  await shots.nth(1).locator('[data-move-shot="up"]').click()
  await waitSaved(page)
  await expect(shots.nth(0)).toHaveAttribute('data-shot', secondId ?? '')
  await expect(shots.nth(0)).toHaveAttribute('data-shot-number', '01-01')
  await expect(shots.nth(1)).toHaveAttribute('data-shot-number', '01-02')

  // Add by hand on the selected scene: born accepted, at the end.
  await page.locator('[data-add-shot]').click()
  const form = page.locator('[data-add-shot-form] [data-shot-editor]')
  await expect(form).toBeVisible()
  await form.locator('[data-field="size"]').selectOption('cu')
  await form.locator('[data-field="description"]').fill('Insert: the kettle.')
  await form.locator('[data-save-shot]').click()
  await waitSaved(page)
  await expect(shots).toHaveCount(5)
  await expect(shots.nth(4)).toHaveAttribute('data-shot-state', 'accepted')
  await expect(shots.nth(4)).toContainText('CU ·')
  await expect(page.locator('[data-shot-count]')).toHaveText('5')
  await expect(page.locator('[data-nav-meta="storyboard"]')).toHaveText('5 shots')

  // Remove it again.
  await shots.nth(4).locator('[data-delete-shot]').click()
  await waitSaved(page)
  await expect(shots).toHaveCount(4)
  await expect(page.locator('[data-shot-count]')).toHaveText('4')
})

test('the frame names its cost, refuses without credits, reserves with them, and releases on cancel', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(storyboardUrl)
  await waitMounted(page)
  const shots = page.locator('[data-scene-column]').nth(0).locator('[data-shot]')
  const draw = shots.nth(0).locator('[data-draw-frame]')
  await expect(draw).toHaveAttribute('data-cost', String(cost))
  await expect(draw).toContainText(`Draw frame · ${String(cost)} cr`)
  await expect(page.locator('[data-credits-available]')).toHaveText('0 credits')

  // No credits: the server refuses with the numbers; nothing is written.
  await draw.click()
  await expect(page.locator('[data-storyboard-error]')).toContainText(`Not enough credits: 0 available, ${String(cost)} needed`, { timeout: 60_000 })
  await expect(shots.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'empty')

  // A grant on the ledger, as a purchase would leave one. Twice the cost.
  grantCredits(test.info().config.rootDir, projectId, cost * 2)
  await page.reload()
  await waitMounted(page)
  await expect(page.locator('[data-credits-available]')).toHaveText(`${String(cost * 2)} credits`)

  // Reserve then execute: the job is queued and the balance drops by exactly the cost.
  await shots.nth(0).locator('[data-draw-frame]').click()
  await waitSaved(page)
  await expect(shots.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'queued')
  await expect(shots.nth(0)).toContainText(`Queued · ${String(cost)} credits reserved`)
  await expect(page.locator('[data-credits-available]')).toHaveText(`${String(cost)} credits`)

  // Survives a closed tab: the job row is the truth.
  await page.reload()
  await waitMounted(page)
  await expect(shots.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'queued')
  await expect(page.locator('[data-credits-available]')).toHaveText(`${String(cost)} credits`)

  // Cancel a queued job: released, and the balance comes back.
  await shots.nth(0).locator('[data-cancel-frame]').click()
  await waitSaved(page)
  await expect(shots.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'cancelled')
  await expect(page.locator('[data-credits-available]')).toHaveText(`${String(cost * 2)} credits`)

  // Two more reservations exhaust the grant; a third is refused with the numbers.
  await shots.nth(0).locator('[data-draw-frame]').click()
  await waitSaved(page)
  await expect(shots.nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'queued')
  await shots.nth(1).locator('[data-draw-frame]').click()
  await waitSaved(page)
  await expect(shots.nth(1).locator('[data-frame]')).toHaveAttribute('data-frame', 'queued')
  await expect(page.locator('[data-credits-available]')).toHaveText('0 credits')
  await shots.nth(2).locator('[data-draw-frame]').click()
  await expect(page.locator('[data-storyboard-error]')).toContainText(`Not enough credits: 0 available, ${String(cost)} needed`, { timeout: 60_000 })
  await expect(shots.nth(2).locator('[data-frame]')).toHaveAttribute('data-frame', 'empty')
})

test('canvas and list draw the same rows', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${storyboardUrl}?view=canvas`)
  await waitMounted(page)
  await expect(page.locator('main[data-route="storyboard"]')).toHaveAttribute('data-sub-view', 'canvas')
  await expect(page.locator('[data-canvas-label]')).toHaveText('Scene 01 · 4 shot nodes')
  await expect(page.locator('[data-shot-node]')).toHaveCount(4)
  await expect(page.locator('[data-shot-node]').nth(0).locator('[data-frame]')).toHaveAttribute('data-frame', 'queued')
  await expect(page.locator('[data-shot-node]').nth(2).locator('[data-generate-frame]')).toContainText(`Generate · ${String(cost)} cr`)
  await page.locator('[data-next-scene]').click()
  await expect(page.locator('[data-canvas-label]')).toHaveText('Scene 02 · 0 shot nodes')
  await expect(page.locator('[data-shot-canvas] [data-auto-board]')).toBeVisible()
  await page.locator('[data-prev-scene]').click()
  await expect(page.locator('[data-shot-node]')).toHaveCount(4)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-canvas-${theme}.png`, fullPage: false })
  }

  await page.goto(`${storyboardUrl}?view=list`)
  await waitMounted(page)
  await expect(page.locator('main[data-route="storyboard"]')).toHaveAttribute('data-sub-view', 'list')
  await expect(page.locator('[data-list-scene]')).toHaveCount(2)
  await expect(page.locator('[data-list-shot]')).toHaveCount(4)
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('01-01')
  await expect(page.locator('[data-list-shot]').nth(0)).toContainText('35mm')
  await expect(page.locator('[data-list-scene]').nth(1)).toContainText('No shots listed for this scene.')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/storyboard-list-${theme}.png`, fullPage: false })
  }
})
