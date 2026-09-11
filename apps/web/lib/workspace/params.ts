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
 * ## Two that need naming
 *
 * **`script.doc`.** The Script header carries a `▤ Script / ▣ Cover` segment,
 * and the README's interaction table says a header segment "switches sub-view
 * within a route". So `doc` is wired as Script's sub-view. It is the one
 * param in this file that is an inference rather than a transcription, and
 * it is flagged in the phase report; the alternative reading is that the
 * cover is session state, like the right panel's tab.
 *
 * **`insights.lens`.** Insights takes two params - `report` and `lens` - and
 * they are never collapsed into one. `lens` defaults to the first built-in,
 * per the rule above. Its *value shape* is AGENTS.md open decision 4
 * (`lens/<id>` or `<id>`), which is not resolved here: the parser accepts
 * either spelling and yields the id, so whichever is ruled canonical later
 * already works and the other can be redirected. The built-in ids are the
 * bundle's; authored lenses have no table yet, so nothing else parses.
 *
 * ## `script.panel` is a query param, on the client's instruction
 *
 * The design README and AGENTS.md's exception table put the right panel's tab
 * in session state (`sideTab` in `lib/state/session.ts`). The brief for the
 * Script route phase specifies `?panel=info|collab` as a sub-view, and the
 * brief is the client's, so the URL wins here and `useSession().sideTab` is
 * not read by the Script route. `composer` is deliberately not a value: ruled
 * 2026-09-11 - the composer is a floating window, not a panel - so
 * `?panel=composer` is a 404 like any other unknown sub-view value.
 *
 * `script.content` stays unwired. `empty` is a data state - whether a
 * screenplay document exists - and a param that forced it would let a URL
 * hide a script that exists. Unknown keys are ignored, so a stale
 * `?content=empty` link is neither honoured nor a 404.
 *
 * ## `selected` is not wired
 *
 * The README puts a selected record in `?selected=`, and the storyboard
 * bundle writes it as `SCENE_xxx`. Whether a scene's URL id is a node id or a
 * minted one is the `SCENE_xxx` contradiction in `docs/build-decisions.md`,
 * and wiring the param would pick a side. Left for that ruling.
 */

const INSIGHT_LENSES = ['showrunner', 'viewer', 'snp', 'producer'] as const

/**
 * Accept `showrunner` and `lens/showrunner` alike; see the header. The prefix
 * is stripped before the enum check so a wrong id fails the same way in
 * either spelling.
 */
const LensSchema = z
  .string()
  .transform((raw) => (raw.startsWith('lens/') ? raw.slice('lens/'.length) : raw))
  .pipe(z.enum(INSIGHT_LENSES))

const first = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).default(values[0])

/**
 * One schema per route. A route with no sub-view has an empty object, so
 * `parseSubViews` is total over the fourteen and a page cannot forget to call
 * it.
 */
export const SUB_VIEW_SCHEMAS = {
  script: z.object({ doc: first(['script', 'cover']), panel: first(['info', 'collab']) }),
  outline: z.object({}),
  beats: z.object({ view: first(['beats', 'arrangement']) }),
  storyboard: z.object({ view: first(['board', 'canvas', 'list']) }),
  scenes: z.object({ view: first(['cards', 'index', 'list']) }),
  revisions: z.object({ view: first(['diff', 'history']) }),
  notes: z.object({ filter: first(['open', 'mine', 'resolved', 'all']) }),
  production: z.object({ view: first(['scene', 'episode']) }),
  characters: z.object({ view: first(['profile', 'map', 'resolve']) }),
  locations: z.object({ view: first(['record', 'breakdown', 'resolve']) }),
  timeline: z.object({ view: first(['story', 'chrono', 'continuity']) }),
  bible: z.object({ view: first(['entry', 'check', 'glossary']) }),
  research: z.object({ view: first(['library', 'source', 'clips']) }),
  insights: z.object({
    report: first(['pacing', 'presence']),
    lens: LensSchema.default(INSIGHT_LENSES[0]),
  }),
} as const satisfies Record<WorkspaceRoute, z.ZodObject>

export type SubViews<R extends WorkspaceRoute> = z.infer<(typeof SUB_VIEW_SCHEMAS)[R]>

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
