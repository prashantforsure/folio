import type { GeneratedArtefactKind, Speaker } from './generated-text'
import { isPageSplitContinuation, readCue, stripGeneratedFromLine } from './generated-text'
import { classifyHeading } from './fountain-syntax'
import type { RejectedHeadingReason } from './fountain-syntax'
import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import { normaliseContent } from './inline'
import type { DeliveryModifier, ScreenplayNode, ScreenplayNodeType } from './node'
import { PAGINATION_FIELDS, makeScreenplayNode } from './node'
import type { Provenance } from './provenance'
import { typed } from './provenance'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Final Draft to a node list.
 *
 * ## Why this takes a tree and not a string
 *
 * AGENTS.md's stack table says FDX is `fast-xml-parser` plus a custom mapping.
 * It also says `packages/script` takes **zero** new runtime dependencies and
 * "must run identically in the browser, in server code, in the worker and in
 * tests". Both cannot hold for a module that parses XML itself.
 *
 * Ruled: the mapping lives here and is pure; the caller parses the XML and
 * hands in the tree. So `fast-xml-parser` is a dependency of `apps/web` and
 * `apps/worker`, never of this package, and the mapping - which is the part
 * that is actually the product - stays deterministic, browser-safe and
 * property-testable.
 *
 * `FdxNode` is therefore a contract *we* own. Replacing the XML library later
 * changes one adapter and touches nothing in here.
 *
 * ### The adapter the caller owes
 *
 * ```ts
 * import { XMLParser } from 'fast-xml-parser'
 *
 * const parser = new XMLParser({
 *   ignoreAttributes: false,
 *   attributeNamePrefix: '',
 *   preserveOrder: true,   // document order is load-bearing: a script is an
 *                          // ordered list of nodes
 *   trimValues: false,     // Final Draft's own spacing, not ours to normalise
 *   textNodeName: '#text',
 * })
 * const tree = toFdxNode(parser.parse(xml))   // ~20 lines, shape below
 * ```
 *
 * ## The mapping
 *
 * Final Draft **declares** each paragraph's type, which Fountain only infers.
 * That difference decides the one judgement call in this file: an FDX
 * `Type="Scene Heading"` paragraph whose text is `INTERCUT - PHONE CALL`
 * becomes a **Scene node**, because the writer explicitly formatted it as a
 * heading - the same standing as Fountain's `.` forcing character. It is
 * reported in `headingsNotRecognised` so it is never *silent*, which is what
 * AGENTS.md, Derivation actually forbids. Demoting it to Action instead would
 * silently rewrite the writer's document and shift every scene after it.
 *
 * Whether such a heading resolves to a set is derivation's problem, not this
 * file's - see the `SceneNode` header in `node.ts`.
 *
 * ## Pagination arrives in the file and does not leave this function
 *
 * A Final Draft scene heading carries `<SceneProperties Page="12" Length="3/8">`.
 * That is exactly the data AGENTS.md bans from a node - "There is no `page`
 * attribute on a node. Ever." - and page numbers and eighths belong on a
 * measurement record. They are discarded here and counted in `discarded`, so
 * the ban is visible at the boundary where the temptation arrives rather than
 * only in the type system.
 *
 * ## Generated text
 *
 * `(MORE)`, `CHARACTER (CONT'D)` and speaker `(CONT'D)` are removed by the same
 * `generated-text.ts` the Fountain parser uses, including the page-split
 * rejoin. One implementation, two front doors: two would agree on `(V.O.)` and
 * then differ on `(CONT’D)` with a curly apostrophe, and that difference is the
 * doubling bug.
 */

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/**
 * One XML element, reduced to what the mapping reads.
 *
 * Deliberately not a general XML model: no namespaces, no processing
 * instructions, no comments. Anything this type cannot express is something the
 * mapping does not look at.
 */
export type FdxNode = {
  /** Element name, e.g. `Paragraph`. Case as it appears in the file. */
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  /** In document order. A script is an ordered list of nodes. */
  readonly children: readonly FdxNode[]
  /** Character data directly inside this element, concatenated in order. */
  readonly text: string
}

export const fdxNode = (
  name: string,
  parts: {
    readonly attributes?: Readonly<Record<string, string>>
    readonly children?: readonly FdxNode[]
    readonly text?: string
  } = {},
): FdxNode => ({
  name,
  attributes: parts.attributes ?? {},
  children: parts.children ?? [],
  text: parts.text ?? '',
})

// ---------------------------------------------------------------------------
// Final Draft's paragraph types
// ---------------------------------------------------------------------------

/**
 * The six that map one-to-one onto the closed union.
 *
 * Keyed by Final Draft's own spelling. A type not in this table is either
 * coerced (with a report) or dropped (with a report) - never guessed.
 */
const DIRECT_TYPES: Readonly<Record<string, ScreenplayNodeType>> = {
  'Scene Heading': 'scene',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'paren',
  Dialogue: 'dialogue',
  Transition: 'transition',
}

/**
 * Types with no member of the union, mapped to the nearest and reported.
 *
 * `Shot` and `General` are both rendered as full-width prose by Final Draft and
 * carry no structure the model would keep, so Action loses nothing. They are
 * still reported, because "your Shot paragraphs are now Action" is a fact the
 * writer is entitled to before they notice it themselves.
 */
const COERCED_TYPES: Readonly<Record<string, ScreenplayNodeType>> = {
  Shot: 'action',
  General: 'action',
}

/**
 * Types that are dropped.
 *
 * `New Act` and `End of Act` are act structure, which belongs to the Outline
 * document kind - a different closed block set in the same table (AGENTS.md,
 * The node model). Coercing them into Action would put structure into prose;
 * widening the screenplay union to hold them is the thing that union exists to
 * refuse. `Cast List` is derived data by definition.
 */
const DROPPED_TYPES: readonly string[] = ['Cast List', 'New Act', 'End of Act', 'Act Break']

// ---------------------------------------------------------------------------
// What the import reports
// ---------------------------------------------------------------------------

/** A `Type="Scene Heading"` paragraph whose text is not heading-shaped. */
export type HeadingNotRecognised = {
  /** 1-based index among the content paragraphs, for the import summary. */
  readonly paragraph: number
  readonly text: string
  readonly reason: RejectedHeadingReason
  /** It is still a Scene node - Final Draft declared it one. Never silent. */
  readonly id: NodeId
}

/** A Final Draft type with no member of the union, mapped to the nearest. */
export type CoercedParagraph = {
  readonly paragraph: number
  readonly from: string
  readonly to: ScreenplayNodeType
  readonly id: NodeId
}

export const FDX_UNSUPPORTED_KINDS = [
  'title-page',
  'dual-dialogue',
  'act-structure',
  'cast-list',
  'unknown-type',
] as const

export type FdxUnsupportedKind = (typeof FDX_UNSUPPORTED_KINDS)[number]

export type FdxUnsupported = {
  readonly kind: FdxUnsupportedKind
  readonly paragraph: number
  /** Final Draft's own type name, where there was one. */
  readonly type: string
  readonly text: string
}

/**
 * Layout that arrived on a paragraph and was thrown away.
 *
 * `page` and `length` are AGENTS.md's banned pagination; `scene-number` has no
 * field on a node either, and giving it one would need an ADR.
 */
export type DiscardedField = {
  readonly field: 'page' | 'length' | 'scene-number'
  readonly value: string
  readonly id: NodeId
}

export type FdxStrippedGeneratedText = {
  readonly kind: GeneratedArtefactKind
  readonly text: string
  readonly paragraph: number
}

export type FdxRejoinedContinuation = {
  readonly paragraph: number
  readonly cue: string
}

export type FdxImport = {
  readonly nodes: readonly ScreenplayNode[]
  readonly headingsNotRecognised: readonly HeadingNotRecognised[]
  readonly coerced: readonly CoercedParagraph[]
  readonly unsupported: readonly FdxUnsupported[]
  readonly discarded: readonly DiscardedField[]
  readonly stripped: readonly FdxStrippedGeneratedText[]
  readonly rejoinedContinuations: readonly FdxRejoinedContinuation[]
  readonly unusedIds: readonly NodeId[]
}

export type FdxImportError =
  | { readonly kind: 'not-a-final-draft-document'; readonly received: string }
  | { readonly kind: 'no-content' }
  | { readonly kind: 'not-enough-ids'; readonly needed: number; readonly supplied: number }
  | { readonly kind: 'duplicate-id'; readonly id: NodeId }
  | { readonly kind: 'empty-id'; readonly index: number }

export type FdxImportOptions = {
  /** One per node, consumed in order. This package cannot mint an id. */
  readonly freshIds: readonly NodeId[]
  readonly provenance?: Provenance
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

const childrenNamed = (node: FdxNode, name: string): readonly FdxNode[] =>
  node.children.filter((child) => child.name === name)

const firstNamed = (node: FdxNode, name: string): FdxNode | undefined =>
  node.children.find((child) => child.name === name)

/**
 * The characters of a paragraph, excluding anything inside a `ScriptNote`.
 *
 * A Final Draft note is anchored *within* a paragraph but is a separate thing
 * the writer wrote about the script, so its text must not join the line it sits
 * on. Runs are concatenated in document order; `<Text Style="Bold">` loses its
 * style, because `InlineRun` has no mark - see the report.
 */
/**
 * Character data that is only whitespace is the file's indentation, not the
 * writer's line. Dropping it here means an adapter may pass a pretty-printed
 * tree through without the indentation joining the dialogue.
 */
const contentOf = (node: FdxNode): string => (node.text.trim() === '' ? '' : node.text)

const paragraphText = (paragraph: FdxNode): string => {
  let out = contentOf(paragraph)
  for (const child of paragraph.children) {
    if (child.name === 'ScriptNote') continue
    if (child.name === 'Text') {
      out += child.text
      continue
    }
    out += paragraphText(child)
  }
  return out
}

/** A note's own text, which *is* everything inside it. */
const noteText = (note: FdxNode): string => {
  let out = contentOf(note)
  for (const child of note.children) out += child.name === 'Text' ? child.text : noteText(child)
  return out
}

const plain = (text: string): InlineContent => normaliseContent([{ kind: 'text', text }])

/** Locate `<FinalDraft>`, whether it is the root or wrapped by the adapter. */
const finalDraftRoot = (root: FdxNode): FdxNode | undefined => {
  if (root.name === 'FinalDraft') return root
  return root.children.find((child) => child.name === 'FinalDraft')
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

type Element = {
  readonly type: ScreenplayNodeType
  readonly text: string
  readonly modifiers: readonly DeliveryModifier[]
  readonly paragraph: number
}

type PendingHeading = { readonly element: number; readonly at: number; readonly text: string; readonly reason: RejectedHeadingReason }
type PendingCoercion = { readonly element: number; readonly at: number; readonly from: string; readonly to: ScreenplayNodeType }
type PendingDiscard = { readonly element: number; readonly field: DiscardedField['field']; readonly value: string }

class Mapper {
  readonly elements: Element[] = []
  readonly headings: PendingHeading[] = []
  readonly coerced: PendingCoercion[] = []
  readonly unsupported: FdxUnsupported[] = []
  readonly discarded: PendingDiscard[] = []
  readonly stripped: FdxStrippedGeneratedText[] = []
  readonly rejoined: FdxRejoinedContinuation[] = []

  private speaker: Speaker | undefined = undefined
  private pendingMore = false
  private paragraph = 0

  private push(element: Element): number {
    this.elements.push(element)
    this.pendingMore = false
    return this.elements.length - 1
  }

  /**
   * A Comment is transparent to everything the page-split logic looks at.
   *
   * AGENTS.md, The node model: comment nodes "occupy zero page space" and their
   * "presence can never change a page count". A Final Draft note is anchored
   * *inside* a paragraph, so one hanging off the last line before a page break
   * must not be the thing that stops a speech being rejoined.
   */
  private pushComment(text: string, at: number): void {
    const more = this.pendingMore
    this.push({ type: 'comment', text, modifiers: [], paragraph: at })
    this.pendingMore = more
  }

  /** The index of the last element that is not a comment, if it is dialogue. */
  private lastDialogueIndex(): number {
    for (let index = this.elements.length - 1; index >= 0; index -= 1) {
      const element = this.elements[index]
      if (element === undefined) return -1
      if (element.type === 'comment') continue
      return element.type === 'dialogue' ? index : -1
    }
    return -1
  }

  private lastIsDialogue(): boolean {
    return this.lastDialogueIndex() !== -1
  }

  private appendToLastDialogue(text: string): void {
    const index = this.lastDialogueIndex()
    const last = index === -1 ? undefined : this.elements[index]
    if (last === undefined) return
    this.elements[index] = { ...last, text: last.text === '' ? text : `${last.text}\n${text}` }
    this.pendingMore = false
  }

  private strip(kind: GeneratedArtefactKind, text: string, at: number): void {
    this.stripped.push({ kind, text, paragraph: at })
    if (kind === 'more') this.pendingMore = true
  }

  /**
   * `<SceneProperties Page="12" Length="3/8">` and `Number="12"`.
   *
   * Read only so they can be counted as thrown away. `PAGINATION_FIELDS` is the
   * tuple `node.ts` builds the compile-time ban from, and referencing it here
   * ties this discard to that ban rather than to a comment.
   */
  private discardLayout(paragraph: FdxNode, element: number): void {
    const properties = firstNamed(paragraph, 'SceneProperties')
    const page = properties?.attributes['Page']
    const length = properties?.attributes['Length']
    if (page !== undefined && page !== '') {
      this.discarded.push({ element, field: 'page', value: page })
    }
    if (length !== undefined && length !== '') {
      this.discarded.push({ element, field: 'length', value: length })
    }
    const number = paragraph.attributes['Number']
    if (number !== undefined && number !== '') {
      this.discarded.push({ element, field: 'scene-number', value: number })
    }
  }

  private notes(paragraph: FdxNode): void {
    for (const note of childrenNamed(paragraph, 'ScriptNote')) {
      this.pushComment(noteText(note).trim(), this.paragraph)
    }
  }

  container(node: FdxNode): void {
    for (const child of node.children) {
      if (child.name === 'DualDialogue') {
        this.unsupported.push({
          kind: 'dual-dialogue',
          paragraph: this.paragraph + 1,
          type: 'DualDialogue',
          text: paragraphText(child).trim(),
        })
        this.container(child)
        continue
      }
      if (child.name !== 'Paragraph') continue
      this.paragraphElement(child)
    }
  }

  private paragraphElement(paragraph: FdxNode): void {
    this.paragraph += 1
    const at = this.paragraph
    const declared = paragraph.attributes['Type'] ?? 'General'
    const raw = paragraphText(paragraph).trim()

    if (DROPPED_TYPES.includes(declared)) {
      this.unsupported.push({
        kind: declared === 'Cast List' ? 'cast-list' : 'act-structure',
        paragraph: at,
        type: declared,
        text: raw,
      })
      return
    }

    const direct = DIRECT_TYPES[declared]
    const coerced = direct === undefined ? COERCED_TYPES[declared] : undefined
    const type = direct ?? coerced
    if (type === undefined) {
      this.unsupported.push({ kind: 'unknown-type', paragraph: at, type: declared, text: raw })
      return
    }

    if (type === 'character') {
      this.cue(paragraph, raw, at)
      return
    }

    const stripped = stripGeneratedFromLine(raw)
    for (const artefact of stripped.artefacts) this.strip(artefact.kind, artefact.text, at)
    if (stripped.text === '') {
      // The paragraph was nothing but a `(MORE)`. It leaves no node behind, and
      // `pendingMore` is now set so the next cue can be read as its other half.
      this.notes(paragraph)
      return
    }

    // Consecutive Dialogue paragraphs are one speech, and become one node
    // joined by a newline - identically to consecutive dialogue lines in
    // Fountain. If the two importers disagreed here, the same screenplay would
    // produce a different node list depending on which file it arrived in, and
    // the format would have quietly become authoritative over the script.
    //
    // It also covers the page split: the cue between the two halves was just
    // dropped, so the previous element is the dialogue they belong to.
    if (type === 'dialogue' && this.lastIsDialogue()) {
      this.appendToLastDialogue(stripped.text)
      this.notes(paragraph)
      return
    }

    const element = this.push({ type, text: stripped.text, modifiers: [], paragraph: at })
    if (coerced !== undefined) {
      this.coerced.push({ element, at, from: declared, to: coerced })
    }
    if (type === 'scene') {
      this.discardLayout(paragraph, element)
      const classified = classifyHeading(stripped.text)
      if (classified.kind === 'rejected') {
        this.headings.push({ element, at, text: stripped.text, reason: classified.reason })
      }
    }
    this.notes(paragraph)
  }

  private cue(paragraph: FdxNode, raw: string, at: number): void {
    const cue = readCue(raw)
    for (const artefact of cue.artefacts) this.strip(artefact.kind, artefact.text, at)
    if (cue.dual) {
      this.unsupported.push({ kind: 'dual-dialogue', paragraph: at, type: 'Character', text: raw })
    }

    const speaker: Speaker = { name: cue.name, modifiers: cue.modifiers }
    const continuation = isPageSplitContinuation(speaker, {
      cueCarriesContinued: cue.artefacts.some((artefact) => artefact.kind === 'cont-d'),
      afterMore: this.pendingMore,
      previousIsDialogue: this.lastIsDialogue(),
      previousSpeaker: this.speaker,
    })

    if (continuation) {
      // The cue is not emitted at all. Emitting it and merely stripping its
      // `(CONT'D)` is what leaves the cue duplicated in the node stream.
      this.rejoined.push({ paragraph: at, cue: raw })
      this.notes(paragraph)
      return
    }

    this.push({ type: 'character', text: cue.name, modifiers: cue.modifiers, paragraph: at })
    this.speaker = speaker
    this.notes(paragraph)
  }
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

const scan = (root: FdxNode): Result<Mapper, FdxImportError> => {
  const document = finalDraftRoot(root)
  if (document === undefined) {
    return err({ kind: 'not-a-final-draft-document', received: root.name })
  }
  const content = firstNamed(document, 'Content')
  if (content === undefined) return err({ kind: 'no-content' })
  const mapper = new Mapper()
  mapper.container(content)
  const titlePage = firstNamed(document, 'TitlePage')
  if (titlePage !== undefined) {
    mapper.unsupported.push({
      kind: 'title-page',
      paragraph: 0,
      type: 'TitlePage',
      text: paragraphText(titlePage).trim(),
    })
  }
  return ok(mapper)
}

/** How many ids an import of this tree will need. Answered before any is spent. */
export const countFdxNodes = (root: FdxNode): number => {
  const mapper = scan(root)
  return mapper.ok ? mapper.value.elements.length : 0
}

export const importFinalDraft = (
  root: FdxNode,
  options: FdxImportOptions,
): Result<FdxImport, FdxImportError> => {
  const mapped = scan(root)
  if (!mapped.ok) return mapped
  const mapper = mapped.value

  const needed = mapper.elements.length
  const supplied = options.freshIds.length
  if (supplied < needed) return err({ kind: 'not-enough-ids', needed, supplied })

  const seen = new Set<NodeId>()
  for (let index = 0; index < needed; index += 1) {
    const id = options.freshIds[index]
    if (id === undefined || id === '') return err({ kind: 'empty-id', index })
    if (seen.has(id)) return err({ kind: 'duplicate-id', id })
    seen.add(id)
  }

  const provenance = options.provenance ?? typed()
  const nodes: ScreenplayNode[] = []
  const ids: NodeId[] = []
  for (let index = 0; index < needed; index += 1) {
    const element = mapper.elements[index]
    const id = options.freshIds[index]
    if (element === undefined || id === undefined) continue
    ids.push(id)
    nodes.push(
      makeScreenplayNode(element.type, {
        id,
        provenance,
        // Deliberately not the Fountain inline reader: a `.fdx` has no mention
        // syntax, so text that happens to look like a mention token is text.
        content: plain(element.text),
        modifiers: element.modifiers,
      }),
    )
  }

  const headingsNotRecognised: HeadingNotRecognised[] = []
  for (const heading of mapper.headings) {
    const id = ids[heading.element]
    if (id === undefined) continue
    headingsNotRecognised.push({
      paragraph: heading.at,
      text: heading.text,
      reason: heading.reason,
      id,
    })
  }

  const coerced: CoercedParagraph[] = []
  for (const entry of mapper.coerced) {
    const id = ids[entry.element]
    if (id === undefined) continue
    coerced.push({ paragraph: entry.at, from: entry.from, to: entry.to, id })
  }

  const discarded: DiscardedField[] = []
  for (const entry of mapper.discarded) {
    const id = ids[entry.element]
    if (id === undefined) continue
    discarded.push({ field: entry.field, value: entry.value, id })
  }

  return ok({
    nodes,
    headingsNotRecognised,
    coerced,
    unsupported: mapper.unsupported,
    discarded,
    stripped: mapper.stripped,
    rejoinedContinuations: mapper.rejoined,
    unusedIds: options.freshIds.slice(needed),
  })
}

/**
 * The pagination field names this mapping refuses to carry, re-exported so a
 * caller writing the adapter can assert it is not smuggling one through.
 */
export const FDX_DISCARDED_PAGINATION: readonly string[] = PAGINATION_FIELDS
