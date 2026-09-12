import type {
  BreakdownRow,
  LocationArcNoteRow,
  LocationRecordView,
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
  listLocationArcNotes,
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

import { hueOf, sceneRefOf } from '../characters/figures'
import { deriveSpeculatively, readDerivationReads } from '../script/server'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import {
  NO_LOCATION_COUNTS,
  ieOf,
  peopleAt,
  perEpisodeCells,
  subtreeOf,
  sumEighths,
  treeOrder,
} from './figures'

/**
 * Everything the Locations route reads, and where each part comes from.
 *
 * A *join*, never a computation over the script: every count comes from the
 * table that owns it -
 *
 *   `rows[]`           `locations` ⋈ `location_derivations`  (`listLocationRecords`),
 *                      in tree order (`treeOrder`); `ie` read off the scenes
 *   `rows[].rollup`    `location_derivations.rollup_*` - the pure core's
 *                      tree walk, stored, which is what "how many days in the
 *                      chawl" reads
 *   `index[]`          the derived `scenes` against `scene_derivations` ⋈
 *                      `nodes` ⋈ `documents` ⋈ `episodes` (`listSceneIndex`),
 *                      each with its heading's reading
 *   `eighths`          `measurement_scenes` at the project's format, `paged`
 *                      (`listSceneEighths`) - the only source of a page count
 *   `resolve[]`        `resolve_rows` open, kind slugline  (`listOpenLocationRows`)
 *   `structure[]`      `resolve_rows` open, kind structure, with a proposal
 *   `breakdown[]`      the above, cut per episode
 *   a record           the above plus `location_slugline_tallies`,
 *                      `location_bound_sluglines`, `location_arc_notes`,
 *                      `scenes.synopsis` and the cast's names.
 *
 * The one place a derivation is *run* is the empty state, exactly as the
 * Characters loader does it: with no record at all, a speculative pass says
 * how many places the headings name - ids discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context, so the nav column
 * (in the layout), the header and the body share one read.
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

/** The row without its I/E, which is read over the subtree once the tree is known. */
const rowOf = (record: LocationRecordRow, children: number): LocationRow => {
  return {
    id: record.id,
    name: record.name,
    parentId: record.parentId,
    depth: record.derived?.depth ?? 0,
    ie: null,
    presence: record.derived?.presence ?? 'absent',
    own: record.derived?.own ?? NO_LOCATION_COUNTS,
    rollup: record.derived?.rollup ?? NO_LOCATION_COUNTS,
    children,
  }
}

export type LocationsLoad = {
  readonly records: readonly LocationRecordRow[]
  /** Tree order: primary sets by weight, each followed by its sub-sets. */
  readonly rows: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly structure: readonly StructureResolveItem[]
  readonly breakdown: readonly BreakdownRow[]
  readonly index: readonly SceneIndexRow[]
  readonly eighths: ReadonlyMap<NodeId, number>
  /** Present scenes across the project - the footer's `M scenes`. */
  readonly sceneTotal: number
  /** Distinct counted heading spellings across every record - the header's `derived from N sluglines`. */
  readonly sluglineTotal: number
  /** Every counted heading per record - what the nav's find input matches beside the name. */
  readonly sluglinesOf: Readonly<Record<string, readonly string[]>>
  /** Only with no record at all: how many a pass would derive, and the headings it read. */
  readonly derivable: { readonly count: number; readonly top: readonly { readonly set: string; readonly n: number }[] } | null
}

/** The scenes of a subtree: this record's derived list plus every descendant's. */
const subtreeScenes = (
  id: LocationId,
  rows: readonly LocationRow[],
  records: readonly LocationRecordRow[],
): ReadonlySet<NodeId> => {
  const ids = subtreeOf(id, rows)
  const out = new Set<NodeId>()
  for (const record of records) {
    if (!ids.has(record.id)) continue
    for (const scene of record.derived?.scenes ?? []) out.add(scene)
  }
  return out
}

export const loadLocations = cache(async (context: ProjectContext): Promise<LocationsLoad> => {
  const { scope, episodes, project } = context
  const [records, index, openRows, tallies, eighths] = await Promise.all([
    listLocationRecords(scope),
    listSceneIndex(scope),
    listOpenLocationRows(scope),
    listSluglineTallies(scope),
    listSceneEighths(scope, project.format),
  ])

  const childCount = new Map<LocationId, number>()
  for (const record of records) {
    if (record.parentId !== null) childCount.set(record.parentId, (childCount.get(record.parentId) ?? 0) + 1)
  }
  const unordered = records.map((record) => rowOf(record, childCount.get(record.id) ?? 0))
  // I/E is read over the whole subtree: a primary set with no heading of its
  // own is `INT/EXT` when its sub-sets are, not `—`.
  const rows = treeOrder(unordered).map((row) => {
    const scenes = subtreeScenes(row.id, unordered, records)
    return { ...row, ie: ieOf(index.filter((entry) => scenes.has(entry.sceneNodeId)).map((entry) => entry.ie)) }
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const refByScene = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))

  const resolve: SluglineResolveItem[] = []
  const structure: StructureResolveItem[] = []
  for (const row of openRows) {
    if (row.subjectKind === 'slugline') {
      const item = sluglineItemOf(row, rowById, refByScene)
      if (item !== null) resolve.push(item)
      continue
    }
    const item = structureItemOf(row, rowById)
    if (item !== null) structure.push(item)
  }

  const breakdown: BreakdownRow[] = rows.map((row) => {
    const scenes = subtreeScenes(row.id, rows, records)
    const cells = perEpisodeCells(episodes, index, scenes, eighths)
    return { ...row, cells, eighths: sumEighths(scenes, eighths) }
  })

  const derivable = records.length === 0 ? await countDerivable(context) : null

  const sluglinesOf: Record<string, string[]> = {}
  for (const tally of tallies) (sluglinesOf[tally.locationId] ??= []).push(tally.slugline)

  return {
    records,
    rows,
    resolve,
    structure,
    breakdown,
    index,
    eighths,
    sceneTotal: index.length,
    sluglineTotal: new Set(tallies.map((tally) => tally.slugline)).size,
    sluglinesOf,
    derivable,
  }
})

const sluglineItemOf = (
  row: OpenLocationRow,
  rowById: ReadonlyMap<LocationId, LocationRow>,
  refByScene: ReadonlyMap<NodeId, SceneRef>,
): SluglineResolveItem | null => {
  if (!isSluglineSubject(row.subject)) return null
  let proposal: SluglineResolveProposal | null = null
  if (row.proposalConfidence !== null && isTarget(row.proposalTarget)) {
    const target = row.proposalTarget
    if (target.kind === 'location') {
      const record = rowById.get(target.id)
      proposal =
        record === undefined
          ? null
          : { kind: 'location', id: record.id, name: record.name, confidence: row.proposalConfidence }
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

const structureItemOf = (
  row: OpenLocationRow,
  rowById: ReadonlyMap<LocationId, LocationRow>,
): StructureResolveItem | null => {
  if (!isStructureSubject(row.subject)) return null
  const location = rowById.get(row.subject.location)
  if (location === undefined || row.proposalConfidence === null || !isTarget(row.proposalTarget)) return null
  const target = row.proposalTarget
  let proposal: StructureResolveProposal | null = null
  if (target.kind === 'attach') {
    const parent = rowById.get(target.parent)
    if (parent !== undefined) {
      proposal = { kind: 'attach', parent: { id: parent.id, name: parent.name }, confidence: row.proposalConfidence }
    }
  } else if (target.kind === 'new-parent') {
    proposal = { kind: 'new-parent', name: target.name, confidence: row.proposalConfidence }
  }
  if (proposal === null) return null
  return {
    key: row.key,
    location: { id: location.id, name: location.name },
    scenes: row.occurrences,
    proposal,
  }
}

/** With no record yet: how many places a pass over the script would mint, and the headings behind them. */
const countDerivable = async (context: ProjectContext): Promise<LocationsLoad['derivable']> => {
  const reads = await readDerivationReads(context.scope)
  const pass = deriveSpeculatively(reads)
  if (pass === null) return { count: 0, top: [] }
  const present = pass.entities.locations.filter((record) => record.presence === 'present')
  const top = present
    .map((record) => ({
      set: record.sluglines[0]?.slugline ?? record.authored.name,
      n: record.own.scenes,
    }))
    .sort((a, b) => b.n - a.n || a.set.localeCompare(b.set))
    .slice(0, 3)
  return { count: present.length, top }
}

export type RecordLoad =
  | { readonly state: 'record'; readonly record: LocationRecordView }
  | { readonly state: 'merged'; readonly into: LocationId }
  | { readonly state: 'missing' }

/**
 * One record's view. The route load plus what only this record reads: its
 * counted headings, its bound set texts, its arc notes, the synopses and
 * the cast's names for its scene list.
 */
export const loadLocationRecord = cache(
  async (context: ProjectContext, locationId: LocationId): Promise<RecordLoad> => {
    const { scope, episodes } = context
    const load = await loadLocations(context)
    const record = load.records.find((entry) => entry.id === locationId)
    const row = load.rows.find((entry) => entry.id === locationId)
    if (record === undefined || row === undefined) {
      const into = await readLocationMergedInto(scope, locationId)
      return into === null ? { state: 'missing' } : { state: 'merged', into }
    }

    const [tallies, bound, notes, synopses, characters] = await Promise.all([
      listSluglineTallies(scope),
      listBoundSluglines(scope),
      listLocationArcNotes(scope, locationId),
      listSceneSynopses(scope),
      listCharacterRecords(scope),
    ])

    const scenes = subtreeScenes(locationId, load.rows, load.records)
    const sceneOrder = new Map<NodeId, number>(load.index.map((entry, at) => [entry.sceneNodeId, at]))
    const refByScene = new Map<NodeId, SceneRef>(load.index.map((entry) => [entry.sceneNodeId, sceneRefOf(entry)]))
    const people = new Map<CharacterId, { readonly name: string; readonly hue: number }>(
      characters.map((character) => [character.id, { name: character.name, hue: hueOf(character.id) }]),
    )
    const nameOf = new Map(load.rows.map((entry) => [entry.id, entry.name]))

    const sceneRows: LocationSceneRow[] = load.index
      .filter((entry) => scenes.has(entry.sceneNodeId))
      .map((entry) => ({
        scene: sceneRefOf(entry),
        light: entry.light,
        timeOfDay: entry.timeOfDay,
        gist: synopses.get(entry.sceneNodeId) ?? null,
        cast: entry.cast.flatMap((id) => {
          const person = people.get(id)
          return person === undefined ? [] : [{ id, name: person.name, hue: person.hue }]
        }),
        eighths: load.eighths.get(entry.sceneNodeId) ?? null,
        at: {
          id: entry.locationId ?? locationId,
          name: (entry.locationId === null ? undefined : nameOf.get(entry.locationId)) ?? row.name,
        },
      }))

    const nameKey = canonicalKey(record.name)
    const mine = tallies.filter((tally) => tally.locationId === locationId)
    const noteByEpisode = new Map(notes.map((note) => [note.episodeId, note.text]))
    const arc: LocationArcNoteRow[] = episodes.map((episode) => ({
      episodeId: episode.id,
      episode: episode.slug,
      ordinal: episode.ordinal,
      text: noteByEpisode.get(episode.id) ?? null,
    }))

    const ordered = [...scenes].sort((a, b) => (sceneOrder.get(a) ?? 0) - (sceneOrder.get(b) ?? 0))
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    const parentRow = record.parentId === null ? undefined : load.rows.find((entry) => entry.id === record.parentId)

    const view: LocationRecordView = {
      ...row,
      description: record.description,
      scheduledDays: record.scheduledDays,
      parent: parentRow === undefined ? null : { id: parentRow.id, name: parentRow.name },
      subLocations: load.rows.filter((entry) => entry.parentId === locationId),
      sluglines: mine.map((tally) => ({ slugline: tally.slugline, occurrences: tally.occurrences })),
      boundSluglines: bound.filter((entry) => entry.locationId === locationId).map((entry) => entry.slugline),
      scenes: sceneRows,
      arc,
      people: peopleAt(load.index, scenes, people),
      perEpisode: perEpisodeCells(episodes, load.index, scenes, load.eighths),
      eighths: sumEighths(scenes, load.eighths),
      firstSeen: first === undefined ? null : (refByScene.get(first) ?? null),
      lastSeen: last === undefined ? null : (refByScene.get(last) ?? null),
      nameHeadings: mine.filter((tally) => tally.key === nameKey).reduce((total, tally) => total + tally.occurrences, 0),
    }
    return { state: 'record', record: view }
  },
)

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterLocations = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: LocationsLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadLocations(context) }
}
