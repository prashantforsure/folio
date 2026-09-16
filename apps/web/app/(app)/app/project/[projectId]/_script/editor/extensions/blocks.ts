import type { DeliveryModifier, Provenance, ScreenplayNodeType } from '@folio/script'
import { DELIVERY_MODIFIERS, SCREENPLAY_NODE_TYPES, runId as toRunId, typed } from '@folio/script'
import type { Attributes } from '@tiptap/core'
import { Node, mergeAttributes } from '@tiptap/core'

import type { BlockAttrs } from '../../../../../../../../lib/script/pm-model'
import { BLOCK_TYPE_COVERAGE } from '../../../../../../../../lib/script/pm-model'

/**
 * The eight block nodes, one per `ScreenplayNodeType`, from one factory.
 *
 * Each is a ProseMirror textblock in the `block` group holding `inline*`
 * with **no marks** - the union has no bold, no italic, and the schema will
 * not build one. The DOM is the same `div.folio-block[data-type]` the sheet
 * has always drawn, so `globals.css`'s insets and the browser walk's
 * selectors are untouched, and it is `toDOM`, not a NodeView: three
 * thousand blocks are three thousand divs ProseMirror patches in place, and
 * React never sees a keystroke.
 *
 * ## Attributes, and what happens to them on a split
 *
 * Every attribute is `keepOnSplit: false`. Tiptap's `splitBlock` then gives
 * the tail a `null` id and the defaults, and `identity.ts` mints the tail -
 * ADR 0001's "head keeps its id". A raw ProseMirror `split` copies the
 * attributes instead; the duplicate it makes is caught by the same plugin,
 * which keeps the first occurrence. Either way the head wins.
 *
 * `data-doc` on every rendered block is the document id, so a paste can
 * tell a move within this document from a copy from elsewhere
 * (`clipboard.ts`). It is read back into the transient `origin` attribute
 * and never written to the model.
 *
 * ## Order
 *
 * Action is registered first. ProseMirror fills `block+` with the first
 * member of the group when it has to make something up - a paste of foreign
 * HTML, a fragment that opens mid-block - and a stray paragraph is an
 * Action, never a Scene heading.
 */

export type BlockOptions = {
  /** The document these blocks belong to, stamped on the DOM as `data-doc`. */
  readonly documentId: string
}

const ORDER: readonly ScreenplayNodeType[] = [
  'action',
  ...SCREENPLAY_NODE_TYPES.filter((type) => type !== 'action'),
]

const writeProvenance = (provenance: Provenance): string =>
  provenance.source === 'typed' ? 'typed' : `agent:${provenance.runId}`

const readProvenance = (value: string | null): Provenance => {
  if (value === null || value === 'typed' || !value.startsWith('agent:')) return typed()
  const raw = value.slice('agent:'.length)
  return raw === '' ? typed() : { source: 'agent', runId: toRunId(raw) }
}

const readModifiers = (value: string | null): readonly DeliveryModifier[] =>
  value === null || value === ''
    ? []
    : value
        .split(',')
        .filter((entry): entry is DeliveryModifier => (DELIVERY_MODIFIERS as readonly string[]).includes(entry))

const blockAttributes = (): Attributes => ({
  id: {
    default: null,
    keepOnSplit: false,
    parseHTML: (element) => element.getAttribute('data-node-id'),
    renderHTML: (attributes) => {
      const id = (attributes as Partial<BlockAttrs>).id
      // `id="n-<uuid>"` beside `data-node-id`: the sidebar's scene rows link
      // to `#n-<uuid>`, and a fragment needs an element id to land on.
      return typeof id === 'string' ? { 'data-node-id': id, id: `n-${id}` } : {}
    },
  },
  provenance: {
    default: typed(),
    keepOnSplit: false,
    parseHTML: (element) => readProvenance(element.getAttribute('data-provenance')),
    renderHTML: (attributes) => {
      const provenance = (attributes as Partial<BlockAttrs>).provenance
      return provenance === undefined ? {} : { 'data-provenance': writeProvenance(provenance) }
    },
  },
  modifiers: {
    default: [],
    keepOnSplit: false,
    parseHTML: (element) => readModifiers(element.getAttribute('data-modifiers')),
    renderHTML: (attributes) => {
      const modifiers = (attributes as Partial<BlockAttrs>).modifiers
      return modifiers === undefined || modifiers.length === 0 ? {} : { 'data-modifiers': modifiers.join(',') }
    },
  },
  origin: {
    default: null,
    keepOnSplit: false,
    rendered: false,
    parseHTML: (element) => element.getAttribute('data-doc'),
  },
})

const screenplayBlock = (type: ScreenplayNodeType) =>
  Node.create<BlockOptions>({
    name: type,
    group: 'block',
    content: 'inline*',
    marks: '',
    // The model keeps whitespace verbatim - a dialogue run holds `\n` - and
    // the sheet draws `white-space: pre`, so a copy must parse back the same.
    whitespace: 'pre',
    addOptions() {
      return { documentId: '' }
    },
    addAttributes() {
      return blockAttributes()
    },
    parseHTML() {
      return type === 'action'
        ? [{ tag: `div[data-type="${type}"]` }, { tag: 'p', priority: 40 }]
        : [{ tag: `div[data-type="${type}"]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, { class: 'folio-block', 'data-type': type, 'data-doc': this.options.documentId }),
        0,
      ]
    },
  })

type BlockNode = ReturnType<typeof screenplayBlock>

/**
 * The eight, keyed by type - written out, not built from a list, so a
 * ninth member of the union is a missing property here and the file stops
 * compiling before a block can be typed without an inset.
 */
export const BLOCK_NODES: Readonly<Record<ScreenplayNodeType, BlockNode>> = {
  action: screenplayBlock('action'),
  scene: screenplayBlock('scene'),
  character: screenplayBlock('character'),
  paren: screenplayBlock('paren'),
  dialogue: screenplayBlock('dialogue'),
  transition: screenplayBlock('transition'),
  comment: screenplayBlock('comment'),
  subtitle: screenplayBlock('subtitle'),
}

/** In registration order - Action first, see the header. */
export const blockExtensions = (options: BlockOptions): readonly BlockNode[] =>
  ORDER.map((type) => BLOCK_NODES[BLOCK_TYPE_COVERAGE[type]].configure(options))
