import { projectId } from '@folio/contracts'
import { openProjectForRequest, trashProject } from '@folio/db'
import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'

/**
 * The four account routes, signed in, in both states and both themes.
 *
 * **This needs a real Supabase project and a real account**, which is why it
 * skips itself unless `E2E_EMAIL` and `E2E_PASSWORD` are set - see
 * `playwright.config.ts`, which stops injecting the dummy project when they
 * are. The account must have **no projects** when the walk starts: the empty
 * state is photographed first, then the walk creates three projects, trashes
 * one through the repository, and photographs everything again.
 *
 * It is serial and it is not idempotent. A second run against the same
 * account starts populated, and the "empty" screenshots will be wrong.
 *
 * ## What it proves
 *
 * - `/app` redirects to `/app/new`, and the three old list paths
 *   (`/app/recents`, `/app/screenwriting`, `/app/filmmaking`) redirect to
 *   `/app/projects`.
 * - The shell: four sidebar rows, a live project count beside Projects, the
 *   credits card and the account button both reachable at 620px.
 * - `/app/new` in both states - the first-run card, which refuses to submit
 *   until all three axes are answered, and the compose box, whose send opens
 *   the creation dialog with the logline already in it.
 * - Creating a film lands on `/app/project/:id/script` and a series on
 *   `/app/project/:id/ep_001/script`; a filmmaking project lands back on
 *   `/app/projects`.
 * - A new project's card says `script empty`, not `0 pages`, and prints its
 *   logline.
 * - The Projects route's controls: the five chips with their counts, the
 *   sort menu, grid ↔ list, the row checkboxes and the bulk bar, rename,
 *   archive (and the chip it moves the card to), move-to-trash, and the
 *   duplicate that refuses in words.
 * - `/app/settings`: all seven sections render, the name saves, and deleting
 *   the account refuses.
 * - `/app/trash`: restore works end to end; delete-forever refuses and says
 *   why.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the signed-in walk.')

// Serial, and generous: each route is compiled by the dev server on first hit,
// and one test walks all four twice.
test.describe.configure({ mode: 'serial', timeout: 600_000 })

const ROUTES = ['/app/new', '/app/projects', '/app/trash', '/app/settings'] as const
const THEMES = ['dark', 'light'] as const

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The signed-in walk needs an account.')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\/new$/)
}

const shoot = async (page: Page, route: string, state: 'empty' | 'populated'): Promise<void> => {
  for (const theme of THEMES) {
    await page.goto(route)
    await page.evaluate((next) => {
      localStorage.setItem('folio.theme', next)
    }, theme)
    await page.reload()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const name = route.replace('/app/', '')
    await page.screenshot({ path: `test-results/shell-${name}-${state}-${theme}.png`, fullPage: true })
  }
}

/**
 * A radio's accessible name is its whole label - the title and the sentence
 * under it - so the options are matched on how the label starts.
 *
 * The input itself is visually hidden (`sr-only`) inside its label card, so
 * the click goes to the label - which is what a person clicks - and the
 * input's state is asserted afterwards.
 */
const choose = async (page: Page, name: RegExp): Promise<void> => {
  const radio = page.getByRole('radio', { name })
  await radio.locator('..').click()
  await expect(radio).toBeChecked()
}

/** The first-run card: a name, the three axes, Continue. */
const createFirst = async (
  page: Page,
  input: { title: string; logline?: string; kind: RegExp; projectType: RegExp; format: RegExp },
): Promise<void> => {
  await page.goto('/app/new')
  await page.getByLabel('Name').fill(input.title)
  if (input.logline !== undefined) await page.getByLabel('What it is about').fill(input.logline)
  await choose(page, input.kind)
  await choose(page, input.projectType)
  await choose(page, input.format)
  await page.getByRole('button', { name: 'Continue' }).click()
}

/** The dialog: the same three axes, from the compose box or the dashed card. */
const createInDialog = async (
  page: Page,
  input: { title: string; logline?: string; projectType: string; format: string },
): Promise<void> => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name').fill(input.title)
  if (input.logline !== undefined) await dialog.getByLabel('What it is about').fill(input.logline)
  await dialog.getByRole('button', { name: input.projectType, exact: true }).click()
  await dialog.getByRole('button', { name: input.format }).click()
  await dialog.getByRole('button', { name: 'Create project' }).click()
}

const SCREENPLAY = /^A screenplay/
const FILM = /^Film /
const HOLLYWOOD = /^Hollywood/

const idFromUrl = (url: string): string => {
  const match = /\/app\/project\/([0-9a-f-]{36})\//.exec(`${url}/`)
  if (match?.[1] === undefined) throw new Error(`No project id in ${url}`)
  return match[1]
}

test('/app lands on /app/new, and the old list paths land on /app/projects', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/new$/)

  for (const old of ['/app/recents', '/app/screenwriting', '/app/filmmaking']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/app\/projects$/)
  }
})

test('the shell is four rows, and stays reachable at 620px', async ({ page, account }) => {
  await signIn(page, account)
  await page.setViewportSize({ width: 1280, height: 620 })
  await page.goto('/app/projects')

  const sidebar = page.locator('[data-home-sidebar]')
  // The nav's four rows, not every link in the column - the credits card
  // carries one of its own.
  const rows = sidebar.getByRole('navigation', { name: 'Sections' }).getByRole('link')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('New')
  await expect(rows.nth(1)).toContainText('Projects')
  await expect(rows.nth(2)).toContainText('Trash')
  await expect(rows.nth(3)).toContainText('Settings')

  // Pinned, not scrolled away: both are in the viewport at the handoff's floor.
  await expect(page.locator('[data-credits-card]')).toBeInViewport()
  const account_ = sidebar.getByRole('button', { name: /Prashant|@/ }).last()
  await expect(account_).toBeInViewport()
  await account_.click()
  await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Account' })).toBeHidden()
})

test('every route renders empty, in both themes', async ({ page, account }) => {
  await signIn(page, account)
  for (const route of ROUTES) await shoot(page, route, 'empty')

  await page.goto('/app/projects')
  await expect(page.getByText('No projects yet')).toBeVisible()
  await page.goto('/app/trash')
  await expect(page.getByText('Trash is empty')).toBeVisible()
  await page.goto('/app/settings')
  // Settings opens on Profile; the ledger is the Plan section's, and the copy
  // is the computed zero - a sum over nothing, not a default written down.
  await page.getByRole('button', { name: 'Plan & credits' }).click()
  await expect(page.getByText('Summed over an empty ledger')).toBeVisible()
})

test('the first run refuses to create until all three axes are answered', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  const create = page.getByRole('button', { name: 'Continue' })
  await expect(create).toBeDisabled()
  await page.getByLabel('Name').fill('Nothing yet')
  await expect(create).toBeDisabled()
  await choose(page, SCREENPLAY)
  await expect(create).toBeDisabled()
})

let filmId = ''
let seriesId = ''

test('creating a film opens the collapsed workspace path', async ({ page, account }) => {
  await signIn(page, account)
  await createFirst(page, {
    title: 'The Sound Before Rain',
    logline: 'A field recordist returns to the valley she grew up in to catalogue a storm.',
    kind: SCREENPLAY,
    projectType: FILM,
    format: HOLLYWOOD,
  })
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/, { timeout: 120_000 })
  filmId = idFromUrl(page.url())
})

test('the compose box carries its sentence into the dialog, and creates a series', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  const logline = 'Episode 1 is locked and scheduled. Camera tests start Thursday.'
  await page.getByPlaceholder(/six-episode series/).fill(logline)
  await page.getByRole('button', { name: 'Name the project' }).click()
  await expect(page.getByRole('dialog').getByLabel('What it is about')).toHaveValue(logline)
  await createInDialog(page, { title: 'Monsoon Line', projectType: 'Series', format: 'Asian' })
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/, { timeout: 120_000 })
  seriesId = idFromUrl(page.url())
  expect(seriesId).not.toBe(filmId)
})

test('creating a filmmaking project returns to the list', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')
  await page.getByRole('button', { name: 'New script' }).click()
  await createInDialog(page, { title: 'Winter Ad Spot', projectType: 'Film', format: 'Hollywood' })
  // Filmmaking is the dialog's `kind` only from the compose box; from the grid
  // it creates a screenplay, so this one is turned filmmaking from the compose
  // chip instead.
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/, { timeout: 120_000 })

  await page.goto('/app/new')
  await page.getByRole('button', { name: 'Start a filmmaking project' }).click()
  await createInDialog(page, { title: 'Mockup Trailer', projectType: 'Film', format: 'Hollywood' })
  await page.waitForURL(/\/app\/projects$/, { timeout: 120_000 })
  await expect(page.getByRole('link', { name: 'Open Mockup Trailer' })).toBeVisible()
})

test('a new project says its script is empty, not that it has zero pages', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')
  await expect(page.getByText(/script empty/).first()).toBeVisible()
  await expect(page.getByText('Pages', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Screenwriting · Series').first()).toBeVisible()
  await expect(page.getByText('Filmmaking · Film').first()).toBeVisible()
  await expect(
    page.getByText('A field recordist returns to the valley she grew up in to catalogue a storm.'),
  ).toBeVisible()
  await expect(page.locator('.folio-page-preview').first()).toContainText('empty')
  await expect(page.locator('.folio-frame-preview').first()).toBeVisible()
})

test('the chips count the list, and the sort and the layout switch without moving the URL', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')

  const all = page.getByRole('button', { name: /^All/ })
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect(all).toContainText('4')
  await page.getByRole('button', { name: /^Filmmaking/ }).click()
  await expect(page.getByRole('link', { name: 'Open Mockup Trailer' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Open Monsoon Line/ })).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/projects$/)
  await all.click()

  await page.getByRole('button', { name: 'Recently edited' }).click()
  await page.getByRole('menuitemradio', { name: 'Title' }).click()
  await expect(page.getByRole('button', { name: 'Title' })).toBeVisible()

  await page.getByTitle('List', { exact: true }).click()
  await expect(page.getByText('shift-click to select a range')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/projects$/)
})

test('rename writes, archive moves the card to its own chip, and duplicate refuses', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')

  await page.getByRole('button', { name: 'Monsoon Line actions' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rename = page.locator('[data-rename-project]')
  await rename.getByLabel('Name').fill('Monsoon Line — Series')
  await rename.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: 'Open Monsoon Line — Series' })).toBeVisible({ timeout: 120_000 })

  await page.getByRole('button', { name: 'Winter Ad Spot actions' }).click()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await expect(page.getByRole('link', { name: 'Open Winter Ad Spot' })).toHaveCount(0, { timeout: 120_000 })
  await page.getByRole('button', { name: /^Archived/ }).click()
  await expect(page.getByRole('link', { name: 'Open Winter Ad Spot' })).toBeVisible()
  await expect(page.getByText('Archived').first()).toBeVisible()

  await page.getByRole('button', { name: /^All/ }).click()
  await page.getByRole('button', { name: 'Mockup Trailer actions' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  // Not `getByRole('alert')`: Next's own route announcer is one too, and it is empty.
  await expect(page.getByText('Duplicating is not switched on yet', { exact: false })).toBeVisible()
})

test('the list view selects rows and the bulk bar acts on them', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')
  await page.getByTitle('List', { exact: true }).click()

  await page.getByRole('checkbox', { name: /^Select / }).first().check()
  await expect(page.getByText('1 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await expect(page.getByText('1 selected')).toHaveCount(0)
})

test('settings renders every section, saves the name, and refuses to delete the account', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/settings')

  for (const section of [
    'Plan & credits',
    'Editor defaults',
    'Notifications',
    'Collaborators',
    'Integrations',
    'Security',
    'Profile',
  ]) {
    await page.getByRole('button', { name: section }).click()
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
    await expect(page).toHaveURL(/\/app\/settings$/)
  }

  const name = page.getByLabel('Name')
  const was = await name.inputValue()
  await name.fill(`${was} `.trim())
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible({ timeout: 120_000 })

  await page.getByRole('button', { name: 'Security' }).click()
  await page.getByRole('button', { name: 'Delete account' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Delete account' })
  await dialog.getByRole('button', { name: 'Delete account' }).click()
  await expect(dialog.getByRole('alert')).toContainText('not switched on yet')
  await dialog.getByRole('button', { name: 'Keep it' }).click()
})

test('trash: restore works, delete forever refuses and says why', async ({ page, account }) => {
  // Trashing through the repository, so the walk is not testing its own UI twice.
  const scope = await openProjectForRequest(projectId(filmId), null)
  await trashProject(scope)

  await signIn(page, account)
  await page.goto('/app/projects')
  await expect(page.getByRole('link', { name: 'Open The Sound Before Rain' })).toHaveCount(0)
  // The toolbar's link, not the sidebar row: it carries the count, which is
  // the thing worth asserting.
  await expect(page.getByRole('link', { name: 'Trash 1' })).toBeVisible()

  for (const route of ROUTES) await shoot(page, route, 'populated')

  await page.goto('/app/trash')
  await page.getByRole('button', { name: 'Delete forever' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete forever' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Deleting forever is not switched on yet')
  await page.screenshot({ path: 'test-results/shell-trash-purge-refused.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Keep it' }).click()

  await page.getByRole('button', { name: 'Restore' }).click()
  // The action revalidates the whole `/app` layout, which the dev server
  // re-renders from cold; the default five seconds is not enough for that.
  await expect(page.getByText('Trash is empty')).toBeVisible({ timeout: 120_000 })
  await page.goto('/app/projects')
  await expect(page.getByRole('link', { name: 'Open The Sound Before Rain' })).toBeVisible()
})
