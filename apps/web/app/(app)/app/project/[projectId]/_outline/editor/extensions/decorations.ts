import { BEAT_HEADLINE_SEPARATOR } from '@folio/script'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { OutlineShape } from '../../../../../../../../lib/outline/pm-model'
import { blockAttrsOf, mentionAttrsOf, sameShape, shapeOf } from '../../../../../../../../lib/outline/pm-model'
import type { LabelFor } from '../../../../../../../../lib/script/inline'
import { UNRESOLVED_LABEL } from '../../../_script/editor/extensions/mention'
import { isStructural } from '../../../_script/editor/extensions/identity'

/**
 * Everything the outline sheet draws that is not the text, as ProseMirror
 * decorations - maintained incrementally, so a keystroke touches the block
 * it landed in and nothing else. The Script route's `sheet-decorations.ts`,
 * with three sets instead of four and no layout engine, because the
 * outline is not paginated.
 *
 *   beats     a beat's number, as a widget at the head of the block, and
 *             its bold lead - an inline decoration from the block's start
 *             to the first colon (`readBeatHeadline`'s rule; nothing about
 *             the lead is stored). The numbers are ordinals, so a block
 *             added, removed or moved renumbers every beat below it: the
 *             set is rebuilt whole on a structural transaction (tens of
 *             blocks) and, for a keystroke inside a beat, only that beat's
 *             lead is replaced.
 *   ghost     the caret line's promise - "Type, or press / for a block" -
 *             inside the last block when it is an empty Body. Inside the
 *             block's own inset, after the text position, not in a margin.
 *   labels    a node decoration on every mention carrying its current
 *             label, which is what makes `mention.ts`'s node view redraw
 *             when the label book changes.
 *
 * The label book arrives by an `outlineDecorationsKey` meta transaction
 * and rebuilds the labels once. The counts the chrome prints - blocks,
 * acts, beats, words - are read here too, after every change, and go to
 * React through `onShape` only when one of them moved.
 */

export type OutlineDecorationsOptions = {
  readonly labelFor: LabelFor
  readonly onShape?: ((shape: OutlineShape) => void) | undefined
}

type DecorationsState = {
  readonly labelFor: LabelFor
  readonly beats: DecorationSet
  readonly ghost: DecorationSet
  readonly labels: DecorationSet
  /** `${id}` of the block the ghost sits in, or `''`. */
  readonly ghostKey: string
  readonly shape: OutlineShape
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

const ghostElement = (): HTMLElement => {
  const ghost = document.createElement('span')
  ghost.className = 'folio-outline-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.append(document.createTextNode('Type, or press '))
  const key = document.createElement('b')
  key.textContent = '/'
  ghost.append(key, document.createTextNode(' for a block'))
  const caret = document.createElement('i')
  caret.textContent = '|'
  ghost.append(caret)
  return ghost
}

const ghostFor = (doc: ProseMirrorNode): { readonly key: string; readonly decorations: readonly Decoration[] } => {
  const last = doc.lastChild
  if (last === null || last.type.name !== 'body' || last.content.size !== 0) return { key: '', decorations: [] }
  const pos = doc.content.size - last.nodeSize
  return { key: idOf(last), decorations: [Decoration.widget(pos + 1, ghostElement, { side: -1, key: 'ghost' })] }
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

const labelsOf = (doc: ProseMirrorNode, labelFor: LabelFor): DecorationSet => {
  const out: Decoration[] = []
  doc.forEach((block, pos) => {
    out.push(...labelDecorationsFor(block, pos, labelFor))
  })
  return DecorationSet.create(doc, out)
}

const build = (state: EditorState, labelFor: LabelFor): DecorationsState => {
  const { doc } = state
  const ghost = ghostFor(doc)
  return {
    labelFor,
    beats: beatsOf(doc),
    ghost: DecorationSet.create(doc, [...ghost.decorations]),
    labels: labelsOf(doc, labelFor),
    ghostKey: ghost.key,
    shape: shapeOf(doc, labelFor),
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

const apply = (tr: Transaction, previous: DecorationsState, state: EditorState): DecorationsState => {
  const meta = tr.getMeta(outlineDecorationsKey) as { readonly labelFor?: LabelFor } | undefined
  if (meta?.labelFor !== undefined) return build(state, meta.labelFor)
  if (!tr.docChanged) return previous

  const { doc } = state
  const { labelFor } = previous
  const structural = isStructural(tr)
  const touched = touchedBlocks(tr, doc)

  let beats = structural ? beatsOf(doc) : previous.beats.map(tr.mapping, doc)
  let labels = structural ? labelsOf(doc, labelFor) : previous.labels.map(tr.mapping, doc)
  if (!structural) {
    // A keystroke: the block it landed in has a new lead or a new mention, and nothing was renumbered.
    let ordinal = 0
    doc.forEach((block, pos) => {
      if (block.type.name === 'beat') ordinal += 1
      if (!touched.has(pos)) return
      if (block.type.name === 'beat') beats = replaceWithin(beats, doc, pos, pos + block.nodeSize, beatDecorationsFor(block, pos, ordinal))
      labels = replaceWithin(labels, doc, pos + 1, pos + block.nodeSize - 1, labelDecorationsFor(block, pos, labelFor))
    })
  }

  const next = ghostFor(doc)
  const ghost = next.key === previous.ghostKey && !structural ? previous.ghost.map(tr.mapping, doc) : DecorationSet.create(doc, [...next.decorations])

  const shape = shapeOf(doc, labelFor)
  return { labelFor, beats, ghost, labels, ghostKey: next.key, shape: sameShape(shape, previous.shape) ? previous.shape : shape }
}

/** One of the three sets, presented to ProseMirror as its own plugin so the sets are never merged by hand. */
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

export const OutlineDecorations = Extension.create<OutlineDecorationsOptions>({
  name: 'outlineDecorations',
  addOptions() {
    return { labelFor: () => undefined, onShape: undefined }
  },
  addProseMirrorPlugins() {
    const { labelFor, onShape } = this.options
    return [
      new Plugin<DecorationsState>({
        key: outlineDecorationsKey,
        state: {
          init: (_config, state) => build(state, labelFor),
          apply: (tr, previous, _old, state) => apply(tr, previous, state),
        },
        view: () => ({
          update: (view, previous) => {
            const now = outlineDecorationsKey.getState(view.state)?.shape
            const before = outlineDecorationsKey.getState(previous)?.shape
            if (now !== undefined && now !== before) onShape?.(now)
          },
        }),
      }),
      presenter('outlineBeats', (current) => current.beats),
      presenter('outlineGhost', (current) => current.ghost),
      presenter('outlineLabels', (current) => current.labels),
    ]
  },
})

/** The plugin's current counts. */
export const outlineShapeOf = (state: EditorState): OutlineShape | undefined => outlineDecorationsKey.getState(state)?.shape

/** Hand the sheet a new label book: every label and count is redrawn once, outside history. */
export const labelBookTransaction = (state: EditorState, labelFor: LabelFor): Transaction =>
  state.tr.setMeta(outlineDecorationsKey, { labelFor }).setMeta('addToHistory', false)
