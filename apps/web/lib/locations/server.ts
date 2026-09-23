import { hueOfColor } from '@folio/contracts'
import type {
  BoundSetView,
  EstablishingRow,
  FiledClip,
  LocationRow,
  LocationSceneRow,
  SceneRef,
  SimilarSetRow,
  SluglineCandidate,
  SluglineResolveItem,
  SluglineResolveProposal,
  StructureResolveItem,
  StructureResolveProposal,
} from '@folio/contracts'
import {
  listBoundSluglines,
  listCharacterRecords,
  listClipsFiledToLocations,
  listLocationRecords,
  listOpenLocationRows,
  listResolveDecisions,
  listSceneEighths,
  listSceneIndex,
  listSceneStoryTime,
  listSceneSynopses,
  listSluglineTallies,
  readLocationMergedInto,
  readProjectScreenplayNodes,
} from '@folio/db'
import type { BoundSluglineRow, LocationRecordRow, OpenLocationRow, SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId, ProposalTarget, ResolveSubject, SetPool } from '@folio/script'
import { NO_QUADRANT, addQuadrants, canonicalKey, establishingLines, matchSetNames, quadrantOf, readSlugline, similarSets } from '@folio/script'
import { cache } from 'react'

import { sceneRefOf } from '../characters/figures'
import { deriveSpeculatively, readDerivationReads } from '../script/server'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { CSV_MIME } from '../workspace/export'
import type { TextExport } from '../workspace/export'
import { nightExteriorsOf, oneOffsOf } from './facts'
import type { FactsPlace } from './facts'
import { NO_LOCATION_COUNTS, ieOf, perEpisodeCounts, peopleAt, subtreeOf, sumEighths, treeOrder } from './figures'
import { breakdownCsvOf, breakdownFilename, csvOf, sortRows } from './sheet'
import { kindOf } from './view'

/**
 * Everything the Locations route reads, and where each part comes from.
 *
 * A *join* over the tables that own each count, plus three readings over
 * the script that no table stores (AGENTS.md, "Nothing is stored that can
 * be computed"): the establishing line, the quadrant and the similar-set
 * pairs are `@folio/script`'s `sets.ts` over rows already in hand -
 *
 *   `rows[]`             `locations` ⋈ `location_derivations`  (`listLocationRecords`),
 *                        in tree order (`treeOrder`); `ie` read off the scenes
 *   `rows[].rollup`      `location_derivations.rollup_*` - the pure core's
 *                        tree walk, stored, which is what "how many days in
 *                        the chawl" reads
 *   `rows[].scenes`      the derived `scenes` against `scene_derivations` ⋈
 *                        `nodes` ⋈ `documents` ⋈ `episodes` (`listSceneIndex`),
 *                        each with its heading's reading, its synopsis
 *                        (`scenes.synopsis`), its story time (`scenes.story_day`,
 *                        the Timeline's) and its cast's names
 *   `rows[].eighths`     `measurement_scenes` at the project's format, `paged`
 *                        (`listSceneEighths`) - the only source of a page count
 *   `rows[].sluglines`   `location_slugline_tallies`, here or below
 *   `rows[].bound`       `location_bound_sluglines` with who bound each, and the
 *                        tallies' count and first heading for each
 *   `rows[].quadrant`    `quadrantOf` over the scene index's readings, own and
 *                        rolled up through the tree
 *   `rows[].intro`       `establishingLines` over the project's node list: the
 *                        first action under any heading at the set or below
 *   `rows[].similar`     `similarSets` over the records, minus the pairs the
 *                        writer said are different (`resolve_decisions`, `set:`)
 *   `rows[].clips`       `research_clip_filings` where `location_id` is this record
 *   `rows[].conflicts`   `resolve_rows` open, kind structure, about this record
 *   `resolve[]`          `resolve_rows` open, kind slugline  (`listOpenLocationRows`),
 *                        each ranked against the records (`matchSetNames`)
 *
 * One shape for every view (`LocationRow`, `@folio/contracts`): the drawer
 * opens over any card and the "Scenes here" view lists every record's
 * scenes, so every field is read for every row, in twelve statements
 * regardless of how many records there are. The node read is the one
 * heavy one and the one the establishing line needs; it is the read the
 * Script route makes on every load.
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
  /** Every present scene across the project as a ref, in running order - the strip's cells and the panel's `Scene N` join. */
  readonly index: readonly SceneRef[]
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

/** The set key a heading reads down to, or the heading's own key when it does not parse. */
const setKeyOf = (heading: string): string => {
  const reading = readSlugline(heading)
  return canonicalKey(reading.ok ? reading.value.set : heading)
}

/** `set:<a>:<b>` with the two ids in order - the decision key for "these two are different places". */
export const similarKey = (a: LocationId, b: LocationId): string => `set:${[a, b].sort().join(':')}`

/**
 * What the load reads of a context - the scope, the project (its format) and
 * the episodes. Narrowed from `ProjectContext` (roadmap task 2.4) so the
 * agent's tools, which hold a gate, read through the same cached loader.
 */
export type LocationsContext = Pick<ProjectContext, 'scope' | 'project' | 'episodes'>

export const loadLocations = cache(async (context: LocationsContext): Promise<LocationsLoad> => {
  const { scope, episodes, project } = context
  const [records, index, openRows, tallies, eighths, bound, synopses, characters, storyTime, filedClips, decisions, nodesRead] =
    await Promise.all([
      listLocationRecords(scope),
      listSceneIndex(scope),
      listOpenLocationRows(scope),
      listSluglineTallies(scope),
      listSceneEighths(scope, project.format),
      listBoundSluglines(scope),
      listSceneSynopses(scope),
      listCharacterRecords(scope),
      listSceneStoryTime(scope),
      listClipsFiledToLocations(scope),
      listResolveDecisions(scope),
      readProjectScreenplayNodes(scope),
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
  const rowByScene = new Map<NodeId, SceneIndexRow>(index.map((row) => [row.sceneNodeId, row]))
  const people = new Map<CharacterId, { readonly name: string; readonly hue: number }>(
    characters.map((character) => [character.id, { name: character.name, hue: hueOfColor(character.color) }]),
  )
  const subtreeIds = new Map(skeletons.map((entry) => [entry.id, subtreeOf(entry.id, skeletons)]))
  const boundOf = new Map<LocationId, BoundSluglineRow[]>()
  for (const entry of bound) {
    const list = boundOf.get(entry.locationId) ?? []
    list.push(entry)
    boundOf.set(entry.locationId, list)
  }

  // The pool matching ranks against: every live record, its name and its
  // bound set texts - the alias table's three columns.
  const pool: readonly (SetPool & { readonly parentId: LocationId | null })[] = skeletons.map((entry) => ({
    id: entry.id,
    name: entry.name,
    boundSluglines: (boundOf.get(entry.id) ?? []).map((row) => row.slugline),
    parentId: entry.parentId,
  }))
  const candidatesFor = (set: string): readonly SluglineCandidate[] =>
    matchSetNames(set, pool)
      .slice(0, 3)
      .flatMap((match) => {
        const name = nameOf.get(match.id)
        return name === undefined ? [] : [{ id: match.id, name, confidence: match.confidence, reason: match.reason }]
      })

  // Two records that read as one place, minus the pairs the writer said differ.
  const differ = new Set(
    decisions.filter((decision) => decision.verdict === 'rejected' && decision.rowKey.startsWith('set:')).map((decision) => decision.rowKey),
  )
  const similarOf = new Map<LocationId, SimilarSetRow[]>()
  for (const pair of similarSets(pool)) {
    if (differ.has(similarKey(pair.a, pair.b))) continue
    for (const [self, other] of [
      [pair.a, pair.b],
      [pair.b, pair.a],
    ] as const) {
      const name = nameOf.get(other)
      if (name === undefined) continue
      const list = similarOf.get(self) ?? []
      list.push({ id: other, name, confidence: pair.confidence, reason: pair.reason })
      similarOf.set(self, list)
    }
  }

  // The first action under any heading at each set, from the node list.
  const labels = new Map<string, string>()
  for (const character of characters) labels.set(`character:${character.id}`, character.name)
  for (const entry of skeletons) labels.set(`location:${entry.id}`, entry.name)
  const intros = nodesRead.ok
    ? establishingLines(
        nodesRead.value,
        (sceneNodeId) => rowByScene.get(sceneNodeId)?.locationId ?? null,
        (target) => labels.get(`${target.entity}:${target.id}`),
      )
    : new Map()

  // The queue, split: sluglines pointing at nothing (the banner) and
  // structure proposals (a conflict block on the record they are about).
  const resolve: SluglineResolveItem[] = []
  const conflictsOf = new Map<LocationId, StructureResolveItem[]>()
  for (const row of openRows) {
    if (row.subjectKind === 'slugline') {
      const item = sluglineItemOf(row, nameOf, refByScene, candidatesFor)
      if (item !== null) resolve.push(item)
      continue
    }
    const item = structureItemOf(row, nameOf)
    if (item === null) continue
    const list = conflictsOf.get(item.location.id) ?? []
    list.push(item)
    conflictsOf.set(item.location.id, list)
  }

  const ownQuadrant = new Map<LocationId, ReturnType<typeof quadrantOf>>()
  for (const entry of skeletons) {
    const own = new Set(entry.record.derived?.scenes ?? [])
    ownQuadrant.set(entry.id, quadrantOf(index.filter((row) => own.has(row.sceneNodeId))))
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
    const ownScenes = index.filter((row) => row.locationId === entry.id)

    const sceneRows: LocationSceneRow[] = here.map((row) => sceneRowOf(row, synopses, people, eighths, storyTime, entry, nameOf))

    // The alias table: each bound set text with its count and first heading, this record's own.
    const boundRows: BoundSetView[] = (boundOf.get(entry.id) ?? []).map((row) => {
      const key = canonicalKey(row.slugline)
      const occurrences = tallies
        .filter((tally) => tally.locationId === entry.id && tally.key === key)
        .reduce((total, tally) => total + tally.occurrences, 0)
      const firstScene = ownScenes.find((scene) => setKeyOf(scene.heading) === key)
      return {
        slugline: row.slugline,
        provenance: row.boundBy === null ? 'derived' : row.boundBy === scope.actor ? 'you' : 'member',
        occurrences,
        firstRef: firstScene === undefined ? null : sceneRefOf(firstScene),
      }
    })

    // The establishing line: this set's own first, else the earliest under any sub-set.
    let intro: EstablishingRow | null = null
    for (const id of ids) {
      const line = intros.get(id)
      if (line === undefined) continue
      const ref = refByScene.get(line.sceneNodeId)
      if (ref === undefined) continue
      if (intro === null || (sceneOrder.get(line.sceneNodeId) ?? 0) < (sceneOrder.get(intro.scene.sceneNodeId) ?? 0)) {
        intro = { nodeId: line.nodeId, text: line.text, scene: ref }
      }
    }

    let rollupQuadrant = NO_QUADRANT
    for (const id of ids) rollupQuadrant = addQuadrants(rollupQuadrant, ownQuadrant.get(id) ?? NO_QUADRANT)

    const clips: FiledClip[] = filedClips
      .filter((clip) => clip.locationId === entry.id)
      .map((clip) => ({ id: clip.clipId, text: clip.text, sourceId: clip.sourceId, sourceTitle: clip.sourceTitle }))

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
      scheduledDays: record.scheduledDays,
      photoUrl: publicUrl(record.photoKey),
      sluglines: tallies
        .filter((tally) => ids.has(tally.locationId))
        .map((tally) => ({ slugline: tally.slugline, occurrences: tally.occurrences })),
      boundSluglines: boundRows.map((row) => row.slugline),
      bound: boundRows,
      intro,
      quadrant: ownQuadrant.get(entry.id) ?? NO_QUADRANT,
      rollupQuadrant,
      clips,
      similar: similarOf.get(entry.id) ?? [],
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

  return {
    rows,
    resolve,
    index: index.map(sceneRefOf),
    sceneTotal: index.length,
    derivable,
    storage: storageAvailable(),
  }
})

const sceneRowOf = (
  row: SceneIndexRow,
  synopses: ReadonlyMap<NodeId, string>,
  people: ReadonlyMap<CharacterId, { readonly name: string; readonly hue: number }>,
  eighths: ReadonlyMap<NodeId, number>,
  storyTime: ReadonlyMap<NodeId, { readonly storyDay: number | null; readonly storyClock: string | null; readonly flashback: boolean }>,
  at: Skeleton,
  nameOf: ReadonlyMap<LocationId, string>,
): LocationSceneRow => {
  const time = storyTime.get(row.sceneNodeId)
  return {
    scene: sceneRefOf(row),
    ie: row.ie,
    light: row.light,
    timeOfDay: row.timeOfDay,
    storyDay: time?.storyDay ?? null,
    storyClock: time?.storyClock ?? null,
    flashback: time?.flashback ?? false,
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
  }
}

const sluglineItemOf = (
  row: OpenLocationRow,
  nameOf: ReadonlyMap<LocationId, string>,
  refByScene: ReadonlyMap<NodeId, SceneRef>,
  candidatesFor: (set: string) => readonly SluglineCandidate[],
): SluglineResolveItem | null => {
  if (!isSluglineSubject(row.subject)) return null
  const candidates = candidatesFor(row.subject.slugline)
  let proposal: SluglineResolveProposal | null = null
  if (row.proposalConfidence !== null && isTarget(row.proposalTarget)) {
    const target = row.proposalTarget
    if (target.kind === 'location') {
      const name = nameOf.get(target.id)
      proposal =
        name === undefined
          ? null
          : {
              kind: 'location',
              id: target.id,
              name,
              confidence: row.proposalConfidence,
              reason: candidates.find((candidate) => candidate.id === target.id)?.reason ?? null,
            }
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
    candidates,
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
const countDerivable = async (context: LocationsContext): Promise<Derivable> => {
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

// ---------------------------------------------------------------------------
// Server-side reads of what the workspace computes (roadmap task 2.4)
// ---------------------------------------------------------------------------

/** The panel's two report chips, answered on the server with the workspace's own predicates. */
export const readLocationFacts = async (
  context: LocationsContext,
): Promise<{ readonly oneOffs: readonly FactsPlace[]; readonly nightExteriors: readonly (FactsPlace & { readonly nights: number })[] }> => {
  const { rows } = await loadLocations(context)
  return { oneOffs: oneOffsOf(rows), nightExteriors: nightExteriorsOf(rows) }
}

/**
 * The Sheet view's `Export CSV`, on the server: every row, in the view's
 * default order (most scenes first), for the whole series or one episode -
 * the view's scope menu - through the same `csvOf`.
 */
export const locationsCsv = async (context: LocationsContext, ordinal: number | null): Promise<TextExport> => {
  const { rows } = await loadLocations(context)
  return {
    filename: 'locations.csv',
    mime: CSV_MIME,
    text: csvOf(sortRows(rows, 'scenes', 'desc', ordinal), ordinal, ordinal === null ? context.episodes.map((episode) => episode.ordinal) : [ordinal]),
  }
}

/** The Scenes view's per-set `Export breakdown`, on the server. `null` when the id names no set here. */
export const locationBreakdownCsv = async (context: LocationsContext, locationId: string): Promise<TextExport | null> => {
  const { rows } = await loadLocations(context)
  const row = rows.find((entry) => entry.id === locationId)
  if (row === undefined) return null
  return { filename: breakdownFilename(row.name), mime: CSV_MIME, text: breakdownCsvOf(row) }
}
