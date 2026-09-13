import type { OutlineNodeType } from '@folio/script'
import { typed } from '@folio/script'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

import { ENTER_TRANSITION } from '../../../../../../../../lib/outline/keyboard'
import { DEFAULT_BLOCK_ATTRS, blockTypeOf } from '../../../../../../../../lib/outline/pm-model'

/**
 * What the keyboard and the slash menu do to an outline, as functions over
 * a transaction - so "make this block a beat" is decided once and a
 * headless test can call it. The twin of `_script/editor/extensions/
 * commands.ts`.
 *
 * Nothing here mints an id. A block these create carries `id: null`, and
 * `identity.ts` mints it in the transaction it appends. Nothing here reads
 * the DOM either; a position is a position in `tr.doc`.
 *
 * ## The rule, both ways
 *
 * A rule is a leaf, so it cannot be *retyped in place* the way a heading
 * becomes body - `setNodeMarkup` refuses to put inline content in a leaf
 * or a leaf's nothing in a textblock. Becoming a rule replaces the block
 * with a rule carrying the same attributes (the id survives, ADR 0001's
 * "the block is the same block") and drops whatever text it held; the caret
 * then lands at the start of the block below, opening an empty body when
 * there is none, so the writer keeps typing under the line. Leaving a rule
 * replaces it with an empty block of the new type, same attributes.
 */

export type CaretBlock = {
  readonly node: ProseMirrorNode
  /** The position before the block. A textblock's content starts at `pos + 1`. */
  readonly pos: number
  readonly index: number
  readonly type: OutlineNodeType
}

/** The block the selection sits in - the caret's textblock, or the rule a node selection holds - or `null`. */
export const caretBlock = (source: EditorState | Transaction): CaretBlock | null => {
  const { selection } = source
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    const type = blockTypeOf(selection.node)
    return type === null ? null : { node: selection.node, pos: selection.from, index: selection.$from.index(0), type }
  }
  const $from = selection.$from
  if ($from.depth < 1) return null
  const node = $from.node(1)
  const type = blockTypeOf(node)
  if (type === null) return null
  return { node, pos: $from.before(1), index: $from.index(0), type }
}

export const blockAt = (doc: ProseMirrorNode, pos: number): CaretBlock | null => {
  const node = doc.nodeAt(pos)
  if (node === null) return null
  const type = blockTypeOf(node)
  if (type === null) return null
  return { node, pos, index: doc.resolve(pos).index(0), type }
}

/** An empty block of `type`, unminted. */
export const freshBlock = (schema: Schema, type: OutlineNodeType): ProseMirrorNode | null => {
  const nodeType = schema.nodes[type]
  if (nodeType === undefined) return null
  return nodeType.create({ ...DEFAULT_BLOCK_ATTRS, provenance: typed() })
}

/** Put the caret at the start of the block after `pos`, opening an empty body there when the block is the last. */
const caretBelow = (tr: Transaction, pos: number): void => {
  const current = tr.doc.nodeAt(pos)
  if (current === null) return
  const after = pos + current.nodeSize
  const next = tr.doc.nodeAt(after)
  if (next === null) {
    const body = freshBlock(tr.doc.type.schema, 'body')
    if (body === null) return
    tr.insert(after, body)
  } else if (next.isLeaf) {
    tr.setSelection(NodeSelection.create(tr.doc, after))
    return
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
}

/**
 * Change a block's type in place. The id survives (ADR 0001). A textblock
 * becomes another textblock by `setNodeMarkup`; a rule is replaced either
 * way, see the header.
 */
export const setBlockTypeAt = (tr: Transaction, pos: number, type: OutlineNodeType): boolean => {
  const node = tr.doc.nodeAt(pos)
  const nodeType = tr.doc.type.schema.nodes[type]
  const from = node === null ? null : blockTypeOf(node)
  if (node === null || nodeType === undefined || from === null) return false
  if (from === type) return true
  if (type === 'rule') {
    tr.replaceWith(pos, pos + node.nodeSize, nodeType.create(node.attrs))
    caretBelow(tr, pos)
    return true
  }
  if (from === 'rule') {
    tr.replaceWith(pos, pos + node.nodeSize, nodeType.create(node.attrs))
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    return true
  }
  tr.setNodeMarkup(pos, nodeType, node.attrs)
  return true
}

/** Insert `block` after the block at `pos` and put the caret in it - or on it, for a rule. */
export const insertBlockAfter = (tr: Transaction, pos: number, block: ProseMirrorNode): boolean => {
  const current = tr.doc.nodeAt(pos)
  if (current === null) return false
  const after = pos + current.nodeSize
  tr.insert(after, block)
  if (block.isLeaf) caretBelow(tr, after)
  else tr.setSelection(TextSelection.create(tr.doc, after + 1))
  return true
}

/**
 * Enter. On a selected rule, a body opens below it. An empty beat ends the
 * list - it becomes body. At the end of a block, the block Enter's
 * transition names opens below; at the start of a block with text, an
 * empty block of the same type opens above and the caret stays with the
 * text; anywhere else the block splits and the tail is a new block of the
 * same type, unminted - the head keeps its id.
 */
export const outlineEnter = (tr: Transaction): boolean => {
  const block = caretBlock(tr)
  if (block === null) return false
  if (block.type === 'rule') {
    const body = freshBlock(tr.doc.type.schema, 'body')
    return body === null ? false : insertBlockAfter(tr, block.pos, body)
  }
  if (!tr.selection.empty) tr.deleteSelection()
  const now = caretBlock(tr)
  if (now === null) return false
  if (now.type === 'beat' && now.node.content.size === 0) return setBlockTypeAt(tr, now.pos, 'body')
  const offset = tr.selection.$from.parentOffset
  if (offset === now.node.content.size) {
    const next = freshBlock(tr.doc.type.schema, ENTER_TRANSITION[now.type])
    return next === null ? false : insertBlockAfter(tr, now.pos, next)
  }
  if (offset === 0) {
    const above = freshBlock(tr.doc.type.schema, now.type)
    if (above === null) return false
    tr.insert(now.pos, above)
    tr.setSelection(TextSelection.create(tr.doc, now.pos + above.nodeSize + 1))
    return true
  }
  tr.split(tr.selection.from, 1, [{ type: now.node.type, attrs: { ...now.node.attrs, id: null, provenance: typed(), origin: null } }])
  return true
}

/**
 * Backspace at the very start of a heading, quote or beat demotes it to
 * body before it would merge into the block above. Anywhere else, and on a
 * body or a rule, this declines and the default applies.
 */
export const demoteAtStart = (tr: Transaction): boolean => {
  const { selection } = tr
  if (!selection.empty || !(selection instanceof TextSelection)) return false
  const block = caretBlock(tr)
  if (block === null || block.type === 'body' || block.type === 'rule') return false
  if (selection.$from.parentOffset !== 0) return false
  return setBlockTypeAt(tr, block.pos, 'body')
}

/** `⌥↑` / `⌥↓`: swap the caret block with its neighbour, the selection travelling with it. */
export const moveBlock = (tr: Transaction, direction: -1 | 1): boolean => {
  const block = caretBlock(tr)
  if (block === null) return false
  const { doc } = tr
  const target = block.index + direction
  if (target < 0 || target >= doc.childCount) return false
  const neighbour = doc.child(target)
  const neighbourPos = direction === -1 ? block.pos - neighbour.nodeSize : block.pos + block.node.nodeSize
  const from = Math.min(block.pos, neighbourPos)
  const to = from + block.node.nodeSize + neighbour.nodeSize
  const inside = tr.selection.from - block.pos
  tr.replaceWith(from, to, direction === -1 ? [block.node, neighbour] : [neighbour, block.node])
  const movedTo = direction === -1 ? from : from + neighbour.nodeSize
  if (block.node.isLeaf) tr.setSelection(NodeSelection.create(tr.doc, movedTo))
  else tr.setSelection(TextSelection.create(tr.doc, movedTo + Math.max(1, Math.min(inside, block.node.nodeSize - 1))))
  return true
}

/** The text of the caret block before the caret - what `slashOpensAt` reads. */
export const textBeforeCaret = (state: EditorState | Transaction): string => {
  const $from = state.selection.$from
  if ($from.depth < 1) return ''
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '')
}
