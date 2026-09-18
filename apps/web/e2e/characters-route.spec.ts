import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Characters route, walked in a browser against the real backend -
 * the rebuild's first phase (2026-09-17, `docs/build-decisions.md`): the
 * identity layer gets a surface, every citation is a link, every route
 * links in, and every queue decision can be taken back.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** The 440px card with the busiest
 *      cues; no toolbar and no widget around it; `?view=` is an unknown
 *      key on this route (the tabs are state, ruled 2026-09-16) so a stale
 *      link opens the cast; a path that is not a UUID is a 404.
 *   2. **Records come from cues; near-misses are the queue, never a second
 *      Meera.** Three cards, the queue drawn without a click, each row
 *      saying why (`contains MEERA`, `first name`) and how sure (a line
 *      `Maybe` against a solid `This is`), the rail badge the same; the
 *      card whose record a cue proposes wears the `--warn` border and the
 *      conflict block; the sidebar's `Needs a decision` group and widget.
 *   3. **Every decision is a row, and every row can be taken back.** `It's
 *      MEERA` on the card binds; `Not a character` → the toast → `Undo`
 *      puts the cue back; again → the walk-on line lists it and `Actually
 *      a character` takes it back; `Someone else… → New character` mints.
 *   4. **The drawer authors the record and survives a reload**: role, age,
 *      gender, description, appearance, colour, status, wants, needs. The
 *      alias table lists the spellings with who bound them; a spelling is
 *      bound and unbound by hand; a meta chip opens the script at the scene.
 *   5. **A record-level rename shows its diff first, rewrites every cue and
 *      keeps the profile**; `Create a new character instead` keeps the old.
 *   6. **Merge has a door**: the on-page record's foot offers it, the loser
 *      redirects to the winner.
 *   7. **The sheet sorts, scopes and exports; the filter applies to every
 *      view; an off-page record is deleted from the sidebar.**
 *   8. **The other routes link in**; the assistant panel says what it
 *      reads, answers a report without a model, and names the open record.
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

/** The card whose name is exactly this. */
const card = (page: Page, name: string) =>
  page.locator('[data-character-card]').filter({
    has: page.locator('[data-card-name]', { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }),
  })

const openDrawer = async (page: Page, name: string) => {
  await card(page, name).click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer).toBeVisible()
  return drawer
}

let scriptUrl = ''
let charactersUrl = ''

test('empty state, both themes; a stale ?view= is ignored, a bad id is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Characters walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  charactersUrl = scriptUrl.replace(/\/ep_001\/script$/, '/characters')

  await page.goto(charactersUrl)
  const main = page.locator('main[data-route="characters"]')
  await expect(main).toHaveAttribute('data-sub-view', 'cast')
  await expect(main).toHaveAttribute('data-characters-state', 'empty')
  await expect(main.getByText('No characters yet')).toBeVisible()
  await expect(main.getByText('Deriving costs nothing and never changes the script.')).toBeVisible()
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  // The empty route is quiet: no toolbar, no widget, no find field; the sidebar says so.
  await expect(page.locator('[data-characters-toolbar]')).toHaveCount(0)
  await expect(page.locator('[data-cast-widget]')).toHaveCount(0)
  await expect(page.locator('[data-cast-find]')).toHaveCount(0)
  await expect(page.locator('aside[data-sidebar] [data-cast-empty]')).toBeVisible()
  await expect(page.locator('[data-route-crumb]')).toHaveText('Characters')
  await expect(page.locator('[data-writing-header] [data-view-pill] button[data-view-tab]')).toHaveText(['Cast', 'Presence', 'Sheet'])
  await expect(page.locator('[data-writing-header] [data-view-pill] [data-view-tab="cast"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-route-id]')).toHaveText('characters')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-empty-${theme}.png`, fullPage: false })
  }
  // The tabs are state, not `?view=`: a stale view link is ignored, not a 404.
  const stale = await page.goto(`${charactersUrl}?view=presence`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'cast')
  const notARecord = await page.goto(`${charactersUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from cues; the queue is drawn, reasoned and weighted; conflicts sit on the cards', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  await page.goto(charactersUrl)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-characters-state', 'cast')
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await expect(card(page, 'MEERA')).toBeVisible()
  await expect(card(page, 'SURESH KADAM')).toBeVisible()
  await expect(card(page, 'CLERK')).toBeVisible()
  // Meera has two spellings in two scenes - the courtyard's `MEERA PAWAR`
  // is still in the queue, so it is not hers yet.
  await expect(card(page, 'MEERA').locator('[data-card-scenes]')).toHaveAttribute('data-card-scenes', '2')
  await expect(card(page, 'MEERA').locator('[data-card-scenes]')).toContainText('2 speaks · 0 mentioned')
  await expect(card(page, 'MEERA').locator('[data-presence-strip] [data-presence-cell]')).toHaveCount(3)
  await expect(card(page, 'MEERA').locator('[data-presence-cell="full"]')).toHaveCount(2)
  await expect(card(page, 'MEERA').locator('[data-card-cues]')).toContainText('MEERA 2')
  await expect(card(page, 'MEERA').locator('[data-card-cues]')).toContainText('MEERA (V.O.) 1')
  await expect(card(page, 'MEERA').locator('[data-card-status]')).toHaveAttribute('data-card-status', 'draft')
  // No description yet: the card quotes the first line instead.
  await expect(card(page, 'MEERA').locator('[data-card-line]')).toHaveAttribute('data-card-quote-kind', 'line')

  // The queue: drawn without a click, no dismiss, a reason and a weight per row.
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('3')
  await expect(page.locator('[data-unmatched-count]')).toHaveText("3 names in the script don't match a character")
  await expect(page.locator('[data-unmatched-dismiss]')).toHaveCount(0)
  await expect(page.locator('[data-unmatched-review]')).toHaveCount(0)
  await expect(page.locator('[data-unmatched-row]')).toHaveCount(3)
  const youngMeera = page.locator('[data-unmatched-row="YOUNG MEERA"]')
  await expect(youngMeera.locator('[data-unmatched-reason]')).toHaveText('contains MEERA')
  await expect(youngMeera.locator('[data-unmatched-match]')).toHaveText('Maybe MEERA')
  await expect(youngMeera.locator('[data-unmatched-match]')).toHaveClass(/folio-line-button/)
  const suresh = page.locator('[data-unmatched-row="SURESH"]')
  await expect(suresh.locator('[data-unmatched-reason]')).toHaveText('first name')
  await expect(suresh.locator('[data-unmatched-match]')).toHaveText('This is SURESH KADAM')
  await expect(suresh.locator('[data-unmatched-match]')).toHaveClass(/folio-solid-button/)
  await expect(page.locator('[data-unmatched-row="MEERA PAWAR"] [data-unmatched-reason]')).toHaveText('starts the same')
  // The citation chips are links into the script.
  await expect(suresh.locator('[data-cite-link]').first()).toHaveAttribute('href', /\/ep_001\/script#n-[0-9a-f-]{36}$/)

  // Conflicts on the cards.
  await expect(card(page, 'MEERA')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'MEERA').locator('[data-conflict-block]').first()).toContainText('reads like MEERA')
  await expect(card(page, 'SURESH KADAM')).toHaveAttribute('data-conflict', 'true')
  await expect(card(page, 'CLERK')).toHaveAttribute('data-conflict', 'false')

  // The sidebar: the decisions group, the record groups, the widget.
  await expect(page.locator('[data-cast-group="decisions"] [data-decision-row]')).toHaveCount(3)
  await expect(page.locator('[data-cast-group="principal"] [data-cast-row]')).toHaveCount(3)
  await expect(page.locator('[data-decisions-total]')).toHaveText('3')
  await expect(page.locator('[data-on-page-count]')).toHaveText('3 of 3')
})

test('every decision is a row and every row can be taken back', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)

  // The conflict block on Meera's card: accept the change. The toast says so.
  const meera = card(page, 'MEERA')
  await meera.locator('[data-conflict-accept]').first().click()
  await saved(page)
  await expect(page.locator('[data-status-toast]')).toContainText("MEERA PAWAR is MEERA's now.")
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('2', { timeout: 60_000 })
  await expect(meera.locator('[data-card-scenes]')).toHaveAttribute('data-card-scenes', '3', { timeout: 60_000 })

  // Not a character: YOUNG MEERA is nobody - then Undo puts the cue back.
  const youngMeera = page.locator('[data-unmatched-row="YOUNG MEERA"]')
  await youngMeera.locator('[data-unmatched-walk-on]').click()
  await saved(page)
  await expect(youngMeera).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-status-toast]')).toContainText('YOUNG MEERA is not a character.')
  await expect(page.locator('[data-walk-ons]')).toHaveAttribute('data-walk-ons', '1')
  await page.locator('[data-status-undo]').click()
  await saved(page)
  await expect(youngMeera).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-walk-ons]')).toHaveCount(0)

  // Again, and this time take it back from the walk-ons line.
  await youngMeera.locator('[data-unmatched-walk-on]').click()
  await saved(page)
  await expect(youngMeera).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('1')
  await expect(page.locator('[data-cast-group="walk-ons"] [data-walk-ons-count]')).toHaveText('1')
  await page.locator('[data-walk-ons] [data-walk-ons-toggle]').click()
  const walkOn = page.locator('[data-walk-on-row="YOUNG MEERA"]')
  await expect(walkOn).toBeVisible()
  await walkOn.locator('[data-walk-on-revoke]').click()
  await saved(page)
  await expect(youngMeera).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-status-toast]')).toContainText('YOUNG MEERA is back in the queue.')
  await youngMeera.locator('[data-unmatched-walk-on]').click()
  await saved(page)
  await expect(youngMeera).toHaveCount(0, { timeout: 60_000 })

  // Someone else… → New character: SURESH is not Suresh Kadam. The menu lists the ranked record first.
  const suresh = page.locator('[data-unmatched-row="SURESH"]')
  await suresh.locator('[data-unmatched-other]').click()
  const menu = page.locator('[role="menu"][aria-label="Who is this"]')
  await expect(menu.locator('[data-unmatched-pick]').first()).toContainText('SURESH KADAM')
  await expect(menu.locator('[data-unmatched-pick-reason]').first()).toHaveText('first name')
  await menu.locator('[data-unmatched-pick="new-record"]').click()
  await saved(page)
  await expect(suresh).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)
  await expect(page.locator('[data-character-card]')).toHaveCount(4)
  await expect(card(page, 'SURESH')).toBeVisible()
  await expect(page.locator('[data-decisions-total]')).toHaveText('0')
  await expect(page.locator('[data-on-page-count]')).toHaveText('4 of 4')

  // The decisions persist: a reload shows no banner and no conflict.
  await page.reload()
  await expect(page.locator('[data-unmatched-banner]')).toHaveCount(0)
  await expect(page.locator('[data-character-card][data-conflict="true"]')).toHaveCount(0)
})

test('the drawer authors the record, lists the spellings, binds one by hand, and opens the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  const drawer = await openDrawer(page, 'MEERA')
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('MEERA')
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('3 speaks · 0 mentioned')
  await expect(drawer.locator('[data-drawer-meta]')).toContainText('minted from the script')
  await expect(drawer.locator('[data-meta-first]')).toHaveText('E1 Sc 1')
  await expect(drawer.locator('[data-meta-last]')).toHaveText('E1 Sc 3')
  await expect(drawer.locator('[data-drawer-stats]')).toContainText('lines')
  await expect(drawer.locator('[data-drawer-stats]')).toContainText('% of dialogue')
  // The script speaks: the first line quoted with its chip, the last, the sides modal.
  await expect(drawer.locator('[data-voice-line="first"]')).toContainText('E1 Sc 1')
  await expect(drawer.locator('[data-voice-line="first"]')).toContainText('“')
  await drawer.locator('[data-voice-sides]').click()
  await expect(page.locator('[data-sides-modal] [data-sides-scene]')).toHaveCount(3, { timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-sides-modal]')).toHaveCount(0)
  // Presence and the scenes breakdown, in place of the old Arc list.
  await expect(drawer.locator('[data-drawer-strip]')).toHaveAttribute('data-drawer-strip', '3')
  await expect(drawer.locator('[data-drawer-span]')).toContainText('first')
  await expect(drawer.locator('[data-drawer-scenes]')).toHaveAttribute('data-drawer-scenes', '3')
  await expect(drawer.locator('[data-drawer-episode="1"]')).toContainText('E1 · 3 scenes')
  await expect(drawer.locator('[data-scene-row]')).toHaveCount(3)
  await expect(drawer.locator('[data-scene-row] [data-cite-link]').first()).toHaveAttribute('href', /#n-[0-9a-f-]{36}$/)
  await expect(drawer.locator('[data-drawer-sets]')).toBeVisible()
  await expect(drawer.locator('[data-drawer-notes]')).toHaveAttribute('open', '')
  // Disconnected: the model actions say so rather than going away.
  await expect(drawer.locator('[data-draft-button="bio"]')).toBeDisabled()
  await expect(drawer.locator('[data-check-contradictions]')).toBeDisabled()
  await expect(page.locator('[data-route-id]')).toHaveText(/^characters\/[0-9a-f]{8}$/)
  await expect(page.locator('aside[data-sidebar] [data-cast-row][aria-current="page"]')).toContainText('MEERA')

  // The alias table: the name's spelling from derivation, `MEERA PAWAR` bound by the click, the V.O. variant folded in.
  await expect(drawer.locator('[data-alias-count]')).toHaveText('2 spellings')
  const nameRow = drawer.locator('[data-alias-row="MEERA"]')
  await expect(nameRow.locator('[data-alias-name]')).toBeVisible()
  await expect(nameRow.locator('[data-alias-by]')).toHaveText('derived')
  await expect(nameRow.locator('[data-alias-variant]')).toHaveText('V.O. 1')
  await expect(drawer.locator('[data-alias-row="MEERA PAWAR"] [data-alias-by]')).toHaveText('you')
  // Bind a spelling by hand, then unbind it.
  await drawer.locator('[data-alias-add]').click()
  await drawer.locator('[data-alias-input]').fill('MIRA')
  await drawer.locator('[data-alias-bind]').click()
  await saved(page)
  await expect(drawer.locator('[data-alias-row="MIRA"]')).toBeVisible({ timeout: 60_000 })
  await expect(drawer.locator('[data-alias-count]')).toHaveText('3 spellings')
  await drawer.locator('[data-alias-row="MIRA"]').hover()
  await drawer.locator('[data-alias-unbind="MIRA"]').click()
  await saved(page)
  await expect(drawer.locator('[data-alias-row="MIRA"]')).toHaveCount(0, { timeout: 60_000 })

  // The fields, the swatches, the status.
  await drawer.locator('[data-field="role"]').fill('Laundress, second floor')
  await drawer.locator('[data-field="age"]').fill('38')
  await drawer.locator('[data-field="gender"]').selectOption('female')
  await drawer.locator('[data-field="bio"]').fill("Does other people's washing and knows how much water every family on the floor uses.")
  await drawer.locator('[data-field="appearance"]').fill('Rain-soaked more often than not.')
  await drawer.locator('[data-swatch="chip-3"]').click()
  await expect(drawer.locator('[data-swatch="chip-3"]')).toHaveAttribute('aria-pressed', 'true')
  await drawer.locator('[data-status="defined"]').click()
  await expect(drawer.locator('[data-status="defined"]')).toHaveAttribute('aria-pressed', 'true')
  await drawer.locator('[data-field="wants"]').fill('Water at six, like before.')
  await drawer.locator('[data-field="needs"]').fill('To be the one who decides.')
  await drawer.locator('[data-drawer-save]').click()
  await saved(page)
  await page.waitForURL(/\/characters$/)

  await expect(card(page, 'MEERA').locator('[data-card-status]')).toHaveText('Defined', { timeout: 60_000 })
  await expect(card(page, 'MEERA').locator('[data-card-line]')).toContainText("Does other people's washing")

  await page.reload()
  await openDrawer(page, 'MEERA')
  await expect(drawer.locator('[data-field="role"]')).toHaveValue('Laundress, second floor')
  await expect(drawer.locator('[data-field="gender"]')).toHaveValue('female')
  await expect(drawer.locator('[data-field="appearance"]')).toHaveValue('Rain-soaked more often than not.')
  await expect(drawer.locator('[data-swatch="chip-3"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(drawer.locator('[data-field="wants"]')).toHaveValue('Water at six, like before.')
  await expect(drawer.locator('[data-status="defined"]')).toHaveAttribute('aria-pressed', 'true')
  // A meta chip opens the script at the scene, which the editor lands on.
  await drawer.locator('[data-meta-first]').click()
  await page.waitForURL(/\/ep_001\/script#n-[0-9a-f-]{36}$/)
  const landing = new URL(page.url()).hash.slice(1)
  await expect(page.locator(`[data-sheet] [id="${landing}"]`)).toBeInViewport({ timeout: 60_000 })
})

test('a rename shows its diff first, rewrites every cue and keeps the profile; or creates a new record instead', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  let drawer = await openDrawer(page, 'MEERA')

  await drawer.locator('[data-field="name"]').fill('Meera Pawar')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.locator('[data-rename-confirm]')).toBeVisible({ timeout: 60_000 })
  await expect(drawer.locator('[data-rename-confirm]')).toContainText('will read MEERA PAWAR')
  await expect(drawer.locator('[data-rename-stays]')).toHaveText('No other spelling is bound.')
  await drawer.locator('[data-rename-confirm-button]').click()
  await saved(page)
  await page.waitForURL(/\/characters$/)
  await expect(page.locator('[data-status-toast]')).toContainText('Renamed ·')
  await expect(card(page, 'Meera Pawar')).toBeVisible({ timeout: 60_000 })
  await expect(card(page, 'Meera Pawar')).toContainText('Laundress, second floor')

  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const cues = page.locator('[data-sheet] [data-type="character"]')
  await expect(cues).toHaveCount(8)
  expect(await cues.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))).toEqual([
    'MEERA PAWAR',
    'SURESH KADAM',
    'MEERA PAWAR',
    'MEERA PAWAR',
    'SURESH',
    'YOUNG MEERA',
    'MEERA PAWAR',
    'CLERK',
  ])

  // `Create a new character instead`: CLERK keeps its cues; `Clerk Two` is a new, off-page record.
  await page.goto(charactersUrl)
  drawer = await openDrawer(page, 'CLERK')
  await drawer.locator('[data-field="name"]').fill('Clerk Two')
  await drawer.locator('[data-drawer-save]').click()
  await expect(drawer.locator('[data-rename-create]')).toBeVisible({ timeout: 60_000 })
  await drawer.locator('[data-rename-create]').click()
  await saved(page)
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('Clerk Two')
  await drawer.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/characters$/)
  await expect(page.locator('[data-character-card]')).toHaveCount(5)
  await expect(card(page, 'CLERK')).toBeVisible()
  await expect(card(page, 'Clerk Two').locator('[data-card-cues]')).toHaveText('Not on the page yet')
  await expect(page.locator('[data-cast-group="off-page"] [data-cast-row]')).toHaveCount(1)
  await expect(page.locator('[data-on-page-count]')).toHaveText('4 of 5')
})

test('merge has a door: the loser redirects to the winner', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  const drawer = await openDrawer(page, 'SURESH')
  const loserUrl = page.url()
  // On the page: no Delete, the merge door instead.
  await expect(drawer.locator('[data-drawer-delete]')).toHaveCount(0)
  await expect(drawer.locator('[data-drawer-in-script]')).toContainText('In 1 scene')
  await drawer.locator('[data-drawer-merge]').click()
  const select = drawer.locator('[data-merge-into]')
  const winner = await select.locator('option', { hasText: 'SURESH KADAM' }).getAttribute('value')
  if (winner === null) throw new Error('SURESH KADAM is not in the merge picker')
  await select.selectOption(winner)
  await expect(drawer.locator('[data-conflict-block]')).toContainText('Merge SURESH into SURESH KADAM?')
  await drawer.locator('[data-conflict-accept]').click()
  await saved(page)
  await page.waitForURL(new RegExp(`/characters/${winner}$`))
  await expect(page.locator('[data-status-toast]')).toContainText('Merged SURESH into SURESH KADAM.')
  await expect(drawer.locator('[data-field="name"]')).toHaveValue('SURESH KADAM')
  await expect(drawer.locator('[data-alias-row="SURESH"]')).toBeVisible()
  await drawer.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/characters$/)
  await expect(page.locator('[data-character-card]')).toHaveCount(4)
  // The tombstone follows: the loser's URL lands on the winner.
  await page.goto(loserUrl)
  await page.waitForURL(new RegExp(`/characters/${winner}$`))
})

test('the sheet sorts, scopes and exports; the filter applies to every view; an off-page record is deleted from the sidebar', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)

  await page.locator('[data-view-tab="sheet"]').click()
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'sheet')
  await expect(page).toHaveURL(charactersUrl)
  const rows = page.locator('a[data-sheet-row]')
  await expect(rows).toHaveCount(4)
  await expect(page.locator('[data-sort="speaks"]')).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.first()).toContainText('Meera Pawar')
  await page.locator('[data-sort="name"]').click()
  await expect(page.locator('[data-sort="name"]')).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.first()).toContainText('CLERK')
  await expect(page.locator('[data-sheet-totals]')).toContainText('4 characters')
  const meeraRow = rows.filter({ hasText: 'Meera Pawar' })
  await expect(meeraRow.locator('[data-sheet-status]')).toHaveAttribute('data-sheet-status', 'defined')
  await expect(meeraRow.locator('[data-sheet-strip] [data-presence-cell]')).toHaveCount(3)
  await expect(meeraRow.locator('[data-sheet-share]')).toContainText('%')
  await expect(meeraRow.locator('[data-cite-link]').first()).toHaveText('E1 Sc 1')
  await expect(page.locator('[data-balance] [data-balance-episode="1"]')).toContainText('Meera Pawar')
  await page.locator('[data-sheet-scope]').click()
  await page.locator('[data-filter-option="ep:1"]').click()
  await expect(page.locator('[data-sort="lines"]')).toContainText('Lines · all')
  const download = page.waitForEvent('download')
  await page.locator('[data-sheet-export]').click()
  expect((await download).suggestedFilename()).toBe('cast.csv')
  await page.screenshot({ path: 'test-results/characters-sheet-dark.png', fullPage: false })

  // The filter narrows every view and the count chip says so.
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="status:defined"]').click()
  await expect(page.locator('[data-cast-count]')).toHaveText('1 of 4')
  await expect(rows).toHaveCount(1)
  await page.locator('[data-view-tab="presence"]').click()
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'presence')
  await expect(page.locator('[data-presence-row]')).toHaveCount(1)
  await page.locator('[data-show-all]').click()
  await expect(page.locator('[data-presence-row]')).toHaveCount(3)
  await expect(page.locator('[data-presence-episode="E1"]')).toBeVisible()
  await expect(page.locator('[data-presence-row]').first().locator('[data-presence-name]')).toHaveAttribute('href', /\/characters\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-presence-pairs]')).toBeVisible()
  await page.locator('[data-presence-row] .folio-presence-cell').first().hover()
  await expect(page.locator('[data-presence-hover]')).not.toHaveAttribute('data-presence-hover', 'none')
  await page.screenshot({ path: 'test-results/characters-presence-dark.png', fullPage: false })
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="status:defined"]').click()
  await page.locator('[data-view-tab="cast"]').click()
  await expect(page.locator('[data-character-card]')).toHaveCount(1)
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="no-description"]').click()
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await page.locator('[data-cast-filter]').click()
  await page.locator('[data-filter-option="status:locked"]').click()
  await expect(page.locator('[data-cast-filtered-empty]')).toBeVisible()
  await page.locator('[data-show-all]').click()
  await expect(page.locator('[data-character-card]')).toHaveCount(4)

  // Delete an off-page record from the sidebar's ghost ×: the drawer opens on its confirm.
  const offPage = page.locator('[data-cast-group="off-page"] [data-cast-row]')
  await expect(offPage).toHaveCount(1)
  await offPage.hover()
  await page.locator('[data-cast-delete]').click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  const drawer = page.locator('[data-character-drawer]')
  await expect(drawer.locator('[data-delete-confirm]')).toBeVisible()
  await drawer.locator('[data-delete-confirm]').click()
  await saved(page)
  await page.waitForURL(/\/characters$/)
  await expect(page.locator('[data-character-card]')).toHaveCount(3)
  await expect(page.locator('[data-cast-group="off-page"]')).toHaveCount(0)

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-cast-${theme}.png`, fullPage: false })
  }
})

test('the other routes link in; the assistant says what it reads and answers a report without a model', async ({ page, account }) => {
  await signIn(page, account)
  // Scenes: the cast chips and the unresolved-cue sentence link to Characters.
  await page.goto(scriptUrl.replace(/\/script$/, '/scenes'))
  await expect(page.locator('[data-cast-link]').first()).toHaveAttribute('href', /\/characters\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  // Production: the cast rows are links.
  await page.goto(scriptUrl.replace(/\/script$/, '/production'))
  await expect(page.locator('a[data-cast-row]').first()).toHaveAttribute('href', /\/characters\/[0-9a-f-]{36}$/, { timeout: 60_000 })

  // The panel on /characters: the scope, a report, the open record's name.
  await page.goto(charactersUrl)
  await page.keyboard.press('Control+J')
  const panel = page.locator('[data-assistant-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-assistant-scope', 'project')
  await expect(panel.locator('[data-assistant-reading]')).toContainText('Reading the script')
  await panel.locator('[data-chip-kind="report"]', { hasText: 'Find characters with no description' }).click()
  await expect(panel.locator('[data-report-note]')).toContainText('report · no model')
  await expect(panel.locator('[data-report-note]')).toContainText('no description')
  await page.keyboard.press('Control+J')
  await openDrawer(page, 'Meera Pawar')
  await page.keyboard.press('Control+J')
  await expect(panel.locator('[data-chip-kind="ask"]').first()).toHaveText("Draft Meera Pawar's needs")
  await expect(panel).toHaveAttribute('data-assistant-focus', /^[0-9a-f-]{36}$/)
  await page.keyboard.press('Control+J')
  await page.locator('[data-character-drawer] [data-drawer-ask]').click()
  await expect(panel.locator('textarea')).toHaveValue('About Meera Pawar: ')
})
