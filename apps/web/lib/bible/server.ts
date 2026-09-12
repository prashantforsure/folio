import type {
  BibleCounts,
  BibleEntryId,
  BibleEntryView,
  BibleFactRow,
  BibleNavEntry,
  CanonConflictRow,
  GlossaryRow,
  SceneRef,
} from '@folio/contracts'
import {
  listBibleEntries,
  listBibleFacts,
  listBiblePitchFields,
  listBibleQuestions,
  listBibleTerms,
  listCanonFacts,
  listCharacterRecords,
  listLocationNames,
  listSceneIndex,
  readProjectScreenplayNodes,
} from '@folio/db'
import type { BibleEntryRecord, BibleFactRecord, SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'
import { excerpt, isOk, liveCites, openConflicts, sceneOpenings, termUsage } from '@folio/script'
import { cache } from 'react'

import { perEpisodeBars, sceneRefOf } from '../characters/figures'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import { initialsOf, linkedFromCites } from './figures'

/**
 * Everything the Bible route reads, and where each part comes from.
 *
 * A *join*, never a computation over the script, except in the two places
 * the brief says a number is derived:
 *
 *   `entries[]`      `bible_entries`, in nav order        (`listBibleEntries`)
 *   `facts[]`        `bible_facts` ⋈ `bible_entries`      (`listBibleFacts`)
 *   `index[]`        the present scenes: `scene_derivations` ⋈ `nodes` ⋈
 *                    `documents` ⋈ `episodes`             (`listSceneIndex`)
 *   `open[]`         `listCanonFacts` - the context gate's read - kept to
 *                    those whose scene is present         (`openConflicts`)
 *   an entry         the above plus `bible_questions` (with each author's
 *                    name) and, for the Pitch, `bible_pitch_fields`; its
 *                    Linked chips are the cast and location of its cited
 *                    scenes; its bars are those scenes per episode
 *   the check        the open conflicts, each with the opening line of the
 *                    scene that established the rule and of the scene that
 *                    contradicts it - one read of the project's nodes,
 *                    `sceneOpenings` over it, nothing stored
 *   the glossary     `bible_terms`, each with `termUsage` over the same one
 *                    read of the nodes - "a **derived** use count"
 *
 * A cite or a conflict names a heading node with no foreign key, so every
 * one is resolved here against the present scenes and dropped when it
 * cannot be - the `key_lines` rule. The nodes are read only on the two
 * views that need them, never on the entry view or the nav.
 *
 * `cache()`d per request, keyed by the project context, so the nav column
 * (in the layout), the header and the body share one read.
 */

export type BibleLoad = {
  readonly entries: readonly BibleEntryRecord[]
  readonly facts: readonly BibleFactRecord[]
  readonly index: readonly SceneIndexRow[]
  readonly present: ReadonlySet<NodeId>
  readonly refByScene: ReadonlyMap<NodeId, SceneRef>
  readonly sceneRefs: readonly SceneRef[]
  /** Open canon conflicts: the badge's rows. */
  readonly open: readonly BibleFactRecord[]
  readonly nav: readonly BibleNavEntry[]
  readonly counts: BibleCounts
  readonly hasPitch: boolean
}

export const loadBible = cache(async (context: ProjectContext): Promise<BibleLoad> => {
  const { scope } = context
  const [entries, facts, index, terms] = await Promise.all([
    listBibleEntries(scope),
    listBibleFacts(scope),
    listSceneIndex(scope),
    listBibleTerms(scope),
  ])
  const present = new Set<NodeId>(index.map((row) => row.sceneNodeId))
  const refByScene = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))
  const open = openConflicts(facts, present)
  const contradicted = new Set<BibleEntryId>(open.map((fact) => fact.entryId))

  const nav: BibleNavEntry[] = entries.map((entry) => ({
    id: entry.id,
    section: entry.section,
    kind: entry.kind,
    status: entry.status,
    title: entry.title,
    contradicted: contradicted.has(entry.id),
  }))

  return {
    entries,
    facts,
    index,
    present,
    refByScene,
    sceneRefs: index.map(sceneRefOf),
    open,
    nav,
    counts: {
      entries: entries.length,
      facts: facts.length,
      canonFacts: facts.filter((fact) => fact.entryStatus === 'canon').length,
      conflicts: open.length,
      terms: terms.length,
    },
    hasPitch: entries.some((entry) => entry.kind === 'pitch'),
  }
})

const factRowOf = (fact: BibleFactRecord, load: BibleLoad): BibleFactRow => {
  const conflictRef =
    fact.conflictSceneId === null || fact.conflictNote === null
      ? undefined
      : load.refByScene.get(fact.conflictSceneId)
  return {
    id: fact.id,
    position: fact.position,
    text: fact.text,
    cites: liveCites(fact.cites, load.present).flatMap((id) => {
      const ref = load.refByScene.get(id)
      return ref === undefined ? [] : [ref]
    }),
    conflict:
      conflictRef === undefined || fact.conflictNote === null ? null : { scene: conflictRef, note: fact.conflictNote },
  }
}

/** How many "Also see" links the aside draws. The bundle's two. */
const RELATED = 2

/**
 * One entry as the route draws it, or null when the id names no entry
 * here. The shared load plus what only this entry reads: its questions,
 * its fields, and the names its cited scenes' cast and location resolve to.
 */
export const loadEntry = cache(
  async (context: ProjectContext, entryId: BibleEntryId): Promise<BibleEntryView | null> => {
    const { scope, episodes } = context
    const load = await loadBible(context)
    const entry = load.entries.find((row) => row.id === entryId)
    if (entry === undefined) return null

    const [questions, fields, characters, locationNames] = await Promise.all([
      listBibleQuestions(scope, entryId),
      entry.kind === 'pitch' ? listBiblePitchFields(scope, entryId) : Promise.resolve([]),
      listCharacterRecords(scope),
      listLocationNames(scope),
    ])

    const facts = load.facts.filter((fact) => fact.entryId === entryId).map((fact) => factRowOf(fact, load))
    const cited = new Set<NodeId>(facts.flatMap((fact) => fact.cites.map((ref) => ref.sceneNodeId)))
    const characterNames = new Map<CharacterId, string>(characters.map((record) => [record.id, record.name]))
    const linked = linkedFromCites(load.index, cited, characterNames, locationNames)

    return {
      id: entry.id,
      section: entry.section,
      kind: entry.kind,
      status: entry.status,
      title: entry.title,
      lede: entry.lede,
      notes: entry.notes,
      updatedAt: entry.updatedAt,
      facts,
      questions: questions.map((question) => ({
        id: question.id,
        text: question.text,
        author: { id: question.authorId, name: question.authorName, initials: initialsOf(question.authorName) },
        resolved: question.resolved,
      })),
      fields: fields.map((field) => ({ id: field.id, key: field.key, value: field.value })),
      links: {
        ...linked,
        related: load.entries
          .filter((row) => row.id !== entryId && row.section === entry.section)
          .slice(0, RELATED)
          .map((row) => ({ id: row.id, title: row.title })),
      },
      mentions: cited.size,
      perEpisode: perEpisodeBars(episodes, load.index, cited),
    }
  },
)

/** How much of a scene's opening line the check quotes. */
const OPENING_LENGTH = 120

/**
 * The canon check: every open conflict with the two lines it is between.
 * Reads the project's nodes once; the entry view never does.
 */
export const loadCanonCheck = cache(async (context: ProjectContext): Promise<readonly CanonConflictRow[]> => {
  const { scope } = context
  const load = await loadBible(context)
  const canon = await listCanonFacts(scope)
  const open = openConflicts(canon, load.present)
  if (open.length === 0) return []

  const wanted = new Set<NodeId>()
  for (const fact of open) {
    if (fact.conflictSceneId !== null) wanted.add(fact.conflictSceneId)
    const first = liveCites(fact.cites, load.present)[0]
    if (first !== undefined) wanted.add(first)
  }
  const read = await readProjectScreenplayNodes(scope)
  const openings = isOk(read) ? sceneOpenings(read.value, wanted) : new Map<NodeId, string>()
  const quote = (id: NodeId): string => excerpt(openings.get(id) ?? '', OPENING_LENGTH)

  return open.flatMap((fact) => {
    if (fact.conflictSceneId === null || fact.conflictNote === null) return []
    const contradicts = load.refByScene.get(fact.conflictSceneId)
    if (contradicts === undefined) return []
    const first = liveCites(fact.cites, load.present)[0]
    const established = first === undefined ? undefined : load.refByScene.get(first)
    return [
      {
        factId: fact.id,
        entryId: fact.entryId,
        entryTitle: fact.entryTitle,
        rule: fact.text,
        established: established === undefined ? null : { scene: established, excerpt: quote(established.sceneNodeId) },
        contradicts: { scene: contradicts, excerpt: quote(contradicts.sceneNodeId), note: fact.conflictNote },
      },
    ]
  })
})

/**
 * The glossary: every term with its derived use count and first-use scene.
 * One read of the project's nodes, one pass over them.
 */
export const loadGlossary = cache(async (context: ProjectContext): Promise<readonly GlossaryRow[]> => {
  const { scope } = context
  const load = await loadBible(context)
  const terms = await listBibleTerms(scope)
  if (terms.length === 0) return []
  const read = await readProjectScreenplayNodes(scope)
  const usage = termUsage(
    isOk(read) ? read.value : [],
    terms.map((term) => term.term),
  )
  return terms.map((term, at) => {
    const row = usage[at]
    const first = row?.firstScene ?? null
    return {
      id: term.id,
      term: term.term,
      definition: term.definition,
      firstSaid: first === null ? null : (load.refByScene.get(first) ?? null),
      uses: row?.uses ?? 0,
    }
  })
})

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterBible = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: BibleLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadBible(context) }
}
