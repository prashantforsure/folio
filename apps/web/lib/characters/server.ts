import type {
  CastRow,
  CharacterMap,
  CharacterProfile,
  MapColumn,
  ResolveItem,
  ResolveProposal,
  SceneRef,
} from '@folio/contracts'
import { hueOfColor } from '@folio/contracts'
import {
  listBoundCues,
  listCharacterRecords,
  listCueTallies,
  listOpenCueRows,
  listSceneIndex,
  readMergedInto,
} from '@folio/db'
import type { CharacterRecordRow } from '@folio/db'
import type { CharacterId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey } from '@folio/script'
import { cache } from 'react'

import { deriveSpeculatively, readDerivationReads } from '../script/server'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import { buildMap, sceneRefOf } from './figures'

/**
 * Everything the Characters route reads, and where each part comes from.
 *
 * Like the Scenes loader this is a *join*, never a computation over the
 * script: every count comes from the table that owns it -
 *
 *   `cast[]`      `characters` ⋈ `character_derivations`  (`listCharacterRecords`)
 *   `resolve[]`   `resolve_rows` open, kind cue, with a proposal (`listOpenCueRows`);
 *                 a row with none is a walk-on the writer decided, and is not drawn
 *   `map`         the derived `scenes` arrays, intersected  (`buildMap`)
 *   a profile     the above plus `character_cue_tallies` and `character_bound_cues`
 *
 * The one place a derivation is *run* is the empty state: with no record at
 * all, the card says how many cues the script holds, and that is a
 * speculative pass over the same reads the Script route's stats use - ids
 * discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context, so the page and the
 * badge share one read.
 */

/** Grid order: most scenes first, then lines, then the name. A record kept at zero sits last. */
const byGrid = (a: CastRow, b: CastRow): number =>
  b.appearances - a.appearances || b.lines - a.lines || a.name.localeCompare(b.name)

/** A character record as the grid draws it. Shared with the Production loader, which reads the same cast. */
export const castRowOf = (record: CharacterRecordRow): CastRow => ({
  id: record.id,
  name: record.name,
  color: record.color,
  hue: hueOfColor(record.color),
  gender: record.gender,
  age: record.age,
  role: record.role,
  bio: record.bio,
  portraitUrl: publicUrl(record.portraitKey),
  presence: record.derived?.presence ?? 'absent',
  appearances: record.derived?.appearances ?? 0,
  lines: record.derived?.lines ?? 0,
  mentions: record.derived?.mentions ?? 0,
  scenes: record.derived?.scenes ?? [],
})

export const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === 'cue' &&
  'cue' in value &&
  typeof value.cue === 'string'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

export type CharactersLoad = {
  readonly records: readonly CharacterRecordRow[]
  /** Grid order. */
  readonly cast: readonly CastRow[]
  /** Open cue rows with a proposal - the ghost cards, and the badge's count. */
  readonly resolve: readonly ResolveItem[]
  readonly map: CharacterMap
  /** Distinct counted spellings across every record - the footer's `N cues`. */
  readonly cueCount: number
  /** Only with no record at all: how many a pass would derive. */
  readonly derivable: number | null
  /** Whether the five `R2_*` variables are set - whether Upload can be offered. */
  readonly storage: boolean
}

export const loadCharacters = cache(async (context: ProjectContext): Promise<CharactersLoad> => {
  const { scope } = context
  const [records, index, cueRows, tallies] = await Promise.all([
    listCharacterRecords(scope),
    listSceneIndex(scope),
    listOpenCueRows(scope),
    listCueTallies(scope),
  ])
  const cast = records.map(castRowOf).sort(byGrid)
  const castById = new Map(cast.map((row) => [row.id, row]))
  const refByScene = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))

  const resolve: ResolveItem[] = []
  for (const row of cueRows) {
    if (!isCueSubject(row.subject)) continue
    if (row.proposalTarget === null || row.proposalConfidence === null) continue
    const target = row.proposalTarget
    let proposal: ResolveProposal | null = null
    if (isTarget(target)) {
      if (target.kind === 'character') {
        const record = castById.get(target.id)
        proposal =
          record === undefined
            ? null
            : { kind: 'character', id: record.id, name: record.name, hue: record.hue, confidence: row.proposalConfidence }
      } else if (target.kind === 'new-record') {
        proposal = { kind: 'new-record', confidence: row.proposalConfidence }
      }
    }
    if (proposal === null) continue
    resolve.push({
      key: row.key,
      cue: row.subject.cue,
      occurrences: row.occurrences,
      scenes: row.scenes.flatMap((id) => {
        const ref = refByScene.get(id)
        return ref === undefined ? [] : [ref]
      }),
      proposal,
    })
  }

  const columns: MapColumn[] = cast
    .filter((row) => row.presence === 'present')
    .map((row) => ({ id: row.id, name: row.name, hue: row.hue, lines: row.lines, scenes: row.appearances }))
  const scenesOf = new Map<CharacterId, readonly NodeId[]>(cast.map((row) => [row.id, row.scenes]))

  const derivable = records.length === 0 ? await countDerivable(context) : null

  return {
    records,
    cast,
    resolve,
    map: buildMap(columns, scenesOf),
    cueCount: new Set(tallies.map((tally) => tally.cue)).size,
    derivable,
    storage: storageAvailable(),
  }
})

/** With no record yet: how many a derivation pass over the script would mint. */
const countDerivable = async (context: ProjectContext): Promise<number> => {
  const reads = await readDerivationReads(context.scope)
  const pass = deriveSpeculatively(reads)
  if (pass === null) return 0
  return pass.entities.characters.filter((record) => record.presence === 'present').length
}

export type ProfileLoad =
  | { readonly state: 'profile'; readonly profile: CharacterProfile }
  | { readonly state: 'merged'; readonly into: CharacterId }
  | { readonly state: 'missing' }

/** One record for the drawer: its card plus the alias table and the look-sheet notes. */
export const loadProfile = cache(
  async (context: ProjectContext, characterId: CharacterId): Promise<ProfileLoad> => {
    const { scope } = context
    const load = await loadCharacters(context)
    const record = load.records.find((entry) => entry.id === characterId)
    if (record === undefined) {
      const into = await readMergedInto(scope, characterId)
      return into === null ? { state: 'missing' } : { state: 'merged', into }
    }
    const row = load.cast.find((entry) => entry.id === characterId)
    if (row === undefined) return { state: 'missing' }

    const [tallies, bound] = await Promise.all([listCueTallies(scope), listBoundCues(scope)])
    const mine = tallies.filter((tally) => tally.characterId === characterId)
    const nameKey = canonicalKey(record.name)

    return {
      state: 'profile',
      profile: {
        ...row,
        appearance: record.appearance,
        cues: mine.map((tally) => ({ cue: tally.cue, occurrences: tally.occurrences, lines: tally.lines })),
        boundCues: bound.filter((entry) => entry.characterId === characterId).map((entry) => entry.cue),
        nameCues: mine.filter((tally) => tally.key === nameKey).reduce((total, tally) => total + tally.occurrences, 0),
      },
    }
  },
)

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterCharacters = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: CharactersLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadCharacters(context) }
}
