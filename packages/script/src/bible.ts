import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { ScreenplayNode } from './node'
import { renderableNodes } from './stream'

/**
 * The bible: what is true in this world, and what the draft contradicts.
 *
 * The Bible brief: "Authored entries whose facts cite derived scenes." Every
 * word of an entry is the writer's; nothing here derives one, and nothing
 * here reads a table. What *is* a function of the node list - how often a
 * glossary term is said and where it is first said, whether a recorded
 * conflict still names a scene that is in the draft - lives here, so the
 * route and the context builder read one implementation of each.
 *
 * ## Entry status is a permission, not a label
 *
 * "`canon` is checked against every draft and readable by lenses; `draft` is
 * neither until promoted; `retired` is kept for history and ignored. Enforce
 * this server-side in the context builder, not in the UI - it is one of the
 * two gates that decide what AI can see." `isReadableByLenses` and
 * `isCheckedAgainstDraft` are that gate as one predicate each, tested, so the
 * repository read the context builder uses and the check the route draws
 * both name the same rule rather than each spelling `=== 'canon'`. The two
 * happen to agree today; they are two functions because the brief names two
 * permissions, and a fourth status could split them.
 *
 * `draft` is first in `BIBLE_ENTRY_STATUSES` because it is the default: "Nothing
 * is canon until you mark it."
 *
 * ## A conflict is recorded, and it is against the *current* draft
 *
 * "Facts can carry a recorded conflict with the current draft." There is no
 * model in this repository and a report never calls one, so a conflict is
 * not found here - it is recorded, by the writer (and later by the agent's
 * canon pre-flight), as a scene and a note. What this module decides is
 * whether a recorded conflict still *counts*: only on a canon entry (a draft
 * "is not checked", a retired one "is ignored"), and only while the scene it
 * names is in the draft. A conflict whose scene has been cut is moot, and
 * `openConflicts` drops it the way a key line the script has lost is dropped
 * on read - never shown from a copy.
 *
 * ## The glossary's use count is derived, and it is a word count
 *
 * "term, definition, first-use scene, and a **derived** use count." `termUsage`
 * scans the renderable stream - comments never count, the same rule as
 * pagination - for the term as a whole word, case-insensitively, and reports
 * how many times and under which heading it was first said. Whole-word means
 * bounded by anything that is not a letter or a digit in any script, so
 * `tank` does not count inside `tanker`, and a Devanagari term is matched by
 * the same rule as a Latin one. Nothing is folded or stemmed: a glossary
 * term is the audience's word, spelled as the writer spelled it.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The four sections, in the order the brief and the nav list them. */
export const BIBLE_SECTIONS = ['premise', 'how_things_work', 'history', 'themes'] as const

export type BibleSection = (typeof BIBLE_SECTIONS)[number]

export const BIBLE_SECTION_LABEL: Readonly<Record<BibleSection, string>> = {
  premise: 'Premise',
  how_things_work: 'How things work',
  history: 'History',
  themes: 'Themes',
}

export const isBibleSection = (value: string): value is BibleSection =>
  (BIBLE_SECTIONS as readonly string[]).includes(value)

/** `draft` first: it is the default. See the header. */
export const BIBLE_ENTRY_STATUSES = ['draft', 'canon', 'retired'] as const

export type BibleEntryStatus = (typeof BIBLE_ENTRY_STATUSES)[number]

export const BIBLE_ENTRY_STATUS_LABEL: Readonly<Record<BibleEntryStatus, string>> = {
  draft: 'Draft',
  canon: 'Canon',
  retired: 'Retired',
}

export const isBibleEntryStatus = (value: string): value is BibleEntryStatus =>
  (BIBLE_ENTRY_STATUSES as readonly string[]).includes(value)

/**
 * Two kinds of entry. `rules` is the ordinary entry: a lede, numbered facts
 * each citing a scene, notes, open questions. `pitch` is the brief's
 * "separate Pitch entry" - ordered key/value fields, "deliberately kept
 * apart from the rules": it has fields and questions and no facts, so it
 * never enters the canon check whatever its status says.
 */
export const BIBLE_ENTRY_KINDS = ['rules', 'pitch'] as const

export type BibleEntryKind = (typeof BIBLE_ENTRY_KINDS)[number]

/** The Pitch's title. One per project; the entry is found by kind, never by this string. */
export const PITCH_TITLE = 'Pitch'

/**
 * The seven fields a new Pitch opens with, empty, in the bundle's order.
 * Keys only: the values are the producer-facing page and are the writer's.
 */
export const PITCH_FIELD_KEYS = [
  'Logline',
  'Genre',
  'Format',
  'Audience',
  'Comparables',
  'Positioning',
  'Status',
] as const

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The first context gate: may a lens read this entry? Only canon. */
export const isReadableByLenses = (status: BibleEntryStatus): boolean => status === 'canon'

/** Is this entry read against every draft? Only canon. */
export const isCheckedAgainstDraft = (status: BibleEntryStatus): boolean => status === 'canon'

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/** What `openConflicts` needs to know about a fact. The route's row carries more. */
export type ConflictCandidate = {
  readonly entryStatus: BibleEntryStatus
  /** The heading node of the scene the writer says contradicts this rule, or null. */
  readonly conflictSceneId: NodeId | null
}

/**
 * The facts whose recorded conflict counts: the entry is canon and the
 * contradicting scene is still in the draft. In the caller's order. See the
 * header for why both conditions are here and not in a query.
 */
export const openConflicts = <F extends ConflictCandidate>(
  facts: readonly F[],
  presentScenes: ReadonlySet<NodeId>,
): readonly F[] =>
  facts.filter(
    (fact) =>
      isCheckedAgainstDraft(fact.entryStatus) &&
      fact.conflictSceneId !== null &&
      presentScenes.has(fact.conflictSceneId),
  )

/** A fact's cites, keeping only scenes that are in the draft. Order kept. */
export const liveCites = (cites: readonly NodeId[], presentScenes: ReadonlySet<NodeId>): readonly NodeId[] =>
  cites.filter((id) => presentScenes.has(id))

// ---------------------------------------------------------------------------
// Scene text
// ---------------------------------------------------------------------------

const plainText = (content: InlineContent): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : ''))
    .join('')
    .trim()

/**
 * The first line of each named scene: the first action or dialogue node
 * under its heading, as plain text. What the check view quotes beside
 * `Established · E1 Sc 3` and `Contradicts · E3 Sc 8`. A heading with
 * nothing under it yet maps to `''`; a heading that is not in the list is
 * not in the result.
 */
export const sceneOpenings = (
  nodes: readonly ScreenplayNode[],
  sceneIds: ReadonlySet<NodeId>,
): ReadonlyMap<NodeId, string> => {
  const out = new Map<NodeId, string>()
  let current: NodeId | null = null
  for (const node of renderableNodes(nodes)) {
    if (node.type === 'scene') {
      current = sceneIds.has(node.id) ? node.id : null
      if (current !== null) out.set(current, '')
      continue
    }
    if (current === null || out.get(current) !== '') continue
    if (node.type !== 'action' && node.type !== 'dialogue') continue
    const line = plainText(node.content)
    if (line !== '') out.set(current, line)
  }
  return out
}

// ---------------------------------------------------------------------------
// The glossary
// ---------------------------------------------------------------------------

export type TermUsage = {
  readonly term: string
  /** Whole-word, case-insensitive occurrences across the renderable stream. */
  readonly uses: number
  /** The heading the first occurrence sits under; null when never said, or said above the first heading. */
  readonly firstScene: NodeId | null
}

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/**
 * A term as a pattern: bounded on both sides by a non-letter, non-digit (or
 * the edge), any run of whitespace inside it matching any run of
 * whitespace. `null` for a term that is only whitespace.
 */
const termPattern = (term: string): RegExp | null => {
  const words = term.trim().split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return null
  const body = words.map(escapeForRegExp).join('\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
}

const countMatches = (pattern: RegExp, haystack: string): number => {
  pattern.lastIndex = 0
  let count = 0
  while (pattern.exec(haystack) !== null) {
    count += 1
    if (pattern.lastIndex === 0) break
  }
  return count
}

/**
 * How often each term is said across the script, and where first. One pass
 * over the nodes; the terms are returned in the order given. A term of only
 * whitespace is never said.
 */
export const termUsage = (
  nodes: readonly ScreenplayNode[],
  terms: readonly string[],
): readonly TermUsage[] => {
  const patterns = terms.map(termPattern)
  const uses = terms.map(() => 0)
  const firstScene = terms.map((): NodeId | null => null)
  const said = terms.map(() => false)
  let current: NodeId | null = null
  for (const node of renderableNodes(nodes)) {
    if (node.type === 'scene') current = node.id
    const haystack = plainText(node.content)
    if (haystack === '') continue
    patterns.forEach((pattern, at) => {
      if (pattern === null) return
      const hits = countMatches(pattern, haystack)
      if (hits === 0) return
      uses[at] = (uses[at] ?? 0) + hits
      if (!said[at]) {
        said[at] = true
        firstScene[at] = current
      }
    })
  }
  return terms.map((term, at) => ({
    term,
    uses: uses[at] ?? 0,
    firstScene: firstScene[at] ?? null,
  }))
}
