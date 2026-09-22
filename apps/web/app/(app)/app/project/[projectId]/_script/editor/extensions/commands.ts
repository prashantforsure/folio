import type { ScreenplayNodeType } from '@folio/script'
import { typed } from '@folio/script'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

import { ENTER_TRANSITION } from '../../../../../../../../lib/script/keyboard'
import { EMPTY_PAREN } from '../../../../../../../../lib/script/pickers'
import { DEFAULT_BLOCK_ATTRS, blockTypeOf } from '../../../../../../../../lib/script/pm-model'

/**
 * What the keyboard, the slash menu and the selectors do to a document,
 * as functions over a transaction - so the same "make this block a
 * Parenthetical" is decided once and a headless test can call it.
 *
 * Nothing here mints an id. A block these create carries `id: null`, and
 * `identity.ts` mints it in the transaction it appends. Nothing here reads
 * the DOM either; a position is a position in `tr.doc`.
 */

export type CaretBlock = {
  readonly node: ProseMirrorNode
  /** The position before the block. Its content starts at `pos + 1`. */
  readonly pos: number
  readonly index: number
  readonly type: ScreenplayNodeType
}

/** The block the selection's head is in, or `null` outside one. */
export const caretBlock = (source: EditorState | Transaction): CaretBlock | null => {
  const $from = source.selection.$from
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

/**
 * An empty block of `type`, unminted. A Parenthetical opens as `()`: the
 * parens are part of the stored text (`fountain-parse.ts` keeps them) and a
 * writer never wants to type them.
 */
export const freshBlock = (schema: Schema, type: ScreenplayNodeType): ProseMirrorNode | null => {
  const nodeType = schema.nodes[type]
  if (nodeType === undefined) return null
  return nodeType.create({ ...DEFAULT_BLOCK_ATTRS, provenance: typed() }, type === 'paren' ? schema.text(EMPTY_PAREN) : null)
}

/**
 * Change a block's type in place. The id survives (ADR 0001); a Character
 * keeps its delivery modifiers and anything else has none. A Parenthetical
 * made from an empty block opens as `()` with the caret between the parens;
 * a Parenthetical leaving for any other type sheds the wrapping parens they
 * were opened with - they framed the cue, they are not the writer's text.
 */
export const setBlockTypeAt = (tr: Transaction, pos: number, type: ScreenplayNodeType): boolean => {
  const node = tr.doc.nodeAt(pos)
  const nodeType = tr.doc.type.schema.nodes[type]
  if (node === null || nodeType === undefined || blockTypeOf(node) === null) return false
  const modifiers = type === 'character' ? node.attrs['modifiers'] : []
  const text = node.textContent
  const leavingParen =
    blockTypeOf(node) === 'paren' &&
    type !== 'paren' &&
    node.content.size === text.length &&
    text.startsWith('(') &&
    text.endsWith(')')
  tr.setNodeMarkup(pos, nodeType, { ...node.attrs, modifiers })
  if (leavingParen) {
    tr.delete(pos + 1, pos + 1 + node.content.size)
    const inner = text.slice(1, -1)
    if (inner.length > 0) tr.insertText(inner, pos + 1)
  }
  if (type === 'paren' && node.content.size === 0) {
    tr.insertText(EMPTY_PAREN, pos + 1)
    tr.setSelection(TextSelection.create(tr.doc, pos + 2))
  }
  return true
}

/** Insert `block` after the block at `pos` and put the caret in it (inside the parens of a `()`). */
export const insertBlockAfter = (tr: Transaction, pos: number, block: ProseMirrorNode): boolean => {
  const current = tr.doc.nodeAt(pos)
  if (current === null) return false
  const after = pos + current.nodeSize
  tr.insert(after, block)
  const inside = block.type.name === 'paren' && block.textContent === EMPTY_PAREN ? 1 : 0
  tr.setSelection(TextSelection.create(tr.doc, after + 1 + inside))
  return true
}

/**
 * Enter. An empty cue becomes Action (nothing to say); an opened, unfilled
 * `()` becomes Dialogue (the writer wanted the line after all); at the end
 * of a block, the block Enter's transition names opens below; anywhere
 * else the block splits and the tail is a new block of the same type,
 * unminted - the head keeps its id.
 */
export const screenplayEnter = (tr: Transaction): boolean => {
  if (!tr.selection.empty) tr.deleteSelection()
  const block = caretBlock(tr)
  if (block === null) return false
  const text = block.node.textContent
  if (text === '' && block.type === 'character') return setBlockTypeAt(tr, block.pos, 'action')
  if (text === EMPTY_PAREN && block.type === 'paren') {
    tr.delete(block.pos + 1, block.pos + 1 + block.node.content.size)
    return setBlockTypeAt(tr, block.pos, 'dialogue')
  }
  // A filled Parenthetical opens as `()` with the caret already between the
  // parens, so typing never moves it past the closing paren - true "end of
  // content" is unreachable by typing. The position the writer can reach is
  // immediately before the `)`, and that is what Enter must treat as the end
  // so the block still leaves for Dialogue (`ENTER_TRANSITION`).
  const atParenClose =
    block.type === 'paren' && text.endsWith(')') && tr.selection.$from.parentOffset === text.length - 1
  const atEnd = tr.selection.$from.parentOffset === block.node.content.size || atParenClose
  if (atEnd) {
    const next = freshBlock(tr.doc.type.schema, ENTER_TRANSITION[block.type])
    return next === null ? false : insertBlockAfter(tr, block.pos, next)
  }
  tr.split(tr.selection.from, 1, [
    { type: block.node.type, attrs: { ...block.node.attrs, id: null, provenance: typed(), origin: null } },
  ])
  return true
}

/** The text of the caret block before the caret - what `promotesToHeading` and `slashOpensAt` read. */
export const textBeforeCaret = (state: EditorState | Transaction): string => {
  const $from = state.selection.$from
  if ($from.depth < 1) return ''
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '')
}
