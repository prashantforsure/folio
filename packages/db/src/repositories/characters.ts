import type {
  ArcTurnEdit,
  ArcTurnId,
  CharacterGroup,
  CharacterProfileEdit,
  EpisodeSlug,
  Timestamp,
} from '@folio/contracts'
import { arcTurnId as brandArcTurnId, episodeSlug as brandEpisodeSlug } from '@folio/contracts'
import type {
  CharacterId,
  InteriorExterior,
  Light,
  LocationId,
  NodeId,
  Presence,
  ScreenplayNode,
} from '@folio/script'
import {
  INTERIOR_EXTERIOR,
  LIGHT_STATES,
  characterId as brandCharacterId,
  isErr,
  locationId as brandLocationId,
} from '@folio/script'
import { asc, eq, sql } from 'drizzle-orm'

import {
  characterArcTurns,
  characterBoundCues,
  characterCueTallies,
  characterDerivations,
  characterRelationships,
  characters,
  documents,
  episodes,
  locations,
  nodes,
  resolveRows,
  sceneDerivations,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { screenplayNodeFromRow, stamp } from './mapping'

/**
 * The Characters route's reads, and every authored write it makes.
 *
 * ## The split, from this side
 *
 * `characters`, `character_bound_cues`, `character_relationships` and
 * `character_arc_turns` are AUTHORED (`schema/derived.ts`); the route reads
 * them beside the DERIVED CACHE rows - `character_derivations`,
 * `character_cue_tallies`, `scene_derivations`, `resolve_rows` - and joins
 * by id in `apps/web`. Nothing here recombines the halves into one row, and
 * nothing here writes a derived table: a re-derive owns those, and the one
 * place that writes them is `derived.ts`, which imports none of the authored
 * tables. The reverse holds for this file - it imports the derived tables to
 * *read* them and writes only the authored ones.
 *
 * ## The alias table is written here, by a person
 *
 * `bindCue` is the mechanism AGENTS.md names for "what makes the Devanagari
 * spelling and `MEERA` one person": a row a human put there. It is the only
 * way a spelling ever binds to a record other than the one derivation minted
 * from it (`persistMintedRecords`), and the unique index on
 * `(project_id, cue)` is what turns "a cue binds to at most one character"
 * from a rule into a refusal.
 *
 * ## A rename is two writes and a diff
 *
 * `renameCharacterRecord` swaps the name and the name's bound cue in one
 * statement; `rewriteCueNodes` writes the rewritten cue nodes the pure
 * core's `renameCharacterCues` produced, across every document, in one
 * statement. The route sequences them with a `before_rename` version per
 * document between (`history.ts`), so the rename is one undo entry per
 * script it touched - AGENTS.md's "explicit rewrite operation, returns a
 * diff, single undo entry".
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A record's authored row beside its derived row. The join the route reads. */
export type CharacterRecordRow = {
  readonly id: CharacterId
  readonly name: string
  readonly group: CharacterGroup
  readonly role: string | null
  readonly age: string | null
  readonly bio: string | null
  readonly wants: string | null
  readonly wantsSource: string | null
  readonly needs: string | null
  readonly needsSource: string | null
  readonly flaw: string | null
  readonly flawSource: string | null
  readonly voiceRules: readonly string[]
  readonly keyLines: readonly NodeId[]
  readonly createdAt: Timestamp
  /** Null until the first derivation pass after the record was made by hand. */
  readonly derived: {
    readonly appearances: number
    readonly lines: number
    readonly mentions: number
    readonly presence: Presence
    readonly scenes: readonly NodeId[]
  } | null
}

/**
 * Every live record - `merged_into IS NULL` - in creation order, with its
 * derived row where one exists. A LEFT JOIN: a record made by hand or by an
 * `@mention` has no derived row until the next pass, and it is still a
 * record.
 */
export const listCharacterRecords = async (
  scope: ProjectScope,
): Promise<readonly CharacterRecordRow[]> => {
  const rows = await dbOf(scope)
    .select({ record: characters, derived: characterDerivations })
    .from(characters)
    .leftJoin(characterDerivations, eq(characterDerivations.characterId, characters.id))
    .where(scoped(scope, characters, sql`${characters.mergedInto} IS NULL`))
    .orderBy(asc(characters.createdAt), asc(characters.id))
  return rows.map(({ record, derived }) => ({
    id: brandCharacterId(record.id),
    name: record.name,
    group: record.group,
    role: record.role,
    age: record.age,
    bio: record.bio,
    wants: record.wants,
    wantsSource: record.wantsSource,
    needs: record.needs,
    needsSource: record.needsSource,
    flaw: record.flaw,
    flawSource: record.flawSource,
    voiceRules: record.voiceRules,
    keyLines: record.keyLines as NodeId[],
    createdAt: stamp(record.createdAt),
    derived:
      derived === null
        ? null
        : {
            appearances: derived.appearances,
            lines: derived.lines,
            mentions: derived.mentions,
            presence: derived.presence,
            scenes: derived.scenes as NodeId[],
          },
  }))
}

/** Where a merged record went, or null when the id is live or unknown. */
export const readMergedInto = async (
  scope: ProjectScope,
  id: CharacterId,
): Promise<CharacterId | null> => {
  const rows = await dbOf(scope)
    .select({ mergedInto: characters.mergedInto })
    .from(characters)
    .where(scoped(scope, characters, eq(characters.id, id)))
    .limit(1)
  const target = rows[0]?.mergedInto ?? null
  return target === null ? null : brandCharacterId(target)
}

export type CueTallyRow = {
  readonly characterId: CharacterId
  readonly cue: string
  readonly key: string
  readonly occurrences: number
  readonly lines: number
}

/** The counted spellings of every record, in insertion order. DERIVED. */
export const listCueTallies = async (scope: ProjectScope): Promise<readonly CueTallyRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(characterCueTallies)
    .where(scoped(scope, characterCueTallies))
  return rows.map((row) => ({
    characterId: brandCharacterId(row.characterId),
    cue: row.cue,
    key: row.key,
    occurrences: row.occurrences,
    lines: row.lines,
  }))
}

export type BoundCueRow = {
  readonly characterId: CharacterId
  readonly cue: string
}

/** The alias table's authored half, whole. AUTHORED. */
export const listBoundCues = async (scope: ProjectScope): Promise<readonly BoundCueRow[]> => {
  const rows = await dbOf(scope)
    .select({ characterId: characterBoundCues.characterId, cue: characterBoundCues.cue })
    .from(characterBoundCues)
    .where(scoped(scope, characterBoundCues))
    .orderBy(asc(characterBoundCues.boundAt))
  return rows.map((row) => ({ characterId: brandCharacterId(row.characterId), cue: row.cue }))
}

export type RelationshipRecordRow = {
  readonly characterId: CharacterId
  readonly otherId: CharacterId
  readonly what: string
  readonly shift: string | null
}

export const listRelationshipRows = async (
  scope: ProjectScope,
): Promise<readonly RelationshipRecordRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(characterRelationships)
    .where(scoped(scope, characterRelationships))
  return rows.map((row) => ({
    characterId: brandCharacterId(row.characterId),
    otherId: brandCharacterId(row.otherId),
    what: row.what,
    shift: row.shift,
  }))
}

export type ArcTurnRecordRow = {
  readonly id: ArcTurnId
  readonly position: number
  readonly sceneNodeId: NodeId | null
  readonly text: string
}

export const listArcTurns = async (
  scope: ProjectScope,
  characterId: CharacterId,
): Promise<readonly ArcTurnRecordRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(characterArcTurns)
    .where(scoped(scope, characterArcTurns, eq(characterArcTurns.characterId, characterId)))
    .orderBy(asc(characterArcTurns.position), asc(characterArcTurns.createdAt))
  return rows.map((row) => ({
    id: brandArcTurnId(row.id),
    position: row.position,
    sceneNodeId: row.sceneNodeId === null ? null : (row.sceneNodeId as NodeId),
    text: row.text,
  }))
}

/**
 * One present scene, with the episode it is in.
 *
 * `scene_derivations` carries no episode: the derived row hangs off the
 * heading node, the node belongs to a document, and the document to an
 * episode. The join walks that chain, the same reasoning `workspace.ts` and
 * `scenes.ts` give. `number` is derivation's, which numbers scenes across
 * the whole project in reading order; `ordinalInEpisode` is the rank within
 * the episode, which is what `E2 Sc 9` means.
 */
export type SceneIndexRow = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly ordinalInEpisode: number
  readonly heading: string
  readonly locationId: LocationId | null
  readonly lines: number
  readonly cast: readonly CharacterId[]
  readonly speaking: readonly CharacterId[]
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  /** The heading as read: interior/exterior and the day/night reduction (Locations route). */
  readonly ie: InteriorExterior
  readonly light: Light
  readonly timeOfDay: string | null
}

const isInteriorExterior = (value: unknown): value is InteriorExterior =>
  typeof value === 'string' && (INTERIOR_EXTERIOR as readonly string[]).includes(value)

const isLight = (value: unknown): value is Light =>
  typeof value === 'string' && (LIGHT_STATES as readonly string[]).includes(value)

/** The stored `SluglineReading`, read defensively: the JSON column is text only. */
const readingOf = (
  value: unknown,
): { readonly ie: InteriorExterior; readonly light: Light; readonly timeOfDay: string | null } => {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    ie: isInteriorExterior(raw['ie']) ? raw['ie'] : 'INT',
    light: isLight(raw['light']) ? raw['light'] : 'unspecified',
    timeOfDay: typeof raw['timeOfDay'] === 'string' ? raw['timeOfDay'] : null,
  }
}

export const listSceneIndex = async (scope: ProjectScope): Promise<readonly SceneIndexRow[]> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      reading: sceneDerivations.reading,
      locationId: sceneDerivations.locationId,
      lines: sceneDerivations.lines,
      cast: sceneDerivations.cast,
      speaking: sceneDerivations.speaking,
      episode: episodes.slug,
      episodeOrdinal: episodes.ordinal,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(documents, eq(documents.id, nodes.documentId))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(episodes.ordinal), asc(sceneDerivations.number))

  let ordinalInEpisode = 0
  let lastEpisode = -1
  return rows.map((row) => {
    if (row.episodeOrdinal !== lastEpisode) {
      lastEpisode = row.episodeOrdinal
      ordinalInEpisode = 0
    }
    ordinalInEpisode += 1
    return {
      sceneNodeId: row.sceneNodeId as NodeId,
      number: row.number,
      ordinalInEpisode,
      heading: row.heading,
      locationId: row.locationId === null ? null : brandLocationId(row.locationId),
      lines: row.lines,
      cast: row.cast as CharacterId[],
      speaking: row.speaking as CharacterId[],
      episode: brandEpisodeSlug(row.episode),
      episodeOrdinal: row.episodeOrdinal,
      ...readingOf(row.reading),
    }
  })
}

export const listLocationNames = async (
  scope: ProjectScope,
): Promise<ReadonlyMap<LocationId, string>> => {
  const rows = await dbOf(scope)
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(scoped(scope, locations))
  return new Map(rows.map((row) => [brandLocationId(row.id), row.name]))
}

/** An open resolve-queue row for a cue, as stored. The route reads the JSON columns. */
export type OpenCueRow = {
  readonly key: string
  readonly subject: unknown
  readonly occurrences: number
  readonly scenes: readonly NodeId[]
  readonly proposalTarget: unknown
  readonly proposalConfidence: 'certain' | 'likely' | 'possible' | null
}

export const listOpenCueRows = async (scope: ProjectScope): Promise<readonly OpenCueRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(resolveRows)
    .where(
      scoped(
        scope,
        resolveRows,
        eq(resolveRows.subjectKind, 'cue'),
        eq(resolveRows.state, 'open'),
      ),
    )
    .orderBy(asc(resolveRows.key))
  return rows.map((row) => ({
    key: row.key,
    subject: row.subject,
    occurrences: row.occurrences,
    scenes: row.scenes as NodeId[],
    proposalTarget: row.proposalTarget,
    proposalConfidence: row.proposalConfidence,
  }))
}

export type NodeInScene = {
  readonly node: ScreenplayNode
  /** The heading node the line sits under, or null above the first heading. */
  readonly sceneNodeId: NodeId | null
}

/**
 * Some nodes by id, as models, each with the scene it sits in. For the key
 * lines: the profile shows the text on the page, read from the node, never
 * a copy, and the ref beside it is the heading that precedes the node in
 * its document - found by order key, under `COLLATE "C"` as every read of
 * that column is (`order.ts`). Ids the script no longer holds simply do
 * not come back.
 */
export const readNodesInScene = async (
  scope: ProjectScope,
  ids: readonly NodeId[],
): Promise<ReadonlyMap<NodeId, NodeInScene>> => {
  if (ids.length === 0) return new Map()
  const rows = await dbOf(scope).execute(sql`
    select n.id, n.document_kind, n.type, n.content, n.modifiers, n.provenance_source, n.provenance_run_id,
      (select s.id from ${nodes} s
        where s.project_id = ${scope.projectId} and s.document_id = n.document_id and s.type = 'scene'
          and s.order_key collate "C" <= n.order_key collate "C"
        order by s.order_key collate "C" desc limit 1) as scene_node_id
    from ${nodes} n
    where n.project_id = ${scope.projectId} and n.document_kind = 'screenplay'
      and n.id = any(${sql.param([...ids])}::uuid[])
  `)
  const out = new Map<NodeId, NodeInScene>()
  for (const raw of rows) {
    const row = raw as {
      readonly id: string
      readonly document_kind: string
      readonly type: string
      readonly content: unknown
      readonly modifiers: readonly string[]
      readonly provenance_source: string
      readonly provenance_run_id: string | null
      readonly scene_node_id: string | null
    }
    const node = screenplayNodeFromRow({
      id: row.id,
      documentKind: row.document_kind,
      type: row.type,
      content: row.content,
      modifiers: row.modifiers,
      provenanceSource: row.provenance_source,
      provenanceRunId: row.provenance_run_id,
    })
    if (isErr(node)) continue
    out.set(node.value.id, {
      node: node.value,
      sceneNodeId: row.scene_node_id === null ? null : (row.scene_node_id as NodeId),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Writes - the record
// ---------------------------------------------------------------------------

export const createCharacterRecord = async (
  scope: ProjectScope,
  name: string,
  group: CharacterGroup,
): Promise<CharacterId> => {
  const rows = await dbOf(scope)
    .insert(characters)
    .values({ ...tenant(scope), name, group })
    .returning({ id: characters.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a character returned no row.')
  return brandCharacterId(row.id)
}

/** Write the fields present in `edit`, whole. `false` when the record is not here. */
export const updateCharacterProfile = async (
  scope: ProjectScope,
  id: CharacterId,
  edit: CharacterProfileEdit,
): Promise<boolean> => {
  const blank = (value: string | null | undefined): string | null | undefined =>
    value === undefined ? undefined : value === '' ? null : value
  const rows = await dbOf(scope)
    .update(characters)
    .set({
      ...(edit.group === undefined ? {} : { group: edit.group }),
      ...(edit.role === undefined ? {} : { role: blank(edit.role) ?? null }),
      ...(edit.age === undefined ? {} : { age: blank(edit.age) ?? null }),
      ...(edit.bio === undefined ? {} : { bio: blank(edit.bio) ?? null }),
      ...(edit.wants === undefined ? {} : { wants: blank(edit.wants) ?? null }),
      ...(edit.wantsSource === undefined ? {} : { wantsSource: blank(edit.wantsSource) ?? null }),
      ...(edit.needs === undefined ? {} : { needs: blank(edit.needs) ?? null }),
      ...(edit.needsSource === undefined ? {} : { needsSource: blank(edit.needsSource) ?? null }),
      ...(edit.flaw === undefined ? {} : { flaw: blank(edit.flaw) ?? null }),
      ...(edit.flawSource === undefined ? {} : { flawSource: blank(edit.flawSource) ?? null }),
      ...(edit.voiceRules === undefined ? {} : { voiceRules: [...edit.voiceRules] }),
      updatedAt: new Date(),
    })
    .where(scoped(scope, characters, eq(characters.id, id), sql`${characters.mergedInto} IS NULL`))
    .returning({ id: characters.id })
  return rows.length > 0
}

export const setKeyLines = async (
  scope: ProjectScope,
  id: CharacterId,
  nodeIds: readonly NodeId[],
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(characters)
    .set({ keyLines: [...nodeIds], updatedAt: new Date() })
    .where(scoped(scope, characters, eq(characters.id, id), sql`${characters.mergedInto} IS NULL`))
    .returning({ id: characters.id })
  return rows.length > 0
}

export type RenameOutcome =
  | { readonly status: 'renamed' }
  | { readonly status: 'missing' }
  /** The new spelling is already bound to another record. Merge, do not rename. */
  | { readonly status: 'taken'; readonly by: CharacterId }

/**
 * The authored half of a rename: the name, and the name's row in the alias
 * table. One statement, gated on the new spelling being free.
 *
 * `oldCues` are the bound spellings whose canonical key is the old name's -
 * the caller computes them with `canonicalKey`, which is the pure core's,
 * not SQL's. They are unbound and the new spelling bound in their place;
 * every other bound spelling stays, because an alias the writer chose is
 * not the name (`@folio/script`'s `rename.ts` says the same of the cues).
 */
export const renameCharacterRecord = async (
  scope: ProjectScope,
  id: CharacterId,
  name: string,
  oldCues: readonly string[],
  newCue: string,
): Promise<RenameOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with taken as (
      select ${characterBoundCues.characterId} as character_id from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.cue, newCue))}
        and ${characterBoundCues.characterId} <> ${id}
    ),
    ok as (select not exists (select 1 from taken) as ok),
    named as (
      update ${characters} set name = ${name}, updated_at = now()
      where ${scoped(scope, characters, eq(characters.id, id))}
        and ${characters.mergedInto} is null
        and (select ok from ok)
      returning id
    ),
    unbound as (
      delete from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, id))}
        and ${characterBoundCues.cue} = any(${sql.param([...oldCues])}::text[])
        and ${characterBoundCues.cue} <> ${newCue}
        and (select ok from ok)
        and exists (select 1 from named)
      returning cue
    ),
    bound as (
      insert into ${characterBoundCues} (project_id, character_id, cue, bound_by)
      select ${scope.projectId}, ${id}, ${newCue}, ${scope.actor}::uuid
      where (select ok from ok) and exists (select 1 from named)
      on conflict (character_id, cue) do nothing
      returning cue
    )
    select
      (select character_id from taken limit 1) as taken_by,
      (select count(*)::int from named) as renamed,
      (select count(*)::int from unbound) + (select count(*)::int from bound) as rebound
  `)
  const row = rows[0] as
    | { readonly taken_by: string | null; readonly renamed: number; readonly rebound: number }
    | undefined
  if (row === undefined) throw new Error('Folio: the rename returned no row. This is a bug in the repository.')
  if (row.taken_by !== null) return { status: 'taken', by: brandCharacterId(row.taken_by) }
  if (row.renamed === 0) return { status: 'missing' }
  return { status: 'renamed' }
}

export type CueNodeRewrite = {
  readonly id: NodeId
  readonly content: ScreenplayNode['content']
}

/**
 * Write rewritten cue nodes across every document, in one statement, and
 * stamp each document touched. The rows come from `renameCharacterCues`;
 * only `content` changes, so ids, order, type and provenance are untouched
 * and every anchor pointing at a rewritten cue still points at it.
 */
export const rewriteCueNodes = async (
  scope: ProjectScope,
  rewrites: readonly CueNodeRewrite[],
): Promise<number> => {
  if (rewrites.length === 0) return 0
  const rows = await dbOf(scope).execute(sql`
    with rewritten as (
      update ${nodes} set content = r.content, updated_at = now()
      from jsonb_to_recordset(${jsonb(rewrites.map((entry) => ({ id: entry.id, content: entry.content })))})
        as r(id uuid, content jsonb)
      where ${scoped(scope, nodes, eq(nodes.type, 'character'))}
        and ${nodes.id} = r.id
      returning ${nodes.documentId} as document_id
    ),
    stamped as (
      update ${documents} set updated_at = now()
      where ${scoped(scope, documents)}
        and ${documents.id} in (select document_id from rewritten)
      returning id
    )
    select (select count(*)::int from rewritten) as rewritten
  `)
  const row = rows[0] as { readonly rewritten: number } | undefined
  return row?.rewritten ?? 0
}

// ---------------------------------------------------------------------------
// Writes - the alias table
// ---------------------------------------------------------------------------

export type BindOutcome =
  | { readonly status: 'bound' }
  /** Already bound to this record. Nothing to do. */
  | { readonly status: 'already' }
  | { readonly status: 'taken'; readonly by: CharacterId }
  | { readonly status: 'missing' }

/**
 * Bind a spelling to a record. The one authored write that makes two
 * spellings one person, and the unique index on `(project_id, cue)` is what
 * refuses a spelling somebody else already holds - an ambiguous cue goes to
 * the resolve queue, never to a tiebreak.
 */
export const bindCue = async (
  scope: ProjectScope,
  id: CharacterId,
  cue: string,
): Promise<BindOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with holder as (
      select ${characterBoundCues.characterId} as character_id from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.cue, cue))}
    ),
    record as (
      select ${characters.id} as id from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null
    ),
    bound as (
      insert into ${characterBoundCues} (project_id, character_id, cue, bound_by)
      select ${scope.projectId}, ${id}, ${cue}, ${scope.actor}::uuid
      where not exists (select 1 from holder) and exists (select 1 from record)
      on conflict do nothing
      returning cue
    )
    select
      (select character_id from holder limit 1) as holder,
      (select count(*)::int from record) as record,
      (select count(*)::int from bound) as bound
  `)
  const row = rows[0] as
    | { readonly holder: string | null; readonly record: number; readonly bound: number }
    | undefined
  if (row === undefined) throw new Error('Folio: binding a cue returned no row. This is a bug in the repository.')
  if (row.holder !== null) {
    return row.holder === (id as string) ? { status: 'already' } : { status: 'taken', by: brandCharacterId(row.holder) }
  }
  if (row.record === 0) return { status: 'missing' }
  return { status: 'bound' }
}

/**
 * Unbind a spelling. Refused when it is the record's last: a record with no
 * bound cue is one its own cues would propose against on the next pass, and
 * the writer asked for that once already when they bound it. Rename or merge
 * instead.
 */
export const unbindCue = async (
  scope: ProjectScope,
  id: CharacterId,
  cue: string,
): Promise<'unbound' | 'last' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with held as (
      select ${characterBoundCues.cue} as cue from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, id))}
    ),
    removed as (
      delete from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, id), eq(characterBoundCues.cue, cue))}
        and (select count(*) from held) > 1
      returning cue
    )
    select
      (select count(*)::int from held) as held,
      exists (select 1 from held where cue = ${cue}) as present,
      (select count(*)::int from removed) as removed
  `)
  const row = rows[0] as
    | { readonly held: number; readonly present: boolean; readonly removed: number }
    | undefined
  if (row === undefined) throw new Error('Folio: unbinding a cue returned no row. This is a bug in the repository.')
  if (!row.present) return 'missing'
  if (row.removed === 0) return 'last'
  return 'unbound'
}

// ---------------------------------------------------------------------------
// Writes - relationships, arc, merge, delete
// ---------------------------------------------------------------------------

export const upsertRelationship = async (
  scope: ProjectScope,
  id: CharacterId,
  otherId: CharacterId,
  what: string,
  shift: string | null,
): Promise<void> => {
  await dbOf(scope)
    .insert(characterRelationships)
    .values({ ...tenant(scope), characterId: id, otherId, what, shift })
    .onConflictDoUpdate({
      target: [characterRelationships.characterId, characterRelationships.otherId],
      set: { what, shift },
    })
}

export const removeRelationship = async (
  scope: ProjectScope,
  id: CharacterId,
  otherId: CharacterId,
): Promise<void> => {
  await dbOf(scope)
    .delete(characterRelationships)
    .where(
      scoped(
        scope,
        characterRelationships,
        eq(characterRelationships.characterId, id),
        eq(characterRelationships.otherId, otherId),
      ),
    )
}

/** Append a turn. Its position is one past the record's last, in the same statement. */
export const addArcTurn = async (
  scope: ProjectScope,
  id: CharacterId,
  edit: ArcTurnEdit,
): Promise<ArcTurnId | null> => {
  const rows = await dbOf(scope).execute(sql`
    insert into ${characterArcTurns} (project_id, character_id, position, scene_node_id, text)
    select ${scope.projectId}, ${id},
      coalesce((select max(${characterArcTurns.position}) from ${characterArcTurns}
        where ${scoped(scope, characterArcTurns, eq(characterArcTurns.characterId, id))}), -1) + 1,
      ${edit.sceneNodeId}::uuid, ${edit.text}
    where exists (select 1 from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null)
    returning id
  `)
  const row = rows[0] as { readonly id: string } | undefined
  return row === undefined ? null : brandArcTurnId(row.id)
}

export const updateArcTurn = async (
  scope: ProjectScope,
  turnId: ArcTurnId,
  edit: ArcTurnEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(characterArcTurns)
    .set({ text: edit.text, sceneNodeId: edit.sceneNodeId, updatedAt: new Date() })
    .where(scoped(scope, characterArcTurns, eq(characterArcTurns.id, turnId)))
    .returning({ id: characterArcTurns.id })
  return rows.length > 0
}

export const deleteArcTurn = async (scope: ProjectScope, turnId: ArcTurnId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(characterArcTurns)
    .where(scoped(scope, characterArcTurns, eq(characterArcTurns.id, turnId)))
    .returning({ id: characterArcTurns.id })
  return rows.length > 0
}

/** Write every turn's position at once. The caller has reordered the list. */
export const reorderArcTurns = async (
  scope: ProjectScope,
  id: CharacterId,
  order: readonly ArcTurnId[],
): Promise<void> => {
  if (order.length === 0) return
  await dbOf(scope).execute(sql`
    update ${characterArcTurns} set position = r.position, updated_at = now()
    from jsonb_to_recordset(${jsonb(order.map((turnId, position) => ({ id: turnId, position })))})
      as r(id uuid, position int)
    where ${scoped(scope, characterArcTurns, eq(characterArcTurns.characterId, id))}
      and ${characterArcTurns.id} = r.id
  `)
}

/**
 * Merge `loser` into `winner`: the writer's decision that two records were
 * one person. One statement. The loser's row is kept with `merged_into` set
 * (a tombstone, so anything pointing at it can be followed); its bound cues,
 * relationships, arc turns and key lines move to the winner. The winner's
 * profile stays the winner's. `false` when either record is not live here.
 */
export const mergeCharacterRecords = async (
  scope: ProjectScope,
  loser: CharacterId,
  winner: CharacterId,
): Promise<boolean> => {
  if ((loser as string) === (winner as string)) return false
  const rows = await dbOf(scope).execute(sql`
    with pair as (
      select count(*)::int as n from ${characters}
      where ${scoped(scope, characters)}
        and ${characters.id} in (${loser}, ${winner})
        and ${characters.mergedInto} is null
    ),
    ok as (select (select n from pair) = 2 as ok),
    cues as (
      update ${characterBoundCues} set character_id = ${winner}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, loser))}
        and (select ok from ok)
      returning cue
    ),
    rel_out as (
      insert into ${characterRelationships} (project_id, character_id, other_id, what, shift)
      select project_id, ${winner}, other_id, what, shift from ${characterRelationships}
      where ${scoped(scope, characterRelationships, eq(characterRelationships.characterId, loser))}
        and other_id <> ${winner}
        and (select ok from ok)
      on conflict do nothing
      returning other_id
    ),
    rel_in as (
      insert into ${characterRelationships} (project_id, character_id, other_id, what, shift)
      select project_id, character_id, ${winner}, what, shift from ${characterRelationships}
      where ${scoped(scope, characterRelationships, eq(characterRelationships.otherId, loser))}
        and character_id <> ${winner}
        and (select ok from ok)
      on conflict do nothing
      returning character_id
    ),
    rel_gone as (
      delete from ${characterRelationships}
      where ${scoped(scope, characterRelationships)}
        and (${characterRelationships.characterId} = ${loser} or ${characterRelationships.otherId} = ${loser})
        and (select ok from ok)
      returning character_id
    ),
    turns as (
      update ${characterArcTurns} set character_id = ${winner},
        position = position + 1 + coalesce((select max(t.position) from ${characterArcTurns} t
          where t.project_id = ${scope.projectId} and t.character_id = ${winner}), -1)
      where ${scoped(scope, characterArcTurns, eq(characterArcTurns.characterId, loser))}
        and (select ok from ok)
      returning id
    ),
    lines as (
      update ${characters} set key_lines = ${characters.keyLines} || (
        select l.key_lines from ${characters} l where l.project_id = ${scope.projectId} and l.id = ${loser}
      ), updated_at = now()
      where ${scoped(scope, characters, eq(characters.id, winner))} and (select ok from ok)
      returning id
    ),
    merged as (
      update ${characters} set merged_into = ${winner}, updated_at = now()
      where ${scoped(scope, characters, eq(characters.id, loser))} and (select ok from ok)
      returning id
    )
    select (select count(*)::int from merged) as merged
  `)
  const row = rows[0] as { readonly merged: number } | undefined
  return (row?.merged ?? 0) > 0
}

/**
 * Delete a record the script no longer holds. Refused - `false` - while it is
 * present: a record deleted under a live cue would be minted again on the
 * next pass, which is not what anyone pressing Delete meant. The cascades
 * take the bound cues, relationships, turns and derived rows with it.
 */
export const deleteAbsentCharacter = async (
  scope: ProjectScope,
  id: CharacterId,
): Promise<'deleted' | 'present' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      select ${characters.id} as id,
        exists (select 1 from ${characterDerivations} d
          where d.project_id = ${scope.projectId} and d.character_id = ${characters.id} and d.presence = 'present') as present
      from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null
    ),
    gone as (
      delete from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))}
        and exists (select 1 from record where not present)
      returning id
    )
    select (select count(*)::int from record) as found,
      coalesce((select present from record limit 1), false) as present,
      (select count(*)::int from gone) as deleted
  `)
  const row = rows[0] as
    | { readonly found: number; readonly present: boolean; readonly deleted: number }
    | undefined
  if (row === undefined || row.found === 0) return 'missing'
  if (row.present) return 'present'
  return 'deleted'
}
