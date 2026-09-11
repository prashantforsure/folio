import type { DerivedEntities } from '@folio/script'
import { resolveRowKey } from '@folio/script'
import type { ProposalTarget } from '@folio/script'
import { eq, sql } from 'drizzle-orm'

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
import { jsonb } from '../sql-json'

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
 * Per the classification in `../schema/index.ts` this is safe precisely
 * because these rows are a cache: AGENTS.md requires them to be
 * "reproducible by re-derivation", so throwing them away and rewriting them
 * is not a loss, it is the definition. The same statement against
 * `characters` would destroy a bio. It cannot be written here, because
 * `characters` is not in scope in this file.
 *
 * **One statement**, for the reason `client.ts` gives: on the request path a
 * parameterised statement is two round trips and cannot be pipelined, and
 * the fourteen this used to be were the slowest thing a save did. The six
 * tables are upserted by primary key and pruned of every row the pass did
 * not produce, in twelve `WITH` clauses that touch disjoint rows - upsert
 * and prune on the same table are fine together as long as no row is in
 * both, and by construction none is. The result is the six tables holding
 * exactly the pass, atomically, as before.
 *
 * Every row carries `project_id` from the scope and every prune is scoped:
 * the raw SQL here is the exception `scope.ts` warns about, and the tenant
 * predicate is still `scoped()`'s, never typed by hand.
 */
export const commitDerivation = async (
  scope: ProjectScope,
  entities: DerivedEntities,
  derivedAt: Date = new Date(),
): Promise<void> => {
  const at = derivedAt.toISOString()
  const characterRows = entities.characters.map((character) => ({
    character_id: character.id,
    appearances: character.appearances,
    lines: character.lines,
    mentions: character.mentions,
    presence: character.presence,
    scenes: [...character.scenes],
  }))
  const cueRows = entities.characters.flatMap((character) =>
    character.cues.map((cue) => ({
      character_id: character.id,
      cue: cue.cue,
      key: cue.key,
      occurrences: cue.occurrences,
      lines: cue.lines,
    })),
  )
  const locationRows = entities.locations.map((location) => ({
    location_id: location.id,
    depth: location.depth,
    presence: location.presence,
    own_scenes: location.own.scenes,
    own_sluglines: location.own.sluglines,
    own_day_scenes: location.own.dayScenes,
    own_night_scenes: location.own.nightScenes,
    own_shooting_days: location.own.shootingDays,
    rollup_scenes: location.rollup.scenes,
    rollup_sluglines: location.rollup.sluglines,
    rollup_day_scenes: location.rollup.dayScenes,
    rollup_night_scenes: location.rollup.nightScenes,
    rollup_shooting_days: location.rollup.shootingDays,
    scenes: [...location.scenes],
  }))
  const sluglineRows = entities.locations.flatMap((location) =>
    location.sluglines.map((slugline) => ({
      location_id: location.id,
      slugline: slugline.slugline,
      key: slugline.key,
      occurrences: slugline.occurrences,
    })),
  )
  const sceneRows = entities.scenes.map((scene) => ({
    scene_node_id: scene.id,
    number: scene.number,
    heading: scene.heading,
    reading: scene.reading,
    location_id: scene.locationId,
    cast: [...scene.cast],
    speaking: [...scene.speaking],
    mentioned: [...scene.mentioned],
    unresolved_cues: [...scene.unresolvedCues],
    cast_size: scene.castSize,
    lines: scene.lines,
    presence: scene.presence,
  }))
  const queueRows = entities.queue.map((row) => ({
    key: resolveRowKey(row.subject),
    subject_kind: row.subject.kind,
    subject: row.subject,
    occurrences: row.occurrences,
    scenes: [...row.scenes],
    proposal_target: row.proposal === null ? null : row.proposal.target,
    proposal_confidence: row.proposal === null ? null : row.proposal.confidence,
    suppressed: row.suppressed,
    state: row.state,
  }))

  await dbOf(scope).execute(sql`
    with
    character_rows as (
      insert into ${characterDerivations} (project_id, character_id, appearances, lines, mentions, presence, scenes, derived_at)
      select ${scope.projectId}, r.character_id, r.appearances, r.lines, r.mentions, r.presence, r.scenes, ${at}::timestamptz
      from jsonb_to_recordset(${jsonb(characterRows)})
        as r(character_id uuid, appearances int, lines int, mentions int, presence presence, scenes uuid[])
      on conflict (character_id) do update set
        appearances = excluded.appearances, lines = excluded.lines, mentions = excluded.mentions,
        presence = excluded.presence, scenes = excluded.scenes, derived_at = excluded.derived_at
      returning character_id
    ),
    character_prune as (
      delete from ${characterDerivations}
      where ${scoped(scope, characterDerivations)}
        and ${characterDerivations.characterId} <> all(${sql.param(characterRows.map((row) => row.character_id))}::uuid[])
      returning character_id
    ),
    cue_rows as (
      insert into ${characterCueTallies} (project_id, character_id, cue, key, occurrences, lines)
      select ${scope.projectId}, r.character_id, r.cue, r.key, r.occurrences, r.lines
      from jsonb_to_recordset(${jsonb(cueRows)})
        as r(character_id uuid, cue text, key text, occurrences int, lines int)
      on conflict (character_id, cue) do update set
        key = excluded.key, occurrences = excluded.occurrences, lines = excluded.lines
      returning character_id
    ),
    cue_prune as (
      delete from ${characterCueTallies}
      where ${scoped(scope, characterCueTallies)}
        and not exists (
          select 1 from jsonb_to_recordset(${jsonb(cueRows.map((row) => ({ character_id: row.character_id, cue: row.cue })))})
            as r(character_id uuid, cue text)
          where r.character_id = ${characterCueTallies.characterId} and r.cue = ${characterCueTallies.cue}
        )
      returning character_id
    ),
    location_rows as (
      insert into ${locationDerivations}
        (project_id, location_id, depth, presence, own_scenes, own_sluglines, own_day_scenes, own_night_scenes, own_shooting_days,
         rollup_scenes, rollup_sluglines, rollup_day_scenes, rollup_night_scenes, rollup_shooting_days, scenes, derived_at)
      select ${scope.projectId}, r.location_id, r.depth, r.presence, r.own_scenes, r.own_sluglines, r.own_day_scenes, r.own_night_scenes, r.own_shooting_days,
        r.rollup_scenes, r.rollup_sluglines, r.rollup_day_scenes, r.rollup_night_scenes, r.rollup_shooting_days, r.scenes, ${at}::timestamptz
      from jsonb_to_recordset(${jsonb(locationRows)})
        as r(location_id uuid, depth int, presence presence, own_scenes int, own_sluglines int, own_day_scenes int, own_night_scenes int, own_shooting_days int,
             rollup_scenes int, rollup_sluglines int, rollup_day_scenes int, rollup_night_scenes int, rollup_shooting_days int, scenes uuid[])
      on conflict (location_id) do update set
        depth = excluded.depth, presence = excluded.presence,
        own_scenes = excluded.own_scenes, own_sluglines = excluded.own_sluglines, own_day_scenes = excluded.own_day_scenes,
        own_night_scenes = excluded.own_night_scenes, own_shooting_days = excluded.own_shooting_days,
        rollup_scenes = excluded.rollup_scenes, rollup_sluglines = excluded.rollup_sluglines, rollup_day_scenes = excluded.rollup_day_scenes,
        rollup_night_scenes = excluded.rollup_night_scenes, rollup_shooting_days = excluded.rollup_shooting_days,
        scenes = excluded.scenes, derived_at = excluded.derived_at
      returning location_id
    ),
    location_prune as (
      delete from ${locationDerivations}
      where ${scoped(scope, locationDerivations)}
        and ${locationDerivations.locationId} <> all(${sql.param(locationRows.map((row) => row.location_id))}::uuid[])
      returning location_id
    ),
    slugline_rows as (
      insert into ${locationSluglineTallies} (project_id, location_id, slugline, key, occurrences)
      select ${scope.projectId}, r.location_id, r.slugline, r.key, r.occurrences
      from jsonb_to_recordset(${jsonb(sluglineRows)})
        as r(location_id uuid, slugline text, key text, occurrences int)
      on conflict (location_id, slugline) do update set
        key = excluded.key, occurrences = excluded.occurrences
      returning location_id
    ),
    slugline_prune as (
      delete from ${locationSluglineTallies}
      where ${scoped(scope, locationSluglineTallies)}
        and not exists (
          select 1 from jsonb_to_recordset(${jsonb(sluglineRows.map((row) => ({ location_id: row.location_id, slugline: row.slugline })))})
            as r(location_id uuid, slugline text)
          where r.location_id = ${locationSluglineTallies.locationId} and r.slugline = ${locationSluglineTallies.slugline}
        )
      returning location_id
    ),
    scene_rows as (
      insert into ${sceneDerivations}
        (project_id, scene_node_id, number, heading, reading, location_id, "cast", speaking, mentioned, unresolved_cues, cast_size, lines, presence, derived_at)
      select ${scope.projectId}, r.scene_node_id, r.number, r.heading, r.reading, r.location_id, r."cast", r.speaking, r.mentioned, r.unresolved_cues, r.cast_size, r.lines, r.presence, ${at}::timestamptz
      from jsonb_to_recordset(${jsonb(sceneRows)})
        as r(scene_node_id uuid, number int, heading text, reading jsonb, location_id uuid, "cast" uuid[], speaking uuid[], mentioned uuid[],
             unresolved_cues text[], cast_size int, lines int, presence presence)
      on conflict (scene_node_id) do update set
        number = excluded.number, heading = excluded.heading, reading = excluded.reading, location_id = excluded.location_id,
        "cast" = excluded."cast", speaking = excluded.speaking, mentioned = excluded.mentioned, unresolved_cues = excluded.unresolved_cues,
        cast_size = excluded.cast_size, lines = excluded.lines, presence = excluded.presence, derived_at = excluded.derived_at
      returning scene_node_id
    ),
    scene_prune as (
      delete from ${sceneDerivations}
      where ${scoped(scope, sceneDerivations)}
        and ${sceneDerivations.sceneNodeId} <> all(${sql.param(sceneRows.map((row) => row.scene_node_id))}::uuid[])
      returning scene_node_id
    ),
    queue_rows as (
      insert into ${resolveRows}
        (project_id, key, subject_kind, subject, occurrences, scenes, proposal_target, proposal_confidence, suppressed, state, derived_at)
      select ${scope.projectId}, r.key, r.subject_kind, r.subject, r.occurrences, r.scenes, r.proposal_target, r.proposal_confidence, r.suppressed, r.state, ${at}::timestamptz
      from jsonb_to_recordset(${jsonb(queueRows)})
        as r(key text, subject_kind resolve_subject_kind, subject jsonb, occurrences int, scenes uuid[], proposal_target jsonb,
             proposal_confidence confidence, suppressed jsonb, state resolve_row_state)
      on conflict (project_id, key) do update set
        subject_kind = excluded.subject_kind, subject = excluded.subject, occurrences = excluded.occurrences, scenes = excluded.scenes,
        proposal_target = excluded.proposal_target, proposal_confidence = excluded.proposal_confidence, suppressed = excluded.suppressed,
        state = excluded.state, derived_at = excluded.derived_at
      returning key
    ),
    queue_prune as (
      delete from ${resolveRows}
      where ${scoped(scope, resolveRows)}
        and ${resolveRows.key} <> all(${sql.param(queueRows.map((row) => row.key))}::text[])
      returning key
    )
    select
      (select count(*) from character_rows) + (select count(*) from character_prune)
      + (select count(*) from cue_rows) + (select count(*) from cue_prune)
      + (select count(*) from location_rows) + (select count(*) from location_prune)
      + (select count(*) from slugline_rows) + (select count(*) from slugline_prune)
      + (select count(*) from scene_rows) + (select count(*) from scene_prune)
      + (select count(*) from queue_rows) + (select count(*) from queue_prune) as touched
  `)
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
