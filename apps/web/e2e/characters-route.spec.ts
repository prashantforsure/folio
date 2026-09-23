import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Characters route, walked in a browser against the real backend -
 * the fourth pass (2026-09-20, "Characters, fourth pass" in
 * `docs/build-decisions.md`), its Relationships graph removed again
 * 2026-09-21 ("Characters, relationships view removed"): laper.ai's route
 * shape - a canvas of cards, a List, a form drawer - with the identity
 * layer a pill away in the `Needs a decision` panel.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** The 440px card; no toolbar around
 *      it; `?view=` is an unknown key (the tabs are state, ruled
 *      2026-09-16) so a stale link opens the canvas; a non-UUID is a 404.
 *   2. **Records come from cues.** `✦ Read the script` → three cards on
 *      the canvas, the `Needs a decision · N` pill equal to the rail
 *      badge, two tabs with icons; no sidebar.
 *   3. **A dragged card stays where it was dropped, across a reload.**
 *   4. **A relationship is made by dragging a grip onto a card** → the
 *      modal → `Create` → a thread with a two-label pill readable at a
 *      glance (13.5px, raised 2026-09-21); the pill itself re-opens the
 *      modal; `Delete` removes the thread.
 *   5. **The List sorts, shows a Display column, exports a CSV.**
 *   6. **The drawer**: a rename on an on-page record previews, rewrites the
 *      cues in the Script, and `Undo` restores them; `＋ New character` lands
 *      a card on a free cell; an off-page record is deleted.
 *   7. **The queue panel** opens from the pill, `This is …` binds, the pill
 *      and the badge drop together.
 *   8. **The other routes link in**; the assistant panel answers the
 *      relationships report without a model.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Characters walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const FOUNTAIN = `INT. KAMATHI CHAWL - CORRIDOR - NIGHT

The tap coughs twice and gives up.

MEERA
Two buckets. I counted.

SURESH KADAM
Madam, the paper is the paper.

MEERA (V.O.)
You've shown me the paper.

EXT. KAMATHI CHAWL - COURTYARD - DAY

MEERA PAWAR
Show me the meter.

SURESH
Tomorrow.

YOUNG MEERA
Amma?

INT. WARD OFFICE - DAY

MEERA
I opened it. Nobody else was going to.

CLERK
Next.
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

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The canvas card whose name is exactly this. */
const node = (page: Page, name: string) =>
  page.locator('[data-character-node]').filter({ has: page.locator('[data-node-name]', { hasText: new RegExp(`^\\s*${escape(name)}\\s*$`) }) })

const openDrawer = async (page: Page, name: string) => {
  await node(page, name).locator('[data-node-edit]').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-characters-drawer]')
  await expect(drawer).toBeVisible()
  return drawer
}

/** Drag from the centre of one locator to the centre of another with real pointer events. */
const dragTo = async (page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>, offset = { x: 0, y: 0 }): Promise<void> => {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (a === null || b === null) throw new Error('Nothing to drag.')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2 + offset.x, b.y + b.height / 2 + offset.y, { steps: 12 })
  await page.mouse.up()
}

let scriptUrl = ''
let charactersUrl = ''

test('empty state, both themes; a stale ?view= is ignored, a bad id is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Characters canvas walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  charactersUrl = scriptUrl.replace(/\/ep_001\/script$/, '/characters')

  await page.goto(charactersUrl)
  const main = page.locator('main[data-route="characters"]')
  await expect(main).toHaveAttribute('data-sub-view', 'canvas')
  await expect(main).toHaveAttribute('data-characters-state', 'empty')
  await expect(main.getByText('No characters yet')).toBeVisible()
  await expect(main.getByText('Read the script and every character cue becomes a card on the canvas')).toBeVisible()
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('[data-characters-toolbar]')).toHaveCount(0)
  // No sidebar on this route (ruling 2).
  await expect(page.locator('aside[data-sidebar]')).toHaveCount(0)
  await expect(page.locator('[data-route-crumb]')).toHaveText('Characters')
  await expect(page.locator('[data-writing-header] [data-view-pill] button[data-view-tab]')).toHaveText(['Characters', 'List'])
  await expect(page.locator('[data-writing-header] [data-view-pill] button[data-view-tab] svg')).toHaveCount(2)
  await expect(page.locator('[data-writing-header] [data-view-pill] [data-view-tab="canvas"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-route-id]')).toHaveText('characters')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-empty-${theme}.png`, fullPage: false })
  }
  const stale = await page.goto(`${charactersUrl}?view=list`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'canvas')
  const notARecord = await page.goto(`${charactersUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from cues: three cards on the canvas, the decision pill equals the badge', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  await page.goto(charactersUrl)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-characters-state', 'canvas')
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
  await expect(page.locator('[data-character-node]')).toHaveCount(3)
  await expect(node(page, 'MEERA')).toBeVisible()
  await expect(node(page, 'SURESH KADAM')).toBeVisible()
  await expect(node(page, 'CLERK')).toBeVisible()
  // Meera has two spellings in two scenes - the courtyard's `MEERA PAWAR` is still in the queue.
  await expect(node(page, 'MEERA').locator('[data-node-scenes]')).toHaveAttribute('data-node-scenes', '2')
  await expect(node(page, 'MEERA').locator('[data-node-bio]')).toHaveAttribute('data-node-bio', 'none')
  // Generate draws the look (roadmap task 5.2): priced on the button where the server can run it, disabled with its reason where not.
  const generate = node(page, 'MEERA').locator('[data-generate]')
  if ((await generate.getAttribute('data-generate')) === 'off') {
    await expect(generate).toBeDisabled()
    await expect(generate).not.toHaveAttribute('title', '')
  } else {
    await expect(generate).toHaveText(/Generate · 40 cr/)
  }
  // The pill and the badge count the same rows; nothing is drawn on the canvas for them.
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('3')
  await expect(page.locator('[data-decision-pill]')).toHaveAttribute('data-decision-pill', '3')
  await expect(page.locator('[data-unmatched-row]')).toHaveCount(0)
  await expect(page.locator('[data-threads] [data-thread]')).toHaveCount(0)
  await expect(page.locator('[data-zoom-pill]')).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-canvas-${theme}.png`, fullPage: false })
  }
})

test('a dragged card stays where it was dropped, across a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  const clerk = node(page, 'CLERK')
  await expect(clerk).toBeVisible()
  const before = await clerk.getAttribute('data-canvas-x')
  const face = clerk.locator('[data-node-face]')
  const box = await face.boundingBox()
  if (box === null) throw new Error('No face to drag.')
  await page.mouse.move(box.x + box.width / 2, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30 + 60, { steps: 6 })
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 30 + 180, { steps: 6 })
  await page.mouse.up()
  await saved(page)
  const after = await clerk.getAttribute('data-canvas-x')
  expect(after).not.toBe(before)
  await page.reload()
  await expect(node(page, 'CLERK')).toHaveAttribute('data-canvas-x', after ?? '')
  // A drag is not a click: no drawer opened.
  expect(page.url()).toBe(charactersUrl)
})

test('a relationship: grip → modal → thread and pill; the pill re-opens the modal, edits and deletes it', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await dragTo(page, node(page, 'MEERA').locator('[data-connect-grip]'), node(page, 'SURESH KADAM').locator('[data-node-face]'))
  const modal = page.locator('[data-relationship-modal]')
  await expect(modal).toBeVisible()
  await expect(modal.locator('[data-modal-sub]')).toContainText('Relationship between MEERA and SURESH KADAM')
  await modal.locator('[data-rel-a-is]').fill('tenant')
  await modal.locator('[data-rel-b-is]').fill('landlord')
  await modal.locator('[data-rel-save]').click()
  await saved(page)
  await expect(modal).toHaveCount(0)
  await expect(page.locator('[data-threads] [data-thread]')).toHaveCount(1, { timeout: 60_000 })
  const pill = page.locator('[data-thread-pill]')
  await expect(pill.locator('[data-pill-a]')).toHaveText('tenant')
  await expect(pill.locator('[data-pill-b]')).toHaveText('landlord')
  await expect(page.locator('[data-status-left]')).toContainText('1 relationship')

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-thread-pill-${theme}.png`, fullPage: false })
  }

  // The pill itself opens the modal; Delete removes the thread.
  await pill.click()
  await expect(modal).toBeVisible()
  await expect(modal.locator('[data-rel-delete]')).toBeVisible()
  await modal.locator('[data-rel-delete]').click()
  await saved(page)
  await expect(page.locator('[data-threads] [data-thread]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-status-left]')).toContainText('0 relationships')
})

test('the List sorts, shows a Display column and exports a CSV', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await page.locator('[data-writing-header] [data-view-tab="list"]').click()
  const list = page.locator('[data-list-view]')
  await expect(list).toBeVisible()
  expect(page.url()).toBe(charactersUrl)
  await expect(list.locator('[data-list-row]')).toHaveCount(3)
  await expect(list.locator('[data-list-row] [data-list-name]').first()).toHaveText('MEERA')
  await list.locator('[data-sort="name"]').click()
  await expect(list.locator('[data-list-row] [data-list-name]').first()).toHaveText('CLERK')
  await expect(list.locator('[data-list-gender]').first()).toHaveAttribute('data-list-gender', 'none')
  await expect(list.locator('[data-list-words]')).toHaveCount(0)
  await list.locator('[data-display-menu]').click()
  await list.locator('[data-display-column="words"]').click()
  await expect(list.locator('[data-list-words]')).toHaveCount(3)
  const download = page.waitForEvent('download')
  await list.locator('[data-export-csv]').click()
  expect((await download).suggestedFilename()).toBe('characters.csv')
})

test('the drawer: a rename previews, rewrites the cues and can be undone; a new character lands on a free cell; an off-page record is deleted', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  const drawer = await openDrawer(page, 'SURESH KADAM')
  await expect(drawer.locator('[data-drawer-counts]')).toContainText('1 scene')
  await expect(drawer.locator('[data-drawer-delete]')).toBeDisabled()
  await drawer.locator('[data-field="role"]').fill('Landlord')
  await drawer.locator('[data-field="name"]').fill('Suresh Kadam')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.locator('[data-rename-confirm]')).toContainText('1 cue in the script will read SURESH KADAM', { timeout: 60_000 })
  await drawer.locator('[data-rename-confirm-button]').click()
  await saved(page)
  await page.waitForURL(charactersUrl)
  await expect(page.locator('[data-status-toast]')).toContainText('Renamed SURESH KADAM → Suresh Kadam')
  await expect(node(page, 'Suresh Kadam')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-status-undo]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText('Rename undone')
  await expect(node(page, 'SURESH KADAM')).toBeVisible({ timeout: 60_000 })
  // The profile save landed with the rename; the role survived the undo.
  await expect((await openDrawer(page, 'SURESH KADAM')).locator('[data-field="role"]')).toHaveValue('Landlord')
  await page.locator('[data-drawer-cancel]').click()
  await page.waitForURL(charactersUrl)

  // A new character by hand: the card lands on a free cell, overlapping nothing.
  await page.locator('[data-new-character]').click()
  const fresh = page.locator('[data-characters-drawer="New character"]')
  await fresh.locator('[data-field="name"]').fill('Inspector Rane')
  await fresh.locator('[data-drawer-create]').click()
  await saved(page)
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-character-node]')).toHaveCount(4)
  const boxes = []
  for (let i = 0; i < 4; i += 1) boxes.push(await page.locator('[data-character-node]').nth(i).boundingBox())
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      if (a === null || b === null || a === undefined || b === undefined) continue
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
    }
  }
  // Off the page: Delete is live.
  await expect(page.locator('[data-drawer-delete]')).toBeEnabled()
  await page.locator('[data-drawer-delete]').click()
  await page.locator('[data-delete-confirm]').click()
  await saved(page)
  await page.waitForURL(charactersUrl)
  await expect(page.locator('[data-character-node]')).toHaveCount(3, { timeout: 60_000 })
})

test('the queue panel: the pill opens it, a decision binds, the pill and the badge drop together', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await expect(page.locator('[data-queue-panel]')).toHaveCount(0)
  await page.locator('[data-decision-pill]').click()
  const panel = page.locator('[data-characters-drawer="Needs a decision"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-unmatched-row]')).toHaveCount(3)
  const suresh = panel.locator('[data-unmatched-row="SURESH"]')
  await expect(suresh.locator('[data-unmatched-reason]')).toHaveText('first name')
  await suresh.locator('[data-unmatched-match]').click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText("SURESH is SURESH KADAM's now.")
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('2', { timeout: 60_000 })
  await expect(page.locator('[data-decision-pill]')).toHaveAttribute('data-decision-pill', '2')
  await expect(panel.locator('[data-unmatched-row]')).toHaveCount(2)
  await panel.locator('[data-queue-done]').click()
  await expect(panel).toHaveCount(0)
  await expect(node(page, 'SURESH KADAM').locator('[data-node-scenes]')).toHaveAttribute('data-node-scenes', '2', { timeout: 60_000 })
})

test('the other routes link in; the assistant answers the relationships report without a model', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const cue = page.locator('[data-character-id]').first()
  await cue.click()
  const link = page.locator('[data-cue-card] a[href*="/characters/"]').first()
  await expect(link).toBeVisible()
  await link.click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-characters-drawer]')).toBeVisible()

  await page.locator('[data-assistant-orb]').click()
  const panel = page.locator('[data-assistant-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-assistant-focus', /[0-9a-f-]{36}/)
  const chip = panel.locator('button[data-chip-kind="report"]', { hasText: 'Who has no relationships yet?' })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(panel.locator('[data-turn="report"]').last()).toContainText('no relationship yet')
})
