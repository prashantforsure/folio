import { MORE_TEXT, writeContinuedCue } from './generated-text'
import type { NodeId } from './ids'
import type { LabelBook, MentionLabel, UnresolvedMention } from './measure'
import { NO_LABELS, labelBook, lineCount, renderedText } from './measure'
import type { ScreenplayNode } from './node'
import { modifiersOf } from './node'
import type { Result } from './result'
import { err, ok } from './result'
import type { LockIssue, LockedPage, NumberedPage, RevisionColour } from './revision'
import { FIRST_REVISION_COLOUR, numberPages } from './revision'
import type { ScriptFormat, SheetSpec, UnresolvedSheet } from './sheet'
import { resolveSheet } from './sheet'
import { readSlugline } from './slugline'
import type { RenderableNode } from './stream'
import { renderableNodes } from './stream'

/**
 * The pagination engine.
 *
 * One pure function over a node list and a format, returning a **measurement
 * record**. AGENTS.md, exception table "Nothing is stored that can be computed
 * - except": page number and eighths are stored "on a **measurement record**.
 * Never a node attribute". Nothing in this file takes a `ScreenplayNode` and
 * returns one: the output type contains ids, never nodes, so there is no
 * expression in this module that could write a page onto a node even by
 * accident. `type-guarantees.test.ts` holds the compile-time proof.
 *
 * It is pure for the reason AGENTS.md, Export gives: "Export must agree with
 * on-screen pagination exactly. This is why the layout engine is ours." The
 * same function runs in the browser, in the server action, in the worker and in
 * these tests, and monospace measurement is arithmetic, so it returns the same
 * record in all four. That is the whole argument against headless Chrome, which
 * is on the "Deliberately not using" list.
 *
 * ## What the engine owes
 *
 * AGENTS.md, Pagination and the sheet: "Break rules the engine owes: `(MORE)`
 * at a split, `(CONT'D)` on the continuation, no orphaned scene headings, no
 * stranded single dialogue lines, at least two lines of dialogue before a legal
 * break."
 *
 * All five are here, none of them is a node. `(MORE)` and `(CONT'D)` come out
 * as **page artefacts** on the record, with the id of the node they hang off,
 * and their text comes from `generated-text.ts` - the module that strips them
 * on import - so the writer and the reader cannot drift apart on an apostrophe.
 * The three constants below are what the prose figures translate to; two are
 * quoted, one is derived and says so.
 *
 * ## Comments
 *
 * A comment is filtered out at the door by `renderableNodes`, which returns a
 * type a comment is not assignable to. It is not measured as zero, it is not
 * placed on a page and it does not appear anywhere in the record - so
 * "inserting a comment does not change the page map" is a statement about the
 * whole record, not about a page count that happens to match.
 * AGENTS.md says the same rule in three sections; `stream.ts` is where it lives
 * and this engine simply cannot see one.
 *
 * ## Two modes and a cadence flag
 *
 * `pageMode: paged | continuous` and `liveRepaginate: boolean`, per AGENTS.md's
 * exception table, and neither is in the URL - this package just takes them.
 * `continuous` is the same walk with an unbounded page, which is why it is a
 * mode and not a second engine. `liveRepaginate` is *when the caller runs this
 * function*, not what it computes: it is carried on the record for the caller's
 * benefit and changes nothing in it, which `paginate.test.ts` asserts. See
 * `docs/build-decisions.md#pagination-two-modes-and-a-cadence-flag`.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const PAGE_MODES = ['paged', 'continuous'] as const

export type PageMode = (typeof PAGE_MODES)[number]

export const isPageMode = (value: string): value is PageMode =>
  (PAGE_MODES as readonly string[]).includes(value)

export type PaginationOptions = {
  /** An engine input. It changes line width, page count, numbers and eighths. */
  readonly format: ScriptFormat
  readonly pageMode: PageMode
  /** A cadence flag. Carried, never consulted. */
  readonly liveRepaginate: boolean
  /** Pages whose numbers are frozen. Anchored to node ids; see `revision.ts`. */
  readonly lockedPages?: readonly LockedPage[]
  /** Record names for `@mention` runs. A mention has no stored label. */
  readonly mentionLabels?: readonly MentionLabel[]
  /** The colour of the pass being paginated. Unlocked pages take it. */
  readonly revision?: RevisionColour
}

export type PaginationError = UnresolvedSheet

// ---------------------------------------------------------------------------
// The break rules, as numbers
// ---------------------------------------------------------------------------

/**
 * AGENTS.md: "at least two lines of dialogue before a legal break."
 * Quoted. Two is written down.
 */
export const MIN_DIALOGUE_LINES_BEFORE_BREAK = 2

/**
 * AGENTS.md: "no stranded single dialogue lines."
 *
 * The prose forbids one; the number that forbids one is two. Derived from the
 * rule rather than quoted from it, and it is the mirror of the line above -
 * a break with a single line under it strands that line just as surely.
 */
export const MIN_DIALOGUE_LINES_AFTER_BREAK = 2

/**
 * The widow and orphan minimum for a paragraph of action.
 *
 * **Not in AGENTS.md.** Nothing there says whether action may split at all. It
 * has to be decided one way or the other to paginate anything: a paginator that
 * refuses to split action leaves a hole at the foot of every page that a long
 * paragraph lands on, and its page counts match no other tool. Final Draft
 * splits action and keeps two lines each side, so that is what this does, and
 * it is flagged in the report as a derived rule rather than a read one.
 */
export const MIN_ACTION_LINES_EACH_SIDE = 2

export const BREAK_RULES = [
  /** The block did not fit and could not legally be divided. */
  'page-full',
  /** A speech was divided: `(MORE)` here, `(CONT'D)` overleaf. */
  'dialogue-split',
  /** Too little room left for two lines of dialogue, so the speech moved whole. */
  'dialogue-minimum',
  /** Splitting would have left a single dialogue line, so the speech moved whole. */
  'stranded-dialogue',
  /** A scene heading would have ended the page with nothing legal under it. */
  'orphaned-heading',
] as const

export type BreakRule = (typeof BREAK_RULES)[number]

export type PageBreak = {
  /** Ordinal of the page that begins at this break. */
  readonly page: number
  readonly rule: BreakRule
  /** The node the break happened at. */
  readonly node: NodeId
}

// ---------------------------------------------------------------------------
// The measurement record
// ---------------------------------------------------------------------------

/** One layout artefact drawn on a page. Never a node. */
export type PageArtefact =
  | { readonly kind: 'more'; readonly text: string; readonly afterNode: NodeId }
  | { readonly kind: 'cont-d'; readonly text: string; readonly beforeNode: NodeId }

export type MeasuredPage = NumberedPage & {
  readonly linesUsed: number
  readonly firstNode: NodeId | null
  readonly artefacts: readonly PageArtefact[]
}

/** One contiguous run of a node's lines on one page. A split node has two. */
export type PlacedRun = {
  /** Ordinal of the page, not its printed label - labels are not unique. */
  readonly page: number
  /** 0-based line within the page's text area. */
  readonly startLine: number
  readonly lines: number
}

/**
 * Where one node landed.
 *
 * Keyed by node id, which is the join key AGENTS.md names for comments,
 * proposals, provenance and every derived row - and which open decision 1 has
 * not finished ruling on. See the report.
 */
export type NodeMeasurement = {
  readonly id: NodeId
  readonly type: RenderableNode['type']
  readonly runs: readonly PlacedRun[]
  readonly lines: number
}

/**
 * One scene's extent, in lines and in eighths.
 *
 * A scene begins at a scene node whose heading `readSlugline` accepts. A scene
 * node it rejects is laid out as a heading - the writer typed one - but does
 * not start a scene, which is exactly what `derive.ts` does with the same call:
 * "the nodes after a demoted heading go on belonging to the scene they were
 * in". Two answers to "how many scenes" is the bug this package exists to stop.
 */
export type SceneMeasurement = {
  /** The heading node's id, the same key `SceneRecord` uses. */
  readonly id: NodeId
  /** 1-based, in document order, as `SceneRecord.number` is. */
  readonly number: number
  readonly startPage: number
  readonly endPage: number
  readonly lines: number
  /** Eighths of a page, as an integer count. 17 prints as "2 1/8". */
  readonly eighths: number
}

export type PaginationTotals = {
  readonly pages: number
  readonly lines: number
  readonly scenes: number
  readonly eighths: number
}

export type MeasurementRecord = {
  readonly format: ScriptFormat
  readonly pageMode: PageMode
  readonly liveRepaginate: boolean
  readonly sheet: SheetSpec
  readonly pages: readonly MeasuredPage[]
  readonly nodes: readonly NodeMeasurement[]
  readonly scenes: readonly SceneMeasurement[]
  readonly breaks: readonly PageBreak[]
  readonly totals: PaginationTotals
  /** Mentions measured without a record name. The count is provisional if non-empty. */
  readonly unresolvedMentions: readonly UnresolvedMention[]
  readonly lockIssues: readonly LockIssue[]
}

// ---------------------------------------------------------------------------
// Eighths
// ---------------------------------------------------------------------------

export const EIGHTHS_PER_PAGE = 8

/**
 * Lines to eighths, rounded to the nearest eighth, never below one.
 *
 * A scene that exists occupies at least 1/8 on a breakdown sheet; rounding a
 * one-line scene to 0/8 would put a zero in a column that is used to schedule
 * a shooting day. Half-eighths round up, deterministically.
 */
export const eighthsOf = (lines: number, linesPerPage: number): number => {
  if (lines <= 0) return 0
  if (!Number.isFinite(linesPerPage) || linesPerPage <= 0) return 0
  return Math.max(1, Math.round((lines * EIGHTHS_PER_PAGE) / linesPerPage))
}

/** "2 1/8", "7/8", "1". The breakdown spelling the Script route bundle uses. */
export const formatEighths = (eighths: number): string => {
  const whole = Math.floor(eighths / EIGHTHS_PER_PAGE)
  const part = eighths % EIGHTHS_PER_PAGE
  if (part === 0) return String(whole)
  if (whole === 0) return `${part}/${EIGHTHS_PER_PAGE}`
  return `${whole} ${part}/${EIGHTHS_PER_PAGE}`
}

// ---------------------------------------------------------------------------
// Blocks: what layout treats as one thing
// ---------------------------------------------------------------------------

type Piece = {
  readonly index: number
  readonly id: NodeId
  readonly type: RenderableNode['type']
  readonly gapBefore: number
  readonly lines: number
  readonly scene: number
}

type Slot = {
  /** Index into the block's pieces; -1 for a blank line. */
  readonly piece: number
  readonly dialogue: boolean
  readonly scene: number
}

type BlockKind =
  /** A cue with its parentheticals and speech. Splits with (MORE) / (CONT'D). */
  | 'speech'
  /** A paragraph. Splits silently, two lines each side. */
  | 'flow'
  /** A heading, a transition, a stray parenthetical. Does not split. */
  | 'atomic'

type Block = {
  readonly kind: BlockKind
  readonly pieces: readonly Piece[]
  /**
   * The id every break in this block is reported against.
   *
   * Held rather than looked up: a block is built from at least one node, so
   * `pieces[0]` always exists - but `noUncheckedIndexedAccess` cannot know
   * that, and a `?? fallback` at each of the six break sites would be six
   * unreachable branches pretending to be error handling.
   */
  readonly firstId: NodeId
  readonly slots: readonly Slot[]
  readonly scene: number
  /** True when the block opens a scene, for the orphan rule. */
  readonly opensScene: boolean
  /** The cue redrawn on a continuation page. Speech blocks only. */
  readonly continuedCue: string | null
  readonly cueNode: NodeId | null
}

const SPEECH_PARTS: readonly RenderableNode['type'][] = ['paren', 'dialogue', 'subtitle']

/**
 * Group the node list into the things a page break has an opinion about.
 *
 * A cue takes its parentheticals, its speech and any subtitle line under it, so
 * that a break can never land between a character's name and what they say -
 * and so that the two dialogue rules have a speech to count lines within. A
 * parenthetical or a dialogue node with no cue above it (which an arbitrary
 * node list can produce) stands on its own rather than being repaired: this
 * engine measures the list it is given.
 */
const blocksOf = (
  nodes: readonly RenderableNode[],
  sheet: SheetSpec,
  labels: LabelBook,
): { readonly blocks: readonly Block[]; readonly unresolved: readonly UnresolvedMention[] } => {
  const unresolved: UnresolvedMention[] = []
  const measured = nodes.map((node) => {
    const metric = sheet.element[node.type]
    const rendered = renderedText(node.content, labels)
    unresolved.push(...rendered.unresolved)
    return { node, metric, lines: lineCount(rendered.text, metric.charsPerLine) }
  })

  // Scene attribution, by the same reading `derive.ts` uses.
  const sceneOf: number[] = []
  let scene = -1
  const sceneStart: boolean[] = []
  measured.forEach((entry, index) => {
    let opens = false
    if (entry.node.type === 'scene') {
      const reading = readSlugline(
        entry.node.content.map((run) => (run.kind === 'text' ? run.text : '')).join(''),
      )
      if (reading.ok) {
        scene += 1
        opens = true
      }
    }
    sceneOf[index] = scene
    sceneStart[index] = opens
  })

  const blocks: Block[] = []
  let index = 0
  while (index < measured.length) {
    const head = measured[index]
    if (head === undefined) break
    const at = index
    const pieces: Piece[] = []
    const push = (entry: (typeof measured)[number], position: number): void => {
      pieces.push({
        index: position,
        id: entry.node.id,
        type: entry.node.type,
        gapBefore: entry.metric.blankLinesBefore,
        lines: entry.lines,
        scene: sceneOf[position] ?? -1,
      })
    }
    push(head, at)
    index += 1

    let kind: BlockKind = head.node.type === 'action' ? 'flow' : 'atomic'
    let continuedCue: string | null = null
    let cueNode: NodeId | null = null

    if (head.node.type === 'character') {
      kind = 'speech'
      cueNode = head.node.id
      const name = renderedText(head.node.content, labels).text.trim()
      continuedCue = writeContinuedCue(name, modifiersOf(head.node))
      while (index < measured.length) {
        const part = measured[index]
        if (part === undefined) break
        if (!SPEECH_PARTS.includes(part.node.type)) break
        push(part, index)
        index += 1
      }
    }

    const slots: Slot[] = []
    pieces.forEach((piece, position) => {
      const blankScene = position === 0 && sceneStart[at] === true ? -1 : piece.scene
      for (let blank = 0; blank < piece.gapBefore; blank += 1) {
        slots.push({ piece: -1, dialogue: false, scene: blankScene })
      }
      for (let line = 0; line < piece.lines; line += 1) {
        slots.push({ piece: position, dialogue: piece.type === 'dialogue', scene: piece.scene })
      }
    })

    blocks.push({
      kind,
      pieces,
      firstId: head.node.id,
      slots,
      scene: pieces[0]?.scene ?? -1,
      opensScene: sceneStart[at] === true,
      continuedCue,
      cueNode,
    })
  }

  return { blocks, unresolved }
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/** Text slots in a range, and dialogue text slots in a range. */
const countSlots = (
  slots: readonly Slot[],
  from: number,
  to: number,
  dialogueOnly: boolean,
): number => {
  let total = 0
  for (let at = from; at < to; at += 1) {
    const slot = slots[at]
    if (slot === undefined || slot.piece === -1) continue
    if (dialogueOnly && !slot.dialogue) continue
    total += 1
  }
  return total
}

/**
 * Every index a block may legally be divided at, largest first.
 *
 * A division is legal only between two text lines of the same kind: for a
 * speech both sides must be dialogue, so a break can never fall between a cue
 * and its speech or immediately above a parenthetical; for a paragraph both
 * sides are its own lines. The minimums are then applied to each side.
 *
 * `from` is where the part still to be placed begins, so the two-line minimum
 * counts lines *on this page* rather than lines the reader saw a page ago. A
 * speech long enough to cross two breaks gets the rule applied at both.
 */
const splitPoints = (block: Block, from: number): readonly number[] => {
  if (block.kind === 'atomic') return []
  const dialogueOnly = block.kind === 'speech'
  const minBefore =
    block.kind === 'speech' ? MIN_DIALOGUE_LINES_BEFORE_BREAK : MIN_ACTION_LINES_EACH_SIDE
  const minAfter =
    block.kind === 'speech' ? MIN_DIALOGUE_LINES_AFTER_BREAK : MIN_ACTION_LINES_EACH_SIDE
  const points: number[] = []
  for (let at = block.slots.length - 1; at > from; at -= 1) {
    const before = block.slots[at - 1]
    const here = block.slots[at]
    if (before === undefined || here === undefined) continue
    if (before.piece === -1 || here.piece === -1) continue
    if (dialogueOnly && (!before.dialogue || !here.dialogue)) continue
    if (countSlots(block.slots, from, at, dialogueOnly) < minBefore) continue
    if (countSlots(block.slots, at, block.slots.length, dialogueOnly) < minAfter) continue
    points.push(at)
  }
  return points
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

type MutablePage = {
  linesUsed: number
  readonly nodes: NodeId[]
  readonly artefacts: PageArtefact[]
}

type RunAccumulator = {
  readonly id: NodeId
  readonly type: RenderableNode['type']
  readonly runs: PlacedRun[]
}

const newPage = (): MutablePage => ({ linesUsed: 0, nodes: [], artefacts: [] })

/**
 * The engine.
 *
 * Returns a measurement record, or refuses because the sheet for this format is
 * an open decision. It never throws: AGENTS.md, Conventions > Errors, and every
 * fallible function in this package returns a `Result`.
 */
export const paginate = (
  nodes: readonly ScreenplayNode[],
  options: PaginationOptions,
): Result<MeasurementRecord, PaginationError> => {
  const sheet = resolveSheet(options.format)
  if (!sheet.ok) return err(sheet.error)
  const spec = sheet.value

  const labels =
    options.mentionLabels === undefined ? NO_LABELS : labelBook(options.mentionLabels)
  const visible = renderableNodes(nodes)
  const built = blocksOf(visible, spec, labels)

  // `continuous` is the same walk with no bottom to the page. One code path,
  // which is the argument that it is a mode rather than a second engine.
  const capacity = options.pageMode === 'paged' ? spec.linesPerPage : Number.POSITIVE_INFINITY

  let page: MutablePage = newPage()
  const pages: MutablePage[] = [page]
  const breaks: PageBreak[] = []
  const sceneLines: number[] = []
  const sceneFirstPage: number[] = []
  const sceneLastPage: number[] = []
  const accumulators = new Map<string, RunAccumulator>()

  const ordinal = (): number => pages.length

  const noteScene = (scene: number, lines: number): void => {
    if (scene < 0) return
    sceneLines[scene] = (sceneLines[scene] ?? 0) + lines
    if (sceneFirstPage[scene] === undefined) sceneFirstPage[scene] = ordinal()
    sceneLastPage[scene] = ordinal()
  }

  const noteNode = (piece: Piece, startLine: number, lines: number): void => {
    const key = String(piece.id)
    const held = accumulators.get(key) ?? { id: piece.id, type: piece.type, runs: [] }
    const last = held.runs[held.runs.length - 1]
    if (last !== undefined && last.page === ordinal() && last.startLine + last.lines === startLine) {
      held.runs[held.runs.length - 1] = { ...last, lines: last.lines + lines }
    } else {
      held.runs.push({ page: ordinal(), startLine, lines })
    }
    accumulators.set(key, held)
    if (!page.nodes.includes(piece.id)) page.nodes.push(piece.id)
  }

  /** Put a run of slots on the current page, with its optional artefact lines. */
  const commit = (
    block: Block,
    slots: readonly Slot[],
    continuation: boolean,
    more: boolean,
  ): void => {
    if (continuation && block.continuedCue !== null && block.cueNode !== null) {
      const firstPiece = block.pieces.find((piece) => piece.type !== 'character')
      page.artefacts.push({
        kind: 'cont-d',
        text: block.continuedCue,
        beforeNode: firstPiece?.id ?? block.cueNode,
      })
      page.linesUsed += 1
      noteScene(block.scene, 1)
    }
    for (const slot of slots) {
      const startLine = page.linesUsed
      page.linesUsed += 1
      noteScene(slot.scene, 1)
      if (slot.piece === -1) continue
      const piece = block.pieces[slot.piece]
      if (piece === undefined) continue
      noteNode(piece, startLine, 1)
    }
    if (more) {
      const lastDialogue = [...slots].reverse().find((slot) => slot.dialogue)
      const piece = lastDialogue === undefined ? undefined : block.pieces[lastDialogue.piece]
      page.artefacts.push({ kind: 'more', text: MORE_TEXT, afterNode: piece?.id ?? block.firstId })
      page.linesUsed += 1
      noteScene(block.scene, 1)
    }
  }

  const breakPage = (rule: BreakRule, node: NodeId): void => {
    page = newPage()
    pages.push(page)
    breaks.push({ page: pages.length, rule, node })
  }

  /** Leading blanks never open a page: the first line of a page is a line. */
  const pastLeadingBlanks = (block: Block, from: number): number => {
    let at = from
    while (at < block.slots.length && block.slots[at]?.piece === -1) at += 1
    return at
  }

  /**
   * Could this block legally begin on a page with `room` lines left?
   *
   * The orphan rule asks this of whatever follows a scene heading. Note that it
   * asks the *whole* question - fits, or divides legally - rather than counting
   * two lines, which is what makes the heading rule and the dialogue minimum
   * interact correctly: a heading followed by a speech that cannot legally
   * divide in the space left is an orphan even though two lines would fit.
   */
  const canStart = (block: Block, room: number): boolean => {
    if (room <= 0) return false
    if (block.slots.length <= room) return true
    const cost = block.kind === 'speech' ? 1 : 0
    return splitPoints(block, 0).some((point) => point + cost <= room)
  }

  /** Why a block that did not fit could not be divided here. */
  const refusal = (block: Block, from: number, room: number): BreakRule => {
    if (block.kind !== 'speech') return 'page-full'
    const dialogue = countSlots(block.slots, from, block.slots.length, true)
    if (dialogue < MIN_DIALOGUE_LINES_BEFORE_BREAK + MIN_DIALOGUE_LINES_AFTER_BREAK) {
      return 'stranded-dialogue'
    }
    return room > 0 ? 'dialogue-minimum' : 'page-full'
  }

  const anchorAt = (block: Block, at: number): NodeId => {
    const slot = block.slots[at]
    const piece = slot === undefined ? undefined : block.pieces[slot.piece]
    return piece?.id ?? block.firstId
  }

  /**
   * Lay one block out, breaking and dividing as the rules allow.
   *
   * `from` is an index into `block.slots`: everything before it is already on a
   * page. Carrying an absolute index rather than a shrinking array is what lets
   * the two-line minimums be counted against the part still to be placed.
   */
  const place = (block: Block, next: Block | undefined): void => {
    let from = 0
    let continuation = false

    for (;;) {
      if (page.linesUsed === 0) from = pastLeadingBlanks(block, from)
      const remaining = block.slots.length - from
      if (remaining <= 0) return
      const lead = continuation ? 1 : 0
      const room = capacity - page.linesUsed

      if (lead + remaining <= room) {
        // The orphan rule. A heading may not end a page with nothing legal
        // under it - and moving it has to actually help, or the break is wasted
        // paper and whatever follows would be forced apart on the fresh page
        // too.
        if (block.opensScene && next !== undefined) {
          const after = room - remaining
          const fresh = capacity - remaining
          if (!canStart(next, after) && canStart(next, fresh)) {
            breakPage('orphaned-heading', block.firstId)
            continue
          }
        }
        commit(block, block.slots.slice(from), continuation, false)
        return
      }

      const cost = block.kind === 'speech' ? 1 : 0
      const budget = room - lead - cost
      const point = splitPoints(block, from).find((at) => at - from <= budget)

      if (point !== undefined) {
        commit(block, block.slots.slice(from, point), continuation, block.kind === 'speech')
        const anchor = anchorAt(block, point)
        from = point
        continuation = block.kind === 'speech'
        breakPage(block.kind === 'speech' ? 'dialogue-split' : 'page-full', anchor)
        continue
      }

      if (page.linesUsed === 0) {
        // Taller than an empty page. Divide it where the page ends rather than
        // overflowing the sheet; a block this size is pathological, and the
        // record says exactly where it was cut.
        const forced = Math.max(1, room - lead - cost)
        commit(block, block.slots.slice(from, from + forced), continuation, block.kind === 'speech')
        const anchor = anchorAt(block, from + forced)
        from += forced
        continuation = block.kind === 'speech'
        if (from >= block.slots.length) return
        breakPage('page-full', anchor)
        continue
      }

      breakPage(refusal(block, from, room), block.firstId)
    }
  }

  built.blocks.forEach((block, index) => {
    place(block, built.blocks[index + 1])
  })

  // -------------------------------------------------------------------------
  // The record
  // -------------------------------------------------------------------------

  const numbering = numberPages(
    pages.map((page) => ({ nodes: page.nodes })),
    options.lockedPages ?? [],
    options.revision ?? FIRST_REVISION_COLOUR,
  )

  const measuredPages: readonly MeasuredPage[] = pages.map((page, index) => {
    const numbered = numbering.pages[index]
    return {
      ordinal: index + 1,
      label: numbered?.label ?? String(index + 1),
      locked: numbered?.locked ?? false,
      revision: numbered?.revision ?? (options.revision ?? FIRST_REVISION_COLOUR),
      linesUsed: page.linesUsed,
      firstNode: page.nodes[0] ?? null,
      artefacts: page.artefacts,
    }
  })

  const measuredNodes: readonly NodeMeasurement[] = visible.map((node) => {
    const held = accumulators.get(String(node.id))
    const runs = held?.runs ?? []
    return {
      id: node.id,
      type: node.type,
      runs,
      lines: runs.reduce((total, run) => total + run.lines, 0),
    }
  })

  const scenes: SceneMeasurement[] = []
  let sceneNumber = 0
  for (const node of visible) {
    if (node.type !== 'scene') continue
    const reading = readSlugline(
      node.content.map((run) => (run.kind === 'text' ? run.text : '')).join(''),
    )
    if (!reading.ok) continue
    const at = sceneNumber
    sceneNumber += 1
    const lines = sceneLines[at] ?? 0
    scenes.push({
      id: node.id,
      number: sceneNumber,
      startPage: sceneFirstPage[at] ?? 1,
      endPage: sceneLastPage[at] ?? sceneFirstPage[at] ?? 1,
      lines,
      eighths: eighthsOf(lines, spec.linesPerPage),
    })
  }

  return ok({
    format: options.format,
    pageMode: options.pageMode,
    liveRepaginate: options.liveRepaginate,
    sheet: spec,
    pages: measuredPages,
    nodes: measuredNodes,
    scenes,
    breaks,
    totals: {
      pages: measuredPages.length,
      lines: measuredPages.reduce((total, page) => total + page.linesUsed, 0),
      scenes: scenes.length,
      eighths: scenes.reduce((total, scene) => total + scene.eighths, 0),
    },
    unresolvedMentions: built.unresolved,
    lockIssues: numbering.issues,
  })
}

/** How many breaks each rule forced. The tally the report quotes. */
export const tallyBreaks = (record: MeasurementRecord): Readonly<Record<BreakRule, number>> => {
  const tally: Record<BreakRule, number> = {
    'page-full': 0,
    'dialogue-split': 0,
    'dialogue-minimum': 0,
    'stranded-dialogue': 0,
    'orphaned-heading': 0,
  }
  for (const entry of record.breaks) tally[entry.rule] += 1
  return tally
}

/** Every `(MORE)` and `(CONT'D)` the layout drew, in page order. */
export const artefactsOf = (record: MeasurementRecord): readonly PageArtefact[] =>
  record.pages.flatMap((page) => page.artefacts)
