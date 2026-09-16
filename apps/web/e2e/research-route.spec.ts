import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'

/**
 * The Research route, walked in a browser against the real backend -
 * `docs/ui design/Route - Research v2.dc.html` as built.
 *
 * What this proves, in order:
 *
 *   1. **The shell, both themes, and the empty card.** The sidebar card
 *      with `Collections` and the `Clips filed` widget; the header without
 *      the Write / Storyboard pill and with `Research` as its crumb; the
 *      toolbar's Library | Source | Clips pill over `?view=`; the 28px
 *      status bar reading `research`; `Nothing in research yet` as the one
 *      440px card; `?view=grid` is a 404; `?view=source` with no source
 *      lands back on the library.
 *   2. **Adding a source is the drawer; the library is cards; a source is
 *      a page.** `＋ Add source` opens `Add source`; a title, a kind, a new
 *      collection and a body save; the router lands on `/research/<id>`
 *      with the title, the `Interview · Chawl life` line and the body; the
 *      sidebar lists the collection with a count of 1; the library card
 *      shows the kind badge, the collection pill and no clip count.
 *   3. **Highlighting a line is a clip; a clip is filed and unfiled.** A
 *      selection over a line shows `Clip this line`; pressing it washes
 *      the line, counts `❝ 1 clip` and `0 / 1` on the widget; the clips
 *      view lists it with `Send to…`; the drawer's clip list says `Not
 *      filed yet`; `Remove clip` from the mark's menu takes it back to
 *      zero. (Filing needs a scene, a character or a location and this
 *      walk writes no script, so the menu's empty copy is what it checks.)
 *   4. **Delete takes the source, its clips and its empty collection.**
 *      The drawer's `Delete` asks, then the library is the empty card again
 *      and the collection row is gone.
 *
 * Needs a real account; skips without one. Leaves one project behind per
 * run.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
  scriptProjectUrl: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the Research walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const BODY = [
  'We used to get water at six. Six to seven-thirty, if the pressure came.',
  "When it stopped, the tanker started. The tanker doesn't wait. If you're not down by the time the horn goes, that's your morning gone.",
].join('\n')

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

const waitSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-status-bar] [data-save-state]')).toHaveAttribute('data-save-state', 'saved', { timeout: 60_000 })
}

let researchUrl = ''
let sourceUrl = ''

test('the shell in both themes; nothing in research is one card; a bad view is a 404', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(`Research walk ${new Date().toISOString()}`)
  await choose(page, /^Screenwriting/)
  await choose(page, /^Series/)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  researchUrl = page.url().replace(/\/ep_001\/script$/, '/research')

  await page.goto(researchUrl)
  const main = page.locator('main[data-route="research"]')
  await expect(main).toHaveAttribute('data-sub-view', 'library')
  await expect(main).toHaveAttribute('data-research-state', 'empty')
  await expect(page.locator('[data-empty-research]').getByText('Nothing in research yet')).toBeVisible()
  // The shell: the sidebar card with this route's slots, the header without the mode pill, the crumb, the status bar.
  const card = page.locator('aside[data-sidebar]')
  await expect(card).toBeVisible()
  expect(await card.evaluate((el) => el.getBoundingClientRect().width)).toBe(236)
  await expect(card.locator('[data-collections-group]')).toBeVisible()
  await expect(card.locator('[data-collections-empty]')).toBeVisible()
  await expect(card.locator('[data-filed-card] [data-filed-count]')).toHaveText('0 / 0')
  await expect(page.locator('[data-research-find]')).toHaveCount(0)
  await expect(page.locator('[data-mode-pill]')).toHaveCount(0)
  await expect(page.locator('[data-route-crumb]')).toHaveText('Research')
  await expect(page.locator('[data-research-count]')).toHaveText('0 sources')
  await expect(page.locator('[data-status-bar] [data-route-id]')).toHaveText('research')
  await expect(page.locator('[data-status-bar] [data-status-left]')).toContainText('research empty')
  await expect(page.locator('[data-view-pill][data-shape="text"] [data-view-tab="library"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('nav[data-rail] [data-rail-item][aria-current="page"]')).toHaveAttribute('data-rail-item', 'research')
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/research-empty-${theme}.png`, fullPage: false })
  }
  await page.goto(`${researchUrl}?view=clips`)
  await expect(main).toHaveAttribute('data-sub-view', 'clips')
  await expect(page.locator('[data-view-tab="clips"]')).toHaveAttribute('aria-current', 'page')
  await page.goto(`${researchUrl}?view=source`)
  await expect(page).toHaveURL(new RegExp(`${researchUrl}$`))
  const bogus = await page.goto(`${researchUrl}?view=grid`)
  expect(bogus?.status()).toBe(404)
})

test('adding a source is the drawer; the library is cards; a source is a page', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(researchUrl)
  await page.locator('[data-add-source]').click()
  const drawer = page.locator('[data-research-drawer]')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('Add source')).toBeVisible()
  await expect(drawer.locator('[data-drawer-meta]')).toHaveText('Not in the library yet')
  await drawer.locator('[data-field="title"]').fill('Sunita Pawar on the queue')
  await drawer.locator('[data-field="kind"] select').selectOption('interview')
  await drawer.locator('[data-field="collection"]').selectOption('new')
  await drawer.locator('[data-field="new-collection"]').fill('Chawl life')
  await drawer.locator('[data-field="origin"]').fill('Recorded 14 Aug')
  await drawer.locator('[data-field="note"]').fill('Marathi, translated by AR.')
  await drawer.locator('[data-field="body"]').fill(BODY)
  await drawer.locator('[data-drawer-save]').click()
  await page.waitForURL(/\/research\/[0-9a-f-]{36}$/)
  sourceUrl = page.url()

  const main = page.locator('main[data-route="research"]')
  await expect(main).toHaveAttribute('data-sub-view', 'source')
  await expect(page.locator('[data-source-title]')).toHaveText('Sunita Pawar on the queue')
  await expect(page.locator('[data-source-kind-line]')).toHaveText('Interview · Chawl life')
  await expect(page.locator('[data-source-byline]')).toHaveText('Marathi, translated by AR.')
  await expect(page.locator('[data-source-body] p')).toHaveCount(2)
  await expect(page.locator('[data-source-clip-count]')).toHaveText(/0 clips/)
  await expect(page.locator('[data-view-tab="source"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-status-bar] [data-route-id]')).toHaveText(/^research\/[0-9a-f-]{36}$/)
  // The sidebar: the collection with its count, the find field now drawn.
  const card = page.locator('aside[data-sidebar]')
  await expect(card.locator('[data-collections-count]')).toHaveText('1')
  await expect(card.locator('[data-collection-row]:not([data-collection-row="all"])')).toHaveText(/Chawl life\s*1/)
  await expect(page.locator('[data-research-find]')).toBeVisible()

  await page.locator('[data-back-to-library]').click()
  await page.waitForURL(new RegExp(`${researchUrl}$`))
  await expect(main).toHaveAttribute('data-research-state', 'library')
  const sourceCard = page.locator('[data-source-card]')
  await expect(sourceCard).toHaveCount(1)
  await expect(sourceCard.locator('[data-source-kind="interview"]')).toHaveText(/Interview/)
  await expect(sourceCard.getByText('Chawl life')).toBeVisible()
  await expect(sourceCard.locator('[data-card-clips]')).toHaveCount(0)
  await expect(page.locator('[data-research-count]')).toHaveText('1 source')
  await expect(page.locator('[data-status-bar] [data-status-left]')).toHaveText('1 source · 1 collection · 0 clips')
  // The type filter narrows the grid.
  await page.locator('[data-kind-filter]').click()
  await page.locator('[data-filter-option="article"]').click()
  await expect(page.locator('[data-source-card]')).toHaveCount(0)
  await expect(page.locator('[data-library-no-match]')).toBeVisible()
  await page.locator('[data-kind-filter]').click()
  await page.locator('[data-filter-option="all"]').click()
  await expect(page.locator('[data-source-card]')).toHaveCount(1)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `test-results/research-library-${theme}.png`, fullPage: false })
  }
})

test('highlighting a line is a clip; a clip is listed, counted and removed', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(sourceUrl)
  await expect(page.locator('[data-source-view]')).toHaveAttribute('data-mounted', 'true', { timeout: 60_000 })
  const body = page.locator('[data-source-body]')
  await expect(body).toBeVisible()
  // Select the first paragraph's text.
  await body.locator('p').first().evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  const clipThis = page.locator('[data-clip-this]')
  await expect(clipThis).toBeVisible()
  await clipThis.click()
  await waitSaved(page)
  const mark = page.locator('[data-clip-mark]')
  await expect(mark).toHaveCount(1, { timeout: 60_000 })
  await expect(mark).toHaveText('We used to get water at six. Six to seven-thirty, if the pressure came.')
  await expect(page.locator('[data-source-clip-count]')).toHaveText(/1 clip$/)
  await expect(page.locator('aside[data-sidebar] [data-filed-count]')).toHaveText('0 / 1')
  await expect(page.locator('aside[data-sidebar] [data-filed-note]')).toHaveText('1 clip not filed yet')
  await page.screenshot({ path: 'test-results/research-source-dark.png', fullPage: false })

  // The clips view lists it, unfiled.
  await page.locator('[data-all-clips]').click()
  await page.waitForURL(/\?view=clips$/)
  await expect(page.locator('[data-clip-card]')).toHaveCount(1)
  await expect(page.locator('[data-clip-source]')).toHaveText('Interview · Sunita Pawar on the queue')
  await expect(page.locator('[data-send-to]')).toBeVisible()
  await expect(page.locator('[data-research-count]')).toHaveText('1 clip')
  await page.locator('[data-send-to]').click()
  const menu = page.locator('[data-clip-menu]')
  await expect(menu).toBeVisible()
  // No script, no cast, no sets: nowhere to file it yet, and the menu says so.
  await expect(menu.locator('[data-clip-menu-empty]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // The drawer's clip list, from the source page.
  await page.goto(sourceUrl)
  await page.locator('[data-edit-source]').click()
  const drawer = page.locator('[data-research-drawer]')
  await expect(drawer.locator('[data-drawer-clip-count]')).toHaveText('1 clip')
  await expect(drawer.locator('[data-drawer-clip]').getByText('Not filed yet')).toBeVisible()
  await expect(drawer.locator('[data-drawer-meta]')).toHaveText(/^Interview · added /)
  await page.screenshot({ path: 'test-results/research-drawer-dark.png', fullPage: false })
  await drawer.locator('[data-drawer-cancel]').click()
  await expect(drawer).toHaveCount(0)

  // Remove the clip from the mark's menu.
  await page.locator('[data-clip-mark]').click()
  await page.locator('[data-clip-menu] [data-remove-clip]').click()
  await waitSaved(page)
  await expect(page.locator('[data-clip-mark]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-source-clip-count]')).toHaveText(/0 clips/)
  await expect(page.locator('aside[data-sidebar] [data-filed-count]')).toHaveText('0 / 0')
})

test('delete takes the source and its empty collection; the library is the empty card again', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(sourceUrl)
  await page.locator('[data-edit-source]').click()
  const drawer = page.locator('[data-research-drawer]')
  await drawer.locator('[data-drawer-delete]').click()
  await expect(drawer.getByText('Delete this source?')).toBeVisible()
  await drawer.locator('[data-delete-confirm]').click()
  await page.waitForURL(new RegExp(`${researchUrl}$`))
  await expect(page.locator('main[data-route="research"]')).toHaveAttribute('data-research-state', 'empty')
  await expect(page.locator('aside[data-sidebar] [data-collections-count]')).toHaveText('0')
  await expect(page.locator('aside[data-sidebar] [data-collections-empty]')).toBeVisible()
  const gone = await page.goto(sourceUrl)
  expect(gone?.status()).toBe(404)
})
