import type { MentionEntity } from '@folio/script'
import { MENTION_ENTITIES } from '@folio/script'
import { Node, mergeAttributes } from '@tiptap/core'

import type { LabelFor } from '../../../../../../../../lib/script/inline'
import { MENTION_TYPE } from '../../../../../../../../lib/script/inline'
import { mentionAttrsOf } from '../../../../../../../../lib/script/pm-model'

/**
 * The `@mention`: an inline atom that *is* the link and *draws* the label.
 *
 * What the model stores is `{ entity, id }` - the edge `derive` reads. What
 * the sheet shows is the record's current name, looked up at render time in
 * the label book the workspace holds. The book lives on this extension's
 * storage; a rename or a new record replaces it and dispatches a `labels`
 * transaction, and `sheet-decorations.ts` puts a node decoration carrying
 * the new label on every mention whose label changed. ProseMirror then
 * calls this node view's `update` for exactly those mentions - a node whose
 * decorations did not change is matched without a visit - and the label is
 * redrawn as text. Text, not a pseudo-element, so it is selectable, found
 * by ⌘F, and copied.
 *
 * `renderText` is what the clipboard's plain-text serialiser and `getText`
 * see: the label, as `wrapText` in `@folio/script` measures it.
 */

export type MentionOptions = {
  /** The label book at creation. Replaced through the storage as the workspace learns of new records. */
  readonly labelFor: LabelFor
}

export type MentionStorage = {
  labelFor: LabelFor
}

declare module '@tiptap/core' {
  interface Storage {
    [MENTION_TYPE]: MentionStorage
  }
}

const isEntity = (value: unknown): value is MentionEntity =>
  typeof value === 'string' && (MENTION_ENTITIES as readonly string[]).includes(value)

/** The engine's placeholder for a mention whose record is gone; one character wide, as `wrapText` counts it. */
export const UNRESOLVED_LABEL = '?'

export const Mention = Node.create<MentionOptions, MentionStorage>({
  name: MENTION_TYPE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { labelFor: () => undefined }
  },
  addStorage() {
    return { labelFor: this.options.labelFor }
  },
  addAttributes() {
    return {
      entity: {
        default: 'character',
        parseHTML: (element) => {
          const value = element.getAttribute('data-entity')
          return isEntity(value) ? value : 'character'
        },
        renderHTML: (attributes) => ({ 'data-entity': String(attributes['entity']) }),
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id') ?? '',
        renderHTML: (attributes) => ({ 'data-id': String(attributes['id']) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span.folio-mention[data-entity][data-id]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const mention = mentionAttrsOf(node)
    const label = mention === null ? UNRESOLVED_LABEL : (this.storage.labelFor(mention.entity, mention.id) ?? UNRESOLVED_LABEL)
    return ['span', mergeAttributes(HTMLAttributes, { class: 'folio-mention', contenteditable: 'false' }), label]
  },
  renderText({ node }) {
    const mention = mentionAttrsOf(node)
    return mention === null ? UNRESOLVED_LABEL : (this.storage.labelFor(mention.entity, mention.id) ?? UNRESOLVED_LABEL)
  },
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span')
      dom.className = 'folio-mention'
      dom.contentEditable = 'false'
      const draw = (current: typeof node): void => {
        const mention = mentionAttrsOf(current)
        dom.dataset['entity'] = mention?.entity ?? ''
        dom.dataset['id'] = mention?.id ?? ''
        dom.textContent =
          mention === null
            ? UNRESOLVED_LABEL
            : (editor.storage[MENTION_TYPE].labelFor(mention.entity, mention.id) ?? UNRESOLVED_LABEL)
      }
      draw(node)
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== MENTION_TYPE) return false
          draw(updated)
          return true
        },
        selectNode: () => {
          dom.dataset['selected'] = 'true'
        },
        deselectNode: () => {
          delete dom.dataset['selected']
        },
        ignoreMutation: () => true,
      }
    }
  },
})
