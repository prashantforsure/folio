import { projectId } from '@folio/contracts'
import { openProjectForRequest, trashProject } from '@folio/db'
import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'

/**
 * The six shell routes, signed in, in both states and both themes.
 *
 * **This needs a real Supabase project and a real account**, which is why it
 * skips itself unless `E2E_EMAIL` and `E2E_PASSWORD` are set - see
 * `playwright.config.ts`, which stops injecting the dummy project when they
 * are. The account must have **no projects** when the walk starts: the empty
 * state is photographed first, then the walk creates three projects, trashes
 * one through the repository (there is no trash button in this phase - that
 * is project settings, a later route), and photographs everything again.
 *
 * It is serial and it is not idempotent. A second run against the same account
 * starts populated, and the "empty" screenshots will be wrong. The report
 * says which account it was run against.
 *
 * ## What it proves
 *
 * - `/app` redirects to `/app/new`.
 * - Every route renders an `h1`, in both themes, with and without projects.
 * - Creating a film lands on `/app/project/:id/script` and a series on
 *   `/app/project/:id/ep_001/script` - the router hides the episode segment
 *   for a film, and both routes 404 because the workspace is not built.
 * - A filmmaking project lands back on `/app/filmmaking`.
 * - A new project's card says `Script empty`, not `0 pages`.
 * - Restore works end to end; delete-forever refuses and says why.
 *
 * The episode-row assertion - exactly one row per project - is a SQL query in
 * the phase report, not here: it is a claim about the database, and a browser
 * is the wrong instrument for it.
 */

/**
 * The account arrives as a Playwright option from `playwright.config.ts`, the
 * one test-runner file allowed to read `process.env`. `null` means the walk
 * is not configured and every test here skips.
 */
const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the signed-in walk.')

// Serial, and generous: each route is compiled by the dev server on first hit,
// and one test walks all six twice.
test.describe.configure({ mode: 'serial', timeout: 300_000 })

const ROUTES = ['/app/new', '/app/recents', '/app/screenwriting', '/app/filmmaking', '/app/trash', '/app/settings'] as const
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
 * under it - so the options are matched on how the label starts. `/^Film /`
 * with the space, because `Filmmaking` starts with `Film` too.
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

const create = async (
  page: Page,
  input: { title: string; kind: RegExp; projectType: RegExp; format: RegExp },
): Promise<void> => {
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(input.title)
  await choose(page, input.kind)
  await choose(page, input.projectType)
  await choose(page, input.format)
  await page.getByRole('button', { name: 'Create project' }).click()
}

const SCREENWRITING = /^Screenwriting/
const FILMMAKING = /^Filmmaking/
const FILM = /^Film /
const SERIES = /^Series/
const HOLLYWOOD = /^Hollywood/
const ASIAN = /^Asian/

const idFromUrl = (url: string): string => {
  const match = /\/app\/project\/([0-9a-f-]{36})\//.exec(`${url}/`)
  if (match?.[1] === undefined) throw new Error(`No project id in ${url}`)
  return match[1]
}

test('/app lands on /app/new', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/new$/)
})

test('every route renders empty, in both themes', async ({ page, account }) => {
  await signIn(page, account)
  for (const route of ROUTES) await shoot(page, route, 'empty')

  await page.goto('/app/recents')
  await expect(page.getByRole('heading', { level: 2, name: 'Nothing here yet' })).toBeVisible()
  await page.goto('/app/trash')
  await expect(page.getByRole('heading', { level: 2, name: 'Trash is empty' })).toBeVisible()
  await page.goto('/app/settings')
  await expect(page.getByText('Summed over an empty ledger')).toBeVisible()
})

let filmId = ''
let seriesId = ''

test('creating a film opens the collapsed workspace path', async ({ page, account }) => {
  await signIn(page, account)
  await create(page, { title: 'The Sound Before Rain', kind: SCREENWRITING, projectType: FILM, format: HOLLYWOOD })
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/)
  filmId = idFromUrl(page.url())
})

test('creating a series opens ep_001', async ({ page, account }) => {
  await signIn(page, account)
  await create(page, { title: 'Monsoon Line', kind: SCREENWRITING, projectType: SERIES, format: ASIAN })
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  seriesId = idFromUrl(page.url())
  expect(seriesId).not.toBe(filmId)
})

test('creating a filmmaking project returns to its list', async ({ page, account }) => {
  await signIn(page, account)
  await create(page, { title: 'Winter Ad Spot', kind: FILMMAKING, projectType: FILM, format: HOLLYWOOD })
  await page.waitForURL(/\/app\/filmmaking$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Winter Ad Spot' })).toBeVisible()
})

test('a new project says its script is empty, not that it has zero pages', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/recents')
  const cards = page.getByRole('link', { name: /Script empty/ })
  await expect(cards).toHaveCount(3)
  await expect(page.getByText('Pages', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Screenwriting · Series · A4')).toBeVisible()
  await expect(page.getByText('Screenwriting · Film · US Letter')).toBeVisible()
  await expect(page.getByText('Filmmaking · Film · US Letter')).toBeVisible()

  await page.goto('/app/screenwriting')
  await expect(page.getByRole('link', { name: /Script empty/ })).toHaveCount(2)
  await page.goto('/app/filmmaking')
  await expect(page.getByRole('link', { name: /Script empty/ })).toHaveCount(1)
})

test('trash: restore works, delete forever refuses and says why', async ({ page, account }) => {
  // Trashing is project settings, a later route; the repository is the door.
  const scope = await openProjectForRequest(projectId(filmId), null)
  await trashProject(scope)

  await signIn(page, account)
  await page.goto('/app/recents')
  await expect(page.getByRole('link', { name: /The Sound Before Rain/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Trash · 1/ })).toBeVisible()

  for (const route of ROUTES) await shoot(page, route, 'populated')

  await page.goto('/app/trash')
  await page.getByRole('button', { name: 'Delete forever' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete forever' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Deleting forever is not switched on yet')
  await page.screenshot({ path: 'test-results/shell-trash-purge-refused-light.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Keep it' }).click()

  await page.getByRole('button', { name: 'Restore' }).click()
  // The action revalidates the whole `/app` layout, which the dev server
  // re-renders from cold; the default five seconds is not enough for that.
  await expect(page.getByRole('heading', { level: 2, name: 'Trash is empty' })).toBeVisible({
    timeout: 90_000,
  })
  await page.goto('/app/recents')
  await expect(page.getByRole('link', { name: /The Sound Before Rain/ })).toBeVisible()
})

test('settings sums a computed zero across the projects', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/settings')
  await expect(page.getByText('Summed across 3 projects')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Monsoon Line' })).toBeVisible()
})
