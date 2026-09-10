/**
 * `pageMode` and `liveRepaginate`. **Per project — and the schema has no home
 * for them.** This file is a flag, not an implementation.
 *
 * ## The gap, precisely
 *
 * AGENTS.md, Sub-views are query params — except:
 *
 * | Case | Reason | Do this |
 * | --- | --- | --- |
 * | `pagination` | Two rendering modes plus a cadence flag, not three peer modes | `pageMode` + `liveRepaginate`, **per project**, not in the URL |
 *
 * "Per project" is a database row. The schema phase did not create one.
 *
 * What the schema *does* have is `measurements.page_mode` and
 * `measurements.live_repaginate` (`packages/db/src/schema/measurement.ts`), and
 * they are a different thing wearing the same name. A measurement record is the
 * **output** of `paginate()` for one document under one format under one mode,
 * and `measurements_document_format_mode_key` is unique on
 * `(document_id, format, page_mode)` — the column is part of the key that says
 * *which* pagination this row is, an input echoed onto its own result. It
 * cannot answer "what does this project prefer", because a project with two
 * measurements has two values and no rule for which wins, and a project that
 * has never been paginated has none at all.
 *
 * So the fields exist and are still homeless. That is the failure mode worth
 * naming: the next person to look will find `page_mode` in the schema, wire the
 * toggle to a measurement row, and ship something that works in development —
 * where there is one measurement — and reverts to the wrong mode in production
 * the first time a project is measured at a second format.
 *
 * ## Why this file does not fix it
 *
 * Adding the column is a migration, and AGENTS.md, When to ask first is
 * unambiguous: schema changes are a question, and CLAUDE.md's brief for this
 * phase says to flag it rather than resolve it. There is also a real design
 * question underneath, which is why guessing would be worse than waiting:
 *
 *   - **Where does the row go?** A `project_preferences` table keyed on
 *     `project_id`, or two columns on `projects`? Two columns is fewer joins;
 *     a table is where the next four preferences go without another migration.
 *   - **Is it really per project, or per project per episode?** A series can be
 *     mid-production on one episode and first-draft on another, and paged
 *     versus continuous is exactly the distinction between those two states.
 *     AGENTS.md says project. The Script route bundle draws the control inside
 *     an episode. Those may not be the same claim.
 *   - **Who may change it?** It is shared with collaborators — that is the
 *     whole reason it is not localStorage — so it is a write, and a write needs
 *     a role check. `memberships.role` exists; nothing reads it yet.
 *
 * ## Until then
 *
 * Nothing in this phase renders a sheet, so nothing needs the value. The types
 * are declared here so the vocabulary exists in one place and the eventual
 * repository has a shape to satisfy — and so that a search for `pageMode` in
 * `apps/web` lands on this explanation rather than on a `useState`.
 *
 * **Do not add a `useState`, a Zustand field or a localStorage key for these.**
 * Any of the three would make the setting per-person, which is the specific bug
 * AGENTS.md's exception table exists to prevent: two writers on one script,
 * disagreeing about how many pages it is.
 */

/** AGENTS.md, Pagination: "Two rendering modes plus a cadence flag." */
export const PAGE_MODES = ['paged', 'continuous'] as const

export type PageMode = (typeof PAGE_MODES)[number]

/**
 * The pair, as a project holds it.
 *
 * Mirrors the two columns on `measurements` in name and type deliberately: when
 * the row lands, the value read from it is passed straight to `paginate()` as
 * an input, and a shape that has to be translated on the way is a shape that
 * will be translated wrongly once.
 */
export type ProjectPagination = {
  readonly pageMode: PageMode
  readonly liveRepaginate: boolean
}

/**
 * What a project has before anyone has chosen.
 *
 * `paged`, because the sheet is the product and a page count is what a
 * screenplay is measured in. `liveRepaginate: false`, matching the default on
 * `measurements.live_repaginate` — repaginating on every keystroke is a choice
 * someone should make on purpose.
 *
 * This is a **default, not storage.** It is the value to write into the row on
 * project creation, not a value to serve when the row is missing: serving it
 * would mean the toggle appears to work and silently forgets, which is harder
 * to notice than a missing feature.
 */
export const DEFAULT_PROJECT_PAGINATION: ProjectPagination = {
  pageMode: 'paged',
  liveRepaginate: false,
}
