import { expect, test as base } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WalkOptions } from '../playwright.config'
import {
  EMPTY_NAV_META,
  HEADER_VIEWS,
  RAIL_LABELS,
  RAIL_ORDER,
  RAIL_WIDTH,
  SIDEBAR_ORDER,
  SIDEBAR_WIDTH,
  THEMES,
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_COUNT,
  WRITING_ORDER,
} from './workspace-routes'

/**
 * The workspace smoke test. Walks the route tree in both themes.
 *
 * **This grows every phase.** The rows it walks are in `workspace-routes.ts`;
 * a later phase adds to a row what its route must show and the walk picks it
 * up. What this phase asserts, per AGENTS.md and the brief:
 *
 *   - the rail is six items, in order, 56px, and its active state is the
 *     `--s2` fill with full ink (the redesign's; no accent bar);
 *   - Writing stays lit across all four writing routes, and Production
 *     lights its own item;
 *   - the sidebar measures exactly 236px, in the order Script · Storyboard ·
 *     Outline · Scenes, and the row of the route is lit;
 *   - the header's centre is the route's views, every tab named and the
 *     Storyboard's and Scenes' tabs iconed, with the current one lit - and
 *     nothing on a route with one view (ruled 2026-09-17: the Write /
 *     Storyboard pill is gone);
 *   - every sidebar meta on a new episode prints the empty convention;
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
 * The active state, read from the cascade rather than from a class name. A
 * probe element painted with `var(--s2)` gives the resolved fill to compare
 * against, so the assertion holds in either theme without knowing the palette.
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
    return {
      background: getComputedStyle(el).backgroundColor,
      s2: probe('--s2'),
    }
  })

const expectRail = async (page: Page, active: string): Promise<void> => {
  const rail = page.locator('nav[data-rail]')
  await expect(rail).toHaveCSS('width', `${RAIL_WIDTH}px`)
  const items = rail.locator('[data-rail-item]')
  await expect(items).toHaveCount(RAIL_ORDER.length)
  expect(await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-rail-item')))).toEqual(RAIL_ORDER)
  expect(await items.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(RAIL_LABELS)

  const lit = rail.locator('[data-rail-item][aria-current="page"]')
  await expect(lit).toHaveCount(1)
  await expect(lit).toHaveAttribute('data-rail-item', active)

  const state = await activeState(lit)
  expect(state.background).toBe(state.s2)

  // And an unlit one carries no fill.
  const unlit = rail.locator('[data-rail-item]:not([aria-current="page"]):not([data-lit="true"])').first()
  const off = await activeState(unlit)
  expect(off.background).not.toBe(off.s2)
}

const expectSidebar = async (page: Page, activeRoute: string): Promise<void> => {
  const nav = page.locator('aside[data-sidebar]')
  await expect(nav).toBeVisible()
  const width = await nav.evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBe(SIDEBAR_WIDTH)

  const rows = nav.locator('a[data-episode-route]')
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-episode-route')))).toEqual(SIDEBAR_ORDER)
  await expect(nav.locator('a[data-episode-route][aria-current="page"]')).toHaveAttribute('data-episode-route', activeRoute)
  for (const [route, meta] of Object.entries(EMPTY_NAV_META)) {
    await expect(nav.locator(`[data-nav-meta="${route}"]`)).toHaveText(meta)
  }
  if (activeRoute === 'storyboard') {
    // The Storyboard's second group is `Boards`, not `Scenes`, and its widget counts boards.
    await expect(nav.locator('[data-boards-card]')).toBeVisible()
  } else if (activeRoute === 'outline') {
    // The Outline's second group is `In this outline`, empty until a heading is written.
    await expect(nav.locator('[data-toc-empty]')).toBeVisible()
    await expect(nav.locator('[data-credits-card]')).toBeVisible()
  } else {
    await expect(nav.getByText('Scenes appear here as you write headings. Nothing to list yet.')).toBeVisible()
    await expect(nav.locator('[data-credits-card]')).toBeVisible()
  }
  await expectHeaderViews(page, activeRoute)
}

/**
 * The header's centre: the route's views (`HEADER_VIEWS`), or nothing. Every
 * tab prints its name; the current one is `aria-current`; an icon tab
 * draws an `svg` before the name. No `[data-mode-pill]` anywhere since
 * 2026-09-17.
 */
const expectHeaderViews = async (page: Page, route: string): Promise<void> => {
  await expect(page.locator('[data-mode-pill]')).toHaveCount(0)
  const centre = page.locator('[data-writing-header] [data-header-views]')
  await expect(centre).toHaveAttribute('data-header-views', route)
  const pill = centre.locator('[data-view-pill]')
  const views = HEADER_VIEWS[route]
  if (views === null || views === undefined) {
    await expect(pill).toHaveCount(0)
    return
  }
  await expect(pill).toHaveCount(1)
  const tabs = pill.locator('[data-view-tab]')
  await expect(tabs).toHaveText(views.tabs)
  await expect(pill.locator('[data-view-tab][aria-current="page"]')).toHaveCount(1)
  await expect(tabs.first()).toHaveAttribute('aria-current', 'page')
  await expect(pill.locator('[data-view-tab] svg')).toHaveCount(views.icons)
}

const hrefFor = (projectId: string, episode: string | null, route: string, scope: 'episode' | 'project') =>
  scope === 'project' || episode === null
    ? `/app/project/${projectId}/${route}`
    : `/app/project/${projectId}/${episode}/${route}`

let seriesId = ''
let filmId = ''
const RUN = Date.now().toString(36)

test('the contract is ten routes', () => {
  expect(WORKSPACE_ROUTES).toHaveLength(WORKSPACE_ROUTE_COUNT)
  expect(WORKSPACE_ROUTES.filter((row) => row.scope === 'episode')).toHaveLength(5)
  // Five project-scoped since the Props pass: characters, locations, props, timeline, research.
  expect(WORKSPACE_ROUTES.filter((row) => row.scope === 'project')).toHaveLength(5)
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

test('+ asks for a name, adds a second episode, and the header menu lists both', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_001/script`)
  // The sidebar's + opens the form in flow; nothing is created until it is submitted.
  await page.locator('aside[data-sidebar] [data-new-episode]').click()
  const panel = page.locator('aside[data-sidebar] [data-episode-panel="create"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-episode-name]')).toHaveAttribute('placeholder', 'Episode 2')
  await panel.locator('[data-episode-name]').fill('Standpipe')
  await panel.locator('[data-episode-name]').press('Enter')
  await page.waitForURL(new RegExp(`/app/project/${seriesId}/ep_002/script$`), { timeout: 120_000 })
  await expect(page.locator('aside[data-sidebar] [data-episode-rename]')).toHaveText('Episode 2 · Standpipe')

  // The header's breadcrumb is the switcher: every episode, the current one marked.
  await page.locator('[data-episode-menu]').click()
  const menu = page.locator('[data-menu-episode]')
  await expect(menu).toHaveCount(2)
  await expect(page.locator('[data-menu-episode="ep_002"]')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-menu-episode="ep_001"]')).toContainText('E1')
  await expect(page.locator('[data-menu-episode="ep_002"]')).toContainText('Standpipe')
  await page.locator('[data-menu-episode="ep_001"]').click()
  await page.waitForURL(new RegExp(`/app/project/${seriesId}/ep_001/script$`))

  // Rename from the menu's own form; the sidebar title and the toolbar follow.
  await page.locator('[data-episode-menu]').click()
  await page.locator('[data-episode-menu-list] [data-episode-rename]').click()
  await page.locator('[data-episode-form="rename"] [data-episode-name]').fill('Cold Open')
  await page.locator('[data-episode-form="rename"] [data-episode-name]').press('Enter')
  await expect(page.locator('aside[data-sidebar] [data-episode-rename]')).toHaveText('Episode 1 · Cold Open', { timeout: 120_000 })

  // Delete the second episode from its own menu; the walk lands on the neighbour.
  await page.goto(`/app/project/${seriesId}/ep_002/script`)
  await page.locator('[data-episode-menu]').click()
  await page.locator('[data-episode-menu-list] [data-episode-delete]').click()
  await expect(page.locator('[data-episode-delete-confirm]')).toContainText('cannot be undone')
  await page.locator('[data-episode-delete-confirm-button]').click()
  await page.waitForURL(new RegExp(`/app/project/${seriesId}/ep_001/script$`), { timeout: 120_000 })
  await page.locator('[data-episode-menu]').click()
  await expect(page.locator('[data-menu-episode]')).toHaveCount(1)
  // The last episode cannot be deleted: the item is not offered.
  await expect(page.locator('[data-episode-menu-list] [data-episode-delete]')).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`walks all nine routes of a series, ${theme} theme`, async ({ page, account }) => {
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
      if (row.title !== null) await expect(main.getByRole('heading', { level: 1 })).toHaveText(row.title)
      for (const [param, value] of Object.entries(row.defaults)) {
        await expect(main).toHaveAttribute(`data-sub-${param}`, value)
      }

      await expectRail(page, row.rail)

      if (row.column.kind === 'sidebar') {
        await expectSidebar(page, row.route)
      } else if (row.column.kind === 'card') {
        // The route's own card in the shared sidebar shape: 236px, no writing rows; the header's centre is the route's views.
        const card = page.locator('aside[data-sidebar]')
        await expect(card).toBeVisible()
        expect(await card.evaluate((el) => el.getBoundingClientRect().width)).toBe(row.column.width)
        await expect(card.locator('a[data-episode-route]')).toHaveCount(0)
        await expectHeaderViews(page, row.route)
      } else {
        await expect(page.locator('aside[data-sidebar]')).toHaveCount(0)
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

test('Writing stays lit on all four writing routes, Production on its own', async ({ page, account }) => {
  await signIn(page, account)
  for (const route of WRITING_ORDER) {
    await page.goto(`/app/project/${seriesId}/ep_002/${route}`)
    await expect(page.locator('nav[data-rail] [data-rail-item][aria-current="page"]')).toHaveAttribute('data-rail-item', 'writing')
  }
  await page.goto(`/app/project/${seriesId}/ep_002/production`)
  await expect(page.locator('nav[data-rail] [data-rail-item][aria-current="page"]')).toHaveAttribute('data-rail-item', 'production')
})

test('the rail navigates straight to /characters from a writing route - no overlay', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_001/script`)
  await expect(page.locator('nav[data-rail] button[data-rail-item="characters"]')).toHaveCount(0)
  await page.locator('nav[data-rail] a[data-rail-item="characters"]').click()
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/characters$`))
  await expect(page.locator('[data-characters-overlay]')).toHaveCount(0)
  await expect(page.locator('main[data-route="characters"]')).toBeVisible()
  await expectRail(page, 'characters')
})

test('a film routes without an episode segment while still having one episode', async ({ page, account }) => {
  await signIn(page, account)
  for (const theme of THEMES) {
    await page.goto(`/app/project/${filmId}/script`)
    await setTheme(page, theme)
    await page.reload()
    await expect(page.locator('main[data-route="script"]')).toBeVisible()
    await expectRail(page, 'writing')
    await expectSidebar(page, 'script')
    // The episode menu is hidden for a film, and so is +.
    await expect(page.locator('[data-episode-menu]')).toHaveCount(0)
    await expect(page.locator('[data-new-episode]')).toHaveCount(0)
    await page.screenshot({ path: `test-results/workspace-film-script-${theme}.png` })
  }

  // The episode-shaped URL for a film is redirected to the collapsed one.
  await page.goto(`/app/project/${filmId}/ep_001/scenes`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${filmId}/scenes$`))
  await page.goto(`/app/project/${filmId}/ep_001`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${filmId}/script$`))
  await page.goto(`/app/project/${filmId}/production`)
  await expect(page.locator('main[data-route="production"]')).toBeVisible()
  await expectRail(page, 'production')

  // And the reverse: a collapsed URL on a series goes to its episode.
  await page.goto(`/app/project/${seriesId}/scenes`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_00[12]/scenes$`))
})

test('an episode id of `characters` is rejected, and so are the other bad segments', async ({ page, account }) => {
  await signIn(page, account)
  // `/characters/script` is the URL static-first precedence does not save:
  // there is no static `characters/script`, so `characters` reaches the
  // episode validator - which refuses it by name.
  for (const segment of ['characters', 'assets', 'settings', 'production', 'props', 'ep_999', 'episode-1', 'EP_001']) {
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
  await page.goto(`/app/project/${seriesId}/research?view=clips`)
  await expect(page.locator('main[data-route="research"]')).toHaveAttribute('data-sub-view', 'clips')
  // Insights was removed with the redesign; its URL is gone, not a shell.
  const gone = await page.goto(`/app/project/${seriesId}/insights`)
  expect(gone?.status()).toBe(404)
  const bad = await page.goto(`/app/project/${seriesId}/research?view=grid`)
  expect(bad?.status()).toBe(404)
  // Timeline's views are state (ruled 2026-09-18): a stale `?view=chrono` opens story order.
  const staleChrono = await page.goto(`/app/project/${seriesId}/timeline?view=chrono`)
  expect(staleChrono?.status()).toBe(200)
  await expect(page.locator('main[data-route="timeline"]')).toHaveAttribute('data-sub-view', 'story')
  // Locations' views are state (ruled 2026-09-18): a stale `?view=sheet` opens the places.
  const staleSheet = await page.goto(`/app/project/${seriesId}/locations?view=sheet`)
  expect(staleSheet?.status()).toBe(200)
  await expect(page.locator('main[data-route="locations"]')).toHaveAttribute('data-sub-view', 'places')
  // Scenes' views are state (ruled 2026-09-17): `?view=` is an unknown key there, and opens the cards.
  const stale = await page.goto(`/app/project/${seriesId}/ep_001/scenes?view=index`)
  expect(stale?.status()).toBe(200)
  await expect(page.locator('main[data-route="scenes"]')).toHaveAttribute('data-sub-view', 'cards')
})

test('/app/project/:id lands on the last opened episode, else the first', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto(`/app/project/${seriesId}/ep_002/scenes`)
  await expect(page.locator('main[data-route="scenes"]')).toBeVisible()
  // The cookie is written by a client effect after hydration, which on a cold
  // dev server lands well after `load`. Wait for the write, not for time.
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === `folio.episode.${seriesId}`), {
      timeout: 60_000,
    })
    .toBe(true)
  await page.goto(`/app/project/${seriesId}`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_002/script$`))

  await page.context().clearCookies({ name: `folio.episode.${seriesId}` })
  await page.goto(`/app/project/${seriesId}`)
  await expect(page).toHaveURL(new RegExp(`/app/project/${seriesId}/ep_001/script$`))
})

test('the project rail does not appear on the home shell, and vice versa', async ({ page, account }) => {
  await signIn(page, account)
  await page.goto('/app/projects')
  await expect(page.locator('nav[data-rail]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Sections', exact: true })).toBeVisible()
  await page.goto(`/app/project/${seriesId}/ep_001/script`)
  await expect(page.getByRole('navigation', { name: 'Sections', exact: true })).toHaveCount(0)
  await expect(page.locator('nav[data-rail]')).toBeVisible()
})
