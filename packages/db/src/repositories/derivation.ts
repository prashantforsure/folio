import type {
  CharacterId,
  CharacterRecord,
  DerivedEntities,
  LocationId,
  LocationRecord,
  MentionLabel,
  MintedRecord,
  ProposalDecision,
  ProposalTarget,
  ResolveRow,
  ResolveSubject,
  SceneRecord,
  SluglineReading,
} from '@folio/script'
import { NO_COUNTS, characterId, locationId } from '@folio/script'
import type { AuthoredNotes, NodeId } from '@folio/script'
import { asc, sql } from 'drizzle-orm'

import {
  characterBoundCues,
  characterRelationships,
  characters,
  locationBoundSluglines,
  locations,
  resolveDecisions,
  resolveRows,
  sceneDerivations,
  scenes,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'

/**
 * The input side of a derivation pass, and the one authored write it needs.
 *
 * `derived.ts` holds the output side - `commitDerivation`, which may write only
 * the six derived-cache tables and imports no authored one. This file is its
 * mirror: it **reads** the authored tables so that `derive` reconciles against
 * what a human has written (bound cues, a location's parent, a synopsis), and
 * it writes exactly one kind of authored row - the record a pass *minted*.
 *
 * ## Why minting is an authored write
 *
 * AGENTS.md, Derivation: "Records survive deletion." A character record is a
 * stable UUID with a name attribute (Entity identity), and the `characters`
 * table is classified AUTHORED because its bio, notes and bound cues are. But
 * the row has to come into existence somehow, and the thing that first notices
 * `MEERA` is derivation. So `persistMintedRecords` inserts the row with the
 * name the cue gave it, and from then on the row is the writer's: a re-derive
 * touches `character_derivations`, never this table.
 *
 * ## What the previous entities are, exactly
 *
 * `derive(nodes, previous, ids)` reads from `previous` only what a pass cannot
 * recompute: each record's `id` and `authored` half, each scene's `authored`
 * half, and each queue row's `decisions`. The derived halves are rebuilt on
 * every pass. So the records assembled here carry their authored data from the
 * authored tables and their derived data zeroed - `presence: 'absent'`,
 * `appearances: 0` - which `derive` overwrites. The one exception is a scene's
 * `heading` and `reading`, which an absent scene keeps verbatim; those come
 * from `scene_derivations`.
 */

const emptyNotes = (value: unknown): AuthoredNotes =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as AuthoredNotes)
    : {}

export const readDerivationInput = async (scope: ProjectScope): Promise<DerivedEntities> => {
  const db = dbOf(scope)
  const [
    characterRows,
    cueRows,
    relationshipRows,
    locationRows,
    sluglineRows,
    sceneRows,
    sceneDerivationRows,
    queueRows,
    decisionRows,
  ] = await Promise.all([
    db.select().from(characters).where(scoped(scope, characters)).orderBy(asc(characters.createdAt)),
    db.select().from(characterBoundCues).where(scoped(scope, characterBoundCues)),
    db.select().from(characterRelationships).where(scoped(scope, characterRelationships)),
    db.select().from(locations).where(scoped(scope, locations)).orderBy(asc(locations.createdAt)),
    db.select().from(locationBoundSluglines).where(scoped(scope, locationBoundSluglines)),
    db.select().from(scenes).where(scoped(scope, scenes)),
    db.select().from(sceneDerivations).where(scoped(scope, sceneDerivations)),
    db.select().from(resolveRows).where(scoped(scope, resolveRows)),
    db.select().from(resolveDecisions).where(scoped(scope, resolveDecisions)),
  ])

  const cuesByCharacter = new Map<string, string[]>()
  for (const row of cueRows) {
    const list = cuesByCharacter.get(row.characterId) ?? []
    list.push(row.cue)
    cuesByCharacter.set(row.characterId, list)
  }
  const relationshipsByCharacter = new Map<string, CharacterRecord['authored']['relationships'][number][]>()
  for (const row of relationshipRows) {
    const list = relationshipsByCharacter.get(row.characterId) ?? []
    list.push({ other: row.otherId as CharacterId, what: row.what })
    relationshipsByCharacter.set(row.characterId, list)
  }

  const characterRecords: CharacterRecord[] = characterRows
    // A record merged into another is retired from derivation's point of view.
    .filter((row) => row.mergedInto === null)
    .map((row) => ({
      id: row.id as CharacterId,
      authored: {
        name: row.name,
        boundCues: cuesByCharacter.get(row.id) ?? [],
        bio: row.bio,
        relationships: relationshipsByCharacter.get(row.id) ?? [],
        notes: emptyNotes(row.notes),
      },
      cues: [],
      appearances: 0,
      scenes: [],
      lines: 0,
      mentions: 0,
      presence: 'absent',
    }))

  const sluglinesByLocation = new Map<string, string[]>()
  for (const row of sluglineRows) {
    const list = sluglinesByLocation.get(row.locationId) ?? []
    list.push(row.slugline)
    sluglinesByLocation.set(row.locationId, list)
  }

  const locationRecords: LocationRecord[] = locationRows
    // A record merged into another is retired, as a merged character is.
    .filter((row) => row.mergedInto === null)
    .map((row) => ({
      id: row.id as LocationId,
      authored: {
        name: row.name,
        parent: row.parentId === null ? null : (row.parentId as LocationId),
        boundSluglines: sluglinesByLocation.get(row.id) ?? [],
        scheduledDays: row.scheduledDays,
        description: row.description,
        notes: emptyNotes(row.notes),
      },
      sluglines: [],
      children: [],
      depth: 0,
      own: NO_COUNTS,
      rollup: NO_COUNTS,
      scenes: [],
      presence: 'absent',
    }))

  const authoredScene = new Map(sceneRows.map((row) => [row.sceneNodeId, row]))
  const sceneRecords: SceneRecord[] = sceneDerivationRows.map((row) => {
    const authored = authoredScene.get(row.sceneNodeId)
    return {
      id: row.sceneNodeId as NodeId,
      number: row.number,
      heading: row.heading,
      reading: row.reading as SluglineReading,
      locationId: null,
      cast: [],
      speaking: [],
      mentioned: [],
      unresolvedCues: [],
      castSize: 0,
      lines: 0,
      presence: 'absent',
      authored: {
        synopsis: authored?.synopsis ?? null,
        storyTime: authored?.storyTime ?? null,
        beats: authored?.beats ?? [],
        threads: authored?.threads ?? [],
        notes: emptyNotes(authored?.notes),
      },
    }
  })

  const decisionsByRow = new Map<string, ProposalDecision[]>()
  for (const row of decisionRows) {
    const list = decisionsByRow.get(row.rowKey) ?? []
    list.push({ verdict: row.verdict, target: row.target as ProposalTarget })
    decisionsByRow.set(row.rowKey, list)
  }

  const queue: ResolveRow[] = queueRows.map((row) => ({
    subject: row.subject as ResolveSubject,
    occurrences: row.occurrences,
    scenes: row.scenes as NodeId[],
    proposal: null,
    suppressed: [],
    state: row.state,
    decisions: decisionsByRow.get(row.key) ?? [],
  }))

  return { characters: characterRecords, locations: locationRecords, scenes: sceneRecords, queue }
}

/**
 * Give the records a pass minted their authored row - **and their first alias.**
 *
 * The name is the cue or set text that minted the record - `MintedRecord.from`
 * - and it is written once, here. Renaming it afterwards is one of the two
 * sanctioned write-backs and is a different, diffed operation.
 *
 * The alias is not optional. `derive.ts`: "A cue never binds by resemblance.
 * Only an **exact key match against an authored bound cue** resolves", and the
 * record it builds for a mint carries `boundCues: [mint.cue]` for exactly that
 * reason. This function used to persist the name and not the cue, so on the
 * *next* pass the same `MEERA` resembled a record it was not bound to, which
 * is the proposal case - and a fresh record was minted beside it every time
 * derivation ran. Found in the Scenes route phase: three `ARJUN`s after three
 * passes, and every scene's cast pointing at whichever one that pass had
 * minted. The bound row is what the pure core's own output says exists, and
 * `readDerivationInput` reads it back into `boundCues` where `derive` expects
 * it. `bound_by` is null: the binding is derivation's, not a person's.
 */
export const persistMintedRecords = async (
  scope: ProjectScope,
  minted: readonly MintedRecord[],
): Promise<void> => {
  const characterRowsToAdd = minted.flatMap((record) =>
    record.kind === 'character'
      ? [{ ...tenant(scope), id: record.id as string, name: record.from }]
      : [],
  )
  const cueRowsToAdd = minted.flatMap((record) =>
    record.kind === 'character'
      ? [{ ...tenant(scope), characterId: record.id as string, cue: record.from }]
      : [],
  )
  const locationRowsToAdd = minted.flatMap((record) =>
    record.kind === 'location'
      ? [{ ...tenant(scope), id: record.id as string, name: record.from, parentId: null }]
      : [],
  )
  const sluglineRowsToAdd = minted.flatMap((record) =>
    record.kind === 'location'
      ? [{ ...tenant(scope), locationId: record.id as string, slugline: record.from }]
      : [],
  )
  if (characterRowsToAdd.length === 0 && locationRowsToAdd.length === 0) return
  // One statement rather than a transaction of four: the request path pays
  // two round trips per parameterised statement (`client.ts`). The cue and
  // slugline rows reference the records inserted beside them; a foreign key
  // is checked at the end of the statement, so the pair lands together.
  await dbOf(scope).execute(sql`
    with
    minted_characters as (
      insert into ${characters} (project_id, id, name)
      select ${scope.projectId}, r.id, r.name
      from jsonb_to_recordset(${jsonb(characterRowsToAdd.map((row) => ({ id: row.id, name: row.name })))}) as r(id uuid, name text)
      on conflict do nothing
      returning id
    ),
    minted_cues as (
      insert into ${characterBoundCues} (project_id, character_id, cue)
      select ${scope.projectId}, r.character_id, r.cue
      from jsonb_to_recordset(${jsonb(cueRowsToAdd.map((row) => ({ character_id: row.characterId, cue: row.cue })))}) as r(character_id uuid, cue text)
      on conflict do nothing
      returning character_id
    ),
    minted_locations as (
      insert into ${locations} (project_id, id, name, parent_id)
      select ${scope.projectId}, r.id, r.name, null
      from jsonb_to_recordset(${jsonb(locationRowsToAdd.map((row) => ({ id: row.id, name: row.name })))}) as r(id uuid, name text)
      on conflict do nothing
      returning id
    ),
    minted_sluglines as (
      insert into ${locationBoundSluglines} (project_id, location_id, slugline)
      select ${scope.projectId}, r.location_id, r.slugline
      from jsonb_to_recordset(${jsonb(sluglineRowsToAdd.map((row) => ({ location_id: row.locationId, slugline: row.slugline })))}) as r(location_id uuid, slugline text)
      on conflict do nothing
      returning location_id
    )
    select (select count(*) from minted_characters) + (select count(*) from minted_cues)
         + (select count(*) from minted_locations) + (select count(*) from minted_sluglines) as minted
  `)
}

/**
 * The labels an `@mention` and the paginator render: every record's name.
 *
 * A mention stores no label (`@folio/script`, `inline.ts`), so the sheet and
 * the measurer both need this book. Read from the authored tables because the
 * name is authored.
 */
export const readMentionLabels = async (
  scope: ProjectScope,
): Promise<readonly MentionLabel[]> => {
  const db = dbOf(scope)
  const [characterRows, locationRows] = await Promise.all([
    db
      .select({ id: characters.id, name: characters.name, mergedInto: characters.mergedInto })
      .from(characters)
      .where(scoped(scope, characters))
      .orderBy(asc(characters.name)),
    db
      .select({ id: locations.id, name: locations.name, mergedInto: locations.mergedInto })
      .from(locations)
      .where(scoped(scope, locations))
      .orderBy(asc(locations.name)),
  ])
  return [
    ...characterRows
      .filter((row) => row.mergedInto === null)
      .map((row) => ({ entity: 'character' as const, id: characterId(row.id), label: row.name })),
    ...locationRows
      .filter((row) => row.mergedInto === null)
      .map((row) => ({ entity: 'location' as const, id: locationId(row.id), label: row.name })),
  ]
}

/**
 * Create a character or location by hand, for an `@mention` to point at.
 *
 * The bundle's hint: "`@` mention a character or location" - and the brief:
 * "the mention creates the structural link that feeds derivation, which is
 * how a character who is discussed but never speaks gets a record." A person
 * who never speaks has no cue for derivation to mint from, so the record is
 * authored here, once, and derivation counts the mention edge from then on.
 */
export const createMentionTarget = async (
  scope: ProjectScope,
  entity: 'character' | 'location',
  name: string,
): Promise<MentionLabel> => {
  const db = dbOf(scope)
  if (entity === 'character') {
    const rows = await db
      .insert(characters)
      .values({ ...tenant(scope), name })
      .returning({ id: characters.id, name: characters.name })
    const row = rows[0]
    if (row === undefined) throw new Error('Folio: inserting a character returned no row.')
    return { entity, id: characterId(row.id), label: row.name }
  }
  const rows = await db
    .insert(locations)
    .values({ ...tenant(scope), name, parentId: null })
    .returning({ id: locations.id, name: locations.name })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a location returned no row.')
  return { entity, id: locationId(row.id), label: row.name }
}

