import type { MeasurementRecord, ScreenplayNodeType, SheetSpec } from '@folio/script'
import { resolveSheet } from '@folio/script'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { LabelFor } from '../../../../../../../../lib/script/inline'
import { inlineText } from '../../../../../../../../lib/script/inline'
import type { BlockLayout, BlockToLayout, SheetLayout } from '../../../../../../../../lib/script/layout'
import { charsPerLineFor, layoutSheet } from '../../../../../../../../lib/script/layout'
import type { LineEnd } from '../../../../../../../../lib/script/lines'
import { lineCountOf, lineEndsOfBlock } from '../../../../../../../../lib/script/lines'
import { ghostFor, pillsFor } from '../../../../../../../../lib/script/pickers'
import { blockAttrsOf, blockTypeOf, inlineChildrenOf, mentionAttrsOf } from '../../../../../../../../lib/script/pm-model'
import { UNRESOLVED_LABEL } from './mention'

/**
 * Everything the sheet draws that is not the text, as ProseMirror
 * decorations - maintained incrementally, so a keystroke touches the block
 * it landed in and nothing else.
 *
 * Four sets, each rebuilt for exactly the blocks whose input changed:
 *
 *   text      per block: the engine's line ends (an inline decoration on
 *             the last character of each line, drawn as a newline by
 *             `.folio-line-end::after`), the pills (`pillsFor`), and the page
 *             gap inside a block the record split across two pages, with
 *             `(MORE)` and the continued cue. Rebuilt for a block whose text
 *             changed or whose gap moved.
 *   margins   per block: a node decoration carrying `margin-top` from the
 *             measurement record via `layoutSheet`, and `data-measured`.
 *             ProseMirror patches the attribute on a block whose decoration
 *             changed and does not visit one whose decoration is equal, so a
 *             new record costs the blocks it moved. Rebuilt for a block whose
 *             layout row changed, or that a transaction restructured (a split
 *             drops both halves' node decorations, as it must).
 *   caret     the caret block alone: the element chip at the inner margin
 *             and the ghost of what an unfinished block promises
 *             (`ghostFor`). Rebuilt when the caret enters another block or
 *             the caret block's text changes.
 *   labels    a node decoration on every mention carrying its current label,
 *             which is what makes `mention.ts`'s node view redraw when the
 *             label book changes - and the comment block's "not exported ·
 *             not paginated" label as a widget.
 *
 * The inputs - the sheet, the measurement record, the page mode and the
 * label book - arrive by a `sheetKey` meta transaction. A new record
 * re-runs the layout and diffs it; a new sheet or label book rebuilds
 * everything, once, because every line end depends on them.
 *
 * The layout itself (`layoutSheet`) runs on every transaction that changed
 * the document, over every block - three thousand cached line counts and
 * some arithmetic, well under a millisecond - because a block that grew by
 * a line moves every block below it on that page, and the record cannot
 * say so until the next measurement. The frames and the desk height it
 * produces go to React through `onLayout`, and only when they changed.
 */

export type SheetInputs = {
  readonly sheet: SheetSpec
  readonly record: MeasurementRecord | null
  readonly paged: boolean
  readonly labelFor: LabelFor
}

export type SheetDecorationsOptions = {
  readonly inputs: SheetInputs | null
  readonly onLayout?: ((layout: SheetLayout) => void) | undefined
}

type SheetState = {
  readonly inputs: SheetInputs
  readonly layout: SheetLayout
  readonly text: DecorationSet
  readonly margins: DecorationSet
  readonly caret: DecorationSet
  readonly labels: DecorationSet
  /** `${id}:${text}` of the caret block as last drawn, or `''`. */
  readonly caretKey: string
}

export const sheetKey = new PluginKey<SheetState>('screenplaySheet')

export const TYPE_LABEL: Readonly<Record<ScreenplayNodeType, string>> = {
  scene: 'Scene',
  action: 'Action',
  character: 'Character',
  paren: 'Paren',
  dialogue: 'Dialogue',
  transition: 'Transition',
  comment: 'Comment',
  subtitle: 'Subtitle',
}

// ---------------------------------------------------------------------------
// Per-block arithmetic
// ---------------------------------------------------------------------------

const idOf = (block: ProseMirrorNode): string => blockAttrsOf(block).id ?? ''

const endsOf = (block: ProseMirrorNode, inputs: SheetInputs): readonly LineEnd[] =>
  lineEndsOfBlock(block, inlineChildrenOf(block), inputs.labelFor, charsPerLineFor(inputs.sheet, block.type.name))

const blocksToLayout = (doc: ProseMirrorNode, inputs: SheetInputs): readonly BlockToLayout[] => {
  const out: BlockToLayout[] = []
  doc.forEach((block) => {
    out.push({ id: idOf(block), type: block.type.name, lines: lineCountOf(endsOf(block, inputs)) })
  })
  return out
}

/** The document position of each inline child's start, in `inlineChildrenOf` order. */
const childStarts = (block: ProseMirrorNode, pos: number): readonly number[] => {
  const starts: number[] = []
  block.forEach((_child, offset) => {
    starts.push(pos + 1 + offset)
  })
  return starts
}

/** A text-only offset (what `pillsFor` indexes) to a document position, mentions skipped. */
const textOffsetToPos = (block: ProseMirrorNode, pos: number, offset: number): number | null => {
  let remaining = offset
  let last: number | null = null
  let found: number | null = null
  block.forEach((child, childOffset) => {
    if (found !== null || !child.isText) return
    const length = child.text?.length ?? 0
    if (remaining <= length) {
      found = pos + 1 + childOffset + remaining
      return
    }
    remaining -= length
    last = pos + 1 + childOffset + length
  })
  return found ?? last
}

const gapElement = (
  heightPx: number,
  more: string | null,
  continued: string | null,
  moreOffsetPx: number,
  cueOffsetPx: number,
): HTMLElement => {
  const gap = document.createElement('span')
  gap.className = 'folio-page-gap'
  gap.style.height = `${String(heightPx)}px`
  if (more !== null) {
    const label = document.createElement('span')
    label.className = 'folio-page-gap-more'
    label.style.left = `${String(moreOffsetPx)}px`
    label.textContent = more
    gap.append(label)
  }
  if (continued !== null) {
    const label = document.createElement('span')
    label.className = 'folio-page-gap-continued'
    label.style.left = `${String(cueOffsetPx)}px`
    label.textContent = continued
    gap.append(label)
  }
  return gap
}

const textDecorationsFor = (
  block: ProseMirrorNode,
  pos: number,
  inputs: SheetInputs,
  placed: BlockLayout | undefined,
): readonly Decoration[] => {
  const out: Decoration[] = []
  const starts = childStarts(block, pos)
  const ends = endsOf(block, inputs)
  const gap = placed?.gap ?? null
  const lastEnd = new Map<number, number>()
  ends.forEach((end, index) => {
    const start = starts[end.child]
    if (start === undefined) return
    const from = lastEnd.get(end.child) ?? 0
    lastEnd.set(end.child, end.offset)
    const to = start + end.offset
    if (gap !== null && index + 1 === gap.afterLine) {
      const type = block.type.name
      const element = inputs.sheet.element
      const blockInset =
        type === 'dialogue' || type === 'paren' || type === 'subtitle' ? element[type].leftPx : element.action.leftPx
      const gapKey = `${String(gap.heightPx)}:${gap.more ?? ''}:${gap.continued ?? ''}`
      out.push(
        Decoration.widget(
          to,
          () => gapElement(gap.heightPx, gap.more, gap.continued, element.dialogue.leftPx - blockInset, element.character.leftPx - blockInset),
          { side: 1, key: `gap:${gapKey}` },
        ),
      )
      return
    }
    // The last character only: a pill boundary inside the line would
    // otherwise split a whole-line range into two spans that both end it.
    const inlineFrom = end.offset > from ? to - 1 : start + from
    if (inlineFrom < to) out.push(Decoration.inline(inlineFrom, to, { class: 'folio-line-end' }))
  })
  const type = blockTypeOf(block)
  if (type !== null) {
    for (const pill of pillsFor(type, block.textContent)) {
      const from = textOffsetToPos(block, pos, pill.start)
      const to = textOffsetToPos(block, pos, pill.end)
      if (from === null || to === null || to <= from) continue
      out.push(Decoration.inline(from, to, { class: 'folio-pill', 'data-pill': pill.kind }))
    }
  }
  return out
}

const marginKey = (placed: BlockLayout | undefined): string =>
  placed === undefined ? '0:false' : `${String(placed.marginTopPx)}:${placed.measured ? 'true' : 'false'}`

const marginDecorationFor = (block: ProseMirrorNode, pos: number, placed: BlockLayout | undefined): Decoration =>
  Decoration.node(
    pos,
    pos + block.nodeSize,
    {
      style: `margin-top:${String(placed?.marginTopPx ?? 0)}px`,
      'data-measured': placed?.measured === true ? 'true' : 'false',
    },
    { margin: marginKey(placed) },
  )

const chipElement = (type: ScreenplayNodeType): HTMLElement => {
  const chip = document.createElement('span')
  chip.className = 'folio-chip'
  chip.textContent = TYPE_LABEL[type]
  return chip
}

const ghostElement = (ghost: NonNullable<ReturnType<typeof ghostFor>>): HTMLElement => {
  const element = document.createElement('span')
  element.className = 'folio-ghost'
  element.setAttribute('aria-hidden', 'true')
  const placed = ghost.insetCh !== null
  element.dataset['placed'] = placed ? 'true' : 'false'
  if (placed && ghost.insetCh !== null && ghost.insetCh > 0) element.style.marginLeft = `${String(ghost.insetCh)}ch`
  if (ghost.lead !== '') {
    const lead = document.createElement('b')
    lead.textContent = ghost.lead
    element.append(lead)
  }
  element.append(document.createTextNode(ghost.rest))
  return element
}

const caretDecorationsFor = (state: EditorState, inputs: SheetInputs): { readonly key: string; readonly decorations: readonly Decoration[] } => {
  const $from = state.selection.$from
  if ($from.depth < 1) return { key: '', decorations: [] }
  const block = $from.node(1)
  const type = blockTypeOf(block)
  if (type === null) return { key: '', decorations: [] }
  const pos = $from.before(1)
  const text = inlineText(inlineChildrenOf(block), inputs.labelFor)
  const key = `${idOf(block)}:${type}:${text}`
  const out: Decoration[] = []
  if (type !== 'comment') out.push(Decoration.widget(pos + 1, () => chipElement(type), { side: -1, key: `chip:${type}` }))
  const ghost = ghostFor(type, text)
  if (ghost !== null) {
    const at = ghost.insetCh === null ? pos + 1 + block.content.size : pos + 1
    out.push(
      Decoration.widget(at, () => ghostElement(ghost), {
        side: ghost.insetCh === null ? 1 : -1,
        key: `ghost:${ghost.lead}:${ghost.rest}:${String(ghost.insetCh)}`,
      }),
    )
  }
  return { key, decorations: out }
}

const commentLabelElement = (): HTMLElement => {
  const label = document.createElement('div')
  label.className = 'folio-comment-label'
  label.append(document.createTextNode('Comment'))
  const detail = document.createElement('span')
  detail.textContent = 'not exported · not paginated'
  label.append(detail)
  return label
}

const labelDecorationsFor = (block: ProseMirrorNode, pos: number, inputs: SheetInputs): readonly Decoration[] => {
  const out: Decoration[] = []
  if (block.type.name === 'comment') {
    out.push(Decoration.widget(pos + 1, commentLabelElement, { side: -1, key: 'comment-label' }))
  }
  block.forEach((child, offset) => {
    const mention = mentionAttrsOf(child)
    if (mention === null) return
    const label = inputs.labelFor(mention.entity, mention.id) ?? UNRESOLVED_LABEL
    const at = pos + 1 + offset
    out.push(Decoration.node(at, at + child.nodeSize, { 'data-label': label }))
  })
  return out
}

// ---------------------------------------------------------------------------
// The sets
// ---------------------------------------------------------------------------

const within = (set: DecorationSet, from: number, to: number): readonly Decoration[] =>
  set.find(from, to).filter((decoration) => decoration.from >= from && decoration.to <= to)

const replaceWithin = (set: DecorationSet, doc: ProseMirrorNode, from: number, to: number, fresh: readonly Decoration[]): DecorationSet => {
  const stale = within(set, from, to)
  const removed = stale.length === 0 ? set : set.remove([...stale])
  return fresh.length === 0 ? removed : removed.add(doc, [...fresh])
}

const marginAt = (set: DecorationSet, pos: number, end: number): Decoration | undefined =>
  set.find(pos, end).find((decoration) => decoration.from === pos && decoration.to === end)

const build = (state: EditorState, inputs: SheetInputs): SheetState => {
  const { doc } = state
  const layout = layoutSheet(blocksToLayout(doc, inputs), inputs.record, inputs.sheet, inputs.paged)
  const text: Decoration[] = []
  const margins: Decoration[] = []
  const labels: Decoration[] = []
  doc.forEach((block, pos) => {
    const placed = layout.blocks.get(idOf(block))
    text.push(...textDecorationsFor(block, pos, inputs, placed))
    margins.push(marginDecorationFor(block, pos, placed))
    labels.push(...labelDecorationsFor(block, pos, inputs))
  })
  const caret = caretDecorationsFor(state, inputs)
  return {
    inputs,
    layout,
    text: DecorationSet.create(doc, text),
    margins: DecorationSet.create(doc, margins),
    caret: DecorationSet.create(doc, [...caret.decorations]),
    labels: DecorationSet.create(doc, labels),
    caretKey: caret.key,
  }
}

/** The top-level blocks a transaction touched, by position in the new document. */
const touchedBlocks = (tr: Transaction, doc: ProseMirrorNode): ReadonlySet<number> => {
  const out = new Set<number>()
  for (const range of getChangedRanges(tr)) {
    const from = Math.max(0, range.newRange.from - 1)
    const to = Math.min(doc.content.size, range.newRange.to + 1)
    doc.nodesBetween(from, to, (_node, pos) => {
      out.add(pos)
      return false
    })
  }
  return out
}

const sameGap = (a: BlockLayout['gap'], b: BlockLayout['gap']): boolean => {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.afterLine === b.afterLine && a.heightPx === b.heightPx && a.more === b.more && a.continued === b.continued
}

const sameRow = (a: BlockLayout | undefined, b: BlockLayout | undefined): boolean => {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return a.marginTopPx === b.marginTopPx && a.measured === b.measured && sameGap(a.gap, b.gap)
}

const apply = (tr: Transaction, previous: SheetState, state: EditorState): SheetState => {
  const meta = tr.getMeta(sheetKey) as Partial<SheetInputs> | undefined
  if (!tr.docChanged && !tr.selectionSet && meta === undefined) return previous
  const inputs = meta === undefined ? previous.inputs : { ...previous.inputs, ...meta }
  const everything =
    meta !== undefined && (meta.sheet !== undefined || meta.labelFor !== undefined || meta.paged !== undefined)
  if (everything) return build(state, inputs)

  const { doc } = state
  let text = tr.docChanged ? previous.text.map(tr.mapping, doc) : previous.text
  let margins = tr.docChanged ? previous.margins.map(tr.mapping, doc) : previous.margins
  let labels = tr.docChanged ? previous.labels.map(tr.mapping, doc) : previous.labels
  let caret = tr.docChanged ? previous.caret.map(tr.mapping, doc) : previous.caret
  let layout = previous.layout

  const touched = tr.docChanged ? touchedBlocks(tr, doc) : new Set<number>()
  const recordChanged = meta !== undefined && meta.record !== undefined
  if (tr.docChanged || recordChanged) {
    layout = layoutSheet(blocksToLayout(doc, inputs), inputs.record, inputs.sheet, inputs.paged)
    doc.forEach((block, pos) => {
      const id = idOf(block)
      const next = layout.blocks.get(id)
      const before = previous.layout.blocks.get(id)
      const end = pos + block.nodeSize
      const restructured = touched.has(pos)
      if (!restructured && sameRow(before, next)) return
      const existing = marginAt(margins, pos, end)
      if (existing === undefined || existing.spec['margin'] !== marginKey(next)) {
        margins = (existing === undefined ? margins : margins.remove([existing])).add(doc, [marginDecorationFor(block, pos, next)])
      }
      if (restructured || !sameGap(before?.gap ?? null, next?.gap ?? null)) {
        text = replaceWithin(text, doc, pos + 1, end - 1, textDecorationsFor(block, pos, inputs, next))
      }
      if (restructured) labels = replaceWithin(labels, doc, pos + 1, end - 1, labelDecorationsFor(block, pos, inputs))
    })
  }

  let caretKey = previous.caretKey
  if (tr.docChanged || tr.selectionSet) {
    const next = caretDecorationsFor(state, inputs)
    if (next.key !== previous.caretKey || touched.size > 0) {
      caret = DecorationSet.create(doc, [...next.decorations])
      caretKey = next.key
    }
  }

  return { inputs, layout, text, margins, caret, labels, caretKey }
}

const framesKey = (layout: SheetLayout): string =>
  `${String(layout.heightPx)}|${layout.paged ? 'P' : 'C'}|${layout.frames
    .map((frame) => `${String(frame.ordinal)}:${frame.label}:${String(frame.topPx)}:${String(frame.heightPx)}:${frame.locked ? 'L' : ''}`)
    .join('|')}`

const letterInputs = (): SheetInputs => {
  const letter = resolveSheet('hollywood')
  if (!letter.ok) throw new Error('Folio: US Letter must resolve.')
  return { sheet: letter.value, record: null, paged: true, labelFor: () => undefined }
}

/** One of the four sets, presented to ProseMirror as its own plugin so the sets are never merged by hand. */
const presenter = (name: string, pick: (state: SheetState) => DecorationSet): Plugin =>
  new Plugin({
    key: new PluginKey(name),
    props: {
      decorations: (state) => {
        const current = sheetKey.getState(state)
        return current === undefined ? DecorationSet.empty : pick(current)
      },
    },
  })

export const SheetDecorations = Extension.create<SheetDecorationsOptions>({
  name: 'screenplaySheet',
  addOptions() {
    return { inputs: null, onLayout: undefined }
  },
  addProseMirrorPlugins() {
    const inputs = this.options.inputs ?? letterInputs()
    const { onLayout } = this.options
    return [
      new Plugin<SheetState>({
        key: sheetKey,
        state: {
          init: (_config, state) => build(state, inputs),
          apply: (tr, previous, _old, state) => apply(tr, previous, state),
        },
        view: () => ({
          update: (view, previous) => {
            const now = sheetKey.getState(view.state)?.layout
            const before = sheetKey.getState(previous)?.layout
            if (now !== undefined && now !== before && (before === undefined || framesKey(now) !== framesKey(before))) onLayout?.(now)
          },
        }),
      }),
      presenter('screenplaySheetMargins', (current) => current.margins),
      presenter('screenplaySheetText', (current) => current.text),
      presenter('screenplaySheetLabels', (current) => current.labels),
      presenter('screenplaySheetCaret', (current) => current.caret),
    ]
  },
})

/** The plugin's current layout - frames, desk height and the per-block rows. */
export const sheetLayoutOf = (state: EditorState): SheetLayout | undefined => sheetKey.getState(state)?.layout

/** Hand the sheet new inputs. A new sheet or label book rebuilds every decoration; a new record diffs the layout. */
export const sheetInputsTransaction = (state: EditorState, inputs: Partial<SheetInputs>): Transaction =>
  state.tr.setMeta(sheetKey, inputs).setMeta('addToHistory', false)
