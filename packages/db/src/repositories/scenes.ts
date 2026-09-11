import type { SceneBoardRow, SluglineReadingRow } from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { CharacterId, DocumentId, LocationId, NodeId, SceneRecord } from '@folio/script'
import { and, asc, eq } from 'drizzle-orm'

import { nodes, sceneDerivations, scenes } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The scene record's authored row, and the Scenes route's read.
 *
 * ## Why an "ensure" exists at all
 *
 * `scene_derivations.scene_node_id` is a foreign key to `scenes.scene_node_id`
 * (`schema/derived.ts`), and `commitDerivation` may write only the derived
 * caches - it imports no authored table on purpose. `persistMintedRecords`
 * gives a *minted* character or location its authored row, but a scene mints
 * nothing: its id is the heading node's id, spent by the editor or the
 * importer, never by `derive`. So nothing was creating the row the foreign key
 * points at, and the first derivation over any script with a heading failed
 * the constraint. `ensureSceneRecords` is the missing step. It runs between
 * `persistMintedRecords` and `commitDerivation`, and like the first it is an
 * insert with `onConflictDoNothing`: the row is created empty exactly once and
 * is the writer's from then on.
 *
 * ## What may be written here
 *
 * One field: `synopsis`. AGENTS.md, Derivation: "Authored data hanging off
 * derived rows - resolve decisions, synopses, beat links, story time, threads
 * - must survive a full re-derive intact." It survives because it is on
 * `scenes`, which no derivation path touches; `writeSceneSynopsis` is the only
 * writer and it never reads or writes a node.
 */

/**
 * Give every scene a derivation pass produced its authored row, if it does not
 * have one yet. Present and absent alike: an absent scene keeps its row and
 * its synopsis, which is the whole reason the row is separate.
 */
export const ensureSceneRecords = async (
  scope: ProjectScope,
  records: readonly SceneRecord[],
): Promise<void> => {
  if (records.length === 0) return
  await dbOf(scope)
    .insert(scenes)
    .values(records.map((record) => ({ ...tenant(scope), sceneNodeId: record.id as string })))
    .onConflictDoNothing()
}

/**
 * The present scenes of one document, in document order, each with its
 * synopsis.
 *
 * `scene_derivations` carries no document id: the derived row hangs off the
 * heading node, the node belongs to a document, and the join walks that chain
 * - the same reasoning `workspace.ts` gives for the nav's counts. `presence =
 * 'present'` because an absent scene has no heading in the script to show a
 * card for; its row is kept for the day the heading comes back.
 *
 * A LEFT JOIN to `scenes`, defensively: after `ensureSceneRecords` the row
 * always exists, but a missing one must read as "no synopsis", not as a
 * missing scene.
 */
export const listSceneBoard = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<readonly SceneBoardRow[]> => {
  const rows = await dbOf(scope)
    .select({
      derivation: sceneDerivations,
      synopsis: scenes.synopsis,
    })
    .from(sceneDerivations)
    .innerJoin(
      nodes,
      and(eq(nodes.id, sceneDerivations.sceneNodeId), eq(nodes.documentId, documentId)),
    )
    .leftJoin(scenes, eq(scenes.sceneNodeId, sceneDerivations.sceneNodeId))
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(sceneDerivations.number))

  return rows.map(({ derivation, synopsis }) => ({
    projectId: brandProjectId(derivation.projectId),
    sceneNodeId: derivation.sceneNodeId as NodeId,
    number: derivation.number,
    heading: derivation.heading,
    reading: derivation.reading as SluglineReadingRow,
    locationId: derivation.locationId === null ? null : (derivation.locationId as LocationId),
    cast: derivation.cast as CharacterId[],
    speaking: derivation.speaking as CharacterId[],
    mentioned: derivation.mentioned as CharacterId[],
    unresolvedCues: derivation.unresolvedCues,
    castSize: derivation.castSize,
    lines: derivation.lines,
    presence: derivation.presence,
    derivedAt: stamp(derivation.derivedAt),
    synopsis: synopsis ?? null,
  }))
}

/**
 * Write a scene's synopsis. The one authored write the Scenes route makes.
 *
 * Returns whether a row was there to write. `false` means the scene record
 * does not exist in this project - a stale card, or an id from somewhere
 * else - and the caller reports it rather than creating a record for a scene
 * derivation never produced. An empty string is stored as `null`: the column
 * is "no synopsis", not "an empty synopsis".
 */
export const writeSceneSynopsis = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  synopsis: string,
): Promise<boolean> => {
  const trimmed = synopsis.trim()
  const rows = await dbOf(scope)
    .update(scenes)
    .set({ synopsis: trimmed === '' ? null : trimmed, updatedAt: new Date() })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}
