import { z } from 'zod'

import { NodeIdSchema } from './ids'
import { EpisodeSchema } from './tenancy'

/**
 * What the project workspace chrome reads. Read models, like `ProjectCard`.
 *
 * AGENTS.md, UI fidelity: "Badges are **live counts**, never placeholders" and
 * every nav meta value is live data. So every field below names the table it
 * is read from, because a number quietly computed in a component is the
 * failure these shapes exist to prevent. None of this is a table and none of
 * it is cached anywhere; `packages/db` assembles each from the rows that own
 * it.
 *
 * Nullable means "does not exist yet", and the chrome renders it as `—`. A
 * zero means "counted, and there were none", rendered as `0`. The convention is
 * AGENTS.md's: "things that legitimately count to zero show `0`; things that
 * either exist or don't show `—`; the script says `empty`." Keeping the two
 * apart in the *type* is what stops a missing measurement rendering as a
 * script with no pages.
 */

// ---------------------------------------------------------------------------
// The rail's three badges
// ---------------------------------------------------------------------------

/**
 * Characters = unresolved cues · Locations = unmatched sluglines · Bible =
 * open canon conflicts.
 *
 *   `characters`  `resolve_rows` where `subject_kind = 'cue'` and
 *                 `state = 'open'`. The resolve queue is rows, and an open row
 *                 is a cue pointing at no record.
 *   `locations`   `resolve_rows` where `subject_kind = 'slugline'` and
 *                 `state = 'open'`.
 *   `bible`       There is no bible table - `index.ts` lists bible entries as
 *                 deliberately absent. A canon conflict is a disagreement
 *                 between a canon entry and the script, so with zero entries
 *                 there are zero conflicts. The repository returns the count of
 *                 that empty set, which is `0`, and says so where it does it.
 *                 When the table lands, this is the field that changes.
 */
export const RailBadgesSchema = z.object({
  characters: z.int().min(0),
  locations: z.int().min(0),
  bible: z.int().min(0),
})

export type RailBadges = z.infer<typeof RailBadgesSchema>

// ---------------------------------------------------------------------------
// The episode board
// ---------------------------------------------------------------------------

/**
 * One row of the episode board: number, title, page count.
 *
 *   `episode`  the `episodes` row.
 *   `pages`    `measurements.total_pages` for the episode's screenplay at the
 *              project's format in `paged` mode; `null` when nothing has been
 *              measured. A page count either exists or does not, so the board
 *              shows `—` rather than `0` for an unmeasured script.
 */
export const EpisodeBoardRowSchema = z.object({
  episode: EpisodeSchema,
  pages: z.int().min(0).nullable(),
})

export type EpisodeBoardRow = z.infer<typeof EpisodeBoardRowSchema>

// ---------------------------------------------------------------------------
// The seven episode-nav metas, as raw facts
// ---------------------------------------------------------------------------

/**
 * The facts behind the seven rows of the episode nav. Formatting - `104pp`,
 * `3 acts`, `Draft 5` - is the chrome's job; this is what it formats.
 *
 *   `script`      `documents` with `kind = 'screenplay'` for this episode:
 *                 `absent` when there is none - the nav says `empty` - and
 *                 otherwise the `measurements.total_pages` at the project's
 *                 format in `paged` mode, or `null` if the script exists but
 *                 has never been measured.
 *   `acts`        `nodes` of `type = 'h1'` in the episode's outline document,
 *                 counted. `null` when there is no outline document.
 *   `beats`       `nodes` of `type = 'beat'` in the episode's outline
 *                 document, counted. `null` when there is no outline document.
 *                 Beats are not a table in this phase; the outline's numbered
 *                 beats are the only beats that exist.
 *   `shots`       Shots are not a table (`comment_threads.anchor_shot_id` is a
 *                 bare uuid for the same reason). `null`, always, until they
 *                 are. The row shows `—`.
 *   `scenes`      `scene_derivations` where `presence = 'present'`, joined
 *                 through `nodes` to this episode's screenplay document.
 *                 Legitimately zero.
 *   `draft`       the highest `revisions.ordinal` for this episode, or `null`
 *                 when no revision has been cut.
 *   `openNotes`   `comment_threads` where `state = 'open'`, joined through the
 *                 anchor node to this episode's documents. Legitimately zero.
 */
export const EpisodeNavMetaSchema = z.object({
  script: z.union([z.literal('absent'), z.object({ pages: z.int().min(0).nullable() })]),
  acts: z.int().min(0).nullable(),
  beats: z.int().min(0).nullable(),
  shots: z.int().min(0).nullable(),
  scenes: z.int().min(0),
  draft: z.int().min(1).nullable(),
  openNotes: z.int().min(0),
})

export type EpisodeNavMeta = z.infer<typeof EpisodeNavMetaSchema>

// ---------------------------------------------------------------------------
// The scenes group
// ---------------------------------------------------------------------------

/**
 * One scene row: number, heading, eighths.
 *
 *   `sceneNodeId`  the heading node's id, which is the scene record's id in
 *                  the implemented core. (ADR 0001 says otherwise; see
 *                  `ids.ts` - flagged, not resolved here.)
 *   `number`       `scene_derivations.number`, 1-based in document order.
 *   `heading`      `scene_derivations.heading`, the slugline as written.
 *   `eighths`      `measurement_scenes.eighths` from the same measurement the
 *                  page count comes from; `null` when the script is unmeasured.
 *                  Never on the derived row - AGENTS.md puts eighths on the
 *                  measurement record.
 */
export const EpisodeSceneRowSchema = z.object({
  sceneNodeId: NodeIdSchema,
  number: z.int().min(1),
  heading: z.string(),
  eighths: z.int().min(0).nullable(),
})

export type EpisodeSceneRow = z.infer<typeof EpisodeSceneRowSchema>
