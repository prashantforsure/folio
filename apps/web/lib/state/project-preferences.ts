import type { PageMode } from '@folio/script'
import { PAGE_MODES } from '@folio/script'

/**
 * `pageMode` and `liveRepaginate`. **Per project, on the project row.**
 *
 * AGENTS.md, Sub-views are query params - except:
 *
 * | Case | Reason | Do this |
 * | --- | --- | --- |
 * | `pagination` | Two rendering modes plus a cadence flag, not three peer modes | `pageMode` + `liveRepaginate`, **per project**, not in the URL |
 *
 * Until the Script route phase this file was a flag: the schema had no home
 * for the pair, and `measurements.page_mode` looked like one and was not (a
 * measurement echoes its inputs; a project with two measurements has two
 * values). Migration `0003` gave them one - `projects.page_mode` and
 * `projects.live_repaginate` - **ruled by the client on 2026-09-11** as two
 * columns on `projects`, per project rather than per episode, writable by any
 * member. `setProjectPagination` in `@folio/db` is the write;
 * `lib/script/actions.ts` is the server action over it.
 *
 * ## The design-file prop and the model
 *
 * `Route - Script.dc.html` draws one three-way control - `minimal | paged |
 * live` - and `docs/build-decisions.md` (Pagination) explains why that is a
 * good control and a wrong model. The mapping between them lives here, at the
 * boundary, and nowhere else:
 *
 *   minimal  ->  continuous, live off
 *   paged    ->  paged,      live off
 *   live     ->  paged,      live on
 *
 * The fourth state - `continuous` with `liveRepaginate: true` - has no button.
 * It is representable in the model and reachable by nothing in this UI, which
 * is the direction that is cheap to widen later.
 *
 * **Do not add a `useState`, a Zustand field or a localStorage key for these.**
 * Any of the three would make the setting per-person, which is the specific
 * bug AGENTS.md's exception table exists to prevent: two writers on one
 * script, disagreeing about how many pages it is.
 */

export { PAGE_MODES }
export type { PageMode }

export type ProjectPagination = {
  readonly pageMode: PageMode
  readonly liveRepaginate: boolean
}

/**
 * What a project has before anyone has chosen. Also the column defaults in
 * migration `0003`, so the row and the code agree without a backfill.
 */
export const DEFAULT_PROJECT_PAGINATION: ProjectPagination = {
  pageMode: 'paged',
  liveRepaginate: false,
}

/** The three segments the bundle draws, in its order. A design-file prop. */
export const PAGINATION_CONTROLS = ['minimal', 'paged', 'live'] as const

export type PaginationControl = (typeof PAGINATION_CONTROLS)[number]

export const isPaginationControl = (value: string): value is PaginationControl =>
  (PAGINATION_CONTROLS as readonly string[]).includes(value)

/** Bundle copy, verbatim: the label and the note under each segment. */
export const PAGINATION_CONTROL_COPY: Readonly<
  Record<PaginationControl, { readonly label: string; readonly note: string }>
> = {
  minimal: {
    label: 'Minimal',
    note: 'No page breaks drawn. Page count still live in the status bar.',
  },
  paged: {
    label: 'Paged',
    note: "Breaks drawn where the printed page breaks. Widow and (MORE)/(CONT'D) rules applied.",
  },
  live: {
    label: 'Live',
    note: "Repaginates on every keystroke, including collaborators'. Heavier on long drafts.",
  },
}

/** Control -> model. The boundary, one direction. */
export const paginationFromControl = (control: PaginationControl): ProjectPagination => {
  switch (control) {
    case 'minimal':
      return { pageMode: 'continuous', liveRepaginate: false }
    case 'paged':
      return { pageMode: 'paged', liveRepaginate: false }
    case 'live':
      return { pageMode: 'paged', liveRepaginate: true }
  }
}

/**
 * Model -> control. The fourth state has no segment; it shows as `minimal`,
 * which is what it draws like, and its live flag stays true on the row.
 */
export const controlFromPagination = (pagination: ProjectPagination): PaginationControl => {
  if (pagination.pageMode === 'continuous') return 'minimal'
  return pagination.liveRepaginate ? 'live' : 'paged'
}
