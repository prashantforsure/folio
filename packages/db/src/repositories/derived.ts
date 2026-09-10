import type { DerivedEntities } from '@folio/script'
import { resolveRowKey } from '@folio/script'
import type { ProposalTarget } from '@folio/script'
import { eq } from 'drizzle-orm'

import {
  characterCueTallies,
  characterDerivations,
  locationDerivations,
  locationSluglineTallies,
  resolveDecisions,
  resolveRows,
  sceneDerivations,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * Writing a derivation pass, and the type that stops it writing anything else.
 *
 * ## The problem
 *
 * AGENTS.md, Derivation: "Derivation **reconciles; it never rebuilds.** Authored
 * data hanging off derived rows - resolve decisions, synopses, beat links, story
 * time, threads - must survive a full re-derive intact."
 *
 * `@folio/script` keeps that promise by keeping every record's authored data in
 * one `authored` sub-object which `derive` carries across **by reference**, so
 * `derive-properties.test.ts` can assert `next.authored === previous.authored`
 * rather than auditing field by field. That is a good mechanism and it does not
 * survive a database: two rows are never `===`, and the natural way to persist
 * a `CharacterRecord` is one upsert of the whole thing, which is exactly the
 * write that erases a bio.
 *
 * ## The mechanism here
 *
 * The authored halves are separate tables, and `commitDerivation` below **never
 * names one**. `DERIVED_TABLES` is the closed list of tables a derivation pass
 * may touch; `characters`, `locations`, `scenes`, `character_bound_cues`,
 * `location_bound_sluglines` and `resolve_decisions` are not in it and are not
 * imported into this file at all.
 *
 * So "a re-derive cannot clobber a synopsis" is not a rule somebody follows. It
 * is a table this function has no reference to.
 *
 * ## What a derivation pass reads
 *
 * `readDerivationInput` is the other half: the authored rows are input to
 * `derive`, because matching goes through the alias table and the location tree
 * is authored. Reading them here and writing them nowhere is the asymmetry the
 * whole design turns on.
 */

/**
 * Every table a derivation pass may write. Nothing else is importable here.
 *
 * Adding a table to this list should be a considered act: it means declaring
 * that a re-derive owns those rows and that a human's edit to them will be
 * overwritten on the next pass.
 */
export const DERIVED_TABLES = [
  'character_derivations',
  'character_cue_tallies',
  'location_derivations',
  'location_slugline_tallies',
  'scene_derivations',
  'resolve_rows',
] as const

export type DerivedTable = (typeof DERIVED_TABLES)[number]

/**
 * A stable string for a proposal target.
 *
 * The uniqueness of a decision is "this row, this target" - AGENTS.md's "A
 * rejected proposal must not reappear identically" - and comparing JSON at read
 * time would make that a scan. `@folio/script` takes the strict reading of
 * *identically*: the same target for the same subject never comes back, at any
 * confidence, so the confidence is deliberately not part of this key.
 */
export const proposalTargetKey = (target: ProposalTarget): string => {
  switch (target.kind) {
    case 'character':
      return `character:${target.id}`
    case 'location':
      return `location:${target.id}`
    case 'attach':
      return `attach:${target.parent}`
    case 'new-parent':
      return `new-parent:${target.name}`
    case 'new-record':
      return 'new-record'
  }
}

/**
 * Replace the derived caches for a project from one `derive` result.
 *
 * Delete-then-insert rather than upsert, and per the classification in
 * `../schema/index.ts` that is safe precisely because these rows are a cache:
 * AGENTS.md requires them to be "reproducible by re-derivation", so throwing
 * them away and rewriting them is not a loss, it is the definition.
 *
 * The same statement against `characters` would destroy a bio. It cannot be
 * written here, because `characters` is not in scope in this file.
 */
export const commitDerivation = async (
  scope: ProjectScope,
  entities: DerivedEntities,
  derivedAt: Date = new Date(),
): Promise<void> => {
  await dbOf(scope).transaction(async (tx) => {
    await tx.delete(characterDerivations).where(scoped(scope, characterDerivations))
    await tx.delete(characterCueTallies).where(scoped(scope, characterCueTallies))
    await tx.delete(locationDerivations).where(scoped(scope, locationDerivations))
    await tx.delete(locationSluglineTallies).where(scoped(scope, locationSluglineTallies))
    await tx.delete(sceneDerivations).where(scoped(scope, sceneDerivations))
    await tx.delete(resolveRows).where(scoped(scope, resolveRows))

    if (entities.characters.length > 0) {
      await tx.insert(characterDerivations).values(
        entities.characters.map((character) => ({
          ...tenant(scope),
          characterId: character.id,
          appearances: character.appearances,
          lines: character.lines,
          mentions: character.mentions,
          presence: character.presence,
          scenes: [...character.scenes],
          derivedAt,
        })),
      )
      const tallies = entities.characters.flatMap((character) =>
        character.cues.map((cue) => ({
          ...tenant(scope),
          characterId: character.id,
          cue: cue.cue,
          key: cue.key,
          occurrences: cue.occurrences,
          lines: cue.lines,
        })),
      )
      if (tallies.length > 0) await tx.insert(characterCueTallies).values(tallies)
    }

    if (entities.locations.length > 0) {
      await tx.insert(locationDerivations).values(
        entities.locations.map((location) => ({
          ...tenant(scope),
          locationId: location.id,
          depth: location.depth,
          presence: location.presence,
          ownScenes: location.own.scenes,
          ownSluglines: location.own.sluglines,
          ownDayScenes: location.own.dayScenes,
          ownNightScenes: location.own.nightScenes,
          ownShootingDays: location.own.shootingDays,
          rollupScenes: location.rollup.scenes,
          rollupSluglines: location.rollup.sluglines,
          rollupDayScenes: location.rollup.dayScenes,
          rollupNightScenes: location.rollup.nightScenes,
          rollupShootingDays: location.rollup.shootingDays,
          scenes: [...location.scenes],
          derivedAt,
        })),
      )
      const tallies = entities.locations.flatMap((location) =>
        location.sluglines.map((slugline) => ({
          ...tenant(scope),
          locationId: location.id,
          slugline: slugline.slugline,
          key: slugline.key,
          occurrences: slugline.occurrences,
        })),
      )
      if (tallies.length > 0) await tx.insert(locationSluglineTallies).values(tallies)
    }

    if (entities.scenes.length > 0) {
      await tx.insert(sceneDerivations).values(
        entities.scenes.map((scene) => ({
          ...tenant(scope),
          sceneNodeId: scene.id,
          number: scene.number,
          heading: scene.heading,
          reading: scene.reading,
          locationId: scene.locationId,
          cast: [...scene.cast],
          speaking: [...scene.speaking],
          mentioned: [...scene.mentioned],
          unresolvedCues: [...scene.unresolvedCues],
          castSize: scene.castSize,
          lines: scene.lines,
          presence: scene.presence,
          derivedAt,
        })),
      )
    }

    if (entities.queue.length > 0) {
      await tx.insert(resolveRows).values(
        entities.queue.map((row) => ({
          ...tenant(scope),
          key: resolveRowKey(row.subject),
          subjectKind: row.subject.kind,
          subject: row.subject,
          occurrences: row.occurrences,
          scenes: [...row.scenes],
          proposalTarget: row.proposal === null ? null : row.proposal.target,
          proposalConfidence: row.proposal === null ? null : row.proposal.confidence,
          suppressed: row.suppressed,
          state: row.state,
          derivedAt,
        })),
      )
    }
  })
}

/**
 * Record what the writer decided about one proposal. AUTHORED.
 *
 * This is the one write in this file that touches an authored table, and it is
 * here rather than in a derivation path because it is the *opposite* of one: a
 * decision is authored input that the next pass must read and honour.
 * AGENTS.md, exception table: resolve-queue decisions "are **authored input**,
 * not derived output. Real rows."
 *
 * `onConflictDoNothing` because deciding the same thing twice is idempotent,
 * and because a second decision that silently overwrote the first would make a
 * rejection reversible by accident.
 */
export const recordResolveDecision = async (
  scope: ProjectScope,
  subject: Parameters<typeof resolveRowKey>[0],
  verdict: 'accepted' | 'rejected',
  target: ProposalTarget,
): Promise<void> => {
  await dbOf(scope)
    .insert(resolveDecisions)
    .values({
      ...tenant(scope),
      rowKey: resolveRowKey(subject),
      verdict,
      target,
      targetKey: proposalTargetKey(target),
      decidedBy: scope.actor,
    })
    .onConflictDoNothing({
      target: [resolveDecisions.projectId, resolveDecisions.rowKey, resolveDecisions.targetKey],
    })
}

/**
 * Every decision made in this project, for feeding back into the next pass.
 *
 * A rejection has to outlive the derived row it rejected - a cue deleted and
 * retyped comes back as the same key, and the writer must not be asked again.
 * That is why `resolve_decisions.row_key` is a plain column and not a foreign
 * key to `resolve_rows`.
 */
export const listResolveDecisions = async (
  scope: ProjectScope,
): Promise<readonly { readonly rowKey: string; readonly verdict: 'accepted' | 'rejected'; readonly target: unknown }[]> => {
  const rows = await dbOf(scope)
    .select({
      rowKey: resolveDecisions.rowKey,
      verdict: resolveDecisions.verdict,
      target: resolveDecisions.target,
    })
    .from(resolveDecisions)
    .where(scoped(scope, resolveDecisions))
  return rows
}

/** One derived scene row, for the Scenes route. */
export const readSceneDerivation = async (
  scope: ProjectScope,
  sceneNodeId: string,
): Promise<typeof sceneDerivations.$inferSelect | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(sceneDerivations)
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.sceneNodeId, sceneNodeId)))
    .limit(1)
  return rows[0] ?? null
}
