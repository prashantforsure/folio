import { hueOfColor } from '@folio/contracts'
import type {
  LocationRow,
  LocationSceneRow,
  SceneRef,
  SluglineResolveItem,
  SluglineResolveProposal,
  StructureResolveItem,
  StructureResolveProposal,
} from '@folio/contracts'
import {
  listBoundSluglines,
  listCharacterRecords,
  listLocationRecords,
  listOpenLocationRows,
  listSceneEighths,
  listSceneIndex,
  listSceneSynopses,
  listSluglineTallies,
  readLocationMergedInto,
} from '@folio/db'
import type { LocationRecordRow, OpenLocationRow, SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey } from '@folio/script'
import { cache } from 'react'

import { sceneRefOf } from '../characters/figures'
import { deriveSpeculatively, readDerivationReads } from '../script/server'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { NO_LOCATION_COUNTS, ieOf, perEpisodeCounts, peopleAt, subtreeOf, sumEighths, treeOrder } from './figures'
import { kindOf } from './view'

/**
 * Everything the Locations route reads, and where each part comes from.
 *
 * A *join*, never a computation over the script: every count comes from the
 * table that owns it -
 *
 *   `rows[]`             `locations` ⋈ `location_derivations`  (`listLocationRecords`),
 *                        in tree order (`treeOrder`); `ie` read off the scenes
 *   `rows[].rollup`      `location_derivations.rollup_*` - the pure core's
 *                        tree walk, stored, which is what "how many days in
 *                        the chawl" reads
 *   `rows[].scenes`      the derived `scenes` against `scene_derivations` ⋈
 *                        `nodes` ⋈ `documents` ⋈ `episodes` (`listSceneIndex`),
 *                        each with its heading's reading, its synopsis
 *                        (`scenes.synopsis`) and its cast's names
 *   `rows[].eighths`     `measurement_scenes` at the project's format, `paged`
 *                        (`listSceneEighths`) - the only source of a page count
 *   `rows[].sluglines`   `location_slugline_tallies`, here or below
 *   `rows[].conflicts`   `resolve_rows` open, kind structure, about this record
 *   `resolve[]`          `resolve_rows` open, kind slugline  (`listOpenLocationRows`)
 *
 * One shape for every view (`LocationRow`, `@folio/contracts`): the drawer
 * opens over any card and the "Scenes here" view lists every record's
 * scenes, so every field is read for every row, in six statements
 * regardless of how many records there are.
 *
 * The one place a derivation is *run* is the empty state, exactly as the
 * Characters loader does it: with no record at all, a speculative pass says
 * how many places the headings name - ids discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context, so the sidebar (in
 * the layout), the header and the body share one read.
 */

const isSluglineSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'slugline' }> =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === 'slugline' &&
  'slugline' in value &&
  typeof value.slugline === 'string'

const isStructureSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'structure' }> =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === 'structure' &&
  'location' in value &&
  typeof value.location === 'string'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

/** The tree's own reading of a record: the edge, the depth, the counts. What `treeOrder` and `subtreeOf` walk. */
type Skeleton = {
  readonly id: LocationId
  readonly name: string
  readonly parentId: LocationId | null
  readonly depth: number
  readonly children: number
  readonly rollup: LocationRow['rollup']
  readonly record: LocationRecordRow
}

export type Derivable = {
  readonly count: number
  /** Distinct heading spellings the pass read - `15 sluglines across 9 distinct places`. */
  readonly sluglines: number
  /** `INT. CHAWL CORRIDOR - DAY × 6`, busiest first, at most three - the empty card's mono block. */
  readonly top: readonly { readonly set: string; readonly n: number }[]
}

export type LocationsLoad = {
  /** Tree order: primary sets by weight, each followed by its sub-sets. */
  readonly rows: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  /** Present scenes across the project - the status bar's `M scenes`. */
  readonly sceneTotal: number
  /** Only with no record at all: how many a pass would derive, and the headings it read. */
  readonly derivable: Derivable | null
  /** Whether the five `R2_*` variables are set - whether Upload can be offered. */
  readonly storage: boolean
}

/** The scenes of a subtree: this record's derived list plus every descendant's. */
const subtreeScenes = (id: LocationId, skeletons: readonly Skeleton[]): ReadonlySet<NodeId> => {
  const ids = subtreeOf(id, skeletons)
  const out = new Set<NodeId>()
  for (const entry of skeletons) {
    if (!ids.has(entry.id)) continue
    for (const scene of entry.record.derived?.scenes ?? []) out.add(scene)
  }
  return out
}

export const loadLocations = cache(async (context: ProjectContext): Promise<LocationsLoad> => {
  const { scope, episodes, project } = context
  const [records, index, openRows, tallies, eighths, bound, synopses, characters] = await Promise.all([
    listLocationRecords(scope),
    listSceneIndex(scope),
    listOpenLocationRows(scope),
    listSluglineTallies(scope),
    listSceneEighths(scope, project.format),
    listBoundSluglines(scope),
    listSceneSynopses(scope),
    listCharacterRecords(scope),
  ])

  const childCount = new Map<LocationId, number>()
  for (const record of records) {
    if (record.parentId !== null) childCount.set(record.parentId, (childCount.get(record.parentId) ?? 0) + 1)
  }
  const skeletons: readonly Skeleton[] = treeOrder(
    records.map((record) => ({
      id: record.id,
      name: record.name,
      parentId: record.parentId,
      depth: record.derived?.depth ?? 0,
      children: childCount.get(record.id) ?? 0,
      rollup: record.derived?.rollup ?? NO_LOCATION_COUNTS,
      record,
    })),
  )
  const nameOf = new Map(skeletons.map((entry) => [entry.id, entry.name]))
  const sceneOrder = new Map<NodeId, number>(index.map((entry, at) => [entry.sceneNodeId, at]))
  const refByScene = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))
  const people = new Map<CharacterId, { readonly name: string; readonly hue: number }>(
    characters.map((character) => [character.id, { name: character.name, hue: hueOfColor(character.color) }]),
  )
  const subtreeIds = new Map(skeletons.map((entry) => [entry.id, subtreeOf(entry.id, skeletons)]))

  // The queue, split: sluglines pointing at nothing (the banner) and
  // structure proposals (a conflict block on the record they are about).
  const resolve: SluglineResolveItem[] = []
  const conflictsOf = new Map<LocationId, StructureResolveItem[]>()
  for (const row of openRows) {
    if (row.subjectKind === 'slugline') {
      const item = sluglineItemOf(row, nameOf, refByScene)
      if (item !== null) resolve.push(item)
      continue
    }
    const item = structureItemOf(row, nameOf)
    if (item === null) continue
    const list = conflictsOf.get(item.location.id) ?? []
    list.push(item)
    conflictsOf.set(item.location.id, list)
  }

  const rows: LocationRow[] = skeletons.map((entry) => {
    const { record } = entry
    const scenes = subtreeScenes(entry.id, skeletons)
    const here = index.filter((row) => scenes.has(row.sceneNodeId))
    const ordered = [...scenes].sort((a, b) => (sceneOrder.get(a) ?? 0) - (sceneOrder.get(b) ?? 0))
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    const ids = subtreeIds.get(entry.id) ?? new Set<LocationId>([entry.id])
    const nameKey = canonicalKey(record.name)
    const parentName = record.parentId === null ? undefined : nameOf.get(record.parentId)
    const skeleton = { parentId: record.parentId, children: entry.children, rollup: entry.rollup }

    const sceneRows: LocationSceneRow[] = here.map((row) => sceneRowOf(row, synopses, people, eighths, entry, nameOf))

    return {
      id: entry.id,
      name: record.name,
      parentId: record.parentId,
      parent: record.parentId === null || parentName === undefined ? null : { id: record.parentId, name: parentName },
      depth: entry.depth,
      ie: ieOf(here.map((row) => row.ie)),
      presence: record.derived?.presence ?? 'absent',
      kind: kindOf(skeleton),
      own: record.derived?.own ?? NO_LOCATION_COUNTS,
      rollup: entry.rollup,
      children: entry.children,
      status: record.status,
      address: record.address,
      description: record.description,
      photoUrl: publicUrl(record.photoKey),
      sluglines: tallies
        .filter((tally) => ids.has(tally.locationId))
        .map((tally) => ({ slugline: tally.slugline, occurrences: tally.occurrences })),
      boundSluglines: bound.filter((row) => row.locationId === entry.id).map((row) => row.slugline),
      scenes: sceneRows,
      people: peopleAt(index, scenes, people),
      perEpisode: perEpisodeCounts(episodes, index, scenes),
      eighths: sumEighths(scenes, eighths),
      firstSeen: first === undefined ? null : (refByScene.get(first) ?? null),
      lastSeen: last === undefined ? null : (refByScene.get(last) ?? null),
      nameHeadings: tallies
        .filter((tally) => tally.locationId === entry.id && tally.key === nameKey)
        .reduce((total, tally) => total + tally.occurrences, 0),
      conflicts: conflictsOf.get(entry.id) ?? [],
    }
  })

  const derivable = records.length === 0 ? await countDerivable(context) : null

  return { rows, resolve, sceneTotal: index.length, derivable, storage: storageAvailable() }
})

const sceneRowOf = (
  row: SceneIndexRow,
  synopses: ReadonlyMap<NodeId, string>,
  people: ReadonlyMap<CharacterId, { readonly name: string; readonly hue: number }>,
  eighths: ReadonlyMap<NodeId, number>,
  at: Skeleton,
  nameOf: ReadonlyMap<LocationId, string>,
): LocationSceneRow => ({
  scene: sceneRefOf(row),
  light: row.light,
  timeOfDay: row.timeOfDay,
  gist: synopses.get(row.sceneNodeId) ?? null,
  cast: row.cast.flatMap((id) => {
    const person = people.get(id)
    return person === undefined ? [] : [{ id, name: person.name, hue: person.hue }]
  }),
  eighths: eighths.get(row.sceneNodeId) ?? null,
  at: {
    id: row.locationId ?? at.id,
    name: (row.locationId === null ? undefined : nameOf.get(row.locationId)) ?? at.name,
  },
})

const sluglineItemOf = (
  row: OpenLocationRow,
  nameOf: ReadonlyMap<LocationId, string>,
  refByScene: ReadonlyMap<NodeId, SceneRef>,
): SluglineResolveItem | null => {
  if (!isSluglineSubject(row.subject)) return null
  let proposal: SluglineResolveProposal | null = null
  if (row.proposalConfidence !== null && isTarget(row.proposalTarget)) {
    const target = row.proposalTarget
    if (target.kind === 'location') {
      const name = nameOf.get(target.id)
      proposal = name === undefined ? null : { kind: 'location', id: target.id, name, confidence: row.proposalConfidence }
    } else if (target.kind === 'new-record') {
      proposal = { kind: 'new-record', confidence: row.proposalConfidence }
    }
  }
  return {
    key: row.key,
    slugline: row.subject.slugline,
    occurrences: row.occurrences,
    scenes: row.scenes.flatMap((id) => {
      const ref = refByScene.get(id)
      return ref === undefined ? [] : [ref]
    }),
    proposal,
  }
}

const structureItemOf = (row: OpenLocationRow, nameOf: ReadonlyMap<LocationId, string>): StructureResolveItem | null => {
  if (!isStructureSubject(row.subject)) return null
  const name = nameOf.get(row.subject.location)
  if (name === undefined || row.proposalConfidence === null || !isTarget(row.proposalTarget)) return null
  const target = row.proposalTarget
  let proposal: StructureResolveProposal | null = null
  if (target.kind === 'attach') {
    const parent = nameOf.get(target.parent)
    if (parent !== undefined) {
      proposal = { kind: 'attach', parent: { id: target.parent, name: parent }, confidence: row.proposalConfidence }
    }
  } else if (target.kind === 'new-parent') {
    proposal = { kind: 'new-parent', name: target.name, confidence: row.proposalConfidence }
  }
  if (proposal === null) return null
  return {
    key: row.key,
    location: { id: row.subject.location, name },
    scenes: row.occurrences,
    proposal,
  }
}

/** With no record yet: how many places a pass over the script would mint, and the headings behind them. */
const countDerivable = async (context: ProjectContext): Promise<Derivable> => {
  const reads = await readDerivationReads(context.scope)
  const pass = deriveSpeculatively(reads)
  if (pass === null) return { count: 0, sluglines: 0, top: [] }
  const present = pass.entities.locations.filter((record) => record.presence === 'present')
  const sluglines = new Set(present.flatMap((record) => record.sluglines.map((entry) => entry.slugline))).size
  const top = present
    .map((record) => ({
      set: record.sluglines[0]?.slugline ?? record.authored.name,
      n: record.own.scenes,
    }))
    .sort((a, b) => b.n - a.n || a.set.localeCompare(b.set))
    .slice(0, 3)
  return { count: present.length, sluglines, top }
}

export type SelectedLoad =
  | { readonly state: 'record'; readonly record: LocationRow }
  | { readonly state: 'merged'; readonly into: LocationId }
  | { readonly state: 'missing' }

/**
 * The record `/locations/:locationId` names, from the route load. A record
 * merged into another says where it went - the loser's row is a tombstone
 * - and an id that names nothing here is missing.
 */
export const loadSelectedLocation = cache(async (context: ProjectContext, locationId: LocationId): Promise<SelectedLoad> => {
  const load = await loadLocations(context)
  const record = load.rows.find((entry) => entry.id === locationId)
  if (record !== undefined) return { state: 'record', record }
  const into = await readLocationMergedInto(context.scope, locationId)
  return into === null ? { state: 'missing' } : { state: 'merged', into }
})
