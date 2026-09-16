import type { OutlineHeading } from '@folio/script'
import { BEAT_HEADLINE_SEPARATOR } from '@folio/script'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { OutlineShape } from '../../../../../../../../lib/outline/pm-model'
import { blockAttrsOf, blockText, mentionAttrsOf, sameShape, shapeOf } from '../../../../../../../../lib/outline/pm-model'
import type { LabelFor } from '../../../../../../../../lib/script/inline'
import type { HandleMenuRequest, OnHandleMenu } from '../../../_script/editor/extensions/handles'
import { handleDecorationFor } from '../../../_script/editor/extensions/handles'
import { isStructural } from '../../../_script/editor/extensions/identity'
import { UNRESOLVED_LABEL } from '../../../_script/editor/extensions/mention'
import type { HostRegistry } from '../../../_script/editor/extensions/sheet-decorations'
import { COMPOSER_HOST } from '../../../_script/editor/extensions/sheet-decorations'
import { sameHeadings } from '../outline-store'

/**
 * Everything the outline draws that is not the text, as ProseMirror
 * decorations - maintained incrementally, so a keystroke touches the block
 * it landed in and nothing else. The Script route's `sheet-decorations.ts`,
 * with no layout engine, because the outline is not paginated.
 *
 *   beats     a beat's number, as a widget at the head of the block, and
 *             its bold lead - an inline decoration from the block's start
 *             to the first colon (`readBeatHeadline`'s rule; nothing about
 *             the lead is stored). The numbers are ordinals, so a block
 *             added, removed or moved renumbers every beat below it: the
 *             set is rebuilt whole on a structural transaction (tens of
 *             blocks) and, for a keystroke inside a beat, only that beat's
 *             lead is replaced.
 *   handles   the `+` / `⠿` pair at every block's left (`handles.ts`,
 *             shared with the Script), drawn at the caret block and on
 *             hover (CSS). `+` opens the block menu through the store.
 *   caret     `data-caret` on the caret block - what shows its handles -
 *             and the ghost of the caret line's promise inside an empty
 *             last block: "Type, or press / for a block", or the empty
 *             state's "Start typing, or type '/' to add a block" when the
 *             block is the only one (`docs/ui design/Route - Outline
 *             v2.dc.html`, `content: empty`).
 *   labels    a node decoration on every mention carrying its current
 *             label, which is what makes `mention.ts`'s node view redraw
 *             when the label book changes.
 *   threads   a host element after every block that carries a comment
 *             thread, and one for the new-thread composer, into which React
 *             portals the cards (`_script/comments/thread-cards.tsx`).
 *
 * The inputs arrive by an `outlineDecorationsKey` meta transaction: the
 * label book, the thread map, and where the composer is open. The counts
 * the chrome prints - blocks, acts, beats, words - and the heading list the
 * sidebar draws are read here too, after every change, and go to React
 * through `onShape` / `onHeadings` only when one of them moved.
 */

export type OutlineInputs = {
  readonly labelFor: LabelFor
  /** Thread ids by the node id they anchor to. */
  readonly threadsByNode: ReadonlyMap<string, readonly string[]>
  /** The node a new-thread composer is open under, or null. */
  readonly composerAt: string | null
}

export type OutlineDecorationsOptions = {
  readonly inputs: OutlineInputs | null
  readonly hosts: HostRegistry | null
  readonly onHandleMenu: OnHandleMenu
  readonly onShape?: ((shape: OutlineShape) => void) | undefined
  readonly onHeadings?: ((headings: readonly OutlineHeading[]) => void) | undefined
}

type DecorationsState = {
  readonly inputs: OutlineInputs
  readonly beats: DecorationSet
  readonly handles: DecorationSet
  readonly caret: DecorationSet
  readonly labels: DecorationSet
  readonly threads: DecorationSet
  /** `${id}:${count}` of the caret block and the block count as last drawn, or `''`. */
  readonly caretKey: string
  readonly shape: OutlineShape
  readonly headings: readonly OutlineHeading[]
}

export const outlineDecorationsKey = new PluginKey<DecorationsState>('outlineDecorations')

const idOf = (block: ProseMirrorNode): string => blockAttrsOf(block).id ?? ''

// ---------------------------------------------------------------------------
// Per-block decorations
// ---------------------------------------------------------------------------

const markerElement = (ordinal: number): HTMLElement => {
  const marker = document.createElement('span')
  marker.className = 'folio-outline-marker'
  marker.contentEditable = 'false'
  marker.textContent = String(ordinal)
  return marker
}

/** The lead's end as a document offset inside the block: a mention counts one, as its node size. */
const leadEnd = (block: ProseMirrorNode): number | null => {
  const at = block.textBetween(0, block.content.size, undefined, '￼').indexOf(BEAT_HEADLINE_SEPARATOR)
  return at === -1 ? null : at + 1
}

const beatDecorationsFor = (block: ProseMirrorNode, pos: number, ordinal: number): readonly Decoration[] => {
  const out: Decoration[] = [Decoration.widget(pos + 1, () => markerElement(ordinal), { side: -1, key: `beat:${String(ordinal)}` })]
  const end = leadEnd(block)
  if (end !== null && end > 0) out.push(Decoration.inline(pos + 1, pos + 1 + end, { class: 'folio-outline-lead' }))
  return out
}

/** The caret line's promise. `alone` is the empty state: the one blank block a new outline starts with. */
const ghostElement = (alone: boolean): HTMLElement => {
  const ghost = document.createElement('span')
  ghost.className = 'folio-outline-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  if (alone) {
    const caret = document.createElement('i')
    ghost.append(caret, document.createTextNode("Start typing, or type '/' to add a block"))
    return ghost
  }
  ghost.append(document.createTextNode('Type, or press '))
  const key = document.createElement('b')
  key.textContent = '/'
  ghost.append(key, document.createTextNode(' for a block'))
  const caret = document.createElement('i')
  ghost.append(caret)
  return ghost
}

const caretDecorationsFor = (state: EditorState): { readonly key: string; readonly decorations: readonly Decoration[] } => {
  const { doc } = state
  const out: Decoration[] = []
  const $from = state.selection.$from
  let key = ''
  if ($from.depth >= 1) {
    const block = $from.node(1)
    const pos = $from.before(1)
    key = `${idOf(block)}:${String(doc.childCount)}`
    out.push(Decoration.node(pos, pos + block.nodeSize, { 'data-caret': 'true' }))
  }
  const last = doc.lastChild
  if (last !== null && last.type.name === 'body' && last.content.size === 0) {
    const pos = doc.content.size - last.nodeSize
    const alone = doc.childCount === 1
    out.push(Decoration.widget(pos + 1, () => ghostElement(alone), { side: -1, key: alone ? 'ghost:alone' : 'ghost' }))
  }
  return { key, decorations: out }
}

const labelDecorationsFor = (block: ProseMirrorNode, pos: number, labelFor: LabelFor): readonly Decoration[] => {
  const out: Decoration[] = []
  block.forEach((child, offset) => {
    const mention = mentionAttrsOf(child)
    if (mention === null) return
    const at = pos + 1 + offset
    out.push(Decoration.node(at, at + child.nodeSize, { 'data-label': labelFor(mention.entity, mention.id) ?? UNRESOLVED_LABEL }))
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
  inputs: OutlineInputs,
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

const replaceWithin = (set: DecorationSet, doc: ProseMirrorNode, from: number, to: number, fresh: readonly Decoration[]): DecorationSet => {
  const stale = within(set, from, to)
  const removed = stale.length === 0 ? set : set.remove([...stale])
  return fresh.length === 0 ? removed : removed.add(doc, [...fresh])
}

const beatsOf = (doc: ProseMirrorNode): DecorationSet => {
  const out: Decoration[] = []
  let ordinal = 0
  doc.forEach((block, pos) => {
    if (block.type.name !== 'beat') return
    ordinal += 1
    out.push(...beatDecorationsFor(block, pos, ordinal))
  })
  return DecorationSet.create(doc, out)
}

const headingsOf = (doc: ProseMirrorNode, labelFor: LabelFor): readonly OutlineHeading[] => {
  const out: OutlineHeading[] = []
  doc.forEach((block) => {
    const type = block.type.name
    if (type !== 'h1' && type !== 'h2' && type !== 'h3') return
    const id = blockAttrsOf(block).id
    if (id === null) return
    out.push({ id, level: type === 'h1' ? 1 : type === 'h2' ? 2 : 3, text: blockText(block, labelFor) })
  })
  return out
}

type BuildContext = {
  readonly hosts: HostRegistry | null
  readonly onHandleMenu: OnHandleMenu
}

const build = (state: EditorState, inputs: OutlineInputs, context: BuildContext): DecorationsState => {
  const { doc } = state
  const handles: Decoration[] = []
  const labels: Decoration[] = []
  const threads: Decoration[] = []
  doc.forEach((block, pos) => {
    handles.push(handleDecorationFor(block, pos, idOf, context.onHandleMenu))
    labels.push(...labelDecorationsFor(block, pos, inputs.labelFor))
    threads.push(...threadDecorationsFor(block, pos, inputs, context.hosts))
  })
  const caret = caretDecorationsFor(state)
  return {
    inputs,
    beats: beatsOf(doc),
    handles: DecorationSet.create(doc, handles),
    caret: DecorationSet.create(doc, [...caret.decorations]),
    labels: DecorationSet.create(doc, labels),
    threads: DecorationSet.create(doc, threads),
    caretKey: caret.key,
    shape: shapeOf(doc, inputs.labelFor),
    headings: headingsOf(doc, inputs.labelFor),
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

const apply = (tr: Transaction, previous: DecorationsState, state: EditorState, context: BuildContext): DecorationsState => {
  const meta = tr.getMeta(outlineDecorationsKey) as Partial<OutlineInputs> | undefined
  if (!tr.docChanged && !tr.selectionSet && meta === undefined) return previous
  const inputs = meta === undefined ? previous.inputs : { ...previous.inputs, ...meta }
  if (meta !== undefined) return build(state, inputs, context)

  const { doc } = state
  const { labelFor } = inputs
  const structural = tr.docChanged && isStructural(tr)
  const touched = tr.docChanged ? touchedBlocks(tr, doc) : new Set<number>()

  let beats = structural ? beatsOf(doc) : tr.docChanged ? previous.beats.map(tr.mapping, doc) : previous.beats
  let handles = tr.docChanged ? previous.handles.map(tr.mapping, doc) : previous.handles
  let labels = tr.docChanged ? previous.labels.map(tr.mapping, doc) : previous.labels
  let threads = tr.docChanged ? previous.threads.map(tr.mapping, doc) : previous.threads
  if (tr.docChanged) {
    // A keystroke: the block it landed in has a new lead, a new mention or a
    // new handle key; nothing else was renumbered unless the change was structural.
    let ordinal = 0
    doc.forEach((block, pos) => {
      if (block.type.name === 'beat') ordinal += 1
      if (!touched.has(pos)) return
      const end = pos + block.nodeSize
      if (!structural && block.type.name === 'beat') beats = replaceWithin(beats, doc, pos, end, beatDecorationsFor(block, pos, ordinal))
      handles = replaceWithin(handles, doc, pos, end, [handleDecorationFor(block, pos, idOf, context.onHandleMenu)])
      labels = replaceWithin(labels, doc, pos + 1, end - 1, labelDecorationsFor(block, pos, labelFor))
      threads = replaceWithin(threads, doc, end, end, threadDecorationsFor(block, pos, inputs, context.hosts))
    })
  }

  let caret = tr.docChanged ? previous.caret.map(tr.mapping, doc) : previous.caret
  let caretKey = previous.caretKey
  const next = caretDecorationsFor(state)
  if (next.key !== previous.caretKey || touched.size > 0) {
    caret = DecorationSet.create(doc, [...next.decorations])
    caretKey = next.key
  }

  const shape = tr.docChanged ? shapeOf(doc, labelFor) : previous.shape
  const headings = tr.docChanged ? headingsOf(doc, labelFor) : previous.headings
  return {
    inputs,
    beats,
    handles,
    caret,
    labels,
    threads,
    caretKey,
    shape: sameShape(shape, previous.shape) ? previous.shape : shape,
    headings: sameHeadings(headings, previous.headings) ? previous.headings : headings,
  }
}

/** One of the sets, presented to ProseMirror as its own plugin so the sets are never merged by hand. */
const presenter = (name: string, pick: (state: DecorationsState) => DecorationSet): Plugin =>
  new Plugin({
    key: new PluginKey(name),
    props: {
      decorations: (state) => {
        const current = outlineDecorationsKey.getState(state)
        return current === undefined ? DecorationSet.empty : pick(current)
      },
    },
  })

const blankInputs = (): OutlineInputs => ({ labelFor: () => undefined, threadsByNode: new Map(), composerAt: null })

export const OutlineDecorations = Extension.create<OutlineDecorationsOptions>({
  name: 'outlineDecorations',
  addOptions() {
    return { inputs: null, hosts: null, onHandleMenu: null, onShape: undefined, onHeadings: undefined }
  },
  addProseMirrorPlugins() {
    const inputs = this.options.inputs ?? blankInputs()
    const { onShape, onHeadings } = this.options
    const context: BuildContext = { hosts: this.options.hosts, onHandleMenu: this.options.onHandleMenu }
    return [
      new Plugin<DecorationsState>({
        key: outlineDecorationsKey,
        state: {
          init: (_config, state) => build(state, inputs, context),
          apply: (tr, previous, _old, state) => apply(tr, previous, state, context),
        },
        view: () => ({
          update: (view, previous) => {
            const now = outlineDecorationsKey.getState(view.state)
            const before = outlineDecorationsKey.getState(previous)
            if (now === undefined) return
            if (now.shape !== before?.shape) onShape?.(now.shape)
            if (now.headings !== before?.headings) onHeadings?.(now.headings)
          },
        }),
      }),
      presenter('outlineBeats', (current) => current.beats),
      presenter('outlineHandles', (current) => current.handles),
      presenter('outlineCaret', (current) => current.caret),
      presenter('outlineLabels', (current) => current.labels),
      presenter('outlineThreads', (current) => current.threads),
    ]
  },
})

/** The plugin's current counts. */
export const outlineShapeOf = (state: EditorState): OutlineShape | undefined => outlineDecorationsKey.getState(state)?.shape

/** The plugin's current heading list. */
export const outlineHeadingsOf = (state: EditorState): readonly OutlineHeading[] | undefined =>
  outlineDecorationsKey.getState(state)?.headings

/** Hand the editor new inputs - a label book, a thread map, where the composer is. Every set is redrawn once, outside history. */
export const outlineInputsTransaction = (state: EditorState, inputs: Partial<OutlineInputs>): Transaction =>
  state.tr.setMeta(outlineDecorationsKey, inputs).setMeta('addToHistory', false)

/** Kept for the callers that only change the label book. */
export const labelBookTransaction = (state: EditorState, labelFor: LabelFor): Transaction =>
  outlineInputsTransaction(state, { labelFor })

export type { HandleMenuRequest }
