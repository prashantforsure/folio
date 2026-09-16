import type { MeasurementRecord, ScreenplayNodeType, SheetSpec } from '@folio/script'
import { resolveSheet } from '@folio/script'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { LabelFor } from '../../../../../../../../lib/script/inline'
import { inlineText } from '../../../../../../../../lib/script/inline'
import { lineEndsOfBlock } from '../../../../../../../../lib/script/lines'
import type { PageBreak } from '../../../../../../../../lib/script/pages'
import { charsPerLineFor, pageBreaksByNode, pageBreaksOf } from '../../../../../../../../lib/script/pages'
import { ghostFor, pillsFor } from '../../../../../../../../lib/script/pickers'
import { blockAttrsOf, blockTypeOf, inlineChildrenOf, mentionAttrsOf } from '../../../../../../../../lib/script/pm-model'
import type { HandleMenuRequest } from './handles'
import { handleDecorationFor } from './handles'
import { UNRESOLVED_LABEL } from './mention'

/**
 * Everything the page draws that is not the text, as ProseMirror
 * decorations - maintained incrementally, so a keystroke touches the block
 * it landed in and nothing else.
 *
 * Since the redesign (`docs/ui design/README.md`, "Dark canvas, no paper")
 * the body is proportional type that wraps on its own, so there are no
 * engine line ends, no per-block margins and no page frames here any more.
 * What is left, one set each:
 *
 *   pages     a `Page N` divider where the measurement record says a page
 *             begins: a widget between blocks when a page starts at a
 *             block's start, and inside the block at the engine's split
 *             offset when it starts mid-block (`lib/script/pages.ts`). The
 *             record's `(MORE)` / `(CONT'D)` texts ride on the divider.
 *             Rebuilt when the record changes, and for a split block whose
 *             text changed (the offset moves).
 *   handles   the `+` / `⠿` pair at every block's left (`handles.ts`, shared
 *             with the Outline's editor), drawn at the caret
 *             block and on hover (CSS). `+` opens the block menu through
 *             the store; `⠿` node-selects the block on mousedown and lets
 *             ProseMirror's own drag-and-drop move it. Rebuilt for the
 *             blocks a transaction restructured.
 *   caret     `data-caret` on the caret block, and the ghost of what an
 *             unfinished block promises (`ghostFor`). The element-type chip
 *             the old sheet drew at the inner margin is gone with it.
 *   text      the pills (`pillsFor`) - a decoration on the text, so the
 *             caret moves through them and typing edits them.
 *   labels    a node decoration on every mention carrying its current
 *             label, which is what makes `mention.ts`'s node view redraw
 *             when the label book changes - and the comment block's
 *             `Note · not exported` label as a widget.
 *   threads   a host element after every block that carries a comment
 *             thread, and one for the new-thread composer, into which React
 *             portals the cards (`sheet/thread-cards.tsx`). `stopEvent` and
 *             `ignoreSelection` keep the editor out of a textarea that lives
 *             inside its own DOM.
 *
 * The inputs arrive by a `sheetKey` meta transaction: the record and the
 * sheet (for the split offsets), the page mode, the label book, the thread
 * map, and where the composer is open.
 */

export type SheetInputs = {
  readonly sheet: SheetSpec
  readonly record: MeasurementRecord | null
  readonly paged: boolean
  readonly labelFor: LabelFor
  /** Thread ids by the node id they anchor to. */
  readonly threadsByNode: ReadonlyMap<string, readonly string[]>
  /** The node a new-thread composer is open under, or null. */
  readonly composerAt: string | null
}

/** Where a thread card or the composer is drawn: an element inside the editor React portals into. */
export type HostRegistry = {
  readonly mount: (key: string, element: HTMLElement) => void
  readonly unmount: (key: string) => void
}

export type { HandleMenuRequest } from './handles'

export type SheetDecorationsOptions = {
  readonly inputs: SheetInputs | null
  readonly hosts: HostRegistry | null
  readonly onHandleMenu: ((request: HandleMenuRequest) => void) | null
}

type SheetState = {
  readonly inputs: SheetInputs
  readonly breaks: ReadonlyMap<string, readonly PageBreak[]>
  readonly pages: DecorationSet
  readonly handles: DecorationSet
  readonly caret: DecorationSet
  readonly text: DecorationSet
  readonly labels: DecorationSet
  readonly threads: DecorationSet
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

export const COMPOSER_HOST = 'composer'

// ---------------------------------------------------------------------------
// Per-block arithmetic
// ---------------------------------------------------------------------------

const idOf = (block: ProseMirrorNode): string => blockAttrsOf(block).id ?? ''

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

/** The document position where the engine's line `afterLine` of this block ends, by its own wrap. */
const splitPos = (block: ProseMirrorNode, pos: number, afterLine: number, inputs: SheetInputs): number | null => {
  const ends = lineEndsOfBlock(block, inlineChildrenOf(block), inputs.labelFor, charsPerLineFor(inputs.sheet, block.type.name))
  const end = ends[afterLine - 1]
  if (end === undefined) return null
  const start = childStarts(block, pos)[end.child]
  return start === undefined ? null : start + end.offset
}

const breakElement = (entry: PageBreak, inline: boolean): HTMLElement => {
  const divider = document.createElement(inline ? 'span' : 'div')
  divider.className = 'folio-page-break'
  divider.dataset['pageBreak'] = String(entry.ordinal)
  divider.dataset['pageLabel'] = entry.label
  divider.dataset['pageLocked'] = entry.locked ? 'true' : 'false'
  divider.setAttribute('contenteditable', 'false')
  if (entry.more !== null) {
    const more = document.createElement('span')
    more.className = 'folio-page-break-artefact'
    more.textContent = entry.more
    divider.append(more)
  }
  const label = document.createElement('span')
  label.className = 'folio-page-break-label'
  label.textContent = `Page ${entry.label}`
  divider.append(label)
  const rule = document.createElement('span')
  rule.className = 'folio-page-break-rule'
  divider.append(rule)
  if (entry.continued !== null) {
    const continued = document.createElement('span')
    continued.className = 'folio-page-break-artefact'
    continued.textContent = entry.continued
    divider.append(continued)
  }
  return divider
}

const pageDecorationsFor = (
  block: ProseMirrorNode,
  pos: number,
  inputs: SheetInputs,
  breaks: readonly PageBreak[] | undefined,
): readonly Decoration[] => {
  if (!inputs.paged || breaks === undefined) return []
  const out: Decoration[] = []
  for (const entry of breaks) {
    const key = `page:${String(entry.ordinal)}:${entry.label}:${entry.more ?? ''}:${entry.continued ?? ''}`
    if (entry.afterLine === null) {
      out.push(Decoration.widget(pos, () => breakElement(entry, false), { side: -1, key }))
      continue
    }
    const at = splitPos(block, pos, entry.afterLine, inputs)
    if (at === null) {
      out.push(Decoration.widget(pos, () => breakElement(entry, false), { side: -1, key }))
      continue
    }
    out.push(Decoration.widget(at, () => breakElement(entry, true), { side: 1, key: `${key}:inline` }))
  }
  return out
}

const ghostElement = (ghost: NonNullable<ReturnType<typeof ghostFor>>): HTMLElement => {
  const element = document.createElement('span')
  element.className = 'folio-ghost'
  element.setAttribute('aria-hidden', 'true')
  if (ghost.lead !== '') {
    const lead = document.createElement('b')
    lead.textContent = ghost.lead
    element.append(lead)
  }
  element.append(document.createTextNode(ghost.rest))
  return element
}

const caretDecorationsFor = (
  state: EditorState,
  inputs: SheetInputs,
): { readonly key: string; readonly decorations: readonly Decoration[] } => {
  const $from = state.selection.$from
  if ($from.depth < 1) return { key: '', decorations: [] }
  const block = $from.node(1)
  const type = blockTypeOf(block)
  if (type === null) return { key: '', decorations: [] }
  const pos = $from.before(1)
  const text = inlineText(inlineChildrenOf(block), inputs.labelFor)
  const key = `${idOf(block)}:${type}:${text}`
  const out: Decoration[] = [Decoration.node(pos, pos + block.nodeSize, { 'data-caret': 'true' })]
  const ghost = ghostFor(type, text)
  if (ghost !== null) {
    out.push(
      Decoration.widget(pos + 1 + block.content.size, () => ghostElement(ghost), {
        side: 1,
        key: `ghost:${ghost.lead}:${ghost.rest}`,
      }),
    )
  }
  return { key, decorations: out }
}

const textDecorationsFor = (block: ProseMirrorNode, pos: number): readonly Decoration[] => {
  const out: Decoration[] = []
  const type = blockTypeOf(block)
  if (type === null) return out
  for (const pill of pillsFor(type, block.textContent)) {
    const from = textOffsetToPos(block, pos, pill.start)
    const to = textOffsetToPos(block, pos, pill.end)
    if (from === null || to === null || to <= from) continue
    out.push(Decoration.inline(from, to, { class: 'folio-pill', 'data-pill': pill.kind }))
  }
  return out
}

const commentLabelElement = (): HTMLElement => {
  const label = document.createElement('div')
  label.className = 'folio-comment-label'
  label.setAttribute('contenteditable', 'false')
  label.append(document.createTextNode('Note'))
  const detail = document.createElement('span')
  detail.textContent = 'not exported'
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

const hostElement = (key: string, kind: 'thread' | 'composer', hosts: HostRegistry | null): HTMLElement => {
  const host = document.createElement('div')
  host.className = 'folio-thread-host'
  host.dataset['host'] = kind
  host.dataset['hostKey'] = key
  host.setAttribute('contenteditable', 'false')
  hosts?.mount(key, host)
  return host
}

const threadDecorationsFor = (
  block: ProseMirrorNode,
  pos: number,
  inputs: SheetInputs,
  hosts: HostRegistry | null,
): readonly Decoration[] => {
  const id = idOf(block)
  const out: Decoration[] = []
  const after = pos + block.nodeSize
  const spec = (key: string) => ({
    side: 1,
    key: `host:${key}`,
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: () => {
      hosts?.unmount(key)
    },
  })
  for (const threadId of inputs.threadsByNode.get(id) ?? []) {
    out.push(Decoration.widget(after, () => hostElement(threadId, 'thread', hosts), spec(threadId)))
  }
  if (inputs.composerAt === id) {
    out.push(Decoration.widget(after, () => hostElement(COMPOSER_HOST, 'composer', hosts), spec(COMPOSER_HOST)))
  }
  return out
}

// ---------------------------------------------------------------------------
// The sets
// ---------------------------------------------------------------------------

const within = (set: DecorationSet, from: number, to: number): readonly Decoration[] =>
  set.find(from, to).filter((decoration) => decoration.from >= from && decoration.to <= to)

const replaceWithin = (
  set: DecorationSet,
  doc: ProseMirrorNode,
  from: number,
  to: number,
  fresh: readonly Decoration[],
): DecorationSet => {
  const stale = within(set, from, to)
  const removed = stale.length === 0 ? set : set.remove([...stale])
  return fresh.length === 0 ? removed : removed.add(doc, [...fresh])
}

type BuildContext = {
  readonly hosts: HostRegistry | null
  readonly onHandleMenu: SheetDecorationsOptions['onHandleMenu']
}


const build = (state: EditorState, inputs: SheetInputs, context: BuildContext): SheetState => {
  const { doc } = state
  const breaks = pageBreaksByNode(pageBreaksOf(inputs.record))
  const pages: Decoration[] = []
  const handles: Decoration[] = []
  const text: Decoration[] = []
  const labels: Decoration[] = []
  const threads: Decoration[] = []
  doc.forEach((block, pos) => {
    pages.push(...pageDecorationsFor(block, pos, inputs, breaks.get(idOf(block))))
    handles.push(handleDecorationFor(block, pos, idOf, context.onHandleMenu))
    text.push(...textDecorationsFor(block, pos))
    labels.push(...labelDecorationsFor(block, pos, inputs))
    threads.push(...threadDecorationsFor(block, pos, inputs, context.hosts))
  })
  const caret = caretDecorationsFor(state, inputs)
  return {
    inputs,
    breaks,
    pages: DecorationSet.create(doc, pages),
    handles: DecorationSet.create(doc, handles),
    caret: DecorationSet.create(doc, [...caret.decorations]),
    text: DecorationSet.create(doc, text),
    labels: DecorationSet.create(doc, labels),
    threads: DecorationSet.create(doc, threads),
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

const apply = (tr: Transaction, previous: SheetState, state: EditorState, context: BuildContext): SheetState => {
  const meta = tr.getMeta(sheetKey) as Partial<SheetInputs> | undefined
  if (!tr.docChanged && !tr.selectionSet && meta === undefined) return previous
  const inputs = meta === undefined ? previous.inputs : { ...previous.inputs, ...meta }
  const everything =
    meta !== undefined &&
    (meta.sheet !== undefined || meta.labelFor !== undefined || meta.paged !== undefined || meta.threadsByNode !== undefined || meta.composerAt !== undefined)
  if (everything) return build(state, inputs, context)

  const { doc } = state
  let pages = tr.docChanged ? previous.pages.map(tr.mapping, doc) : previous.pages
  let handles = tr.docChanged ? previous.handles.map(tr.mapping, doc) : previous.handles
  let text = tr.docChanged ? previous.text.map(tr.mapping, doc) : previous.text
  let labels = tr.docChanged ? previous.labels.map(tr.mapping, doc) : previous.labels
  let threads = tr.docChanged ? previous.threads.map(tr.mapping, doc) : previous.threads
  let caret = tr.docChanged ? previous.caret.map(tr.mapping, doc) : previous.caret
  let breaks = previous.breaks

  const touched = tr.docChanged ? touchedBlocks(tr, doc) : new Set<number>()
  const recordChanged = meta !== undefined && meta.record !== undefined
  if (recordChanged) {
    breaks = pageBreaksByNode(pageBreaksOf(inputs.record))
    const fresh: Decoration[] = []
    doc.forEach((block, pos) => {
      fresh.push(...pageDecorationsFor(block, pos, inputs, breaks.get(idOf(block))))
    })
    pages = DecorationSet.create(doc, fresh)
  } else if (touched.size > 0) {
    doc.forEach((block, pos) => {
      if (!touched.has(pos)) return
      const end = pos + block.nodeSize
      const id = idOf(block)
      const own = breaks.get(id)
      if (own !== undefined) {
        // The block's page breaks, re-placed by its new text; the widget
        // before the block moves with the block by mapping and is left.
        pages = replaceWithin(pages, doc, pos + 1, end - 1, pageDecorationsFor(block, pos, inputs, own).filter((d) => d.from > pos))
      }
      handles = replaceWithin(handles, doc, pos, end, [handleDecorationFor(block, pos, idOf, context.onHandleMenu)])
      text = replaceWithin(text, doc, pos + 1, end - 1, textDecorationsFor(block, pos))
      labels = replaceWithin(labels, doc, pos + 1, end - 1, labelDecorationsFor(block, pos, inputs))
      threads = replaceWithin(threads, doc, end, end, threadDecorationsFor(block, pos, inputs, context.hosts))
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

  return { inputs, breaks, pages, handles, caret, text, labels, threads, caretKey }
}

const letterInputs = (): SheetInputs => {
  const letter = resolveSheet('hollywood')
  if (!letter.ok) throw new Error('Folio: US Letter must resolve.')
  return { sheet: letter.value, record: null, paged: true, labelFor: () => undefined, threadsByNode: new Map(), composerAt: null }
}

/** One of the sets, presented to ProseMirror as its own plugin so the sets are never merged by hand. */
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
    return { inputs: null, hosts: null, onHandleMenu: null }
  },
  addProseMirrorPlugins() {
    const inputs = this.options.inputs ?? letterInputs()
    const context: BuildContext = { hosts: this.options.hosts, onHandleMenu: this.options.onHandleMenu }
    return [
      new Plugin<SheetState>({
        key: sheetKey,
        state: {
          init: (_config, state) => build(state, inputs, context),
          apply: (tr, previous, _old, state) => apply(tr, previous, state, context),
        },
      }),
      presenter('screenplaySheetPages', (current) => current.pages),
      presenter('screenplaySheetHandles', (current) => current.handles),
      presenter('screenplaySheetText', (current) => current.text),
      presenter('screenplaySheetLabels', (current) => current.labels),
      presenter('screenplaySheetThreads', (current) => current.threads),
      presenter('screenplaySheetCaret', (current) => current.caret),
    ]
  },
})

/** Hand the page new inputs. A new sheet, label book, thread map or composer rebuilds every set; a new record re-places the dividers. */
export const sheetInputsTransaction = (state: EditorState, inputs: Partial<SheetInputs>): Transaction =>
  state.tr.setMeta(sheetKey, inputs).setMeta('addToHistory', false)
