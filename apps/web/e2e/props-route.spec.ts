import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Props route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record, and **no `✦ Derive`
 *      button** - nothing in a screenplay is a prop, so there is nothing to
 *      derive and the card offers one manual action. The sidebar card has
 *      no rows, no find field and no widget; the `Project / Props` crumb
 *      with the two views in the header's centre as buttons; the status
 *      bar. A stale `?view=` is not a 404 - the views are state - but a
 *      non-UUID id is.
 *   2. **A record is authored, and the alias table is what makes it read.**
 *      `Game Ball` is created and collects nothing, because the page never
 *      writes those two words. Binding `the ball` makes the same script
 *      quote four lines back at it, under their scenes, with no migration
 *      and nothing stored. This is the route's whole argument, and it is
 *      the one assertion that would fail if the evidence were ever cached.
 *   3. **Two props may both be "the bag".** The alias table has no unique
 *      index per project, so the same spelling binds to a second record and
 *      both collect the line - there is no conflict block and no queue.
 *   4. **The drawer authors the record**: category (free text, offered from
 *      what the project already uses, never an enum), status, description;
 *      it survives a reload; the sidebar groups by category and the widget
 *      counts sourced and on-the-page.
 *   5. **A rename changes the record and not the script.** The heading and
 *      the action lines read exactly as they did; the spelling that *was*
 *      the name is swapped, and every other spelling stays bound.
 *   6. **Both views, both themes**, the filter narrows both, and the List's
 *      two columns sort each way.
 *   7. **Props is authoritative for Production.** The shot drawer's `Prop`
 *      row opens a menu whose items are the props table - the thing that
 *      could not be done at all before this route existed - and the picked
 *      prop reads back on the record's own drawer.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Props walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

/**
 * The corpus makes the route's point: the words "Game Ball" and "Kit Bag"
 * appear nowhere. "the ball" appears four times in action and once in
 * dialogue (which is not evidence - a person asking for a thing is not the
 * page describing it), and "the bag" appears twice.
 */
const FOUNTAIN = `INT. CHANGING ROOM - DAY

The bag sits open on the bench.

MEERA
Where is the ball?

ANIL
Ask Kadam.

EXT. MAIDAN - DAY

The ball rolls under the bench.

Meera picks up the ball and turns it over once.

INT. CHANGING ROOM - NIGHT

The bag is gone.

EXT. MAIDAN - NIGHT

Somebody has left the ball in the goal mouth.
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

/** The card whose name link carries exactly this name. */
const card = (page: Page, name: string) =>
  page.locator('[data-prop-card]').filter({
    has: page.locator('[data-card-name]', { hasText: new RegExp(`^\\s*${escape(name)}\\s*$`) }),
  })

const sidebarRow = (page: Page, name: string) =>
  page.locator('[data-prop-row]').filter({ hasText: new RegExp(`^\\s*${escape(name)}\\b`) }).first()

const openDrawer = async (page: Page, name: string): Promise<void> => {
  await sidebarRow(page, name).click()
  await page.waitForURL(/\/props\/[0-9a-f-]{36}$/)
  await expect(page.locator('[data-props-drawer]')).toBeVisible()
}

/** Make a record through the `New prop` drawer, and land on its own page. */
const createProp = async (page: Page, name: string, category: string | null): Promise<void> => {
  await page.locator('[data-new-prop], [data-add-by-hand]').first().click()
  await expect(page.locator('[data-props-drawer="New prop"]')).toBeVisible()
  await page.locator('[data-field="name"]').fill(name)
  if (category !== null) await page.locator('[data-field="category"]').fill(category)
  await page.locator('[data-drawer-create]').click()
  await page.waitForURL(/\/props\/[0-9a-f-]{36}$/)
}

const bind = async (page: Page, spelling: string): Promise<void> => {
  await page.locator('[data-bind-open]').click()
  await page.locator('[data-bind-input]').fill(spelling)
  await page.locator('[data-bind-submit]').click()
  await saved(page)
  await expect(page.locator(`[data-alias-row="${spelling}"]`)).toBeVisible()
}

let scriptUrl = ''
let propsUrl = ''

test('empty state, both themes; no Derive button; a stale view opens the overview, a bad id is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Props walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  scriptUrl = page.url()
  propsUrl = scriptUrl.replace(/\/ep_001\/script$/, '/props')

  await page.goto(propsUrl)
  const main = page.locator('main[data-route="props"]')
  await expect(main).toHaveAttribute('data-sub-view', 'overview')
  await expect(main).toHaveAttribute('data-props-state', 'empty')
  await expect(main.getByText('No props yet')).toBeVisible()
  // The one thing this empty state must not have: nothing is derivable, so nothing offers to derive.
  await expect(page.locator('[data-derive-now]')).toHaveCount(0)
  await expect(page.locator('[data-derivable-top]')).toHaveCount(0)
  await expect(page.locator('[data-add-by-hand]')).toBeVisible()
  await expect(page.locator('[data-props-toolbar]')).toHaveCount(0)
  // The shell: the sidebar card with no rows, no find, no widget; the crumb; the views as buttons; the status bar.
  await expect(page.locator('aside[data-sidebar] [data-props-empty]')).toBeVisible()
  await expect(page.locator('[data-testid="prop-find"]')).toHaveCount(0)
  await expect(page.locator('[data-props-widget]')).toHaveCount(0)
  await expect(page.locator('[data-route-crumb]')).toHaveText('Props')
  const tabs = page.locator('[data-writing-header] [data-view-pill] [data-view-tab]')
  await expect(tabs).toHaveText(['Overview', 'List'])
  await expect(tabs.first()).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-props-toolbar] [data-view-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-id]')).toHaveText('props')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/props-empty-${theme}.png`, fullPage: false })
  }
  // The views are state: a stale `?view=` is an unknown key, not a 404.
  const stale = await page.goto(`${propsUrl}?view=list`)
  expect(stale?.status()).toBe(200)
  await expect(main).toHaveAttribute('data-sub-view', 'overview')
  const notARecord = await page.goto(`${propsUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('a record reads nothing until a spelling is bound - then the same script quotes it back', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('4', { timeout: 60_000 })

  // Importing a script derives characters and locations. It derives no props at all.
  await page.goto(propsUrl)
  await expect(page.locator('main[data-route="props"]')).toHaveAttribute('data-props-state', 'empty')

  await createProp(page, 'Game Ball', 'Hand prop')
  // The record's own name is bound, and the page never writes it - so it reads nothing.
  await expect(page.locator('[data-alias-row="Game Ball"]')).toBeVisible()
  await expect(page.locator('[data-alias-lines="0"]')).toBeVisible()
  await expect(page.locator('[data-drawer-evidence="none"]')).toBeVisible()
  await expect(page.locator('[data-evidence-count]')).toHaveAttribute('data-evidence-count', '0')

  // Bind what the page actually calls it. Nothing is stored; the next render reads the script again.
  await bind(page, 'the ball')
  await page.reload()
  // Four lines of action; the dialogue line asking for the ball is not one of them.
  await expect(page.locator('[data-evidence-count]')).toHaveAttribute('data-evidence-count', '4')
  await expect(page.locator('[data-evidence-row]')).toHaveCount(4)
  await expect(page.locator('[data-evidence-row]').first()).toContainText('The ball rolls under the bench.')
  await expect(page.locator('[data-evidence-list]')).not.toContainText('Where is the ball?')
  // Each quotation links into the script at its scene.
  await expect(page.locator('[data-evidence-row] [data-cite-link]').first()).toHaveAttribute('href', /#n-/)
  // And the alias table now says which spelling is doing the work.
  await expect(page.locator('[data-alias-row="the ball"] [data-alias-lines]')).toHaveAttribute('data-alias-lines', '4')
  await expect(page.locator('[data-alias-row="Game Ball"] [data-alias-lines]')).toHaveAttribute('data-alias-lines', '0')

  await page.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/props$/)
  await expect(card(page, 'Game Ball')).toBeVisible()
  await expect(card(page, 'Game Ball')).toContainText('The ball rolls under the bench.')
})

test('two props may both be "the bag" - no unique index, no conflict, no queue', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(propsUrl)
  await createProp(page, 'Kit Bag', 'Set dressing')
  await bind(page, 'the bag')
  await expect(page.locator('[data-evidence-count]')).toHaveAttribute('data-evidence-count', '2')
  await page.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/props$/)

  await createProp(page, "Meera's bag", 'Set dressing')
  await bind(page, 'the bag')
  // The same spelling, a second record, and no conflict block anywhere: both collect the line.
  await expect(page.locator('[data-alias-taken]')).toHaveCount(0)
  await expect(page.locator('[data-evidence-count]')).toHaveAttribute('data-evidence-count', '2')
  await page.locator('[data-drawer-cancel]').click()
  await page.waitForURL(/\/props$/)
  await expect(page.locator('[data-prop-count]')).toHaveText('3')
})

test('the drawer authors the record; the sidebar groups by category and the widget counts', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(propsUrl)
  await openDrawer(page, 'Game Ball')
  await page.locator('[data-status="sourced"]').click()
  await page.locator('[data-field="description"]').fill('Match ball, deflating. Two needed.')
  await page.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/props$/)
  await saved(page)

  await page.reload()
  await expect(card(page, 'Game Ball')).toHaveAttribute('data-status', 'sourced')
  await expect(card(page, 'Game Ball')).toContainText('Hand prop')
  // Grouped by category, alphabetically: Hand prop, then Set dressing.
  await expect(page.locator('[data-prop-group]')).toHaveCount(2)
  await expect(page.locator('[data-prop-group="Hand prop"]')).toBeVisible()
  await expect(page.locator('[data-prop-group="Set dressing"]')).toBeVisible()
  await expect(page.locator('[data-sourced-count]')).toHaveText('1 of 3')
  await expect(page.locator('[data-on-page-count]')).toHaveText('3 of 3')

  // The category field offers what the project already uses, and takes anything.
  await openDrawer(page, 'Kit Bag')
  const list = page.locator('#prop-categories option')
  await expect(list).toHaveCount(2)
  await page.locator('[data-field="category"]').fill('Picture vehicle')
  await page.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/props$/)
  await saved(page)
  await page.reload()
  await expect(page.locator('[data-prop-group="Picture vehicle"]')).toBeVisible()
})

test('a rename changes the record and not one word of the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  const before = await page.locator('[data-editor] [data-node-type="action"]').first().innerText()

  await page.goto(propsUrl)
  await openDrawer(page, 'Game Ball')
  await page.locator('[data-field="name"]').fill('Match Ball')
  await page.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/props$/)
  await saved(page)
  await page.reload()
  await expect(card(page, 'Match Ball')).toBeVisible()

  // The spelling that *was* the name went with it; the one the page uses stayed.
  await openDrawer(page, 'Match Ball')
  await expect(page.locator('[data-alias-row="Match Ball"]')).toBeVisible()
  await expect(page.locator('[data-alias-row="Game Ball"]')).toHaveCount(0)
  await expect(page.locator('[data-alias-row="the ball"]')).toBeVisible()
  await expect(page.locator('[data-evidence-count]')).toHaveAttribute('data-evidence-count', '4')
  await page.locator('[data-drawer-cancel]').click()

  // And the script is untouched - a prop rename is not a write-back.
  await page.goto(scriptUrl)
  await expect(page.locator('[data-editor] [data-node-type="action"]').first()).toHaveText(before)
})

test('both views, both themes; the filter narrows both and the list sorts each way', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(propsUrl)
  const main = page.locator('main[data-route="props"]')
  const tabs = page.locator('[data-writing-header] [data-view-pill] [data-view-tab]')

  await expect(page.locator('[data-props-grid] [data-prop-card]')).toHaveCount(3)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/props-overview-${theme}.png`, fullPage: false })
  }

  await tabs.nth(1).click()
  await expect(main).toHaveAttribute('data-sub-view', 'list')
  // The URL never moved - the views are state.
  await expect(page).toHaveURL(new RegExp(`${escape(propsUrl)}$`))
  await expect(page.locator('[data-prop-listrow]')).toHaveCount(3)
  const names = page.locator('[data-prop-listrow] [data-listrow-link]')
  await expect(names.first()).toContainText('Kit Bag')
  await page.locator('[data-sort-by="name"]').click()
  await expect(page.locator('[data-sort-by="name"]')).toHaveAttribute('data-sort-direction', 'descending')
  await expect(names.first()).toContainText("Meera's bag")
  await page.locator('[data-sort-by="category"]').click()
  await expect(page.locator('[data-sort-by="category"]')).toHaveAttribute('data-sort-direction', 'ascending')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/props-list-${theme}.png`, fullPage: false })
  }

  // The filter narrows the list, and the same filter narrows the grid.
  await page.locator('[data-display-menu]').click()
  await page.locator('[data-filter-option="sourced"]').click()
  await expect(page.locator('[data-prop-count]')).toHaveText('1 of 3')
  await expect(page.locator('[data-prop-listrow]')).toHaveCount(1)
  await tabs.first().click()
  await expect(page.locator('[data-props-grid] [data-prop-card]')).toHaveCount(1)
  await page.locator('[data-display-menu]').click()
  await page.locator('[data-filter-option="all"]').click()
  await expect(page.locator('[data-prop-count]')).toHaveText('3')
})

test('Production picks a prop from the table - which could not be done at all before this route', async ({ page, account }) => {
  await signIn(page, account)
  const productionUrl = scriptUrl.replace(/\/script$/, '/production')
  await page.goto(productionUrl)
  await expect(page.locator('main[data-route="production"]')).toBeVisible({ timeout: 60_000 })

  // A scene with a reel and a shot; open the shot drawer and its Prop row.
  const shot = page.locator('[data-shot-card]').first()
  if ((await shot.count()) === 0) test.skip(true, 'The walk project has no shot to hang a prop on.')
  await shot.click()
  await expect(page.locator('[data-shot-drawer]')).toBeVisible()
  const propRow = page.locator('[data-drawer-row="prop"]')
  await expect(propRow).toBeVisible()
  await expect(propRow).toContainText('No prop')
  await propRow.click()
  // The menu's vocabulary is the props table - it was always empty before `0030`.
  const menu = page.locator('[role="menu"]')
  await expect(menu).toContainText('Match Ball')
  await menu.getByText('Match Ball', { exact: true }).click()
  await expect(propRow).toContainText('Match Ball')

  // And Props reads it back: the record knows what needs it.
  await page.goto(propsUrl)
  await openDrawer(page, 'Match Ball')
  await expect(page.locator('[data-drawer-needed]')).toContainText('Needed for 1 shot')
})
