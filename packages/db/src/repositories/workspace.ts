import type {
  EpisodeBoardRow,
  EpisodeId,
  EpisodeNavMeta,
  EpisodeSceneRow,
  RailBadges,
} from '@folio/contracts'
import type { NodeId, ScriptFormat } from '@folio/script'
import { and, asc, count, eq, max } from 'drizzle-orm'

import {
  commentThreads,
  documents,
  episodes,
  measurementScenes,
  measurements,
  nodes,
  resolveRows,
  revisions,
  sceneDerivations,
} from '../schema'
import { dbOf, scoped } from '../scope'
import type { ProjectScope } from '../scope'
import { toEpisode } from './projects'

/**
 * What the workspace chrome reads: the rail's badges, the episode board, the
 * seven nav metas and the scenes group.
 *
 * AGENTS.md, UI fidelity: badges are "live counts, never placeholders" and the
 * nav meta convention is "things that legitimately count to zero show `0`;
 * things that either exist or don't show `—`; the script says `empty`". Every
 * function here returns the *fact* - a count, a nullable count, or `absent` -
 * and the chrome does the formatting. The `@folio/contracts` shapes name the
 * table each field is read from; this file is where those reads are.
 *
 * ## The page count is one measurement, chosen the same way everywhere
 *
 * `measurements` holds one row per document per format per page mode, so "the
 * page count" is a choice. The choice is the project's own `format` in
 * `paged` mode - the same row `listProjectsFor` sums for the project card -
 * and `screenplayPages` below is the one expression of it in this file,
 * so the episode board, the Script row and the scenes group cannot disagree
 * about which measurement they are reading.
 *
 * ## Scenes and notes are reached through the node, never stored per episode
 *
 * `scene_derivations` and `comment_threads` carry no `episode_id`. They hang
 * off a node, the node belongs to a document, and the document belongs to an
 * episode. Every per-episode count here walks that chain rather than
 * denormalising an episode id onto the derived row, because the day a scene
 * moves between episodes is the day a copied column would be wrong.
 */

const PAGE_MODE_FOR_COUNTS = 'paged' as const

/**
 * A note on how these are written. Drizzle renders a column *unqualified*
 * inside a single-table select, so a correlated subquery written as a raw
 * `sql` template with `${nodes.id}` in it comes out as `"id"` and collides
 * with the outer table's `"id"`. Every read below therefore either goes
 * through the query builder, where joins force qualification, or joins in
 * JavaScript over two plain selects. Nothing here embeds a column in a raw
 * template.
 */

/**
 * The screenplay measurement per episode: one row per episode that has a
 * measured screenplay at this format in `paged` mode. The choice of
 * measurement described in the header, made once.
 */
const screenplayPages = async (
  scope: ProjectScope,
  format: ScriptFormat,
): Promise<ReadonlyMap<string, number>> => {
  const rows = await dbOf(scope)
    .select({ episodeId: measurements.episodeId, pages: measurements.totalPages })
    .from(measurements)
    .innerJoin(documents, eq(documents.id, measurements.documentId))
    .where(
      scoped(
        scope,
        measurements,
        eq(documents.kind, 'screenplay'),
        eq(measurements.format, format),
        eq(measurements.pageMode, PAGE_MODE_FOR_COUNTS),
      ),
    )
  return new Map(rows.map((row) => [row.episodeId, row.pages]))
}

// ---------------------------------------------------------------------------
// The rail's badges
// ---------------------------------------------------------------------------

/**
 * Characters = unresolved cues · Locations = unmatched sluglines · Bible =
 * open canon conflicts.
 *
 * The first two are `resolve_rows` in state `open`, split by subject kind.
 * The queue is rows, not a computed view (AGENTS.md, Entity identity), and an
 * open row is by definition something in the script that points at no
 * record - which is what "unresolved" and "unmatched" mean.
 *
 * **`bible` is the count of an empty set, and it is written out as one.**
 * There is no bible table in this schema - `@folio/contracts` lists bible
 * entries as deliberately absent from this phase - and a canon conflict is a
 * disagreement between a canon entry and the script. With no entries there is
 * nothing to disagree with, so the count is zero by construction, not by
 * assumption. It is a constant here because the set it counts has no table to
 * be queried; when `bible_entries` lands, this becomes a query like the two
 * above, and the badge changes without the chrome knowing.
 */
export const readRailBadges = async (scope: ProjectScope): Promise<RailBadges> => {
  const rows = await dbOf(scope)
    .select({ kind: resolveRows.subjectKind, n: count() })
    .from(resolveRows)
    .where(scoped(scope, resolveRows, eq(resolveRows.state, 'open')))
    .groupBy(resolveRows.subjectKind)
  const open = (kind: 'cue' | 'slugline'): number => rows.find((row) => row.kind === kind)?.n ?? 0
  return {
    characters: open('cue'),
    locations: open('slugline'),
    bible: OPEN_CANON_CONFLICTS_WITHOUT_A_BIBLE,
  }
}

/** See `readRailBadges`. Zero entries, zero conflicts; not a placeholder. */
const OPEN_CANON_CONFLICTS_WITHOUT_A_BIBLE = 0

// ---------------------------------------------------------------------------
// The episode board
// ---------------------------------------------------------------------------

/**
 * Every episode in running order with its page count.
 *
 * Ordered by `ordinal`, never by slug - ADR 0002. `pages` is the screenplay
 * measurement described in the header, or `null`; the board shows `—` for an
 * unmeasured episode because a page count either exists or does not.
 */
export const readEpisodeBoard = async (
  scope: ProjectScope,
  format: ScriptFormat,
): Promise<readonly EpisodeBoardRow[]> => {
  const [rows, pages] = await Promise.all([
    dbOf(scope).select().from(episodes).where(scoped(scope, episodes)).orderBy(asc(episodes.ordinal)),
    screenplayPages(scope, format),
  ])
  return rows.map((row) => ({ episode: toEpisode(row), pages: pages.get(row.id) ?? null }))
}

// ---------------------------------------------------------------------------
// The seven nav metas
// ---------------------------------------------------------------------------

/**
 * The facts behind the episode nav's seven rows.
 *
 * Six small reads, issued together. Each is a plain builder query against
 * the table that owns the fact; the documents are read first because every
 * other count hangs off a document id.
 *
 * `shots` is `null` unconditionally: shots are not a table
 * (`schema/threads.ts` says why `anchor_shot_id` is a bare uuid), so there is
 * nothing to count. The row renders `—` for the reason the convention gives -
 * a thing that does not exist yet - not because a field was forgotten.
 */
export const readEpisodeNavMeta = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  format: ScriptFormat,
): Promise<EpisodeNavMeta> => {
  const db = dbOf(scope)

  const docs = await db
    .select({ id: documents.id, kind: documents.kind })
    .from(documents)
    .where(scoped(scope, documents, eq(documents.episodeId, episodeId)))
  const screenplay = docs.find((doc) => doc.kind === 'screenplay') ?? null
  const outline = docs.find((doc) => doc.kind === 'outline') ?? null

  const countNodes = async (documentId: string, type: 'h1' | 'beat'): Promise<number> => {
    const rows = await db
      .select({ n: count() })
      .from(nodes)
      .where(scoped(scope, nodes, eq(nodes.documentId, documentId), eq(nodes.type, type)))
    return rows[0]?.n ?? 0
  }

  const [pages, acts, beats, scenes, draft, openNotes] = await Promise.all([
    screenplay === null
      ? Promise.resolve(null)
      : db
          .select({ pages: measurements.totalPages })
          .from(measurements)
          .where(
            scoped(
              scope,
              measurements,
              eq(measurements.documentId, screenplay.id),
              eq(measurements.format, format),
              eq(measurements.pageMode, PAGE_MODE_FOR_COUNTS),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]?.pages ?? null),
    outline === null ? Promise.resolve(null) : countNodes(outline.id, 'h1'),
    outline === null ? Promise.resolve(null) : countNodes(outline.id, 'beat'),
    screenplay === null
      ? Promise.resolve(0)
      : db
          .select({ n: count() })
          .from(sceneDerivations)
          .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
          .where(
            scoped(
              scope,
              sceneDerivations,
              eq(nodes.documentId, screenplay.id),
              eq(sceneDerivations.presence, 'present'),
            ),
          )
          .then((rows) => rows[0]?.n ?? 0),
    db
      .select({ draft: max(revisions.ordinal) })
      .from(revisions)
      .where(scoped(scope, revisions, eq(revisions.episodeId, episodeId)))
      .then((rows) => rows[0]?.draft ?? null),
    db
      .select({ n: count() })
      .from(commentThreads)
      .innerJoin(nodes, eq(nodes.id, commentThreads.anchorNodeId))
      .innerJoin(documents, eq(documents.id, nodes.documentId))
      .where(
        scoped(
          scope,
          commentThreads,
          eq(documents.episodeId, episodeId),
          eq(commentThreads.state, 'open'),
        ),
      )
      .then((rows) => rows[0]?.n ?? 0),
  ])

  return {
    script: screenplay === null ? 'absent' : { pages },
    acts,
    beats,
    shots: null,
    scenes,
    draft,
    openNotes,
  }
}

// ---------------------------------------------------------------------------
// The scenes group
// ---------------------------------------------------------------------------

/**
 * The episode's present scenes in document order, with eighths where a
 * measurement exists.
 *
 * Headings and numbers come from `scene_derivations`; eighths come from
 * `measurement_scenes` on the same measurement the page count does, joined
 * with a LEFT JOIN so an unmeasured script still lists its scenes and shows
 * `—` for the length. AGENTS.md puts eighths on the measurement record and
 * nowhere else, which is why they are not a column on the derived row.
 */
export const listEpisodeScenes = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  format: ScriptFormat,
): Promise<readonly EpisodeSceneRow[]> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      eighths: measurementScenes.eighths,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(
      documents,
      and(
        eq(documents.id, nodes.documentId),
        eq(documents.episodeId, episodeId),
        eq(documents.kind, 'screenplay'),
      ),
    )
    .leftJoin(
      measurements,
      and(
        eq(measurements.documentId, documents.id),
        eq(measurements.format, format),
        eq(measurements.pageMode, PAGE_MODE_FOR_COUNTS),
      ),
    )
    .leftJoin(
      measurementScenes,
      and(
        eq(measurementScenes.measurementId, measurements.id),
        eq(measurementScenes.sceneNodeId, sceneDerivations.sceneNodeId),
      ),
    )
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(sceneDerivations.number))

  return rows.map((row) => ({
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    heading: row.heading,
    eighths: row.eighths,
  }))
}
