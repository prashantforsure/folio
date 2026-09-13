import { Node } from '@tiptap/core'

/**
 * The document and the text node for the outline schema. Six lines each,
 * written here for the same reason `_script/editor/extensions/schema.ts`
 * writes its own: the content expression is the closed set's front door.
 * `block+` admits the seven outline blocks (`blocks.ts`) and nothing else -
 * no `p`, no heading, no list item, and no screenplay block - so there is
 * no normaliser to keep honest.
 */

export const OutlineDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
})

export const OutlineText = Node.create({
  name: 'text',
  group: 'inline',
})
