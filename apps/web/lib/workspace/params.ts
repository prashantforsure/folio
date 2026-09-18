import { z } from 'zod'

import type { WorkspaceRoute } from './routes'

/**
 * Sub-views. Query params, never routes, each defaulting to its first value.
 *
 * AGENTS.md, Routing: "Sub-views are **query params**, never separate routes.
 * Each defaults to its first value." The values are the `data-props` enums
 * transcribed from each route's bundle (design README, File map), in the order
 * the bundle lists them - the first one is the default, so the order is part
 * of the contract and is not alphabetised.
 *
 * ## What is deliberately not a param here
 *
 * AGENTS.md's "Sub-views are query params - except" table, all three rows:
 *
 *   `script.pagination`   `pageMode` + `liveRepaginate`, per project. Not here.
 *   `script.content`      `draft | empty` is whether a script exists. Not here.
 *   `production.mode`     the generation job's status. Not here.
 *
 * And the bundle props that are not switches at all: `theme` (localStorage),
 * `sideTab` (session), `format` and `projectType` (the project row), and the
 * `empty` flag on the entity routes (a data state).
 *
 * ## Insights had two params, and is gone
 *
 * `report` and `lens` (open decision 4, the `lens/<id>` shape) parsed here
 * until the route was removed with the v2 redesign (2026-09-16). The decision
 * stays open in AGENTS.md; nothing here guesses at it.
 *
 * ## Script has no sub-view params - ruled 2026-09-11
 *
 * The Script route's URL is the bare path, `.../script`, as the design
 * README's URL-shape table writes it. Its two switches are not in the URL:
 *
 *   `▤ Script / ▣ Cover`      component state in `script-workspace.tsx`
 *   `Info / Collaboration`    session state, `useSession().sideTab`
 *
 * The client ruled that clicking either must be instant and must not change
 * the address - "on the URL it's still /script". The panel tab is where the
 * README's state table and AGENTS.md's exception table ("theme, zoom,
 * panels ... session state") always put it; the Script-phase brief's
 * `?panel=` overrode that and the ruling withdraws the override. The
 * document switch was the one param in this file that was an inference (the
 * workspace-shell phase flagged the alternative as "session state") and it
 * now takes the reading the Scenes route took for selection: state, not a
 * URL. So `?doc=cover` and `?panel=collab` are unknown keys here - a stale
 * link opens on the script with the Info tab, and is not a 404.
 *
 * `script.content` stays unwired. `empty` is a data state - whether a
 * screenplay document exists - and a param that forced it would let a URL
 * hide a script that exists. `composer` is not a panel either: ruled
 * 2026-09-11, the composer is a floating window.
 *
 * ## Characters has none either - ruled 2026-09-16
 *
 * The v2 pass parsed `view: cast | relationships | sheet` here (`presence` since 2026-09-18); the client
 * then ruled the route's tabs the way the Script's switches were ruled:
 * instant, and the URL stays `/characters`. The view is React state in the
 * route's layout (`_characters/view-state.tsx`), so `?view=` is an unknown
 * key on this route - a stale `?view=relationships` link opens the cast and
 * is not a 404.
 *
 * ## And Storyboard - ruled 2026-09-17
 *
 * `view: board | canvas | list` parsed here from the first shell pass to
 * the header-views pass; each tab was a link, and a click re-ran the page
 * on the server before the body changed. The client ruled it as Characters'
 * was: smooth, and the URL stays `/storyboard`. The view is a cell the
 * header and the workspace both reach (`_storyboard/view-state.tsx`), so
 * `?view=` is an unknown key here too - a stale `?view=canvas` link opens
 * the board and is not a 404.
 *
 * ## And Scenes - ruled 2026-09-17, the same day
 *
 * `view: cards | index | list` parsed here from the shell-routes phase to
 * the v2 pass; each tab was a link, and a click moved the address to
 * `?view=index` and re-ran the page's read. The client ruled it as the
 * Storyboard's was, in the same words: smooth, and the URL stays `/scenes`.
 * The view is a cell the header and the route's box both reach
 * (`_scenes/view-state.tsx`), so `?view=` is an unknown key here too - a
 * stale `?view=index` link opens the cards and is not a 404.
 *
 * ## And Locations - ruled 2026-09-18
 *
 * `view: places | scenes | sheet` parsed here from the v2 pass to the
 * rebuild; each tab was a link that re-ran the page's read. The client
 * ruled it as the three before it: smooth, and the URL stays `/locations`.
 * The view is React state in the route's layout (`_locations/view-state.tsx`,
 * the Characters shape - the route has a layout of its own), so `?view=`
 * is an unknown key here too - a stale `?view=sheet` link opens the places
 * and is not a 404.
 *
 * ## And Timeline - ruled 2026-09-18, the same day
 *
 * `view: story | chrono | continuity` parsed here from the Timeline phase
 * (2026-09-12) to the rebuild; each tab was a link that re-ran the page's
 * read. The client ruled it as the four before it: instant, and the URL
 * stays `/timeline`. The view is React state in the route's layout
 * (`_timeline/view-state.tsx`, the Locations shape), so `?view=` is an
 * unknown key here too - a stale `?view=chrono` link opens story order and
 * is not a 404.
 *
 * ## `selected` is not wired
 *
 * The README puts a selected record in `?selected=`, and the storyboard
 * bundle writes it as `SCENE_xxx`. Whether a scene's URL id is a node id or a
 * minted one is the `SCENE_xxx` contradiction in `docs/build-decisions.md`,
 * and wiring the param would pick a side. Left for that ruling.
 */

const first = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).default(values[0])

/**
 * One schema per route. A route with no sub-view has an empty object, so
 * `parseSubViews` is total over the nine and a page cannot forget to call
 * it.
 */
export const SUB_VIEW_SCHEMAS = {
  script: z.object({}),
  outline: z.object({}),
  storyboard: z.object({}),
  scenes: z.object({}),
  production: z.object({ view: first(['scene', 'episode']) }),
  characters: z.object({}),
  locations: z.object({}),
  timeline: z.object({}),
  research: z.object({ view: first(['library', 'source', 'clips']) }),
} as const satisfies Record<WorkspaceRoute, z.ZodObject>

export type SubViews<R extends WorkspaceRoute> = z.infer<(typeof SUB_VIEW_SCHEMAS)[R]>

/** Every `?view=` value any route accepts - what a view-switcher tab may link to. */
export type AnySubView = WorkspaceRoute extends infer R
  ? R extends WorkspaceRoute
    ? SubViews<R> extends { readonly view: infer V extends string }
      ? V
      : never
    : never
  : never

/** What Next hands a page. Repeated keys arrive as arrays; the first wins. */
export type RawSearchParams = Record<string, string | string[] | undefined>

const firstValues = (raw: RawSearchParams): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  )

export type SubViewResult<R extends WorkspaceRoute> =
  | { readonly ok: true; readonly params: SubViews<R> }
  | { readonly ok: false; readonly param: string; readonly value: string | undefined }

/**
 * Parse a route's query string into its sub-views, defaults applied.
 *
 * An unknown value is refused rather than replaced by the default: a link to
 * `?view=grid` on a route with no grid view is a link to a view that does not
 * exist, and the page turns that into a 404 the same way it would an episode
 * that does not exist. Unknown *keys* are ignored - a stray `utm_source` is
 * not a broken link.
 */
export const parseSubViews = <R extends WorkspaceRoute>(
  route: R,
  raw: RawSearchParams,
): SubViewResult<R> => {
  const schema: z.ZodObject = SUB_VIEW_SCHEMAS[route]
  const values = firstValues(raw)
  const parsed = schema.safeParse(values)
  if (parsed.success) return { ok: true, params: parsed.data as SubViews<R> }
  const issue = parsed.error.issues[0]
  const param = String(issue?.path[0] ?? '')
  return { ok: false, param, value: values[param] }
}
