import type { NodeId } from '@folio/script'
import { countFountainNodes, nodeId, parseFountain } from '@folio/script'
import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { blockAttrsOf, blockTypeOf, idsOf, toBlock } from '../../../../../../../../lib/script/pm-model'

/**
 * The clipboard, and ADR 0001's paste rule in DOM terms.
 *
 * Every block renders `data-doc`, the id of the document it was copied
 * from (`blocks.ts`), and the parser reads it back as the transient `origin`
 * attribute. So a pasted slice says where it came from, and this decides:
 *
 *   same document, id absent    keep the id - cut here, paste here is a move
 *   same document, id present   null it - copy here, paste here cannot
 *                               repeat a join key; `identity.ts` mints
 *   another document            null it - every block is minted
 *
 * `origin` is cleared on the way through and never reaches the model.
 *
 * Plain text with a newline is parsed as Fountain - parser parity with the
 * import path - with ids minted here for every node the parser will need,
 * and inserted as blocks. A single line is inserted as text by ProseMirror.
 * Text that Fountain refuses is inserted as one line, its whitespace folded.
 */

export type ClipboardOptions = {
  readonly documentId: string
  readonly mint: () => NodeId
}

export const clipboardKey = new PluginKey('screenplayClipboard')

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

export const ScreenplayClipboard = Extension.create<ClipboardOptions>({
  name: 'screenplayClipboard',
  addOptions() {
    return { documentId: '', mint: () => nodeId('unminted') }
  },
  addProseMirrorPlugins() {
    const { documentId, mint } = this.options
    return [
      new Plugin({
        key: clipboardKey,
        props: {
          transformPasted: (slice, view) => withIdsSettled(slice, documentId, new Set(idsOf(view.state.doc))),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (data === null) return false
            const html = data.getData('text/html')
            const text = data.getData('text/plain').replace(/\r/gu, '')
            if (html !== '' || text === '' || !text.includes('\n')) return false
            const needed = countFountainNodes(text)
            const parsed = parseFountain(text, { freshIds: Array.from({ length: needed }, () => mint()) })
            if (!parsed.ok || parsed.value.nodes.length === 0) {
              view.dispatch(view.state.tr.insertText(text.replace(/\s+/gu, ' ')).scrollIntoView())
              return true
            }
            const blocks = parsed.value.nodes.map((node) => view.state.schema.nodeFromJSON(toBlock(node)))
            view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(blocks), 0, 0)).scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})
