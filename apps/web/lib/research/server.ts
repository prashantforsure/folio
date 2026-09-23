import type { ResearchClipRow, ResearchCollectionRow, ResearchFilingRow, ResearchSourceRow, SceneRef } from '@folio/contracts'
import { listCharacterRecords, listLocationRecords, listResearchClips, listResearchCollections, listResearchSources, listSceneIndex } from '@folio/db'
import type { StoredFiling } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { cache } from 'react'

import { sceneRefOf } from '../characters/figures'
import type { ProjectContext } from '../workspace/context'

/**
 * Everything the Research route reads, in one `cache()`d call the layout
 * and the page share.
 *
 * Five reads in parallel: the sources (with clip counts), the collections
 * (with source counts), every clip with its filings, and the three lists
 * a filing can point at - the scene index, the live characters and the
 * live locations. The last three feed the `Send to…` picker and resolve a
 * scene filing to its `E1 Sc 3`; a scene whose heading is no longer
 * present resolves to `ref: null` and the chip says so
 * (`lib/research/view.ts`, `filingLabel`).
 *
 * Nothing here computes what a table owns: every count is the
 * repository's `count(*)`. What this file adds is the join a key cannot
 * make - the scene ref for a node id (`schema/research.ts` says why there
 * is no key).
 */

export type FilingTargets = {
  readonly characters: readonly { readonly id: CharacterId; readonly name: string }[]
  readonly locations: readonly { readonly id: LocationId; readonly name: string }[]
  readonly scenes: readonly SceneRef[]
}

export type ResearchLoad = {
  /** Newest first. */
  readonly sources: readonly ResearchSourceRow[]
  /** Name order. */
  readonly collections: readonly ResearchCollectionRow[]
  /** Every clip in the project, oldest first, filings resolved. */
  readonly clips: readonly ResearchClipRow[]
  readonly targets: FilingTargets
}

const resolveFiling = (filing: StoredFiling, refs: ReadonlyMap<NodeId, SceneRef>): ResearchFilingRow =>
  filing.kind === 'scene' ? { ...filing, ref: refs.get(filing.sceneNodeId) ?? null } : filing

/** What the load reads of a context: only the scope (narrowed for the agent's `read_research`, roadmap task 2.5). */
export type ResearchContext = Pick<ProjectContext, 'scope'>

export const loadResearch = cache(async (context: ResearchContext): Promise<ResearchLoad> => {
  const { scope } = context
  const [sources, collections, stored, index, characterRows, locationRows] = await Promise.all([
    listResearchSources(scope),
    listResearchCollections(scope),
    listResearchClips(scope),
    listSceneIndex(scope),
    listCharacterRecords(scope),
    listLocationRecords(scope),
  ])
  const scenes = index.map(sceneRefOf)
  const refs = new Map<NodeId, SceneRef>(scenes.map((ref) => [ref.sceneNodeId, ref]))
  const clips = stored.map((clip) => ({ ...clip, filings: clip.filings.map((filing) => resolveFiling(filing, refs)) }))
  const byName = <T extends { readonly name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)
  return {
    sources,
    collections,
    clips,
    targets: {
      characters: characterRows.map((row) => ({ id: row.id, name: row.name })).sort(byName),
      locations: locationRows.map((row) => ({ id: row.id, name: row.name })).sort(byName),
      scenes,
    },
  }
})
