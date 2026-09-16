import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Production route, walked in a browser against the real backend -
 * `docs/ui design/Route - Production v2.dc.html` as built.
 *
 * What this proves, in order:
 *
 *   1. **The shell, both themes.** The sidebar card with `Scenes from
 *      script` and the `Episode frames` widget; the header without the
 *      Write / Storyboard pill and with its third crumb; the toolbar's
 *      Scene | Episode pill over `?view=`; the 28px status bar; no script
 *      is the one 440px card; `?view=` outside `scene | episode` is a 404.
 *   2. **A script is scene tabs; an empty scene is the card; a reel is a
 *      card of three columns.** The strip, the sidebar rows and the table
 *      list the same scenes; `＋ Empty reel` draws a reel; `✦ Propose
 *      shots` writes amber proposals with a `Proposed` tile each; Accept
 *      turns one into `Awaiting frame`; the toolbar chip, the status bar,
 *      the widget and the Episode tiles agree on every count.
 *   3. **Frames name their cost, refuse without credits, queue with them,
 *      and stop.** Generate says `1 frame · N cr`; with no balance the
 *      reason line is orange and the button is off; with a grant on the
 *      ledger a click writes a queued job and the tile reads `Queued`;
 *      `Stop generating` cancels it and the balance comes back.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run, with a grant of 8 credits on its ledger.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Production walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. MEERA'S FLAT - NIGHT

A kettle on the hob. MEERA, 30s, watches it not boil.

MEERA
Come on. Come on.

RAVI (O.S.)
It's business, not charity.

The kettle clicks off. She does not move.

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

const waitMounted = async (page: Page): Promise<void> => {
  await expect(page.locator('main[data-route="production"]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-status-bar] [data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

/** A `grant` on the project's ledger, the way a purchase webhook would write one. A fixture, not a feature. */
const grantCredits = (rootDir: string, projectId: string, amount: number): void => {
  const cwd = resolve(rootDir, '../../../packages/db')
  const script = `
    import { existsSync } from 'node:fs'
    import postgres from 'postgres'
    process.loadEnvFile(existsSync('.env') ? '.env' : '../../apps/web/.env')
    const sql = postgres(process.env.DATABASE_URL_SESSION, { prepare: true })
    await sql\`insert into credit_ledger (project_id, kind, delta, idempotency_key, reason)
      values (\${'${projectId}'}, 'grant', \${${String(amount)}}, \${'e2e:grant:production:${projectId}'}, 'E2E production walk')
      on conflict (project_id, idempotency_key) do nothing\`
    await sql.end()
  `
  const file = join(cwd, '.e2e-grant.mjs')
  writeFileSync(file, script)
  try {
    execFileSync('node', [file], { cwd, stdio: 'pipe' })
  } finally {
    unlinkSync(file)
  }
}

let scriptUrl = ''
let productionUrl = ''
let projectId = ''

test('the shell in both themes; no script is one card; a bad view is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Production walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  productionUrl = scriptUrl.replace(/\/script$/, '/production')
  projectId = /\/project\/([0-9a-f-]{36})\//.exec(scriptUrl)?.[1] ?? ''
  expect(projectId).not.toBe('')

  await page.goto(productionUrl)
  const main = page.locator('main[data-route="production"]')
  await expect(main).toHaveAttribute('data-sub-view', 'scene')
  await expect(main).toHaveAttribute('data-production-state', 'no-script')
  await expect(page.locator('[data-production-empty="no-script"]')).toBeVisible()
  // The shell: the sidebar card with this route's two slots, the header without the mode pill, the third crumb, the status bar.
  await expect(page.locator('aside[data-sidebar] [data-production-scenes]')).toBeVisible()
  await expect(page.locator('[data-episode-frames-card] [data-episode-frames]')).toHaveText('0 / 0')
  await expect(page.locator('[data-mode-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-crumb]')).toHaveText('Production')
  await expect(page.locator('[data-reels-chip]')).toHaveText('0 reels in this scene')
  await expect(page.locator('[data-status-bar] [data-route-id]')).toHaveText('ep_001/production')
  await expect(page.locator('[data-view-pill][data-shape="text"] [data-view-tab="scene"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('nav[data-rail] [data-rail-item][aria-current="page"]')).toHaveAttribute('data-rail-item', 'production')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/production-empty-${theme}.png`, fullPage: false })
  }
  await page.goto(`${productionUrl}?view=episode`)
  await expect(main).toHaveAttribute('data-sub-view', 'episode')
  await expect(page.locator('[data-view-tab="episode"]')).toHaveAttribute('aria-current', 'page')
  const bogus = await page.goto(`${productionUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
})

test('a script is scene tabs; an empty scene is the card; a reel is three columns; the counts agree', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('2', { timeout: 60_000 })

  await page.goto(productionUrl)
  await waitMounted(page)
  await expect(page.locator('main[data-route="production"]')).toHaveAttribute('data-production-state', 'reels')
  const tabs = page.locator('[data-scene-tab]')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(tabs.nth(0)).toContainText("MEERA'S FLAT")
  await expect(tabs.nth(0)).toHaveAttribute('data-scene-mode', 'empty')
  const rows = page.locator('[data-production-scene-row]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(rows.nth(0)).toContainText('no reels')
  await expect(page.locator('[data-empty-scene]')).toBeVisible()
  await expect(page.locator('[data-empty-scene]')).toContainText('No reels in this scene yet')
  await expect(page.locator('[data-status-left]')).toHaveText('Ep 1 · 2 scenes · 0 reels · Scene 1 · No reels')

  // An empty reel: the card goes, a reel card with three columns arrives, and every count moves together.
  await page.locator('[data-add-reel-empty]').click()
  await waitSaved(page)
  await expect(page.locator('[data-empty-scene]')).toHaveCount(0)
  const reel = page.locator('[data-reel]')
  await expect(reel).toHaveCount(1)
  await expect(reel.locator('[data-reel-name]')).toHaveText('Reel 1')
  await expect(reel.locator('[data-reel-shots]')).toBeVisible()
  await expect(reel.locator('[data-reel-frames]')).toBeVisible()
  await expect(reel.locator('[data-in-this-reel]')).toBeVisible()
  await expect(reel.locator('[data-reel-status-pill]')).toHaveText('Writing shots')
  await expect(reel.locator('[data-clip-length="15"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-reels-chip]')).toHaveText('1 reel in this scene')
  await expect(page.locator('[data-status-left]')).toHaveText('Ep 1 · 2 scenes · 1 reel · Scene 1 · Writing shots')
  await expect(rows.nth(0)).toContainText('0/0 frames · 1 reel')

  // Propose shots, free: amber proposals with a `Proposed` tile each; accepting one makes it a shot awaiting a frame.
  await reel.locator('[data-propose-shots]').click()
  await waitSaved(page)
  const proposed = reel.locator('[data-shot-row][data-shot-state="proposed"]')
  await expect(proposed.first()).toBeVisible()
  const proposals = await proposed.count()
  expect(proposals).toBeGreaterThan(0)
  await expect(reel.locator('[data-frame-tile]')).toHaveCount(proposals)
  await expect(reel.locator('[data-frame-tile][data-frame-kind="proposed"]')).toHaveCount(proposals)
  await expect(reel.locator('[data-reel-reason]')).toContainText('proposal')
  await proposed.first().locator('[data-accept-shot]').click()
  await waitSaved(page)
  await expect(reel.locator('[data-shot-row][data-shot-state="accepted"]')).toHaveCount(1)
  await expect(reel.locator('[data-frame-tile][data-frame-kind="await"]')).toHaveCount(1)
  await expect(reel.locator('[data-frame-tile][data-frame-kind="await"] [data-frame-state]')).toHaveText('Awaiting frame')
  await expect(reel.locator('[data-reel-shot-meta]')).toContainText('1 shot')
  await expect(page.locator('[data-episode-frames]')).toHaveText('0 / 1')
  await expect(rows.nth(0)).toContainText('0/1 frames · 1 reel')

  // The Episode view counts the same rows.
  await page.locator('[data-view-tab="episode"]').click()
  await expect(page.locator('main[data-route="production"]')).toHaveAttribute('data-sub-view', 'episode')
  await expect(page.locator('[data-stat-tile="Scenes with reels"] [data-stat-value]')).toHaveText('1 / 2')
  await expect(page.locator('[data-stat-tile="Reels"] [data-stat-value]')).toHaveText('1')
  await expect(page.locator('[data-stat-tile="Frames done"] [data-stat-value]')).toHaveText('0 / 1')
  await expect(page.locator('[data-episode-row]')).toHaveCount(2)
  await page.locator('[data-open-scene]').first().click()
  await expect(page.locator('main[data-route="production"]')).toHaveAttribute('data-sub-view', 'scene')

  // Survives a reload: rows, not state.
  await page.reload()
  await waitMounted(page)
  await expect(page.locator('[data-reel]')).toHaveCount(1)
  await expect(page.locator('[data-reels-chip]')).toHaveText('1 reel in this scene')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/production-reel-${theme}.png`, fullPage: false })
  }
})

test('frames name their cost, refuse without credits, queue with them, and stop', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(productionUrl)
  await waitMounted(page)
  const reel = page.locator('[data-reel]').first()
  const generate = reel.locator('[data-generate-frames]')
  const cost = Number(await generate.getAttribute('data-cost'))
  expect(cost).toBeGreaterThan(0)
  await expect(generate).toHaveText(new RegExp(`Generate 1 frame · ${String(cost)} cr`))
  // A new project has no credits: the reason is orange with the numbers, and the button is off.
  await expect(reel.locator('[data-reel-reason]')).toHaveAttribute('data-tone', 'live')
  await expect(reel.locator('[data-reel-reason]')).toContainText(`Needs ${String(cost)} credits, you have 0.`)
  await expect(generate).toBeDisabled()
  await expect(page.locator('[data-credits-available]')).toHaveAttribute('data-short', 'true')

  grantCredits(test.info().project.testDir, projectId, 8)
  await page.reload()
  await waitMounted(page)
  await expect(page.locator('[data-credits-available]')).toHaveAttribute('data-credits-available', '8')
  await expect(generate).toBeEnabled()
  await generate.click()
  await waitSaved(page)
  await expect(reel.locator('[data-frame-tile][data-frame-kind="queued"]')).toHaveCount(1)
  await expect(reel.locator('[data-reel-status-pill]')).toHaveText('Generating frames')
  await expect(page.locator('[data-credits-available]')).toHaveAttribute('data-credits-available', String(8 - cost))
  await expect(page.locator('[data-status-left]')).toContainText('Generating frames')

  // Stop: the reservation is released and the tile says so.
  await reel.locator('[data-cancel-frames]').click()
  await waitSaved(page)
  await expect(reel.locator('[data-frame-tile][data-frame-kind="cancelled"]')).toHaveCount(1)
  await expect(page.locator('[data-credits-available]')).toHaveAttribute('data-credits-available', '8')
  await expect(reel.locator('[data-reel-status-pill]')).toHaveText('Writing shots')
})
