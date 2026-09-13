import type { NodeId } from '@folio/script'
import type { Extensions } from '@tiptap/core'

import type { OutlineShape } from '../../../../../../../../lib/outline/pm-model'
import type { IdentityLog } from '../../../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../../../lib/script/inline'
import { Mention } from '../../../_script/editor/extensions/mention'
import type { OutlineStore } from '../outline-store'
import { blockExtensions } from './blocks'
import { OutlineClipboard } from './clipboard'
import { OutlineDecorations } from './decorations'
import { OutlineIdentity } from './identity'
import { OutlineKeymap } from './keymap'
import { OutlineDocument, OutlineText } from './schema'
import { OutlineSlash } from './slash'

/**
 * Tiptap, configured to express exactly `@folio/script`'s outline union
 * and nothing more.
 *
 * The document, the text node, seven blocks, one inline atom, and five
 * extensions of our own. **No other Tiptap extension.** No StarterKit, no
 * paragraph, no heading, no list, no marks - the bundle's Bold / Italic have
 * no inline run to land in and are not built. No `UniqueID`: `identity.ts`
 * is the only minter.
 *
 * The `@mention` atom is the Script route's, shared: what it stores and
 * draws is the same edge on either document, and it is not a block. The
 * two block sets share nothing (`blocks.ts`).
 *
 * Priorities, highest first: the slash menu (1100) owns Enter, Tab and the
 * arrows while open; the outline keymap (1000) has them otherwise; Tiptap's
 * core keymap (100) never sees Enter.
 */

export type OutlineEditorOptions = {
  readonly documentId: string
  readonly mint: () => NodeId
  readonly log: IdentityLog
  readonly store: OutlineStore
  readonly labelFor: LabelFor
  readonly onIds: (ids: readonly string[]) => void
  readonly onShape: (shape: OutlineShape) => void
}

export const outlineExtensions = (options: OutlineEditorOptions): Extensions => [
  OutlineDocument,
  OutlineText,
  ...blockExtensions({ documentId: options.documentId }),
  Mention.configure({ labelFor: options.labelFor }),
  OutlineIdentity.configure({ mint: options.mint, log: options.log, onIds: options.onIds }),
  OutlineClipboard.configure({ documentId: options.documentId }),
  OutlineKeymap,
  OutlineSlash.configure({ store: options.store }),
  OutlineDecorations.configure({ labelFor: options.labelFor, onShape: options.onShape }),
]

export { labelBookTransaction, outlineShapeOf } from './decorations'
export { blockIds } from './identity'
export { caretBlock } from './commands'
