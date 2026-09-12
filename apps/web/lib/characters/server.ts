import type {
  CastRow,
  CharacterMap,
  CharacterProfile,
  MapColumn,
  ResolveItem,
  ResolveProposal,
  SceneRef,
  WalkOnRow,
} from '@folio/contracts'
import {
  listArcTurns,
  listBoundCues,
  listCharacterRecords,
  listCueTallies,
  listLocationNames,
  listOpenCueRows,
  listRelationshipRows,
  listSceneIndex,
  readMergedInto,
  readNodesInScene,
} from '@folio/db'
import type { CharacterRecordRow, SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey } from '@folio/script'
import { cache } from 'react'

import { deriveSpeculatively, readDerivationReads } from '../script/server'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import {
  buildMap,
  hueOf,
  perEpisodeBars,
  placesOf,
  presenceGap,
  sceneRefOf,
  sharedScenes,
} from './figures'

/**
 * Everything the Characters route reads, and where each part comes from.
 *
 * Like the Scenes loader this is a *join*, never a computation over the
 * script: every count comes from the table that owns it -
 *
 *   `cast[]`          `characters` ⋈ `character_derivations`  (`listCharacterRecords`)
 *   `cast[].inEpisode` the derived `scenes` against `scene_derivations` ⋈
 *                     `nodes` ⋈ `documents` ⋈ `episodes`      (`listSceneIndex`)
 *   `walkOns[]`       `resolve_rows` open, kind cue, no proposal
 *   `resolve[]`       `resolve_rows` open, kind cue, with one   (`listOpenCueRows`)
 *   `map`             the derived `scenes` arrays, intersected  (`buildMap`)
 *   a profile         the above plus `character_cue_tallies`,
 *                     `character_bound_cues`, `character_relationships`,
 *                     `character_arc_turns`, and the key-line nodes by id.
 *
 * The one place a derivation is *run* is the empty state: with no record at
 * all, the card says how many cues the script holds, and that is a
 * speculative pass over the same reads the Script route's stats use - ids
 * discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context, so the nav column
 * (in the layout), the header and the body share one read.
 */

const byNav = (a: CastRow, b: CastRow): number => {
  if (a.group !== b.group) return a.group === 'principal' ? -1 : 1
  if (a.appearances !== b.appearances) return b.appearances - a.appearances
  return a.name.localeCompare(b.name)
}

const castRowOf = (
  record: CharacterRecordRow,
  index: readonly SceneIndexRow[],
  episodeOrdinals: readonly number[],
): CastRow => {
  const scenes = new Set<NodeId>(record.derived?.scenes ?? [])
  const present = new Set<number>()
  for (const row of index) if (scenes.has(row.sceneNodeId)) present.add(row.episodeOrdinal)
  return {
    id: record.id,
    name: record.name,
    group: record.group,
    role: record.role,
    hue: hueOf(record.id),
    presence: record.derived?.presence ?? 'absent',
    appearances: record.derived?.appearances ?? 0,
    lines: record.derived?.lines ?? 0,
    mentions: record.derived?.mentions ?? 0,
    inEpisode: episodeOrdinals.map((ordinal) => present.has(ordinal)),
  }
}

const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
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
  /** Nav order: principals, then supporting, each by appearances. */
  readonly cast: readonly CastRow[]
  readonly walkOns: readonly WalkOnRow[]
  readonly resolve: readonly ResolveItem[]
  readonly map: CharacterMap
  readonly index: readonly SceneIndexRow[]
  readonly sceneRefs: readonly SceneRef[]
  /** Distinct counted spellings across every record - the footer's `N cues`. */
  readonly cueCount: number
  /** Only with no record at all: how many a pass would derive. */
  readonly derivable: number | null
}

export const loadCharacters = cache(async (context: ProjectContext): Promise<CharactersLoad> => {
  const { scope, episodes } = context
  const [records, index, cueRows, tallies] = await Promise.all([
    listCharacterRecords(scope),
    listSceneIndex(scope),
    listOpenCueRows(scope),
    listCueTallies(scope),
  ])
  const ordinals = episodes.map((episode) => episode.ordinal)
  const cast = records.map((record) => castRowOf(record, index, ordinals)).sort(byNav)
  const castById = new Map(cast.map((row) => [row.id, row]))
  const refByScene = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))

  const walkOns: WalkOnRow[] = []
  const resolve: ResolveItem[] = []
  for (const row of cueRows) {
    if (!isCueSubject(row.subject)) continue
    if (row.proposalTarget === null || row.proposalConfidence === null) {
      walkOns.push({ key: row.key, cue: row.subject.cue, scenes: row.scenes.length })
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
            : { kind: 'character', id: record.id, name: record.name, hue: record.hue, confidence: row.proposalConfidence }
      } else if (target.kind === 'new-record') {
        proposal = { kind: 'new-record', confidence: row.proposalConfidence }
      }
    }
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
    .map((row) => ({ id: row.id, name: row.name, hue: row.hue, group: row.group }))
  const scenesOf = new Map<CharacterId, readonly NodeId[]>(
    records.map((record) => [record.id, record.derived?.scenes ?? []]),
  )

  const derivable = records.length === 0 ? await countDerivable(context) : null

  return {
    records,
    cast,
    walkOns,
    resolve,
    map: buildMap(columns, scenesOf),
    index,
    sceneRefs: index.map(sceneRefOf),
    cueCount: new Set(tallies.map((tally) => tally.cue)).size,
    derivable,
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

/**
 * One record's profile. The cast load plus what only this profile reads:
 * its arc turns, its relationships, its key lines' nodes.
 */
export const loadProfile = cache(
  async (context: ProjectContext, characterId: CharacterId): Promise<ProfileLoad> => {
    const { scope, episodes } = context
    const load = await loadCharacters(context)
    const record = load.records.find((entry) => entry.id === characterId)
    if (record === undefined) {
      const into = await readMergedInto(scope, characterId)
      return into === null ? { state: 'missing' } : { state: 'merged', into }
    }
    const row = load.cast.find((entry) => entry.id === characterId)
    if (row === undefined) return { state: 'missing' }

    const [tallies, bound, relationshipRows, turns, keyNodes, locationNames] = await Promise.all([
      listCueTallies(scope),
      listBoundCues(scope),
      listRelationshipRows(scope),
      listArcTurns(scope, characterId),
      readNodesInScene(scope, record.keyLines),
      listLocationNames(scope),
    ])

    const scenes = new Set<NodeId>(record.derived?.scenes ?? [])
    const refByScene = new Map<NodeId, SceneRef>(load.index.map((entry) => [entry.sceneNodeId, sceneRefOf(entry)]))
    const sceneOrder = new Map<NodeId, number>(load.index.map((entry, at) => [entry.sceneNodeId, at]))

    const cues = tallies
      .filter((tally) => tally.characterId === characterId)
      .map((tally) => ({ cue: tally.cue, occurrences: tally.occurrences, lines: tally.lines }))
    const nameKey = canonicalKey(record.name)
    const nameCues = tallies
      .filter((tally) => tally.characterId === characterId && tally.key === nameKey)
      .reduce((total, tally) => total + tally.occurrences, 0)

    // Relationships: every authored row in this direction, plus every
    // character sharing a scene who has none. Most shared first.
    const authored = new Map(
      relationshipRows.filter((entry) => entry.characterId === characterId).map((entry) => [entry.otherId, entry]),
    )
    const mine = record.derived?.scenes ?? []
    const relationships = load.cast
      .filter((other) => other.id !== characterId)
      .map((other) => {
        const theirs = load.records.find((entry) => entry.id === other.id)?.derived?.scenes ?? []
        const shared = sharedScenes(mine, theirs)
        const row = authored.get(other.id)
        return {
          other: { id: other.id, name: other.name, hue: other.hue },
          what: row?.what ?? null,
          shift: row?.shift ?? null,
          shared,
          authored: row !== undefined,
        }
      })
      .filter((entry) => entry.authored || entry.shared > 0)
      .sort((a, b) => b.shared - a.shared || a.other.name.localeCompare(b.other.name))

    // The key lines, in the writer's order, dropping any the script has lost.
    const keyLines = record.keyLines.flatMap((nodeId) => {
      const entry = keyNodes.get(nodeId)
      if (entry === undefined || entry.node.type !== 'dialogue') return []
      const text = entry.node.content.map((run) => (run.kind === 'text' ? run.text : '')).join('').trim()
      const scene = entry.sceneNodeId === null ? null : (refByScene.get(entry.sceneNodeId) ?? null)
      return [{ nodeId, text, scene }]
    })

    const ordered = [...scenes].sort((a, b) => (sceneOrder.get(a) ?? 0) - (sceneOrder.get(b) ?? 0))
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    const totalLines = load.index.reduce((total, entry) => total + entry.lines, 0)

    const profile: CharacterProfile = {
      ...row,
      age: record.age,
      bio: record.bio,
      wants: record.wants,
      wantsSource: record.wantsSource,
      needs: record.needs,
      needsSource: record.needsSource,
      flaw: record.flaw,
      flawSource: record.flawSource,
      voiceRules: record.voiceRules,
      cues,
      boundCues: bound.filter((entry) => entry.characterId === characterId).map((entry) => entry.cue),
      arc: turns.map((turn) => ({
        id: turn.id,
        position: turn.position,
        text: turn.text,
        scene: turn.sceneNodeId === null ? null : (refByScene.get(turn.sceneNodeId) ?? null),
      })),
      keyLines,
      relationships,
      places: placesOf(load.index, scenes, locationNames),
      perEpisode: perEpisodeBars(episodes, load.index, scenes),
      firstSeen: first === undefined ? null : (refByScene.get(first) ?? null),
      lastSeen: last === undefined ? null : (refByScene.get(last) ?? null),
      voiceShare: totalLines === 0 ? null : row.lines / totalLines,
      gap: presenceGap(load.index, scenes),
      nameCues,
    }
    return { state: 'profile', profile }
  },
)

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterCharacters = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: CharactersLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadCharacters(context) }
}
