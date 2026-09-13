import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { DEFAULT_BLOCK_ATTRS, blockAttrsOf, blockTypeOf, idsOf } from '../../../../../../../../lib/outline/pm-model'

/**
 * The clipboard, and ADR 0001's paste rule in DOM terms - the Script
 * route's `clipboard.ts` over the outline's blocks.
 *
 * Every block renders `data-doc`, the id of the document it was copied
 * from (`blocks.ts`), and the parser reads it back as the transient
 * `origin` attribute. So a pasted slice says where it came from:
 *
 *   same document, id absent    keep the id - cut here, paste here is a move
 *   same document, id present   null it - a copy cannot repeat a join key
 *   another document            null it - every block is minted
 *
 * `origin` is cleared on the way through and never reaches the model. A
 * screenplay block copied from the Script route arrives as HTML no outline
 * parse rule matches, so ProseMirror keeps its text and drops its type; it
 * lands as Body, the first block in the group.
 *
 * Plain text with a newline becomes one Body block per non-empty line, each
 * unminted for the identity plugin. A single line is inserted as text.
 */

export type OutlineClipboardOptions = {
  readonly documentId: string
}

export const outlineClipboardKey = new PluginKey('outlineClipboard')

const withIdsSettled = (slice: Slice, documentId: string, present: ReadonlySet<string>): Slice => {
  let changed = false
  const nodes: ProseMirrorNode[] = []
  slice.content.forEach((node) => {
    if (blockTypeOf(node) === null) {
      nodes.push(node)
      return
    }
    const attrs = blockAttrsOf(node)
    const keep = attrs.origin === documentId && attrs.id !== null && !present.has(attrs.id)
    const id = keep ? attrs.id : null
    if (id === attrs.id && attrs.origin === null) {
      nodes.push(node)
      return
    }
    changed = true
    nodes.push(node.type.create({ ...node.attrs, id, origin: null }, node.content, node.marks))
  })
  return changed ? new Slice(Fragment.from(nodes), slice.openStart, slice.openEnd) : slice
}

export const OutlineClipboard = Extension.create<OutlineClipboardOptions>({
  name: 'outlineClipboard',
  addOptions() {
    return { documentId: '' }
  },
  addProseMirrorPlugins() {
    const { documentId } = this.options
    return [
      new Plugin({
        key: outlineClipboardKey,
        props: {
          transformPasted: (slice, view) => withIdsSettled(slice, documentId, new Set(idsOf(view.state.doc))),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (data === null) return false
            const html = data.getData('text/html')
            const text = data.getData('text/plain').replace(/\r/gu, '')
            if (html !== '' || text === '' || !text.includes('\n')) return false
            const lines = text
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== '')
            const body = view.state.schema.nodes['body']
            if (body === undefined || lines.length === 0) return false
            if (lines.length === 1) {
              view.dispatch(view.state.tr.insertText(lines[0] ?? '').scrollIntoView())
              return true
            }
            const blocks = lines.map((line) => body.create(DEFAULT_BLOCK_ATTRS, view.state.schema.text(line)))
            view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(blocks), 0, 0)).scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})
