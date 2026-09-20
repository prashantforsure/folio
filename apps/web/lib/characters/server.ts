import type { CastRow, CharacterProfile, CueVariantRow, PairItem, Relationship, ResolveCandidate, ResolveItem, ResolveProposal, SceneRef } from '@folio/contracts'
import { hueOfColor } from '@folio/contracts'
import { listBoundCues, listCharacterRecords, listCueTallies, listOpenCueRows, listRelationships, listResolveDecisions, listSceneIndex, readMergedInto } from '@folio/db'
import type { CharacterRecordRow, CueTallyRow, RelationshipRow } from '@folio/db'
import type { CharacterId, CharacterNamePool, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, matchCharacterNames, similarRecords } from '@folio/script'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { deriveSpeculatively, readDerivationReads } from '../script/server'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import { characterHref } from '../workspace/hrefs'
import { sceneRefOf } from './figures'
import type { DialogueEdge } from './graph'
import { dialogueEdges } from './graph'

/**
 * Everything the Characters route reads, and where each part comes from.
 *
 * Like the Scenes loader this is a *join*, never a computation over the
 * script: every count comes from the table that owns it -
 *
 *   `cast[]`           `characters` ⋈ `character_derivations` ⋈ `character_cue_tallies`
 *                      (`listCharacterRecords`, `listCueTallies`) - the record, the
 *                      counts the pass wrote, its counted spellings, where the
 *                      canvas left its card
 *   `relationships[]`  `character_relationships` between live records
 *                      (`listRelationships`) - the canvas threads, the graph's edges
 *   `dialogue[]`       who talks to whom, from `character_derivations.exchanges`
 *                      (`dialogueEdges`) - the graph's `Dialogue` layout
 *   `index[]`          `scene_derivations` ⋈ episodes (`listSceneIndex`) - a ref per
 *                      present scene with its dialogue words, the share's denominator
 *   `resolve[]`        `resolve_rows` open, kind cue, with a proposal (`listOpenCueRows`) -
 *                      the queue's rows and the badge's count; each ranked against the
 *                      cast (`matchCharacterNames` over `character_bound_cues`) for the
 *                      reason it prints and the `Someone else…` menu
 *   `walkOns[]`        the open cue rows with no proposal - the writer said "not a
 *                      character"; listed under the queue so the decision can be taken back
 *   `pairs[]`          two records that read as one person (`similarRecords`), minus the
 *                      pairs the writer said are different (`record:` decision rows)
 *   a profile          a cast row plus how many cues a rename would rewrite and the
 *                      record's relationships
 *
 * The fourth pass (2026-09-20) stopped reading the script itself here: no
 * quoted lines, no introductions, no eighths, no sets, no mention labels.
 * The one place a derivation is *run* is the empty state: with no record
 * at all, the card says how many cues the script holds, and that is a
 * speculative pass over the same reads the Script route's stats use -
 * ids discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context.
 */

/** How many ranked records the queue's `Someone else…` menu lists first, before the rest of the cast. */
const CANDIDATES_SHOWN = 3

/** Cast order: most scenes first, then lines, then the name. A record kept at zero sits last. The canvas grid fills in this order. */
const byCast = (a: CastRow, b: CastRow): number => b.appearances - a.appearances || b.lines - a.lines || a.name.localeCompare(b.name)

const cueRowOf = (tally: CueTallyRow): CueVariantRow => ({
  cue: tally.cue,
  key: tally.key,
  occurrences: tally.occurrences,
  lines: tally.lines,
  words: tally.words,
})

/** The counted spellings per record, insertion order. */
export const cuesByRecord = (tallies: readonly CueTallyRow[]): ReadonlyMap<CharacterId, readonly CueVariantRow[]> => {
  const out = new Map<CharacterId, CueVariantRow[]>()
  for (const tally of tallies) {
    const list = out.get(tally.characterId) ?? []
    list.push(cueRowOf(tally))
    out.set(tally.characterId, list)
  }
  return out
}

/** A character record as the route draws it. Shared with the Production loader, which reads the same cast. */
export const castRowOf = (record: CharacterRecordRow, cues: readonly CueVariantRow[]): CastRow => ({
  id: record.id,
  name: record.name,
  color: record.color,
  hue: hueOfColor(record.color),
  gender: record.gender,
  age: record.age,
  role: record.role,
  bio: record.bio,
  appearance: record.appearance,
  portraitUrl: publicUrl(record.portraitKey),
  origin: record.origin,
  presence: record.derived?.presence ?? 'absent',
  appearances: record.derived?.appearances ?? 0,
  lines: record.derived?.lines ?? 0,
  words: record.derived?.words ?? 0,
  scenes: record.derived?.scenes ?? [],
  cues,
  exchanges: record.derived?.exchanges ?? [],
  canvas: record.canvas,
})

/** A relationship row as the route reads it (`0024`). */
export const relationshipOf = (row: RelationshipRow): Relationship => ({
  aId: row.aId,
  bId: row.bId,
  aIs: row.aIs,
  bIs: row.bIs,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cue' && 'cue' in value && typeof value.cue === 'string'

const isTarget = (value: unknown): value is ProposalTarget => typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

/** The pair decision key: `record:<a>:<b>` with the ids sorted, so either order finds the row. */
export const pairDecisionKey = (a: CharacterId, b: CharacterId): string => (a < b ? `record:${a}:${b}` : `record:${b}:${a}`)

// ---------------------------------------------------------------------------
// The load
// ---------------------------------------------------------------------------

/** A present scene as the route reads it: the ref, and its dialogue words for the share. */
export type SceneIndexRef = SceneRef & { readonly words: number }

export type CharactersLoad = {
  readonly records: readonly CharacterRecordRow[]
  /** Cast order. */
  readonly cast: readonly CastRow[]
  /** Every authored relationship between two live records (`0024`). */
  readonly relationships: readonly Relationship[]
  /** Who talks to whom, from the derivation's exchanges. */
  readonly dialogue: readonly DialogueEdge[]
  /** Open cue rows with a proposal - the queue's rows, and the badge's count. */
  readonly resolve: readonly ResolveItem[]
  /** Open cue rows with no proposal - the walk-ons, `proposal` null, listed under the queue. */
  readonly walkOns: readonly ResolveItem[]
  /** Two records that read as one person, minus the pairs the writer said are different. */
  readonly pairs: readonly PairItem[]
  /** Every present scene as a ref with its words. */
  readonly index: readonly SceneIndexRef[]
  /** Only with no record at all: what a pass would derive - the count, and the three busiest cues. */
  readonly derivable: Derivable | null
  /** Whether the five `R2_*` variables are set - whether Upload can be offered. */
  readonly storage: boolean
}

export type Derivable = {
  readonly count: number
  /** `MEERA · 79 scenes`, busiest first, at most three - the empty card's mono block. */
  readonly top: readonly { readonly cue: string; readonly scenes: number }[]
}

export const loadCharacters = cache(async (context: ProjectContext): Promise<CharactersLoad> => {
  const { scope } = context
  const [records, sceneRows, cueRows, tallies, bound, decisions, relationshipRows] = await Promise.all([
    listCharacterRecords(scope),
    listSceneIndex(scope),
    listOpenCueRows(scope),
    listCueTallies(scope),
    listBoundCues(scope),
    listResolveDecisions(scope),
    listRelationships(scope),
  ])
  const index: SceneIndexRef[] = sceneRows.map((row) => ({ ...sceneRefOf(row), words: row.words }))
  const refByScene = new Map<NodeId, SceneRef>(index.map((ref) => [ref.sceneNodeId, ref]))
  const cues = cuesByRecord(tallies)

  // The pool the queue ranks against: every live record, its name and its
  // bound spellings - the same scoring a pass uses, so the candidates are
  // exactly what later passes would propose one at a time.
  const boundById = new Map<CharacterId, string[]>()
  for (const entry of bound) {
    const list = boundById.get(entry.characterId)
    if (list === undefined) boundById.set(entry.characterId, [entry.cue])
    else list.push(entry.cue)
  }
  const pool: CharacterNamePool[] = records.map((record) => ({ id: record.id, name: record.name, boundCues: boundById.get(record.id) ?? [] }))

  const cast = records.map((record) => castRowOf(record, cues.get(record.id) ?? [])).sort(byCast)
  const castById = new Map(cast.map((row) => [row.id, row]))

  const candidatesFor = (cue: string): readonly ResolveCandidate[] =>
    matchCharacterNames(cue, pool)
      .slice(0, CANDIDATES_SHOWN)
      .flatMap((match) => {
        const record = castById.get(match.id)
        return record === undefined ? [] : [{ id: record.id, name: record.name, hue: record.hue, confidence: match.confidence, reason: match.reason }]
      })

  const resolve: ResolveItem[] = []
  const walkOns: ResolveItem[] = []
  for (const row of cueRows) {
    if (!isCueSubject(row.subject)) continue
    const candidates = candidatesFor(row.subject.cue)
    const scenes = row.scenes.flatMap((id) => {
      const ref = refByScene.get(id)
      return ref === undefined ? [] : [ref]
    })
    const item = { key: row.key, cue: row.subject.cue, occurrences: row.occurrences, scenes, candidates }
    if (row.proposalTarget === null || row.proposalConfidence === null) {
      walkOns.push({ ...item, proposal: null })
      continue
    }
    const target = row.proposalTarget
    let proposal: ResolveProposal | null = null
    if (isTarget(target)) {
      if (target.kind === 'character') {
        const record = castById.get(target.id)
        proposal =
          record === undefined
            ? null
            : {
                kind: 'character',
                id: record.id,
                name: record.name,
                hue: record.hue,
                confidence: row.proposalConfidence,
                reason: candidates.find((candidate) => candidate.id === record.id)?.reason ?? null,
              }
      } else if (target.kind === 'new-record') {
        proposal = { kind: 'new-record', confidence: row.proposalConfidence }
      }
    }
    if (proposal === null) continue
    resolve.push({ ...item, proposal })
  }

  // Two records that read as one person - the queue's pair rows - minus
  // the pairs the writer said are different. `keep` is the busier record.
  const rejectedPairs = new Set(decisions.filter((decision) => decision.rowKey.startsWith('record:') && decision.verdict === 'rejected').map((decision) => decision.rowKey))
  const pairs: PairItem[] = similarRecords(pool).flatMap((pair) => {
    const key = pairDecisionKey(pair.a, pair.b)
    if (rejectedPairs.has(key)) return []
    const a = castById.get(pair.a)
    const b = castById.get(pair.b)
    if (a === undefined || b === undefined) return []
    const side = (row: CastRow) => ({ id: row.id, name: row.name, hue: row.hue, appearances: row.appearances })
    const [keep, other] = b.appearances > a.appearances ? [b, a] : [a, b]
    return [{ key, keep: side(keep), other: side(other), confidence: pair.confidence }]
  })

  const derivable = records.length === 0 ? await countDerivable(context) : null
  const live = new Set(cast.map((row) => row.id))

  return {
    records,
    cast,
    relationships: relationshipRows.map(relationshipOf),
    dialogue: dialogueEdges(cast, live),
    resolve,
    walkOns,
    pairs,
    index,
    derivable,
    storage: storageAvailable(),
  }
})

/** With no record yet: what a derivation pass over the script would mint - the count and the busiest cues. */
const countDerivable = async (context: ProjectContext): Promise<Derivable> => {
  const reads = await readDerivationReads(context.scope)
  const pass = deriveSpeculatively(reads)
  if (pass === null) return { count: 0, top: [] }
  const present = pass.entities.characters.filter((record) => record.presence === 'present')
  const top = [...present]
    .sort((a, b) => b.appearances - a.appearances || b.lines - a.lines)
    .slice(0, 3)
    .flatMap((record) => {
      const cue = record.cues[0]?.cue ?? record.authored.name
      return [{ cue, scenes: record.appearances }]
    })
  return { count: present.length, top }
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export type ProfileLoad =
  | { readonly state: 'profile'; readonly profile: CharacterProfile }
  | { readonly state: 'merged'; readonly into: CharacterId }
  | { readonly state: 'missing' }

/** One record for the drawer: its cast row, how many cues a rename would rewrite, and its relationships. */
export const loadProfile = cache(async (context: ProjectContext, characterId: CharacterId): Promise<ProfileLoad> => {
  const load = await loadCharacters(context)
  const record = load.records.find((entry) => entry.id === characterId)
  if (record === undefined) {
    const into = await readMergedInto(context.scope, characterId)
    return into === null ? { state: 'missing' } : { state: 'merged', into }
  }
  const row = load.cast.find((entry) => entry.id === characterId)
  if (row === undefined) return { state: 'missing' }
  const nameKey = canonicalKey(record.name)
  return {
    state: 'profile',
    profile: {
      ...row,
      nameCues: row.cues.filter((tally) => tally.key === nameKey).reduce((total, tally) => total + tally.occurrences, 0),
      relationships: load.relationships.filter((entry) => entry.aId === characterId || entry.bId === characterId),
    },
  }
})

/**
 * `loadProfile` plus the two doors every caller of it takes the same way:
 * a record merged into another redirects to the survivor, and an id that
 * names nothing here is a 404. Shared by the full `/characters/:id` page
 * (`characters-route.tsx`) and the intercepted one that opens the edit
 * modal over the canvas (`characters/@modal/(.)[characterId]/page.tsx`) -
 * one branch, written once.
 */
export const loadCharacterProfile = async (context: ProjectContext, characterId: CharacterId): Promise<CharacterProfile> => {
  const result = await loadProfile(context, characterId)
  if (result.state === 'merged') redirect(characterHref(context.project.id, result.into))
  if (result.state === 'missing') notFound()
  return result.profile
}

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterCharacters = async (rawProjectId: string): Promise<{ readonly context: ProjectContext; readonly load: CharactersLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadCharacters(context) }
}
