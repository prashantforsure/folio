import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'

/**
 * The app-wide assistant panel (roadmap task 2.2), walked in a browser.
 *
 * What this proves, in order:
 *
 *   1. **Outside a project the panel is the launcher** (ADR 0003 D15): `⌘J`
 *      opens it on `/app/projects`, it lists recent projects as links and
 *      draws `Start from a story` disabled, and it has no composer - the
 *      launcher runs no model turn in Phase 2 (ruled 2026-09-23).
 *   2. **The panel survives navigation between routes.** Opened on Script with
 *      a draft typed, it is the same element after a client-side move to
 *      Characters and to Timeline through the rail - never re-mounted - and the
 *      draft is still in the composer.
 *   3. **And between projects.** Across a full load of a second project and
 *      back to the first, the draft and the open chat come back from the
 *      session store; with the assistant connected, the question asked on the
 *      first project and its answer are on screen again.
 *
 * The conversation half of 3 needs `ANTHROPIC_API_KEY` on the server; without
 * it the composer is disabled with its reason, and the walk proves the rest.
 * Needs a real account; skips without one. Leaves two projects behind per run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
  productionUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the assistant panel walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

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

/** A film, so the script URL has no episode segment and the chat key is the one episode. */
const createFilm = async (page: Page, title: string): Promise<string> => {
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(title)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Film/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/)
  return page.url()
}

const panel = (page: Page) => page.locator('[data-assistant-panel]:not([data-assistant-launcher])')

const openWithShortcut = async (page: Page): Promise<void> => {
  await page.keyboard.press('ControlOrMeta+j')
}

let first = ''
let second = ''

test('outside a project the panel is the launcher', async ({ page, account }) => {
  await signIn(page, account)
  const stamp = new Date().toISOString()
  first = await createFilm(page, `Assistant walk A ${stamp}`)
  second = await createFilm(page, `Assistant walk B ${stamp}`)

  await page.goto('/app/projects')
  await openWithShortcut(page)
  const launcher = page.locator('[data-assistant-launcher]')
  await expect(launcher).toBeVisible()
  await expect(launcher.locator('[data-launcher-project]').first()).toBeVisible()
  await expect(launcher.locator('[data-launcher-story]')).toBeDisabled()
  await expect(launcher.getByLabel('Ask the assistant')).toHaveCount(0)
  // Opening a project from the launcher is a plain link to its front door.
  await launcher.locator('[data-launcher-project]').first().click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/)
  await expect(page.locator('[data-assistant-launcher]')).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
})

test('the panel and its draft survive a move between routes, un-remounted', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(first)
  await expect(page.locator('[data-project-shell]')).toBeVisible()
  if (!(await panel(page).isVisible())) await openWithShortcut(page)
  await expect(panel(page)).toBeVisible()

  // Tag the element: a re-mount would draw a new one without the tag.
  await panel(page).evaluate((element) => {
    element.setAttribute('data-walk-tag', 'kept')
  })
  const composer = panel(page).getByLabel('Ask the assistant')
  const connected = (await page.locator('[data-assistant-disconnected]').count()) === 0
  if (connected) await composer.fill('Which scene opens the film?')

  await page.locator('[data-rail-item="characters"]').click()
  await page.waitForURL(/\/characters$/)
  await expect(panel(page)).toHaveAttribute('data-walk-tag', 'kept')
  await page.locator('[data-rail-item="timeline"]').click()
  await page.waitForURL(/\/timeline$/)
  await expect(panel(page)).toHaveAttribute('data-walk-tag', 'kept')
  if (connected) await expect(panel(page).getByLabel('Ask the assistant')).toHaveValue('Which scene opens the film?')

  // Closing hides; it does not unmount.
  await panel(page).getByRole('button', { name: 'Close the assistant' }).click()
  await expect(panel(page)).toBeHidden()
  await expect(panel(page)).toHaveAttribute('data-walk-tag', 'kept')
  await openWithShortcut(page)
  await expect(panel(page)).toBeVisible()
})

test('the conversation survives a move to another project and back', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(first)
  if (!(await panel(page).isVisible())) await openWithShortcut(page)
  await expect(panel(page)).toBeVisible()

  const connected = (await page.locator('[data-assistant-disconnected]').count()) === 0
  test.info().annotations.push({ type: 'assistant', description: connected ? 'connected' : 'not connected - conversation half skipped' })
  const question = `Say only the word harbour. ${new Date().toISOString()}`
  if (connected) {
    await panel(page).getByLabel('Ask the assistant').fill(question)
    await panel(page).getByRole('button', { name: 'Send' }).click()
    await expect(panel(page).locator('[data-turn="user"]').last()).toHaveText(question)
    await expect(panel(page).locator('[data-turn="assistant"]').last()).not.toHaveText('', { timeout: 120_000 })
    await expect(panel(page).getByLabel('Ask the assistant')).toBeEnabled({ timeout: 120_000 })
  }
  await panel(page).getByLabel('Ask the assistant').fill('an unsent thought').catch(() => undefined)

  // Another project, a full load: its own empty chat, the same draft.
  await page.goto(second)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).locator('[data-turn="user"]')).toHaveCount(0)
  if (connected) await expect(panel(page).getByLabel('Ask the assistant')).toHaveValue('an unsent thought')

  // Back: the first project's chat is the one on screen again.
  await page.goto(first)
  await expect(panel(page)).toBeVisible()
  if (connected) await expect(panel(page).locator('[data-turn="user"]').first()).toHaveText(question)
})
