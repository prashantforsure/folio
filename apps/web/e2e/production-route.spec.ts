import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Production route (v12, 2026-09-22), walked in a browser against the
 * real backend.
 *
 * What this proves, in order:
 *
 *   1. **The shell and the first run.** No sidebar, no header views; the
 *      header's actions slot carries the settings chip. A fresh episode
 *      opens the Production Settings modal on its own; `Confirm` writes the
 *      defaults and the chip summarises them. The empty state - no script -
 *      in both themes.
 *   2. **Scenes are tabs derived from the script.** An import with two
 *      headings gives two tabs, each `scene-empty` with the mockup's line and
 *      its two buttons; `✦ Propose shots` writes a reel of *proposed* shots
 *      from the scene's lines.
 *   3. **Every authoring write persists across a reload**, and each is
 *      waited on, not guessed at: add shot (drawer opens), rename, clip
 *      length, a status override from the menu, a keyboard retime
 *      (`role="slider"`), a keyboard reorder (`Alt+↓`), a bulk priority, the
 *      Columns layout as a view preference, an inline description edit, a
 *      delete that renumbers, and a reel delete back to the empty state.
 *   4. **The gates are server-side.** `Start shooting` is drawn disabled with
 *      the spec's tooltip while readiness fails; the sheet button says the
 *      model is not connected without `GEMINI_API_KEY`; `✦ AI shotlist` falls
 *      back to the rule-based proposal and says so.
 *   5. **The five seeded states** (rendered, authoring, empty, generating
 *      with a refused shot, stale) when `E2E_PRODUCTION_URL` names a project
 *      written by `pnpm --filter @folio/db seed:production` - the states a
 *      fresh project cannot reach without the model. Both themes, three
 *      widths, screenshots for the side-by-side with the mockup.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run. Every server action here takes seconds on the remote pooler, so a
 * write is awaited on its POST before the page is reloaded.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
  productionUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Production walk.')

test.describe.configure({ mode: 'serial', timeout: 900_000 })

const FOUNTAIN = `INT. KITCHEN - NIGHT

A strip light. ADE eats standing up. NIA watches from the door.

NIA
You could sit.

ADE
I could.

EXT. COMMUNITY PITCH - DAY

Bare earth and one goal with no net. ADE laces a boot.

ADE
Don't wait for me.
`

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The walk needs an account.')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app/)
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

/** Two frames have painted - see `scenes-route.spec.ts`. */
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

const main = (page: Page) => page.locator('main[data-route="production"]')

/** The route has rendered and the settings modal, if it opened, is gone. */
const opened = async (page: Page): Promise<void> => {
  await expect(main(page)).toBeVisible({ timeout: 120_000 })
}

/**
 * Run a write and wait for its server action to answer. A server action is
 * a `POST` to the page carrying a `next-action` header; a reload before it
 * lands reads the row as it was, which is the one false reading this walk
 * could give.
 */
const acted = async (page: Page, run: () => Promise<void>): Promise<void> => {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined, {
    timeout: 120_000,
  })
  await run()
  await answered
}

/** Reload, wait for the route, and open a scene tab by its number. */
const reopen = async (page: Page, scene: number): Promise<void> => {
  await page.reload()
  await opened(page)
  await page.locator(`[data-scene-tab="${String(scene)}"]`).click()
  await expect(page.locator(`[data-scene-tab="${String(scene)}"]`)).toHaveAttribute('aria-selected', 'true')
}

const shotCards = (page: Page) => page.locator('[data-shot-card]')

let scriptUrl = ''
let productionUrl = ''

test('the shell, the first-run settings modal, and the empty state in both themes', async ({ page, account }) => {
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

  await page.goto(productionUrl)
  await opened(page)
  // The v12 shell: rail, header, panel - no sidebar, no header views, the chip in the actions slot.
  await expect(page.locator('aside[data-sidebar]')).toHaveCount(0)
  await expect(page.locator('aside[data-context-column]')).toHaveCount(0)
  await expect(page.locator('[data-writing-header] [data-header-views="production"] [data-view-tab]')).toHaveCount(0)
  await expect(page.locator('nav[data-rail] [data-rail-item][aria-current="page"]')).toHaveAttribute('data-rail-item', 'production')
  const chip = page.locator('[data-writing-header] [data-production-settings-chip]')
  await expect(chip).toBeVisible()

  // A fresh episode opens Production Settings on its own; Confirm writes the defaults.
  const modal = page.locator('[data-settings-modal]')
  await expect(modal).toBeVisible()
  await expect(modal.locator('#production-settings-title')).toHaveText('Production Settings')
  await expect(modal.locator('[data-aspect][aria-checked="true"]')).toHaveAttribute('data-aspect', '16:9 landscape')
  await expect(modal.locator('[data-art-style][aria-checked="true"]')).toHaveAttribute('data-art-style', 'netflix-prestige-drama')
  await expect(modal.locator('[data-settings-confirm]')).toHaveText('Confirm')
  await acted(page, () => modal.locator('[data-settings-confirm]').click())
  await expect(modal).toHaveCount(0)
  // The chip names the art style, as the mockup's does.
  await expect(chip).toContainText('Netflix Prestige Drama')

  // No script: the panel says so; a reload no longer opens the modal.
  await expect(main(page)).toHaveAttribute('data-production-state', 'empty')
  await expect(page.locator('[data-production-empty]')).toContainText('No scenes to shoot yet')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await opened(page)
    await expect(page.locator('[data-settings-modal]')).toHaveCount(0)
    await painted(page)
    await page.screenshot({ path: `test-results/production-empty-${theme}.png`, fullPage: false })
  }
  // The chip reopens the modal; Escape closes it and focus returns to the chip.
  await chip.click()
  await expect(page.locator('[data-settings-modal]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-settings-modal]')).toHaveCount(0)
  await expect(chip).toBeFocused()
})

test('scenes are tabs from the script; propose writes proposed shots; every write survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('2', { timeout: 60_000 })

  await page.goto(productionUrl)
  await opened(page)
  const tabs = page.locator('[data-scene-tab]')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toContainText('KITCHEN')
  await expect(tabs.nth(1)).toContainText('COMMUNITY PITCH')
  await expect(main(page)).toHaveAttribute('data-production-state', 'scene-empty')
  await expect(page.locator('[data-scene-empty]')).toContainText('No reels in this scene yet.')
  await expect(page.locator('[data-propose-shots]')).toHaveText('✦ Propose shots from the scene')
  await expect(page.locator('[data-empty-reel]')).toHaveText('＋ Empty reel')
  await painted(page)
  await page.screenshot({ path: 'test-results/production-scene-empty.png', fullPage: false })

  // 1. Propose: a reel of proposed shots from the scene's lines, 0 cr.
  await acted(page, () => page.locator('[data-propose-shots]').click())
  await expect(shotCards(page).first()).toBeVisible()
  const proposedCount = await shotCards(page).count()
  expect(proposedCount).toBeGreaterThan(0)
  await expect(page.locator('[data-shot-card][data-status="proposed"]')).toHaveCount(proposedCount)
  await expect(page.locator('[data-reel-status-pill]')).toHaveText('Writing')

  // 2. Add a shot: it lands last, numbered, and opens in the drawer; Escape closes the drawer.
  await acted(page, () => page.locator('[data-add-shot]').click())
  await expect(page.locator('[data-shot-drawer]')).toBeVisible()
  await expect(shotCards(page)).toHaveCount(proposedCount + 1)
  await expect(shotCards(page).last()).toHaveAttribute('data-shot-number', String(proposedCount + 1))
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-shot-drawer]')).toHaveCount(0)

  // 3. Rename via the reel's ⋯ menu, then the clip length; both persist.
  await page.locator('[data-reel-menu]').click()
  await page.locator('[data-reel-rename]').click()
  await page.locator('[data-reel-name-input]').fill('Kitchen reel')
  await acted(page, () => page.keyboard.press('Enter'))
  await acted(page, () => page.locator('[data-clip-length="8"]').click())
  await reopen(page, 1)
  await expect(page.locator('[data-reel-chip] .folio-prod-reel-name').first()).toHaveText('Kitchen reel')
  await expect(page.locator('[data-clip-length="8"]')).toHaveAttribute('aria-pressed', 'true')

  // 4. A status override from the card's menu.
  await page.locator('[data-shot-status]').first().click()
  await expect(page.locator('[data-context-menu]')).toBeVisible()
  await acted(page, () => page.locator('[data-menu-item="drawn"]').click())
  await reopen(page, 1)
  await expect(shotCards(page).first()).toHaveAttribute('data-status', 'drawn')

  // 5. A keyboard retime on the timing bar's handle (`role="slider"`, →).
  const handle = page.locator('[data-retime-handle]').first()
  const before = Number(await handle.getAttribute('aria-valuenow'))
  await handle.focus()
  await acted(page, () => page.keyboard.press('ArrowRight'))
  await reopen(page, 1)
  await expect(page.locator('[data-retime-handle]').first()).toHaveAttribute('aria-valuenow', String(before + 1))

  // 6. A keyboard reorder: Alt+↓ on the first card makes it second, and the numbers follow.
  const firstId = await shotCards(page).first().getAttribute('data-shot-card')
  await shotCards(page).first().focus()
  await acted(page, () => page.keyboard.press('Alt+ArrowDown'))
  await reopen(page, 1)
  await expect(shotCards(page).nth(1)).toHaveAttribute('data-shot-card', firstId ?? '')
  await expect(shotCards(page).nth(1)).toHaveAttribute('data-shot-number', '2')

  // 7. The bulk bar: two picked, a priority for both; the drawer reads it back.
  await page.locator('[data-shot-select]').nth(0).click()
  await page.locator('[data-shot-select]').nth(1).click()
  await expect(page.locator('[data-bulk-count]')).toHaveText('2 selected')
  await page.locator('[data-bulk-priority]').click()
  await acted(page, () => page.locator('[data-menu-item="high"]').click())
  await page.locator('[data-bulk-clear]').click()
  await expect(page.locator('[data-bulk-bar]')).toHaveCount(0)
  await reopen(page, 1)
  await shotCards(page).first().click()
  await expect(page.locator('[data-shot-drawer]')).toBeVisible()
  await expect(page.locator('[data-drawer-row="priority"]')).toContainText('High')
  await page.keyboard.press('Escape')

  // 8. Columns is a view preference (no `?view=`): it persists, and its description cell edits inline.
  await page.locator('[data-view-options]').click()
  await acted(page, () => page.locator('[data-layout="list"]').click())
  await page.keyboard.press('Escape')
  await expect(main(page)).toHaveAttribute('data-sub-view', 'list')
  await expect(page).toHaveURL(productionUrl)
  await page.reload()
  await opened(page)
  await expect(main(page)).toHaveAttribute('data-sub-view', 'list')
  const cell = page.locator("[data-scene-table='1'] .folio-prod-tdesc").first()
  await cell.click()
  await cell.fill('A strip light. @Ade eats standing up.')
  await acted(page, () => page.locator('body').click({ position: { x: 5, y: 5 } }))
  await page.reload()
  await opened(page)
  await expect(page.locator("[data-scene-table='1'] .folio-prod-tdesc").first()).toContainText('A strip light.')
  await painted(page)
  await page.screenshot({ path: 'test-results/production-columns.png', fullPage: false })
  await page.locator('[data-view-options]').click()
  await acted(page, () => page.locator('[data-layout="grid"]').click())
  await page.keyboard.press('Escape')
  await expect(main(page)).toHaveAttribute('data-sub-view', 'grid')

  // 9. The gates: shoot is refused by readiness (the spec's tooltip), the sheet needs the model, AI shotlist falls back.
  const shoot = page.locator('[data-shoot]')
  await expect(shoot).toHaveAttribute('aria-disabled', 'true')
  await expect(shoot).toHaveAttribute('title', /^Finish the shotlist/)
  await expect(page.locator('[data-readiness-step="shotlist"]')).toHaveAttribute('data-ok', 'false')
  await expect(page.locator('[data-generate-sheet]')).toHaveAttribute('title', /not connected|not set up/)
  await acted(page, () => page.locator('[data-ai-shotlist]').click())
  await expect(page.locator('[data-production-notice]')).toContainText('proposed from the scene')
  // The settings are still editable: no shoot has succeeded.
  await page.locator('[data-production-settings-chip]').click()
  await expect(page.locator('[data-settings-confirm]')).toHaveText('Confirm')
  await page.keyboard.press('Escape')

  // 10. Delete a shot: the reel renumbers from 1; delete the reel: the scene is empty again.
  await reopen(page, 1)
  const countBefore = await shotCards(page).count()
  await acted(page, () => page.locator('[data-shot-delete]').first().click())
  await reopen(page, 1)
  await expect(shotCards(page)).toHaveCount(countBefore - 1)
  await expect(shotCards(page).first()).toHaveAttribute('data-shot-number', '1')
  await page.locator('[data-reel-menu]').click()
  await acted(page, () => page.locator('[data-reel-delete]').click())
  await reopen(page, 1)
  await expect(page.locator('[data-scene-empty]')).toBeVisible()
  await expect(main(page)).toHaveAttribute('data-production-state', 'scene-empty')
})

test('the five seeded states, both themes, three widths', async ({ page, account, productionUrl: seeded }) => {
  test.skip(seeded === null, 'Set E2E_PRODUCTION_URL to a seeded project to walk the five states.')
  if (seeded === null) return
  await signIn(page, account)
  await page.goto(seeded)
  await opened(page)
  await expect(page.locator('[data-scene-tab]')).toHaveCount(5)

  // Scene 1: a rendered reel - done sheet, a clip, settings locked by the shoot.
  await page.locator('[data-scene-tab="1"]').click()
  await expect(page.locator('[data-reel-card]').first()).toHaveAttribute('data-reel-status', 'rendered')
  await expect(page.locator('[data-sheet-column]')).toHaveAttribute('data-sheet-state', 'done')
  await expect(page.locator('[data-shoot]')).toHaveAttribute('aria-disabled', 'true')
  await page.locator('[data-production-settings-chip]').click()
  await expect(page.locator('[data-settings-confirm]')).toHaveText('Locked')
  await page.keyboard.press('Escape')

  // Scene 2: nothing yet. Scene 3: generating, with a refused shot and its banner. Scene 4: a reel with no shots. Scene 5: stale.
  await page.locator('[data-scene-tab="2"]').click()
  await expect(page.locator('[data-scene-empty]')).toBeVisible()
  await page.locator('[data-scene-tab="3"]').click()
  await expect(page.locator('[data-reel-card]').first()).toHaveAttribute('data-reel-status', 'generating')
  await expect(page.locator('[data-shot-refusal]')).toBeVisible()
  await expect(page.locator('[data-suggest-rewrite]')).toBeVisible()
  await page.locator('[data-scene-tab="4"]').click()
  await expect(page.locator('[data-shot-count]')).toHaveText('0 shots')
  await expect(page.locator('[data-generate-sheet]')).toBeDisabled()
  await page.locator('[data-scene-tab="5"]').click()
  await expect(page.locator('[data-reel-card]').first()).toHaveAttribute('data-reel-status', 'stale')

  // Screenshots for the side-by-side with the mockup: both themes, the three widths the spec names.
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await opened(page)
    for (const width of [1440, 1160, 980]) {
      await page.setViewportSize({ width, height: 900 })
      await painted(page)
      await page.screenshot({ path: `test-results/production-seeded-${theme}-${String(width)}.png`, fullPage: false })
    }
  }
})
