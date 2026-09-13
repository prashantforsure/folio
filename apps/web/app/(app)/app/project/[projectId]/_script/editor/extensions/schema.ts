import { Node } from '@tiptap/core'

/**
 * The two nodes every schema needs and Tiptap does not bundle in `@tiptap/core`:
 * the document and the text node. Written here rather than taken from
 * `@tiptap/extension-document` / `@tiptap/extension-text` because each would
 * be a dependency for six lines, and because the document's content
 * expression is the closed set's front door: `block+` admits the eight
 * screenplay blocks (`blocks.ts`) and nothing else. A `p`, a heading, a list
 * item cannot exist in this schema, so there is no normaliser to keep honest.
 */

export const ScreenplayDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
})

export const ScreenplayText = Node.create({
  name: 'text',
  group: 'inline',
})
