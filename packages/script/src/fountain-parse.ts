import type { GeneratedArtefactKind, Speaker } from './generated-text'
import {
  isContinuedLine,
  isMoreLine,
  isPageSplitContinuation,
  readCue,
  stripGeneratedFromLine,
} from './generated-text'
import type { Block, RejectedHeadingReason } from './fountain-syntax'
import {
  classifyHeading,
  isBoneyardBlock,
  isCentred,
  isForcedAction,
  isForcedCue,
  isForcedHeading,
  isForcedTransition,
  isLyric,
  isNaturalCue,
  isNaturalTransition,
  isNoteBlock,
  isPageBreak,
  isParentheticalLine,
  isSection,
  isSynopsis,
  isTitlePageBlock,
  readInline,
  toBlocks,
  toLines,
} from './fountain-syntax'
import type { NodeId } from './ids'
import type { DeliveryModifier, ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode } from './node'
import type { Provenance } from './provenance'
import { typed } from './provenance'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Fountain text to a node list.
 *
 * Custom, zero dependencies, per AGENTS.md's stack table. Nothing here throws:
 * a malformed heading is a `RejectedHeading` in the return value and the line
 * becomes an Action node, per AGENTS.md, Conventions > Errors and Derivation
 * ("A malformed heading does not silently become a scene").
 *
 * ## It cannot mint an id
 *
 * `packages/script` has no entropy (AGENTS.md, Development philosophy 2), so
 * the caller supplies `freshIds` and the parse fails with `not-enough-ids`
 * rather than inventing one. That is also why parsing is two phases: the scan
 * produces id-free elements, so `needed` is exact before a single id is spent.
 *
 * This is what keeps the parser usable while AGENTS.md open decision 1 and the
 * `SCENE_xxx` / `ep_NNN` casing question are both still open - no id format is
 * written down anywhere in this file.
 *
 * ## Generated text
 *
 * `(MORE)`, `CHARACTER (CONT'D)` and speaker `(CONT'D)` are removed here and
 * counted in `stripped`. See `generated-text.ts` for the recognisers and why
 * they are liberal.
 *
 * A page split is not only a `(MORE)` - it is a `(MORE)`, then the same cue
 * again with a `(CONT'D)`, then the rest of the speech. Stripping the two
 * tokens and stopping would leave the **cue itself** duplicated in the node
 * stream, which renders as a doubled continued the moment anything paginates
 * it. So a cue that (a) carries a `(CONT'D)` or follows a `(MORE)`, (b) names
 * the same speaker with the same modifiers, and (c) directly follows that
 * speaker's dialogue, is not emitted at all: its dialogue is appended to the
 * dialogue node already there, and the collapse is reported in
 * `rejoinedContinuations`.
 *
 * **Assumption, and it is a product decision rather than a technical one:** the
 * two halves are joined with a newline. A page split happens at a rendered line
 * wrap, not at anything the writer typed, so there is no authored separator to
 * recover. A newline was chosen over a space because it is the only join that
 * makes `parse(serialise(nodes))` an identity - a space would have to be
 * re-split on the way out and there is nothing to re-split it on. Flagged.
 *
 * ## What Fountain has that the eight types do not
 *
 * Sections, synopses, lyrics, page breaks and the title page have no member of
 * the closed union to map onto, and AGENTS.md is explicit that the union does
 * not widen to accommodate a format - "rejecting anything outside the eight
 * types is that schema's entire job". Sections and synopses in particular
 * belong to the *Outline* document kind, which is a different closed set in the
 * same table. They are reported in `unsupported` and dropped. Dual dialogue's
 * `^` is reported the same way: it would be a new attribute on `CharacterNode`,
 * and a node schema change needs an ADR (AGENTS.md, When to ask first).
 */

// ---------------------------------------------------------------------------
// What the parse reports
// ---------------------------------------------------------------------------

export type RejectedHeading = {
  readonly line: number
  /** The line exactly as it appeared. */
  readonly text: string
  readonly reason: RejectedHeadingReason
  /** What it became instead. Never `'scene'` - that is the point. */
  readonly became: Exclude<ScreenplayNodeType, 'scene'>
  readonly id: NodeId
}

export const UNSUPPORTED_ELEMENT_KINDS = [
  'title-page',
  'section',
  'synopsis',
  'lyric',
  'page-break',
  'boneyard',
  'dual-dialogue',
] as const

export type UnsupportedElementKind = (typeof UNSUPPORTED_ELEMENT_KINDS)[number]

/** A Fountain element with no home in the eight types. Dropped, never coerced. */
export type UnsupportedElement = {
  readonly kind: UnsupportedElementKind
  readonly line: number
  readonly text: string
}

export type StrippedGeneratedText = {
  readonly kind: GeneratedArtefactKind
  /** Verbatim, so a count of one spelling can be told from another. */
  readonly text: string
  readonly line: number
}

/** A page-split cue that was collapsed back into the speech it belongs to. */
export type RejoinedContinuation = {
  readonly line: number
  readonly cue: string
}

export type FountainParse = {
  readonly nodes: readonly ScreenplayNode[]
  readonly rejectedHeadings: readonly RejectedHeading[]
  readonly unsupported: readonly UnsupportedElement[]
  readonly stripped: readonly StrippedGeneratedText[]
  readonly rejoinedContinuations: readonly RejoinedContinuation[]
  /** Supplied but not needed. The caller decides whether to keep them. */
  readonly unusedIds: readonly NodeId[]
}

export type FountainParseError =
  | { readonly kind: 'not-enough-ids'; readonly needed: number; readonly supplied: number }
  | { readonly kind: 'duplicate-id'; readonly id: NodeId }
  | { readonly kind: 'empty-id'; readonly index: number }

export type FountainParseOptions = {
  /** Consumed in order, one per node. See "It cannot mint an id" above. */
  readonly freshIds: readonly NodeId[]
  readonly provenance?: Provenance
}

// ---------------------------------------------------------------------------
// Phase one: the scan. Elements, no ids.
// ---------------------------------------------------------------------------

type Element = {
  readonly type: ScreenplayNodeType
  readonly text: string
  readonly modifiers: readonly DeliveryModifier[]
  readonly line: number
}

type ScannedRejection = {
  readonly line: number
  readonly text: string
  readonly reason: RejectedHeadingReason
  readonly element: number
}

type Scan = {
  readonly elements: readonly Element[]
  readonly rejections: readonly ScannedRejection[]
  readonly unsupported: readonly UnsupportedElement[]
  readonly stripped: readonly StrippedGeneratedText[]
  readonly rejoined: readonly RejoinedContinuation[]
}

class Scanner {
  readonly elements: Element[] = []
  readonly rejections: ScannedRejection[] = []
  readonly unsupported: UnsupportedElement[] = []
  readonly stripped: StrippedGeneratedText[] = []
  readonly rejoined: RejoinedContinuation[] = []

  /** The cue that opened the most recent dialogue block. */
  private speaker: Speaker | undefined = undefined
  /** A `(MORE)` was the last thing seen, so the next cue may be a continuation. */
  private pendingMore = false

  private push(element: Element): number {
    this.elements.push(element)
    this.pendingMore = false
    return this.elements.length - 1
  }

  private lastIsDialogue(): boolean {
    const last = this.elements[this.elements.length - 1]
    return last !== undefined && last.type === 'dialogue'
  }

  private appendToLastDialogue(text: string): void {
    const index = this.elements.length - 1
    const last = this.elements[index]
    if (last === undefined) return
    this.elements[index] = { ...last, text: last.text === '' ? text : `${last.text}\n${text}` }
    this.pendingMore = false
  }

  private strip(kind: GeneratedArtefactKind, text: string, line: number): void {
    this.stripped.push({ kind, text, line })
    if (kind === 'more') this.pendingMore = true
  }

  private simple(type: ScreenplayNodeType, text: string, line: number): number {
    return this.push({ type, text, modifiers: [], line })
  }

  /**
   * Remove and record any generated text on a line, whatever element it became.
   *
   * Not only cues. A cue-shaped line with nothing following it is Action under
   * Fountain's inference rules, and AGENTS.md's ban on generated text in the
   * node stream is not qualified by element type.
   */
  private withoutGeneratedText(text: string, line: number): string {
    const result = stripGeneratedFromLine(text)
    for (const artefact of result.artefacts) this.strip(artefact.kind, artefact.text, line)
    return result.text
  }

  /** A heading-shaped line that is not a heading, recorded against what it became. */
  private reject(reason: RejectedHeadingReason, text: string, line: number, element: number): void {
    this.rejections.push({ line, text, reason, element })
  }

  // -------------------------------------------------------------------------

  block(block: Block, isFirst: boolean): void {
    const lines = block.lines
    const first = lines[0]
    if (first === undefined) return

    if (isFirst && isTitlePageBlock(lines)) {
      this.unsupported.push({ kind: 'title-page', line: block.line, text: lines.join('\n') })
      return
    }
    if (isBoneyardBlock(lines)) {
      this.unsupported.push({ kind: 'boneyard', line: block.line, text: lines.join('\n') })
      return
    }
    if (isNoteBlock(lines)) {
      const joined = lines.join('\n')
      this.simple('comment', joined.slice(2, -2).trim(), block.line)
      return
    }
    if (isForcedAction(first)) {
      // Forced action still has its generated text taken off it, and is never
      // reported as a failed heading - the `!` is the writer saying otherwise.
      this.action([first.slice(1), ...lines.slice(1)], block.line, false)
      return
    }
    if (isSection(first)) {
      this.unsupported.push({ kind: 'section', line: block.line, text: lines.join('\n') })
      return
    }
    if (isPageBreak(first)) {
      this.unsupported.push({ kind: 'page-break', line: block.line, text: lines.join('\n') })
      return
    }
    if (isSynopsis(first)) {
      this.unsupported.push({ kind: 'synopsis', line: block.line, text: lines.join('\n') })
      return
    }
    if (isLyric(first)) {
      this.unsupported.push({ kind: 'lyric', line: block.line, text: lines.join('\n') })
      return
    }
    // A lone `(MORE)` or `(CONT'D)` with blank lines either side.
    if (lines.length === 1 && isMoreLine(first)) {
      this.strip('more', first, block.line)
      return
    }
    if (lines.length === 1 && isContinuedLine(first)) {
      this.strip('cont-d', first, block.line)
      return
    }

    // A heading may open a block that continues into action without a blank
    // line. Real files are written that way and a heading is unambiguous, so it
    // is split off rather than swallowed - the alternative is a silent scene.
    if (isForcedHeading(first) || classifyHeading(first).kind === 'heading') {
      this.heading(first, block.line)
      if (lines.length > 1) this.block({ lines: lines.slice(1), line: block.line + 1 }, false)
      return
    }

    if (lines.length === 1 && isCentred(first)) {
      this.simple('subtitle', this.withoutGeneratedText(first.slice(1, -1).trim(), block.line), block.line)
      return
    }
    if (isForcedTransition(first)) {
      this.simple('transition', this.withoutGeneratedText(first.slice(1).trim(), block.line), block.line)
      if (lines.length > 1) this.block({ lines: lines.slice(1), line: block.line + 1 }, false)
      return
    }
    if (lines.length === 1 && isNaturalTransition(first)) {
      this.simple('transition', this.withoutGeneratedText(first, block.line), block.line)
      return
    }

    if (isForcedCue(first) || isNaturalCue(first, lines.length > 1)) {
      this.dialogueBlock(lines, block.line)
      return
    }

    this.action(lines, block.line)
  }

  /** Emits exactly one element for the line: a Scene, or an Action plus a rejection. */
  private heading(line: string, at: number): void {
    if (isForcedHeading(line)) {
      const text = line.slice(1).trim()
      if (text === '') {
        const element = this.simple('action', line, at)
        this.reject({ kind: 'forced-but-empty' }, line, at, element)
        return
      }
      this.simple('scene', this.withoutGeneratedText(text, at), at)
      return
    }
    this.simple('scene', this.withoutGeneratedText(line, at), at)
  }

  private action(lines: readonly string[], at: number, reportHeading = true): void {
    const kept: string[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line === undefined) continue
      const text = this.withoutGeneratedText(line, at + index)
      // A line that was nothing but a `(MORE)` leaves no line behind. Keeping
      // an empty one would put a blank line inside a node's content, and a
      // blank line is a block separator - it could not be written back out.
      if (text === '') continue
      kept.push(text)
    }
    if (kept.length === 0) return
    const first = lines[0]
    const element = this.simple('action', kept.join('\n'), at)
    if (first === undefined || !reportHeading) return
    const classified = classifyHeading(first)
    if (classified.kind === 'rejected') this.reject(classified.reason, first, at, element)
  }

  private dialogueBlock(lines: readonly string[], at: number): void {
    const raw = lines[0]
    if (raw === undefined) return
    const cueText = isForcedCue(raw) ? raw.slice(1).trim() : raw
    const cue = readCue(cueText)
    for (const artefact of cue.artefacts) this.strip(artefact.kind, artefact.text, at)
    if (cue.dual) this.unsupported.push({ kind: 'dual-dialogue', line: at, text: raw })

    const speaker: Speaker = { name: cue.name, modifiers: cue.modifiers }
    const isContinuation = isPageSplitContinuation(speaker, {
      cueCarriesContinued: cue.artefacts.some((artefact) => artefact.kind === 'cont-d'),
      afterMore: this.pendingMore,
      previousIsDialogue: this.lastIsDialogue(),
      previousSpeaker: this.speaker,
    })

    if (isContinuation) {
      this.rejoined.push({ line: at, cue: raw })
    } else {
      const element = this.push({
        type: 'character',
        text: cue.name,
        modifiers: cue.modifiers,
        line: at,
      })
      // `INTERCUT - PHONE CALL` followed by a line reads as a cue, not a scene.
      // Still not a scene - but the writer has to be told it became a person.
      const classified = classifyHeading(raw)
      if (classified.kind === 'rejected') this.reject(classified.reason, raw, at, element)
      this.speaker = speaker
    }

    let pending: string[] = []
    let pendingAt = at
    /** True once this speech has a dialogue node that further lines append to. */
    let open = isContinuation && this.lastIsDialogue()
    const flush = (): void => {
      if (pending.length === 0) return
      const text = pending.join('\n')
      if (open && this.lastIsDialogue()) {
        this.appendToLastDialogue(text)
      } else {
        this.simple('dialogue', text, pendingAt)
        open = true
      }
      pending = []
    }

    for (let index = 1; index < lines.length; index += 1) {
      const raw = lines[index]
      if (raw === undefined) continue
      const lineAt = at + index
      const result = stripGeneratedFromLine(raw)
      if (result.artefacts.length > 0) {
        // Flush before recording, so that a `(MORE)` at the end of a speech is
        // the last thing seen and the next block's cue can be read as its
        // continuation.
        flush()
        for (const artefact of result.artefacts) this.strip(artefact.kind, artefact.text, lineAt)
      }
      const line = result.text
      if (line === '') continue
      // A note inside a speech. Keeping it here rather than ending the block is
      // what lets AGENTS.md's "comment nodes occupy zero page space" be true of
      // a note the writer left mid-speech, instead of orphaning the dialogue
      // after it.
      if (isNoteBlock([line])) {
        flush()
        this.simple('comment', line.slice(2, -2).trim(), lineAt)
        continue
      }
      if (isParentheticalLine(line)) {
        flush()
        this.simple('paren', line, lineAt)
        continue
      }
      if (pending.length === 0) pendingAt = lineAt
      pending.push(line)
    }
    flush()
  }
}

/**
 * Text to elements. Exported for the tests and for the report - it is the half
 * of parsing that has an answer before any id has been spent.
 */
export const scanFountain = (text: string): Scan => {
  const scanner = new Scanner()
  const blocks = toBlocks(toLines(text))
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    scanner.block(block, index === 0)
  }
  return {
    elements: scanner.elements,
    rejections: scanner.rejections,
    unsupported: scanner.unsupported,
    stripped: scanner.stripped,
    rejoined: scanner.rejoined,
  }
}

/** How many ids a parse of this text will need. */
export const countFountainNodes = (text: string): number => scanFountain(text).elements.length

// ---------------------------------------------------------------------------
// Phase two: ids
// ---------------------------------------------------------------------------

export const parseFountain = (
  text: string,
  options: FountainParseOptions,
): Result<FountainParse, FountainParseError> => {
  const scan = scanFountain(text)
  const needed = scan.elements.length
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
    const element = scan.elements[index]
    const id = options.freshIds[index]
    if (element === undefined || id === undefined) continue
    ids.push(id)
    nodes.push(
      makeScreenplayNode(element.type, {
        id,
        provenance,
        content: readInline(element.text),
        modifiers: element.modifiers,
      }),
    )
  }

  const rejectedHeadings: RejectedHeading[] = []
  for (const rejection of scan.rejections) {
    const element = scan.elements[rejection.element]
    const id = ids[rejection.element]
    if (element === undefined || id === undefined) continue
    if (element.type === 'scene') continue
    rejectedHeadings.push({
      line: rejection.line,
      text: rejection.text,
      reason: rejection.reason,
      became: element.type,
      id,
    })
  }

  return ok({
    nodes,
    rejectedHeadings,
    unsupported: scan.unsupported,
    stripped: scan.stripped,
    rejoinedContinuations: scan.rejoined,
    unusedIds: options.freshIds.slice(needed),
  })
}
