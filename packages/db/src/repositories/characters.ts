import type {
  CharacterColor,
  CharacterFindingId,
  CharacterFindingStatus,
  CharacterGender,
  CharacterOrigin,
  CharacterProfileEdit,
  CharacterStatus,
  EpisodeSlug,
  Timestamp,
} from '@folio/contracts'
import { CHARACTER_ORIGINS, characterFindingId as brandFindingId, episodeSlug as brandEpisodeSlug } from '@folio/contracts'
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
  locationId as brandLocationId,
} from '@folio/script'
import { asc, desc, eq, sql } from 'drizzle-orm'

import {
  characterBoundCues,
  characterCueTallies,
  characterDerivations,
  characterFindings,
  characterRelationships,
  characters,
  documents,
  episodes,
  nodes,
  resolveRows,
  sceneDerivations,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp } from './mapping'

/**
 * The Characters route's reads, and every authored write it makes.
 *
 * ## The split, from this side
 *
 * `characters` and `character_bound_cues` are AUTHORED (`schema/derived.ts`;
 * `character_relationships` is too, and since `0013` nothing on the route
 * writes it); the route reads them beside the DERIVED CACHE rows - `character_derivations`,
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
  readonly color: CharacterColor
  readonly gender: CharacterGender | null
  readonly age: string | null
  readonly role: string | null
  readonly bio: string | null
  readonly appearance: string | null
  readonly status: CharacterStatus
  readonly wants: string | null
  readonly needs: string | null
  readonly portraitKey: string | null
  /** Where the record came from; null on a record made before `0021`. */
  readonly origin: CharacterOrigin | null
  readonly createdAt: Timestamp
  /** Null until the first derivation pass after the record was made by hand. */
  readonly derived: {
    readonly appearances: number
    readonly lines: number
    readonly mentions: number
    readonly presence: Presence
    readonly scenes: readonly NodeId[]
    readonly words: number
    readonly speeches: number
    readonly parens: number
    readonly namedIn: number
    readonly firstLine: SpokenAt | null
    readonly lastLine: SpokenAt | null
    readonly longest: (SpokenAt & { readonly words: number }) | null
    readonly introducedAt: SpokenAt | null
    readonly sceneCounts: readonly { readonly scene: NodeId; readonly lines: number; readonly words: number }[]
    readonly exchanges: readonly { readonly other: CharacterId; readonly count: number; readonly scenes: readonly NodeId[] }[]
  } | null
}

/** A node and the heading it sits under, as the derivation row stores it. */
export type SpokenAt = { readonly nodeId: NodeId; readonly scene: NodeId | null }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isOrigin = (value: unknown): value is CharacterOrigin =>
  typeof value === 'string' && (CHARACTER_ORIGINS as readonly string[]).includes(value)

/** A stored `{ nodeId, scene }`, read defensively: the JSON column is a cache the next pass rewrites. */
const spokenAtOf = (value: unknown): SpokenAt | null => {
  if (!isRecord(value) || typeof value['nodeId'] !== 'string') return null
  return { nodeId: value['nodeId'] as NodeId, scene: typeof value['scene'] === 'string' ? (value['scene'] as NodeId) : null }
}

const longestOf = (value: unknown): (SpokenAt & { readonly words: number }) | null => {
  const at = spokenAtOf(value)
  if (at === null || !isRecord(value)) return null
  return { ...at, words: typeof value['words'] === 'number' ? value['words'] : 0 }
}

const sceneCountsOf = (value: unknown): readonly { readonly scene: NodeId; readonly lines: number; readonly words: number }[] =>
  Array.isArray(value)
    ? value.flatMap((entry: unknown) =>
        isRecord(entry) && typeof entry['scene'] === 'string'
          ? [
              {
                scene: entry['scene'] as NodeId,
                lines: typeof entry['lines'] === 'number' ? entry['lines'] : 0,
                words: typeof entry['words'] === 'number' ? entry['words'] : 0,
              },
            ]
          : [],
      )
    : []

const exchangesOf = (value: unknown): readonly { readonly other: CharacterId; readonly count: number; readonly scenes: readonly NodeId[] }[] =>
  Array.isArray(value)
    ? value.flatMap((entry: unknown) =>
        isRecord(entry) && typeof entry['other'] === 'string'
          ? [
              {
                other: brandCharacterId(entry['other']),
                count: typeof entry['count'] === 'number' ? entry['count'] : 0,
                scenes: Array.isArray(entry['scenes']) ? (entry['scenes'].filter((id: unknown) => typeof id === 'string') as NodeId[]) : [],
              },
            ]
          : [],
      )
    : []

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
    color: record.color as CharacterColor,
    gender: record.gender,
    age: record.age,
    role: record.role,
    bio: record.bio,
    appearance: record.appearance,
    status: record.status,
    wants: record.wants,
    needs: record.needs,
    portraitKey: record.portraitKey,
    origin: isOrigin(record.origin) ? record.origin : null,
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
            words: derived.words,
            speeches: derived.speeches,
            parens: derived.parens,
            namedIn: derived.namedIn,
            firstLine: spokenAtOf(derived.firstLine),
            lastLine: spokenAtOf(derived.lastLine),
            longest: longestOf(derived.longest),
            introducedAt: spokenAtOf(derived.introducedAt),
            sceneCounts: sceneCountsOf(derived.sceneCounts),
            exchanges: exchangesOf(derived.exchanges),
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
  readonly words: number
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
    words: row.words,
  }))
}

export type BoundCueRow = {
  readonly characterId: CharacterId
  readonly cue: string
  /** Null when derivation bound it (a mint, or the name's own spelling); a user id when a person did. */
  readonly boundBy: string | null
}

/** The alias table's authored half, whole. AUTHORED. */
export const listBoundCues = async (scope: ProjectScope): Promise<readonly BoundCueRow[]> => {
  const rows = await dbOf(scope)
    .select({
      characterId: characterBoundCues.characterId,
      cue: characterBoundCues.cue,
      boundBy: characterBoundCues.boundBy,
    })
    .from(characterBoundCues)
    .where(scoped(scope, characterBoundCues))
    .orderBy(asc(characterBoundCues.boundAt))
  return rows.map((row) => ({
    characterId: brandCharacterId(row.characterId),
    cue: row.cue,
    boundBy: row.boundBy,
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
  /** Dialogue words under the heading, every cue counted (`0021`). */
  readonly words: number
  readonly cast: readonly CharacterId[]
  readonly speaking: readonly CharacterId[]
  readonly mentioned: readonly CharacterId[]
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
      words: sceneDerivations.words,
      cast: sceneDerivations.cast,
      speaking: sceneDerivations.speaking,
      mentioned: sceneDerivations.mentioned,
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
      words: row.words,
      cast: row.cast as CharacterId[],
      speaking: row.speaking as CharacterId[],
      mentioned: row.mentioned as CharacterId[],
      episode: brandEpisodeSlug(row.episode),
      episodeOrdinal: row.episodeOrdinal,
      ...readingOf(row.reading),
    }
  })
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

// ---------------------------------------------------------------------------
// Writes - the record
// ---------------------------------------------------------------------------

/** Insert a record by hand, with whatever profile the drawer filled in. `origin` is `hand` unless the assistant made it. */
export const createCharacterRecord = async (
  scope: ProjectScope,
  name: string,
  edit: CharacterProfileEdit,
  origin: Extract<CharacterOrigin, 'hand' | 'agent'> = 'hand',
): Promise<CharacterId> => {
  const rows = await dbOf(scope)
    .insert(characters)
    .values({ ...tenant(scope), name, origin, ...profileColumns(edit) })
    .returning({ id: characters.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a character returned no row.')
  return brandCharacterId(row.id)
}

const blank = (value: string | null | undefined): string | null =>
  value === undefined || value === '' ? null : value

/** The columns an edit sets - each present field written whole, an empty string stored as null. */
const profileColumns = (edit: CharacterProfileEdit) => ({
  ...(edit.color === undefined ? {} : { color: edit.color }),
  ...(edit.gender === undefined ? {} : { gender: edit.gender }),
  ...(edit.age === undefined ? {} : { age: blank(edit.age) }),
  ...(edit.role === undefined ? {} : { role: blank(edit.role) }),
  ...(edit.bio === undefined ? {} : { bio: blank(edit.bio) }),
  ...(edit.appearance === undefined ? {} : { appearance: blank(edit.appearance) }),
  ...(edit.status === undefined ? {} : { status: edit.status }),
  ...(edit.wants === undefined ? {} : { wants: blank(edit.wants) }),
  ...(edit.needs === undefined ? {} : { needs: blank(edit.needs) }),
})

/** Write the fields present in `edit`, whole. `false` when the record is not here. */
export const updateCharacterProfile = async (
  scope: ProjectScope,
  id: CharacterId,
  edit: CharacterProfileEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(characters)
    .set({ ...profileColumns(edit), updatedAt: new Date() })
    .where(scoped(scope, characters, eq(characters.id, id), sql`${characters.mergedInto} IS NULL`))
    .returning({ id: characters.id })
  return rows.length > 0
}

/**
 * Point the record at a new portrait object, or at none. Returns the key
 * it replaced, so the caller can delete the old object after the row says
 * the new one is the portrait - never before.
 */
export const setPortraitKey = async (
  scope: ProjectScope,
  id: CharacterId,
  key: string | null,
): Promise<{ readonly found: boolean; readonly previous: string | null }> => {
  const rows = await dbOf(scope).execute(sql`
    with before as (
      select ${characters.portraitKey} as previous from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null
    ),
    written as (
      update ${characters} set portrait_key = ${key}, updated_at = now()
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null
      returning id
    )
    select (select count(*)::int from written) as found, (select previous from before limit 1) as previous
  `)
  const row = rows[0] as { readonly found: number; readonly previous: string | null } | undefined
  return { found: (row?.found ?? 0) > 0, previous: row?.previous ?? null }
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

export type MoveOutcome =
  | { readonly status: 'moved'; readonly from: CharacterId | null }
  /** Already bound to `toId`. Nothing to do. */
  | { readonly status: 'already' }
  /** The holder's last spelling; moving it would leave that record with none. */
  | { readonly status: 'last'; readonly by: CharacterId }
  | { readonly status: 'missing' }

/**
 * Move a spelling from whichever record holds it to `toId` - the alias
 * table's `Move it here`, when a bind is refused as `taken`. One statement
 * rather than an unbind and a bind: the request path pays two round trips
 * per statement, and between two statements the spelling would be bound
 * nowhere, which a concurrent pass would read as a cue to mint against. The
 * holder keeps it when it is their last (the `unbindCue` rule). A spelling
 * nobody holds is simply bound, so this is also a bind.
 */
export const moveBoundCue = async (
  scope: ProjectScope,
  cue: string,
  toId: CharacterId,
): Promise<MoveOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with holder as (
      select ${characterBoundCues.characterId} as character_id from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.cue, cue))}
    ),
    held as (
      select count(*)::int as n from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues)}
        and ${characterBoundCues.characterId} = (select character_id from holder limit 1)
    ),
    target as (
      select ${characters.id} as id from ${characters}
      where ${scoped(scope, characters, eq(characters.id, toId))} and ${characters.mergedInto} is null
    ),
    removed as (
      delete from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.cue, cue))}
        and ${characterBoundCues.characterId} <> ${toId}
        and (select n from held) > 1
        and exists (select 1 from target)
      returning cue
    ),
    bound as (
      insert into ${characterBoundCues} (project_id, character_id, cue, bound_by)
      select ${scope.projectId}, ${toId}, ${cue}, ${scope.actor}::uuid
      where exists (select 1 from target)
        and (not exists (select 1 from holder) or exists (select 1 from removed))
      on conflict do nothing
      returning cue
    )
    select
      (select character_id from holder limit 1) as holder,
      coalesce((select n from held), 0) as held,
      (select count(*)::int from target) as target,
      (select count(*)::int from removed) as removed,
      (select count(*)::int from bound) as bound
  `)
  const row = rows[0] as
    | {
        readonly holder: string | null
        readonly held: number
        readonly target: number
        readonly removed: number
        readonly bound: number
      }
    | undefined
  if (row === undefined) throw new Error('Folio: moving a cue returned no row. This is a bug in the repository.')
  if (row.target === 0) return { status: 'missing' }
  if (row.holder === (toId as string)) return { status: 'already' }
  if (row.holder !== null && row.removed === 0) return { status: 'last', by: brandCharacterId(row.holder) }
  if (row.bound === 0) return { status: 'missing' }
  return { status: 'moved', from: row.holder === null ? null : brandCharacterId(row.holder) }
}

export type SplitOutcome =
  | { readonly status: 'split'; readonly id: CharacterId }
  /** The record's only spelling; splitting it off would leave the record with none. */
  | { readonly status: 'last' }
  | { readonly status: 'missing' }

/**
 * Split a bound spelling off into a record of its own - the alias table's
 * `Split off`, for a cue the writer once accepted as an alias and now says
 * is somebody else. Three writes in one statement (unbind here, insert the
 * record, bind there) so a half-finished split cannot strand the spelling;
 * the script is untouched, and the next pass counts the cues under the new
 * record. Refused as `last` on the record's only spelling, as `unbindCue` is.
 */
export const splitBoundCue = async (
  scope: ProjectScope,
  fromId: CharacterId,
  cue: string,
  name: string,
  color: CharacterColor,
): Promise<SplitOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with held as (
      select ${characterBoundCues.cue} as cue from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, fromId))}
    ),
    removed as (
      delete from ${characterBoundCues}
      where ${scoped(scope, characterBoundCues, eq(characterBoundCues.characterId, fromId), eq(characterBoundCues.cue, cue))}
        and (select count(*) from held) > 1
      returning cue
    ),
    created as (
      insert into ${characters} (project_id, name, color, origin)
      select ${scope.projectId}, ${name}, ${color}, 'hand'::character_origin
      where exists (select 1 from removed)
      returning id
    ),
    bound as (
      insert into ${characterBoundCues} (project_id, character_id, cue, bound_by)
      select ${scope.projectId}, created.id, ${cue}, ${scope.actor}::uuid from created
      on conflict do nothing
      returning cue
    )
    select
      exists (select 1 from held where cue = ${cue}) as present,
      (select count(*)::int from removed) as removed,
      (select id from created limit 1) as id
  `)
  const row = rows[0] as
    | { readonly present: boolean; readonly removed: number; readonly id: string | null }
    | undefined
  if (row === undefined) throw new Error('Folio: splitting a cue returned no row. This is a bug in the repository.')
  if (!row.present) return { status: 'missing' }
  if (row.removed === 0 || row.id === null) return { status: 'last' }
  return { status: 'split', id: brandCharacterId(row.id) }
}

// ---------------------------------------------------------------------------
// Writes - merge, delete
// ---------------------------------------------------------------------------

/**
 * Merge `loser` into `winner`: the writer's decision that two records were
 * one person. One statement. The loser's row is kept with `merged_into` set
 * (a tombstone, so anything pointing at it can be followed); its bound cues
 * and relationships move to the winner. The winner's profile stays the
 * winner's, portrait included. `false` when either record is not live here.
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
 * take the bound cues, relationships and derived rows with it; the portrait
 * object, if any, is the caller's to delete.
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

/**
 * Delete a record that has nothing on it: no profile field, no portrait,
 * `draft`, at most one bound spelling - regardless of presence. The one
 * caller is the queue's `Undo` of a `New character` decision within its few
 * seconds: the record it minted is seconds old and empty, and the cue that
 * minted it goes back to the queue. A record with anything written on it is
 * `kept` (the caller unbinds instead), so nothing a writer typed is lost.
 */
export const deleteBlankCharacter = async (
  scope: ProjectScope,
  id: CharacterId,
): Promise<'deleted' | 'kept' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      select ${characters.id} as id,
        (${characters.bio} is null and ${characters.role} is null and ${characters.age} is null
          and ${characters.appearance} is null and ${characters.wants} is null and ${characters.needs} is null
          and ${characters.portraitKey} is null and ${characters.status} = 'draft'
          and (select count(*) from ${characterBoundCues} b
            where b.project_id = ${scope.projectId} and b.character_id = ${characters.id}) <= 1) as blank
      from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))} and ${characters.mergedInto} is null
    ),
    gone as (
      delete from ${characters}
      where ${scoped(scope, characters, eq(characters.id, id))}
        and exists (select 1 from record where blank)
      returning id
    )
    select (select count(*)::int from record) as found,
      coalesce((select blank from record limit 1), false) as blank,
      (select count(*)::int from gone) as deleted
  `)
  const row = rows[0] as
    | { readonly found: number; readonly blank: boolean; readonly deleted: number }
    | undefined
  if (row === undefined || row.found === 0) return 'missing'
  if (!row.blank || row.deleted === 0) return 'kept'
  return 'deleted'
}

// ---------------------------------------------------------------------------
// Findings (the Characters rebuild, phase 4)
// ---------------------------------------------------------------------------

export type CharacterFindingRow = {
  readonly id: CharacterFindingId
  readonly characterId: CharacterId
  readonly status: CharacterFindingStatus
  readonly aRef: NodeId
  readonly bRef: NodeId
  readonly aQuote: string
  readonly bQuote: string
  readonly claim: string
  readonly claimHash: string
  readonly createdAt: Timestamp
}

const findingOf = (row: typeof characterFindings.$inferSelect): CharacterFindingRow => ({
  id: brandFindingId(row.id),
  characterId: brandCharacterId(row.characterId),
  status: row.status,
  aRef: row.aRef as NodeId,
  bRef: row.bRef as NodeId,
  aQuote: row.aQuote,
  bQuote: row.bQuote,
  claim: row.claim,
  claimHash: row.claimHash,
  createdAt: stamp(row.createdAt),
})

/** Every finding on a record, open first, newest first within a status. AUTHORED (the assistant's, and the writer's verdict). */
export const listCharacterFindings = async (
  scope: ProjectScope,
  characterId: CharacterId,
): Promise<readonly CharacterFindingRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(characterFindings)
    .where(scoped(scope, characterFindings, eq(characterFindings.characterId, characterId)))
    .orderBy(asc(characterFindings.status), desc(characterFindings.createdAt), asc(characterFindings.id))
  return rows.map(findingOf)
}

export type FindingInsert = {
  readonly aRef: NodeId
  readonly bRef: NodeId
  readonly aQuote: string
  readonly bQuote: string
  readonly claim: string
  readonly claimHash: string
}

/**
 * Replace the open findings on a record with a fresh check's. One
 * statement: the open rows the re-check did not reproduce go, the new set
 * is inserted `on conflict do nothing` against the dedupe key - so a row
 * the writer marked deliberate keeps its verdict and blocks its own
 * re-insert, and an open row that came back stays as it was. Not a
 * delete-then-insert of the same key: a data-modifying CTE sees one
 * snapshot, and deleting a key then inserting it in the same statement
 * would conflict with the row the delete has not yet removed.
 */
export const replaceOpenFindings = async (
  scope: ProjectScope,
  characterId: CharacterId,
  findings: readonly FindingInsert[],
): Promise<{ readonly inserted: number; readonly removed: number }> => {
  const rows = findings.map((finding) => ({
    a_ref: finding.aRef,
    b_ref: finding.bRef,
    a_quote: finding.aQuote,
    b_quote: finding.bQuote,
    claim: finding.claim,
    claim_hash: finding.claimHash,
  }))
  const result = await dbOf(scope).execute(sql`
    with fresh as (
      select * from jsonb_to_recordset(${jsonb(rows)})
        as r(a_ref uuid, b_ref uuid, a_quote text, b_quote text, claim text, claim_hash text)
    ),
    gone as (
      delete from ${characterFindings}
      where ${scoped(scope, characterFindings, eq(characterFindings.characterId, characterId), eq(characterFindings.status, 'open'))}
        and not exists (
          select 1 from fresh
          where fresh.a_ref = ${characterFindings.aRef} and fresh.b_ref = ${characterFindings.bRef}
            and fresh.claim_hash = ${characterFindings.claimHash}
        )
      returning id
    ),
    added as (
      insert into ${characterFindings} (project_id, character_id, kind, status, a_ref, b_ref, a_quote, b_quote, claim, claim_hash)
      select ${scope.projectId}, ${characterId}, 'contradiction'::character_finding_kind, 'open'::character_finding_status,
        fresh.a_ref, fresh.b_ref, fresh.a_quote, fresh.b_quote, fresh.claim, fresh.claim_hash
      from fresh
      on conflict (project_id, character_id, a_ref, b_ref, claim_hash) do nothing
      returning id
    )
    select (select count(*)::int from added) as inserted, (select count(*)::int from gone) as removed
  `)
  const row = result[0] as { readonly inserted: number; readonly removed: number } | undefined
  return { inserted: row?.inserted ?? 0, removed: row?.removed ?? 0 }
}

/** The writer's verdict on a finding: `deliberate`, or back to `open`. The row as it now stands, or null when it is not here. */
export const setFindingStatus = async (
  scope: ProjectScope,
  id: CharacterFindingId,
  status: CharacterFindingStatus,
): Promise<CharacterFindingRow | null> => {
  const rows = await dbOf(scope)
    .update(characterFindings)
    .set({ status })
    .where(scoped(scope, characterFindings, eq(characterFindings.id, id)))
    .returning()
  const row = rows[0]
  return row === undefined ? null : findingOf(row)
}
