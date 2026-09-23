import type { PropAliasView, PropEvidenceRow, PropRow, PropShotRow, SceneRef } from '@folio/contracts'
import {
  countPropSceneSetups,
  listCharacterRecords,
  listLocationRecords,
  listPropAliases,
  listPropRecords,
  listPropShots,
  listSceneIndex,
  readProjectScreenplayNodes,
  readPropMergedInto,
} from '@folio/db'
import type { PropAliasRow, SceneIndexRow } from '@folio/db'
import type { Confidence, NodeId, PropEvidence as ScriptEvidence, PropId, PropPool } from '@folio/script'
import { canonicalKey, propEvidence, PROP_EVIDENCE_LIMIT } from '@folio/script'
import { cache } from 'react'

import { sceneRefOf } from '../characters/figures'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { unsourcedOf, unwrittenOf } from './facts'
import type { FactsProp } from './facts'
import { categoriesOf } from './view'

/**
 * Everything the Props route reads, and where each part comes from.
 *
 *   `rows[]`               `props`, live rows in creation order
 *   `rows[].bound`         `prop_aliases` with who bound each
 *   `rows[].evidence`      `@folio/script`'s `propEvidence` over the
 *                          project's node list - **read here, stored
 *                          nowhere** (AGENTS.md, "Nothing is stored that
 *                          can be computed"); the same standing the
 *                          Locations route's `sets.ts` readings have
 *   `rows[].scenes`        the scenes those lines fall in, joined to the
 *                          scene index (`listSceneIndex`) for their refs
 *   `rows[].shots`         `reel_shots.prop_id`, Production read back
 *   `rows[].sceneSetups`   `scenes.prop_id`, the same
 *
 * There is no derived table to join, because a prop has no derived half
 * (`packages/db`, `schema/props.ts`). That is the whole difference from
 * `lib/locations/server.ts`, and it makes this loader shorter rather than
 * cleverer.
 *
 * ## Every read in one `Promise.all`, and no query inside the map
 *
 * Seven statements, regardless of how many props there are. The node read
 * is the heavy one and the evidence reading needs it; it is the read the
 * Script route makes on every load, and `cache()` means the layout and the
 * page share this whole load rather than making it twice.
 *
 * ## The pool is the writer's list, and only the writer's list
 *
 * `propEvidence` is handed the records that exist with their aliases. It
 * cannot mint one and nothing here proposes one: a line of action naming a
 * thing nobody wrote down produces no record and no queue row (ruling 6).
 * So the empty state offers to add one by hand and nothing else - there is
 * no `✦ Derive props` button, because there is nothing to derive.
 */

/** Lower is better, the pure core's own ordering - `confidenceRank`, inlined rather than re-exported for one comparison. */
const RANK: Readonly<Record<Confidence, number>> = { certain: 0, likely: 1, possible: 2 }

export type PropsLoad = {
  readonly rows: readonly PropRow[]
  /** Every present scene across the project as a ref, in running order. */
  readonly index: readonly SceneRef[]
  /** Present scenes across the project - the status bar's `M scenes`. */
  readonly sceneTotal: number
  /** Every category already in use, sorted - what the drawer's field offers (ruling 5). */
  readonly categories: readonly string[]
  /** Whether the five `R2_*` variables are set - whether Upload can be offered. */
  readonly storage: boolean
}

/** What the load reads of a context: only the scope (narrowed for the agent's tools, roadmap task 2.4). */
export type PropsContext = Pick<ProjectContext, 'scope'>

export const loadProps = cache(async (context: PropsContext): Promise<PropsLoad> => {
  const { scope } = context
  const [records, aliases, index, shots, setups, characters, locations, nodesRead] = await Promise.all([
    listPropRecords(scope),
    listPropAliases(scope),
    listSceneIndex(scope),
    listPropShots(scope),
    countPropSceneSetups(scope),
    listCharacterRecords(scope),
    listLocationRecords(scope),
    readProjectScreenplayNodes(scope),
  ])

  const refByScene = new Map<NodeId, SceneRef>(index.map((row: SceneIndexRow) => [row.sceneNodeId, sceneRefOf(row)]))
  const sceneOrder = new Map<NodeId, number>(index.map((row, at) => [row.sceneNodeId, at]))
  const nodeOrder = new Map<NodeId, number>(nodesRead.ok ? nodesRead.value.map((node, at) => [node.id, at] as const) : [])

  const aliasesOf = new Map<PropId, PropAliasRow[]>()
  for (const entry of aliases) {
    const list = aliasesOf.get(entry.propId) ?? []
    list.push(entry)
    aliasesOf.set(entry.propId, list)
  }

  // A mention renders as the record's name in a quoted line, so an
  // `@mention` of a character does not leave a hole in the evidence.
  const labels = new Map<string, string>()
  for (const character of characters) labels.set(`character:${character.id}`, character.name)
  for (const location of locations) labels.set(`location:${location.id}`, location.name)

  /**
   * One pass, at the **alias** level rather than the record level.
   *
   * The drawer wants both answers - every line about the record, and how
   * many lines each spelling accounts for - and the second is not
   * recoverable from the first. Scoring per record and then again per
   * alias would walk the node list once per record, which is the "no query
   * inside the map" mistake in a different costume. So the pool is one
   * entry per `(record, alias)` pair with a composite key, `propEvidence`
   * runs once, and each record's own evidence is its aliases' lines merged
   * by node, best confidence winning. The record's name is a key even when
   * nothing is bound to it, so a record whose name alias was unbound still
   * answers to its name.
   */
  const keyed = records.flatMap((record) => {
    const own = (aliasesOf.get(record.id) ?? []).map((row) => row.alias)
    const spellings = own.some((alias) => canonicalKey(alias) === canonicalKey(record.name)) ? own : [record.name, ...own]
    return spellings.map((alias, at) => ({
      id: `${record.id}#${String(at)}` as PropId,
      record: record.id,
      alias,
      pool: { id: `${record.id}#${String(at)}` as PropId, name: alias, aliases: [] } satisfies PropPool,
    }))
  })
  const perAlias = nodesRead.ok
    ? propEvidence(
        nodesRead.value,
        keyed.map((entry) => entry.pool),
        (target) => labels.get(`${target.entity}:${target.id}`),
      )
    : new Map<PropId, readonly ScriptEvidence[]>()

  /** Each record's lines, its aliases merged by node with the best confidence. */
  const evidence = new Map<PropId, readonly ScriptEvidence[]>()
  const linesPerAlias = new Map<string, number>()
  for (const record of records) {
    const best = new Map<NodeId, ScriptEvidence>()
    for (const entry of keyed) {
      if (entry.record !== record.id) continue
      const lines = perAlias.get(entry.id) ?? []
      linesPerAlias.set(`${record.id}\u0000${entry.alias}`, lines.length)
      for (const line of lines) {
        const held = best.get(line.nodeId)
        if (held === undefined || RANK[line.confidence] < RANK[held.confidence]) best.set(line.nodeId, line)
      }
    }
    const ordered = [...best.values()].sort((a, b) => (nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0))
    if (ordered.length > 0) evidence.set(record.id, ordered)
  }

  const shotsOf = new Map<PropId, PropShotRow[]>()
  for (const use of shots) {
    const ref = refByScene.get(use.sceneNodeId)
    const list = shotsOf.get(use.propId) ?? []
    list.push({
      shotId: use.shotId,
      label: `${use.reelName} · Shot ${String(use.number)}`,
      sceneNodeId: use.sceneNodeId,
      sceneNumber: ref?.number ?? 0,
    })
    shotsOf.set(use.propId, list)
  }

  const rows: readonly PropRow[] = records.map((record) => {
    const lines = evidence.get(record.id) ?? []
    const rows_: PropEvidenceRow[] = lines.flatMap((line) => {
      const scene = refByScene.get(line.sceneNodeId)
      return scene === undefined ? [] : [{ nodeId: line.nodeId, text: line.text, confidence: line.confidence, scene }]
    })
    const sceneIds = [...new Set(lines.map((line) => line.sceneNodeId))].sort(
      (a, b) => (sceneOrder.get(a) ?? 0) - (sceneOrder.get(b) ?? 0),
    )
    const scenes = sceneIds.flatMap((id) => {
      const ref = refByScene.get(id)
      return ref === undefined ? [] : [ref]
    })

    // The alias table as drawn: each bound spelling with how many lines it
    // reads in. Counted per alias by re-scoring that one key, so the
    // drawer can say which spelling is doing the work.
    const nameKey = canonicalKey(record.name)
    const counted: readonly PropAliasView[] = (aliasesOf.get(record.id) ?? []).map((row) => ({
      alias: row.alias,
      provenance: row.boundBy === null ? 'derived' : row.boundBy === scope.actor ? 'you' : 'member',
      lines: linesPerAlias.get(`${record.id}\u0000${row.alias}`) ?? 0,
      isName: canonicalKey(row.alias) === nameKey,
    }))

    const first = scenes[0]
    const last = scenes[scenes.length - 1]
    return {
      id: record.id,
      name: record.name,
      category: record.category,
      description: record.description,
      status: record.status,
      photoUrl: publicUrl(record.photoKey),
      aliases: counted.map((entry) => entry.alias),
      bound: counted,
      evidence: rows_.slice(0, PROP_EVIDENCE_LIMIT),
      lines: rows_.length,
      scenes,
      shots: shotsOf.get(record.id) ?? [],
      sceneSetups: setups.get(record.id) ?? 0,
      firstSeen: first ?? null,
      lastSeen: last ?? null,
      createdAt: record.createdAt,
    }
  })

  return {
    rows,
    index: index.map(sceneRefOf),
    sceneTotal: index.length,
    categories: categoriesOf(rows),
    storage: storageAvailable(),
  }
})

export type SelectedProp =
  | { readonly state: 'ok'; readonly record: PropRow }
  /** The id names a tombstone: the record was merged into this one. */
  | { readonly state: 'merged'; readonly into: PropId }
  | { readonly state: 'missing' }

/**
 * The record `/props/:propId` names, out of the load the page already made
 * - so opening the drawer costs one extra statement and only when the id
 * is not a live record (the merge lookup).
 */
export const loadSelectedProp = async (context: ProjectContext, id: PropId): Promise<SelectedProp> => {
  const load = await loadProps(context)
  const record = load.rows.find((row) => row.id === id)
  if (record !== undefined) return { state: 'ok', record }
  const into = await readPropMergedInto(context.scope, id)
  return into === null ? { state: 'missing' } : { state: 'merged', into }
}

/** The panel's two report chips, answered on the server with the workspace's own predicates (roadmap task 2.4). */
export const readPropFacts = async (context: PropsContext): Promise<{ readonly unsourced: readonly FactsProp[]; readonly unwritten: readonly FactsProp[] }> => {
  const { rows } = await loadProps(context)
  return { unsourced: unsourcedOf(rows), unwritten: unwrittenOf(rows) }
}
