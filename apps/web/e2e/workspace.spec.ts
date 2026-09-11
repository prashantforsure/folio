import { expect, test as base } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'
import {
  EMPTY_NAV_META,
  EPISODE_NAV_ORDER,
  EPISODE_NAV_WIDTH,
  RAIL_LABELS,
  RAIL_ORDER,
  THEMES,
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_COUNT,
} from './workspace-routes'

/**
 * The workspace smoke test. Walks the route tree in both themes.
 *
 * **This grows every phase.** The rows it walks are in `workspace-routes.ts`;
 * a later phase adds to a row what its route must show and the walk picks it
 * up. What this phase asserts, per AGENTS.md and the brief:
 *
 *   - the rail is eight items, in order, and its active state is both the
 *     2px bar at `left:-5px` and the `--sel` background;
 *   - Writing stays lit across all seven episode routes, Notes and Revisions
 *     included, and Production lights its own item;
 *   - the episode nav measures exactly 238px, in the order Script · Outline
 *     · Beats · Storyboard · Scenes · Revisions · Notes;
 *   - every nav meta on a new episode prints the empty convention;
 *   - every sub-view param resolves to its first value, and a value that is
 *     not a view is a 404;
 *   - an episode id of `characters` is rejected - so are `assets`, an unknown
 *     `ep_NNN` and a malformed segment;
 *   - a film routes without an episode segment and redirects an episode-shaped
 *     URL to the collapsed one; a series does the reverse;
 *   - `/app/project/:id` lands on the last opened episode.
 *
 * Needs a real account, like `shell-routes.spec.ts`; skips without one. It
 * creates its own projects with unique titles and never needs the account to
 * be empty, so it is re-runnable, though every run leaves two projects behind.
 * Serial, because the later tests navigate the projects the first one made.
 */

const test = base.extend<WalkOptions>({
  account: [null, { option: true }],
})

test.skip(({ account }) => account === null, 'Set E2E_EMAIL and E2E_PASSWORD to run the workspace walk.')

test.describe.configure({ mode: 'serial', timeout: 600_000 })

const signIn = async (page: Page, account: WalkOptions['account']): Promise<void> => {
  if (account === null) throw new Error('The workspace walk needs an account.')
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

const create = async (page: Page, title: string, projectType: RegExp): Promise<void> => {
  await page.goto('/app/new')
  await page.getByLabel('Title').fill(title)
  await choose(page, /^Screenwriting/)
  await choose(page, projectType)
  await choose(page, /^Hollywood/)
  await page.getByRole('button', { name: 'Create project' }).click()
}

const idFromUrl = (url: string): string => {
  const match = /\/app\/project\/([0-9a-f-]{36})\//.exec(`${url}/`)
  if (match?.[1] === undefined) throw new Error(`No project id in ${url}`)
  return match[1]
}

const setTheme = async (page: Page, theme: (typeof THEMES)[number]): Promise<void> => {
  await page.evaluate((next) => {
    localStorage.setItem('folio.theme', next)
  }, theme)
}

/**
 * The two halves of the active state, read from the cascade rather than
 * from a class name. A probe element painted with `var(--accent)` and one
 * with `var(--sel)` give the resolved colours to compare against, so the
 * assertion holds in either theme without knowing the palette.
 */
const activeState = async (item: Locator) =>
  item.evaluate((el) => {
    const probe = (variable: string) => {
      const span = document.createElement('span')
      span.style.background = `var(${variable})`
      document.body.append(span)
      const colour = getComputedStyle(span).backgroundColor
      span.remove()
      return colour
    }
    const bar = getComputedStyle(el, '::before')
    return {
      barWidth: bar.width,
      barLeft: bar.left,
      barColour: bar.backgroundColor,
      accent: probe('--accent'),
      background: getComputedStyle(el).backgroundColor,
      sel: probe('--sel'),
    }
  })

const expectRail = async (page: Page, active: string): Promise<void> => {
  const rail = page.locator('nav[data-rail]')
  await expect(rail).toHaveCSS('width', '66px')
  const items = rail.locator('a[data-rail-item]')
  await expect(items).toHaveCount(RAIL_ORDER.length)
  expect(await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-rail-item')))).toEqual(
    RAIL_ORDER,
  )
  expect(await items.evaluateAll((els) => els.map((el) => el.querySelector('.folio-nav-label')?.textContent))).toEqual(
    RAIL_LABELS,
  )

  const lit = rail.locator('a[aria-current="page"]')
  await expect(lit).toHaveCount(1)
  await expect(lit).toHaveAttribute('data-rail-item', active)

  const state = await activeState(lit)
  expect(state.barWidth).toBe('2px')
  expect(state.barLeft).toBe('-5px')
  expect(state.barColour).toBe(state.accent)
  expect(state.background).toBe(state.sel)

  // And the unlit ones carry neither half.
  const unlit = rail.locator('a[data-rail-item]:not([aria-current="page"])').first()
  const off = await activeState(unlit)
  expect(off.barWidth).not.toBe('2px')
  expect(off.background).not.toBe(off.sel)
}

const expectEpisodeNav = async (page: Page, activeRoute: string): Promise<void> => {
  const nav = page.locator('aside[data-episode-nav]')
  await expect(nav).toBeVisible()
  const width = await nav.evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBe(EPISODE_NAV_WIDTH)

  const rows = nav.locator('a[data-episode-route]')
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-episode-route')))).toEqual(
    EPISODE_NAV_ORDER,
  )
  await expect(nav.locator('a[data-episode-route][aria-current="page"]')).toHaveAttribute(
    'data-episode-route',
    activeRoute,
  )
  for (const [route, meta] of Object.entries(EMPTY_NAV_META)) {
    await expect(nav.locator(`[data-nav-meta="${route}"]`)).toHaveText(meta)
  }
  await expect(nav.getByText('Scenes appear here as you write headings. Nothing to list yet.')).toBeVisible()
}

const hrefFor = (projectId: string, episode: string | null, route: string, scope: 'episode' | 'project') =>
  scope === 'project' || episode === null
    ? `/app/project/${projectId}/${route}`
    : `/app/project/${projectId}/${episode}/${route}`

let seriesId = ''
let filmId = ''
const RUN = Date.now().toString(36)

test('the contract is fourteen routes', () => {
  expect(WORKSPACE_ROUTES).toHaveLength(WORKSPACE_ROUTE_COUNT)
  expect(WORKSPACE_ROUTES.filter((row) => row.scope === 'episode')).toHaveLength(8)
  expect(WORKSPACE_ROUTES.filter((row) => row.scope === 'project')).toHaveLength(6)
})

test('a series opens on ep_001/script and a film on /script', async ({ page, account }) => {
  await signIn(page, account)
  await create(page, `Monsoon Line ${RUN}`, /^Series/)
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/ep_001\/script$/)
  seriesId = idFromUrl(page.url())

  await create(page, `The Sound Before Rain ${RUN}`, /^Film /)
  await page.waitForURL(/\/app\/project\/[0-9a-f-]{36}\/script$/)
  filmId = idFromUrl(page.url())
  expect(filmId).not.toBe(seriesId)
})

test('＋ adds a second episode to the series and the board lists both', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_001/script`)
  await page.getByRole('button', { name: 'New episode' }).click()
  await page.waitForURL(new RegExp(`/app/project/${seriesId}/ep_002/script$`))
  const board = page.locator('[data-episode-board]')
  await expect(board.locator('a[data-board-episode]')).toHaveCount(2)
  await expect(board.locator('a[data-board-episode="ep_002"]')).toHaveAttribute('aria-current', 'page')
  await expect(board.getByText('E1')).toBeVisible()
  await expect(board.getByText('E2')).toBeVisible()
  await expect(board.getByRole('button', { name: /Episode board/ })).toContainText('2')
})

for (const theme of THEMES) {
  test(`walks all fourteen routes of a series, ${theme} theme`, async ({ page, account }) => {
    await signIn(page, account)
    await page.goto(`/app/project/${seriesId}/ep_001/script`)
    await setTheme(page, theme)

    for (const row of WORKSPACE_ROUTES) {
      const href = hrefFor(seriesId, 'ep_001', row.route, row.scope)
      await page.goto(href)
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.evaluate(() => document.fonts.ready)

      const main = page.locator(`main[data-route="${row.route}"]`)
      await expect(main).toBeVisible()
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(row.title)
      for (const [param, value] of Object.entries(row.defaults)) {
        await expect(main).toHaveAttribute(`data-sub-${param}`, value)
      }

      await expectRail(page, row.rail)

      if (row.column.kind === 'episode-nav') {
        await expectEpisodeNav(page, row.route)
      } else {
        await expect(page.locator('aside[data-episode-nav]')).toHaveCount(0)
        if (row.column.kind === 'context') {
          const column = page.locator(`aside[data-context-column="${row.route}"]`)
          await expect(column).toBeVisible()
          expect(await column.evaluate((el) => el.getBoundingClientRect().width)).toBe(row.column.width)
        } else {
          await expect(page.locator('aside[data-context-column]')).toHaveCount(0)
        }
      }

      if (row.emptyState !== undefined) {
        await expect(main.getByText(row.emptyState.text)).toBeVisible()
      }

      await page.screenshot({ path: `test-results/workspace-${row.route}-${theme}.png` })
    }
  })
}

test('Writing stays lit on all seven episode routes - Notes and Revisions included', async ({ page, account }) => {
  await signIn(page, account)
  for (const route of EPISODE_NAV_ORDER) {
    await page.goto(`/app/project/${seriesId}/ep_002/${route}`)
    await expect(page.locator('nav[data-rail] a[aria-current="page"]')).toHaveAttribute('data-rail-item', 'writing')
  }
  await page.goto(`/app/project/${seriesId}/ep_002/production`)
  await expect(page.locator('nav[data-rail] a[aria-current="page"]')).toHaveAttribute('data-rail-item', 'production')
})

test('a film routes without an episode segment while still having one episode', async ({ page, account }) => {
  await signIn(page, account)
  for (const theme of THEMES) {
    await page.goto(`/app/project/${filmId}/script`)
    await setTheme(page, theme)
    await page.reload()
    await expect(page.locator('main[data-route="script"]')).toBeVisible()
    await expectRail(page, 'writing')
    await expectEpisodeNav(page, 'script')
    // The board is hidden for a film, and so is ＋.
    await expect(page.locator('[data-episode-board]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New episode' })).toHaveCount(0)
    await page.screenshot({ path: `test-results/workspace-film-script-${theme}.png` })
  }

  // The episode-shaped URL for a film is redirected to the collapsed one.
  await page.goto(`/app/project/${filmId}/ep_001/notes`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${filmId}/notes$`))
  await page.goto(`/app/project/${filmId}/ep_001`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${filmId}/script$`))
  await page.goto(`/app/project/${filmId}/production`)
  await expect(page.locator('main[data-route="production"]')).toBeVisible()
  await expect(page.locator('aside[data-context-column="production"]')).toBeVisible()
  await expectRail(page, 'production')

  // And the reverse: a collapsed URL on a series goes to its episode.
  await page.goto(`/app/project/${seriesId}/notes`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_00[12]/notes$`))
})

test('an episode id of `characters` is rejected, and so are the other bad segments', async ({ page, account }) => {
  await signIn(page, account)
  // `/characters/script` is the URL static-first precedence does not save:
  // there is no static `characters/script`, so `characters` reaches the
  // episode validator - which refuses it by name.
  for (const segment of ['characters', 'assets', 'settings', 'production', 'ep_999', 'episode-1', 'EP_001']) {
    const response = await page.goto(`/app/project/${seriesId}/${segment}/script`)
    expect(response?.status(), segment).toBe(404)
  }
  // While the reserved name itself still routes to its own page.
  const ok = await page.goto(`/app/project/${seriesId}/characters`)
  expect(ok?.status()).toBe(200)
  await expect(page.locator('main[data-route="characters"]')).toBeVisible()
})

test('a sub-view that does not exist is a 404; one that does is read', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_001/scenes?view=index`)
  await expect(page.locator('main[data-route="scenes"]')).toHaveAttribute('data-sub-view', 'index')
  await page.goto(`/app/project/${seriesId}/insights?report=presence&lens=producer`)
  const insights = page.locator('main[data-route="insights"]')
  await expect(insights).toHaveAttribute('data-sub-report', 'presence')
  await expect(insights).toHaveAttribute('data-sub-lens', 'producer')
  const bad = await page.goto(`/app/project/${seriesId}/ep_001/scenes?view=grid`)
  expect(bad?.status()).toBe(404)
})

test('/app/project/:id lands on the last opened episode, else the first', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_002/notes`)
  await expect(page.locator('main[data-route="notes"]')).toBeVisible()
  await page.goto(`/app/project/${seriesId}`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_002/script$`))

  await page.context().clearCookies({ name: `folio.episode.${seriesId}` })
  await page.goto(`/app/project/${seriesId}`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_001/script$`))
})

test('the project rail does not appear on the home shell, and vice versa', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/recents')
  await expect(page.locator('nav[data-rail]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await page.goto(`/app/project/${seriesId}/ep_001/script`)
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await expect(page.locator('nav[data-rail]')).toBeVisible()
})
