import type { OutlineNodeType, Provenance } from '@folio/script'
import { OUTLINE_NODE_TYPES, runId as toRunId, typed } from '@folio/script'
import type { Attributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { Node, mergeAttributes } from '@tiptap/core'

import type { OutlineBlockAttrs } from '../../../../../../../../lib/outline/pm-model'
import { BLOCK_TYPE_COVERAGE } from '../../../../../../../../lib/outline/pm-model'

/**
 * The seven outline blocks, one per `OutlineNodeType`, from one factory.
 * The twin of `_script/editor/extensions/blocks.ts`; no block node is
 * shared between the two schemas.
 *
 * Six are ProseMirror textblocks in the `block` group holding `inline*`
 * with **no marks**. The seventh, `rule`, is a **leaf**: no content
 * expression, `atom: true`, so the caret can select it as a node and never
 * be *inside* it. The DOM is the same `div.folio-outline-block[data-type]`
 * the sheet has always drawn, so `globals.css`'s rhythm and the E2E walk's
 * selectors are untouched, and it is `toDOM`, not a NodeView: React never
 * sees a keystroke.
 *
 * Nothing is drawn to the left of a block. The gutter rings the first
 * Outline phase carried per block are gone with the Plate editor, as the
 * Script route's sheet has nothing in its margin: no handle, no marker, no
 * label. What a beat needs - its number - is a widget inside the block's
 * own inset (`decorations.ts`), and is the beat's content, not chrome.
 *
 * ## Attributes, and what happens to them on a split
 *
 * Every attribute is `keepOnSplit: false`, so the tail of a split has a
 * `null` id and `identity.ts` mints it - ADR 0001's "head keeps its id".
 * `data-doc` on every rendered block is the document id, read back as the
 * transient `origin` attribute so a paste can tell a move from a copy
 * (`clipboard.ts`); it is never written to the model.
 *
 * ## Order
 *
 * Body is registered first. ProseMirror fills `block+` with the first
 * member of the group when it has to make something up - a paste of
 * foreign HTML, typing over a selected rule - and a stray paragraph is
 * Body, never a heading.
 */

export type OutlineBlockOptions = {
  /** The document these blocks belong to, stamped on the DOM as `data-doc`. */
  readonly documentId: string
}

const ORDER: readonly OutlineNodeType[] = ['body', ...OUTLINE_NODE_TYPES.filter((type) => type !== 'body')]

const writeProvenance = (provenance: Provenance): string =>
  provenance.source === 'typed' ? 'typed' : `agent:${provenance.runId}`

const readProvenance = (value: string | null): Provenance => {
  if (value === null || value === 'typed' || !value.startsWith('agent:')) return typed()
  const raw = value.slice('agent:'.length)
  return raw === '' ? typed() : { source: 'agent', runId: toRunId(raw) }
}

const blockAttributes = (): Attributes => ({
  id: {
    default: null,
    keepOnSplit: false,
    parseHTML: (element) => element.getAttribute('data-node-id'),
    renderHTML: (attributes) => {
      const id = (attributes as Partial<OutlineBlockAttrs>).id
      return typeof id === 'string' ? { 'data-node-id': id } : {}
    },
  },
  provenance: {
    default: typed(),
    keepOnSplit: false,
    parseHTML: (element) => readProvenance(element.getAttribute('data-provenance')),
    renderHTML: (attributes) => {
      const provenance = (attributes as Partial<OutlineBlockAttrs>).provenance
      return provenance === undefined ? {} : { 'data-provenance': writeProvenance(provenance) }
    },
  },
  origin: {
    default: null,
    keepOnSplit: false,
    rendered: false,
    parseHTML: (element) => element.getAttribute('data-doc'),
  },
})

const outlineBlock = (type: OutlineNodeType) =>
  Node.create<OutlineBlockOptions>({
    name: type,
    group: 'block',
    // A rule holds nothing; the six others hold inline runs and no marks.
    ...(type === 'rule' ? { atom: true, selectable: true } : { content: 'inline*', marks: '', whitespace: 'pre' as const }),
    addOptions() {
      return { documentId: '' }
    },
    addAttributes() {
      return blockAttributes()
    },
    parseHTML() {
      return type === 'body'
        ? [{ tag: `div[data-type="${type}"]` }, { tag: 'p', priority: 40 }]
        : [{ tag: `div[data-type="${type}"]` }]
    },
    renderHTML({ HTMLAttributes }): DOMOutputSpec {
      const attrs = mergeAttributes(HTMLAttributes, {
        class: 'folio-outline-block',
        'data-type': type,
        'data-doc': this.options.documentId,
      })
      if (type === 'rule') return ['div', attrs, ['span', { class: 'folio-outline-rule' }]]
      if (type === 'quote') return ['div', attrs, ['div', { class: 'folio-outline-quote' }, 0]]
      return ['div', attrs, 0]
    },
  })

type OutlineBlockNode = ReturnType<typeof outlineBlock>

/** The seven, keyed by type - written out so an eighth member of the union is a missing property here. */
export const BLOCK_NODES: Readonly<Record<OutlineNodeType, OutlineBlockNode>> = {
  body: outlineBlock('body'),
  h1: outlineBlock('h1'),
  h2: outlineBlock('h2'),
  h3: outlineBlock('h3'),
  quote: outlineBlock('quote'),
  rule: outlineBlock('rule'),
  beat: outlineBlock('beat'),
}

/** In registration order - Body first, see the header. */
export const blockExtensions = (options: OutlineBlockOptions): readonly OutlineBlockNode[] =>
  ORDER.map((type) => BLOCK_NODES[BLOCK_TYPE_COVERAGE[type]].configure(options))
