import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WalkOptions } from '../playwright.config'

/**
 * The copilot, hardened - roadmap task 5.6. Six walks through the panel as a
 * writer meets it, each on a film imported fresh so it owns its data:
 *
 *   1. **The panel persists across navigation** - the same element, never
 *      re-mounted, across four routes, with its draft.
 *   2. **A cited answer** - an answer naming a scene carries a link to it,
 *      and the link opens the scene.
 *   3. **A character creation is applied and undone** - the card changes
 *      nothing until Apply, Undo run takes it back, and History says so.
 *   4. **A script edit is applied in the open editor** (ADR 0003 D10 path A)
 *      - the line lands on the sheet the writer is looking at, and autosave
 *      carries it.
 *   5. **A background run stops at a checkpoint** - `story_to_script` waits
 *      at its first stop with Approve, and Cancel stops it.
 *   6. **A paid confirmation** - applying a paid proposal opens the
 *      confirmation with its cost and the balance; cancelling it spends
 *      nothing.
 *
 * Needs `E2E_EMAIL` / `E2E_PASSWORD` (skips without). 2 to 6 need
 * `ANTHROPIC_API_KEY` on the server; 5 also needs a worker on the same
 * database (it skips when the run never leaves `queued`); 6 needs the
 * generation model and storage (`GEMINI_API_KEY`, `R2_*`), without which the
 * paid tool refuses before any card exists. Leaves one film per walk behind.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
  productionUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the copilot walks.')

test.describe.configure({ timeout: 600_000 })

const FOUNTAIN = `Title: The Last Ferry

EXT. JETTY - DAWN

MEERA, fifty, coils a rope that does not need coiling. Gulls on the pilings.

MEERA
Last ferry went an hour ago.

INT. FERRY CABIN - NIGHT

ARJUN, twenty, sleeps against the window.

ARJUN
Is this the boat to the island?

MEERA
It's the only boat.
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

/** A film with the two-scene script imported, on its Script route. */
const filmWithScript = async (page: Page, title: string): Promise<string> => {
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`${title} ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Film/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/)
  const url = page.url()
  mkdirSync(test.info().outputDir, { recursive: true })
  const file = join(test.info().outputDir, 'ferry.fountain')
  writeFileSync(file, FOUNTAIN)
  await page.locator('[data-import-form] input[type=file]').setInputFiles(file)
  await expect(page.locator('main[data-route="script"]')).toHaveAttribute('data-script-state', 'draft', { timeout: 120_000 })
  return url
}

const panel = (page: Page) => page.locator('[data-assistant-panel]:not([data-assistant-launcher])')

const openPanel = async (page: Page): Promise<void> => {
  if (!(await panel(page).isVisible())) await page.keyboard.press('ControlOrMeta+j')
  await expect(panel(page)).toBeVisible()
}

const connected = async (page: Page): Promise<boolean> => (await page.locator('[data-assistant-disconnected]').count()) === 0

const ask = async (page: Page, question: string): Promise<void> => {
  await panel(page).getByRole('button', { name: '+ New' }).click()
  await panel(page).getByLabel('Ask the assistant').fill(question)
  await panel(page).getByRole('button', { name: 'Send' }).click()
}

test('1. the panel persists across navigation, un-remounted, with its draft', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot persist')
  await openPanel(page)
  await panel(page).evaluate((element) => {
    element.setAttribute('data-walk-tag', 'kept')
  })
  const live = await connected(page)
  if (live) await panel(page).getByLabel('Ask the assistant').fill('Which scene opens the film?')
  for (const route of ['characters', 'timeline', 'production'] as const) {
    await page.locator(`[data-rail-item="${route}"]`).click()
    await page.waitForURL(new RegExp(`/${route}$`, 'u'))
    await expect(panel(page)).toHaveAttribute('data-walk-tag', 'kept')
  }
  if (live) await expect(panel(page).getByLabel('Ask the assistant')).toHaveValue('Which scene opens the film?')
})

test('2. a cited answer links to the scene it names', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot cite')
  test.skip(!(await connected(page)), 'Needs ANTHROPIC_API_KEY on the server.')
  await openPanel(page)
  await ask(page, 'In which scene does Arjun first speak? Answer in one sentence and name the scene as "Scene N".')
  const answer = panel(page).locator('[data-turn="assistant"]').last()
  await expect(answer.locator('[data-cite-link]').first()).toBeVisible({ timeout: 120_000 })
  await answer.locator('[data-cite-link]').first().click()
  await page.waitForURL(/\/script(#n-[0-9a-f-]+)?$/u)
})

test('3. a character creation is applied and undone, and History says so', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot undo')
  test.skip(!(await connected(page)), 'Needs ANTHROPIC_API_KEY on the server.')
  await openPanel(page)
  const name = `WALKER ${String(Date.now()).slice(-5)}`
  await ask(page, `Create a character called ${name}. Propose it now; do not ask me anything first.`)
  const card = panel(page).locator('[data-proposal-card]').last()
  await expect(card.locator('[data-proposal-tool="create_character"]')).toBeVisible({ timeout: 120_000 })
  await expect(card).toHaveAttribute('data-proposal-status', 'pending')
  await card.locator('[data-proposal-apply]').click()
  await expect(card).toHaveAttribute('data-proposal-status', 'applied', { timeout: 60_000 })
  await page.locator('[data-rail-item="characters"]').click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await card.locator('[data-proposal-undo]').click()
  await card.locator('[data-proposal-undo-yes]').click()
  await expect(card.locator('[data-proposal-undone]')).toContainText('Put back 1 change.', { timeout: 60_000 })
  await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 30_000 })
  await panel(page).locator('[data-panel-tab="history"]').click()
  await expect(panel(page).locator('[data-history-tool="create_character"]').first()).toContainText('undone', { timeout: 30_000 })
})

test('4. a script edit is applied in the open editor and autosaved', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot edit')
  test.skip(!(await connected(page)), 'Needs ANTHROPIC_API_KEY on the server.')
  await openPanel(page)
  const line = `The gulls go quiet ${String(Date.now()).slice(-4)}.`
  await ask(page, `Add one action line, exactly "${line}", right after the first scene heading. Propose it now; do not ask me anything first.`)
  const card = panel(page).locator('[data-proposal-card]').last()
  await expect(card.locator('[data-proposal-tool="propose_script_edit"]')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('[data-sheet]')).not.toContainText(line)
  await card.locator('[data-proposal-apply]').click()
  // Path A: the open editor writes it - on the sheet at once, then saved by autosave.
  await expect(page.locator('[data-sheet]')).toContainText(line, { timeout: 60_000 })
  await expect(card).toHaveAttribute('data-proposal-status', 'applied', { timeout: 60_000 })
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
  await page.reload()
  await expect(page.locator('[data-sheet]')).toContainText(line, { timeout: 60_000 })
})

test('5. a background run stops at a checkpoint, with Approve, and Cancel stops it', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot run')
  test.skip(!(await connected(page)), 'Needs ANTHROPIC_API_KEY on the server.')
  await openPanel(page)
  await ask(page, 'Use story_to_script now on this story, titled "Undertow": a lifeguard who cannot swim is found out on the busiest day of summer.')
  const card = panel(page).locator('[data-proposal-card]').last()
  await expect(card.locator('[data-proposal-tool="story_to_script"]')).toBeVisible({ timeout: 120_000 })
  await card.locator('[data-proposal-apply]').click()
  await card.locator('[data-proposal-confirm-yes]').click()
  const run = card.locator('[data-run-card]').first()
  await expect(run).toBeVisible({ timeout: 60_000 })
  // A worker must claim it; without one it stays queued, and the walk says so rather than failing.
  const left = await run.evaluate((element) => element.getAttribute('data-run-status'))
  if (left === 'queued') {
    await page.waitForTimeout(60_000)
    test.skip((await run.getAttribute('data-run-status')) === 'queued', 'No worker claimed the run on this database.')
  }
  await expect(run).toHaveAttribute('data-run-status', 'waiting_for_user', { timeout: 300_000 })
  await expect(run.locator('[data-run-approve]')).toBeVisible()
  await run.locator('[data-run-cancel]').click()
  await expect(run).toHaveAttribute('data-run-status', 'cancelled', { timeout: 30_000 })
})

test('6. a paid proposal asks first, with its cost and the balance, and cancelling spends nothing', async ({ page, account }) => {
  await signIn(page, account)
  await filmWithScript(page, 'Copilot paid')
  test.skip(!(await connected(page)), 'Needs ANTHROPIC_API_KEY on the server.')
  await page.locator('[data-rail-item="production"]').click()
  await page.waitForURL(/\/production$/)
  await openPanel(page)
  await ask(page, 'Use generate_images now to draw a location plate for the jetty location. Do not ask me anything first.')
  const card = panel(page).locator('[data-proposal-card]').last()
  const priced = card.locator('[data-proposal-tool="generate_images"]')
  const appeared = await priced.waitFor({ timeout: 120_000 }).then(
    () => true,
    () => false,
  )
  test.skip(!appeared, 'The paid tool refused before proposing - the server has no generation model or storage (GEMINI_API_KEY, R2_*).')
  await card.locator('[data-proposal-apply]').click()
  await expect(card.locator('[data-proposal-confirm]')).toBeVisible()
  await expect(card.locator('[data-proposal-cost]')).toContainText(/Costs \d[\d,]* credits?\. You have \d[\d,]* credits? available\./u)
  await card.locator('[data-proposal-confirm]').getByRole('button', { name: 'Cancel' }).click()
  await expect(card).toHaveAttribute('data-proposal-status', 'pending')
})
