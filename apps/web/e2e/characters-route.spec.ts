import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The Characters route, walked in a browser against the real backend.
 *
 * What this proves, in order:
 *
 *   1. **The empty state, both themes.** No record; `?view=` outside
 *      `profile | map | resolve` is a 404.
 *   2. **Records come from cues through the alias table, and near-misses
 *      go to the queue, not to a record.** A script with `MEERA`, `MEERA
 *      (V.O.)`, `MEERA PAWAR`, `SURESH KADAM`, `SURESH`, `YOUNG MEERA` and
 *      `CLERK` derives three records - never a second Meera - and three
 *      queue rows with a proposal and a confidence each. The rail badge
 *      and the column's "Unmatched names" row are that count.
 *   3. **The queue is rows, and a decision persists.** Match binds a
 *      spelling; Walk-on rejects every candidate and the row leaves the
 *      badge for good, listed under Walk-ons; Other… mints a record.
 *   4. **The profile is authored on the record and survives a reload**:
 *      role, an arc turn with its unwritten flag and its scene, an alias
 *      bound by hand.
 *   5. **A record-level rename rewrites every cue and keeps the profile.**
 *      The Script route shows the new spelling on every cue that was the
 *      name; the modifier survives; the alias does not move; the role and
 *      the turn are still there.
 *   6. **Merge folds one record into another**, and the loser's spelling
 *      resolves to the winner. Delete refuses a record still in the script.
 *   7. **The map**, both themes.
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

/** Wait for the workspace to hydrate before clicking anything in it. */
const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-characters-header]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
}

const saved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 120_000 })
}

/** Edit an in-place field: click its button, type, Enter. */
const edit = async (page: Page, label: string, value: string): Promise<void> => {
  await page.getByRole('button', { name: label, exact: true }).click()
  const input = page.getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press('Enter')
}

let scriptUrl = ''
let charactersUrl = ''

test('empty state, both themes; a bad view is a 404', async ({ page, account }) => {
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
  await expect(main).toHaveAttribute('data-sub-view', 'profile')
  await expect(main).toHaveAttribute('data-characters-state', 'empty')
  await expect(main.getByText('No characters yet')).toBeVisible()
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('aside[data-context-column="characters"]')).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-empty-${theme}.png`, fullPage: false })
  }
  const bogus = await page.goto(`${charactersUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
  const notARecord = await page.goto(`${charactersUrl}/not-a-uuid`)
  expect(notARecord?.status()).toBe(404)
})

test('records come from cues; near-misses are queue rows, never a second Meera', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(scriptUrl)
  mkdirSync(test.info().outputDir, { recursive: true })
  const fountain = join(test.info().outputDir, 'walk.fountain')
  writeFileSync(fountain, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(fountain)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  await expect(page.locator('[data-nav-meta="scenes"]')).toHaveText('3', { timeout: 60_000 })

  await page.goto(charactersUrl)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-characters-state', 'profile')
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
  const rows = page.locator('[data-cast-row]')
  await expect(rows).toHaveCount(3)
  await expect(page.locator('[data-cast-group="supporting"]')).toContainText('MEERA')
  await expect(page.locator('[data-cast-group="supporting"]')).toContainText('SURESH KADAM')
  await expect(page.locator('[data-cast-group="supporting"]')).toContainText('CLERK')
  // Three cues with nowhere to point: the badge, the column row, the tab.
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('3')
  await expect(page.locator('[data-unmatched-row]')).toContainText('3')
  await expect(page.locator('[data-resolve-badge]')).toHaveText('3')

  // The first profile in nav order is Meera's: two spellings, two scenes -
  // the courtyard's `MEERA PAWAR` is still in the queue, so it is not hers yet.
  const profile = page.locator('[data-profile]')
  await expect(profile.getByRole('button', { name: 'Name', exact: true })).toHaveText('MEERA')
  await expect(profile.locator('[data-cue-chip="MEERA"]')).toContainText('× 2')
  await expect(profile.locator('[data-cue-chip="MEERA (V.O.)"]')).toContainText('× 1')
  await expect(page.locator('[data-fact="Scenes"]')).toContainText('2')
  await expect(page.locator('[data-fact="First seen"]')).toContainText('E1 Sc 1')
  await expect(page.locator('[data-fact="Last seen"]')).toContainText('E1 Sc 3')
  await expect(page.locator('[data-relationship]')).toHaveCount(2)
})

test('the queue is rows: Match binds, Walk-on is never asked again, Other… mints', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${charactersUrl}?view=resolve`)
  await ready(page)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'resolve')
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '3')

  const meeraPawar = page.locator('[data-resolve-row="MEERA PAWAR"]')
  await expect(meeraPawar).toContainText('MEERA')
  await expect(meeraPawar.locator('[data-confidence]')).toHaveText('likely')
  const youngMeera = page.locator('[data-resolve-row="YOUNG MEERA"]')
  await expect(youngMeera.locator('[data-confidence]')).toHaveText('possible')
  const suresh = page.locator('[data-resolve-row="SURESH"]')
  await expect(suresh).toContainText('SURESH KADAM')
  await expect(suresh.locator('[data-confidence]')).toHaveText('likely')

  // Match: MEERA PAWAR is Meera. The spelling binds; the row settles.
  await meeraPawar.locator('[data-resolve-match]').click()
  await saved(page)
  await expect(meeraPawar).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '2')
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('2')

  // Walk-on: YOUNG MEERA is nobody. The row leaves the badge and is listed as a walk-on.
  await youngMeera.locator('[data-resolve-walk-on]').click()
  await saved(page)
  await expect(youngMeera).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveText('1')
  await expect(page.locator('[data-cast-group="walk-ons"]')).toContainText('1 unnamed')
  await expect(page.locator('[data-cast-group="walk-ons"]')).toContainText('YOUNG MEERA')

  // Other…: SURESH is a new character, not Suresh Kadam.
  await suresh.locator('[data-resolve-other]').click()
  await suresh.getByLabel('Who SURESH is').selectOption('new-record')
  await suresh.locator('[data-resolve-other-confirm]').click()
  await saved(page)
  await expect(suresh).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-rail-badge="characters"]')).toHaveCount(0)
  await expect(page.locator('[data-cast-row]')).toHaveCount(4)
  await expect(page.locator('[data-cast-group="supporting"]')).toContainText('SURESH')

  // The decisions persist: a reload shows the same queue.
  await page.reload()
  await expect(page.locator('[data-resolve-count]')).toHaveAttribute('data-resolve-count', '0')
  await expect(page.locator('[data-cast-group="walk-ons"]')).toContainText('YOUNG MEERA')
})

test('the profile is authored on the record and survives a reload', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  const profile = page.locator('[data-profile]')
  await expect(profile.getByRole('button', { name: 'Name', exact: true })).toHaveText('MEERA')
  await expect(profile.locator('[data-cue-chip="MEERA PAWAR"]')).toContainText('× 1')
  // Matched in the queue, the courtyard scene is hers now.
  await expect(page.locator('[data-fact="Scenes"]')).toContainText('3')

  await edit(page, 'Role', 'Laundress, second floor')
  await saved(page)
  await edit(page, 'Wants', 'Water at six, like before.')
  await saved(page)

  // An arc turn: unwritten until it points at a scene.
  await page.locator('[data-add-turn]').fill('Opens the tank herself.')
  await page.locator('[data-add-turn]').press('Enter')
  await saved(page)
  const turn = page.locator('[data-arc-turn]')
  await expect(turn).toHaveCount(1, { timeout: 60_000 })
  await expect(turn.locator('[data-unwritten]')).toHaveText('not on the page')
  await turn.getByLabel('Scene').selectOption({ label: 'E1 Sc 2' })
  await saved(page)
  await expect(turn.locator('[data-unwritten]')).toHaveCount(0, { timeout: 60_000 })

  // An alias bound by hand: the Devanagari spelling is Meera, at × 0 until written.
  await page.locator('[data-add-alias]').click()
  await page.locator('[data-alias-input]').fill('मीरा')
  await page.locator('[data-alias-input]').press('Enter')
  await saved(page)
  await expect(profile.locator('[data-cue-chip="मीरा"]')).toContainText('× 0', { timeout: 60_000 })

  await page.reload()
  await expect(page.locator('[data-cast-row]').first()).toContainText('Laundress, second floor')
  await expect(page.getByRole('button', { name: 'Wants', exact: true })).toHaveText('Water at six, like before.')
  await expect(page.locator('[data-arc-turn]')).toContainText('Opens the tank herself.')
  await expect(page.locator('[data-arc-turn]').getByLabel('Scene')).toHaveValue(/./)
  await expect(page.locator('[data-cue-chip="मीरा"]')).toBeVisible()
})

test('a record-level rename rewrites every cue in the script and keeps the profile', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  await expect(page.locator('[data-profile]').getByRole('button', { name: 'Name', exact: true })).toHaveText('MEERA')

  await edit(page, 'Name', 'Meera Pawar')
  const confirm = page.locator('[data-rename-confirm]')
  await expect(confirm).toContainText('3 cues will be rewritten')
  await confirm.locator('[data-rename-everywhere]').click()
  await saved(page)
  await expect(page.locator('[data-renamed]')).toContainText('3 cues rewritten across 1 episode', { timeout: 120_000 })
  // The action's revalidation streams the re-read tree in after the result; give it the pooler's time.
  await expect(page.locator('[data-cast-row]').first()).toContainText('Meera Pawar', { timeout: 60_000 })
  // The profile came along; the alias the writer bound did not move.
  await expect(page.locator('[data-cast-row]').first()).toContainText('Laundress, second floor')
  await expect(page.locator('[data-cue-chip="MEERA PAWAR"]')).toContainText('× 3')
  await expect(page.locator('[data-cue-chip="MEERA PAWAR (V.O.)"]')).toContainText('× 1')
  await expect(page.locator('[data-cue-chip="मीरा"]')).toBeVisible()
  await expect(page.locator('[data-arc-turn]')).toContainText('Opens the tank herself.')

  // The script says so too: every cue that was the name, in document order,
  // and nothing else. The `(V.O.)` is a node attribute the sheet does not
  // print in the cue's text; the profile's `MEERA PAWAR (V.O.) × 1` above is
  // where it shows.
  await page.goto(scriptUrl)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  const cues = page.locator('[data-sheet] [data-node-id][data-type="character"]')
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
})

test('merge folds a record into another; delete refuses a record still in the script', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(charactersUrl)
  await ready(page)
  await page.locator('[data-cast-row]').filter({ has: page.getByText('SURESH', { exact: true }) }).click()
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}$/)
  await ready(page)
  await expect(page.locator('[data-profile]').getByRole('button', { name: 'Name', exact: true })).toHaveText('SURESH')
  await expect(page.locator('[data-delete-button]')).toBeDisabled()

  const loserUrl = page.url()
  await page.locator('[data-merge-button]').click()
  await page.locator('[data-merge-into]').selectOption({ label: 'SURESH KADAM' })
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  // The merge awaits a re-derive, then lands on the survivor's profile.
  await page.waitForURL((url) => url.toString() !== loserUrl && /\/characters\/[0-9a-f-]{36}$/.test(url.toString()), {
    timeout: 120_000,
  })
  await ready(page)
  await expect(page.locator('[data-profile]').getByRole('button', { name: 'Name', exact: true })).toHaveText('SURESH KADAM', {
    timeout: 60_000,
  })
  await expect(page.locator('[data-cue-chip="SURESH"]')).toContainText('× 1', { timeout: 60_000 })
  await expect(page.locator('[data-cast-row]')).toHaveCount(3)
  await expect(page.locator('[data-cast-count]')).toHaveText('3')
})

test('who meets whom, both themes', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`${charactersUrl}?view=map`)
  await expect(page.locator('main[data-route="characters"]')).toHaveAttribute('data-sub-view', 'map')
  await expect(page.locator('[data-map-row]')).toHaveCount(3)
  // Meera and Suresh Kadam share scene 1 and scene 2; Meera and the clerk share scene 3.
  const meera = page.locator('[data-map-row]', { hasText: 'Meera Pawar' })
  await expect(meera.locator('[data-map-cell]')).toHaveCount(2)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-map-${theme}.png`, fullPage: false })
  }
  await page.goto(charactersUrl)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/characters-profile-${theme}.png`, fullPage: false })
  }
})
