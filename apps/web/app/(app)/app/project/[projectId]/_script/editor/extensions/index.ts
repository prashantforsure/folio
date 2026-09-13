import type { MentionEntity, MentionLabel, NodeId } from '@folio/script'
import type { Extensions } from '@tiptap/core'

import type { IdentityLog } from '../../../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../../../lib/script/inline'
import type { SheetLayout } from '../../../../../../../../lib/script/layout'
import type { EditorStore } from '../editor-store'
import { blockExtensions } from './blocks'
import { ScreenplayClipboard } from './clipboard'
import { ScreenplayIdentity } from './identity'
import { ScreenplayKeymap } from './keymap'
import { Mention } from './mention'
import { ScreenplayMentionSuggestion } from './mention-suggestion'
import { ScreenplayPickers } from './pickers'
import { ScreenplayDocument, ScreenplayText } from './schema'
import { SheetDecorations } from './sheet-decorations'
import type { SheetInputs } from './sheet-decorations'
import { ScreenplaySlash } from './slash'

/**
 * Tiptap, configured to express exactly `@folio/script`'s union and nothing
 * more.
 *
 * The document, the text node, eight blocks, one inline atom, and six
 * extensions of our own. **No other Tiptap extension.** No StarterKit, no
 * paragraph, no heading, no marks, no page-break node - AGENTS.md:
 * "Pagination is ours, not Plate's", and it is not Tiptap's either. No
 * `UniqueID` extension: it would make Tiptap an id authority, and
 * `identity.ts` is the only minter.
 *
 * Priorities, highest first: the slash menu and the `@` combobox (1100)
 * own Enter, Tab and the arrows while open; the selectors (1099) own them
 * next; the screenplay keymap (1000) has them otherwise; Tiptap's core
 * keymap (100) never sees Enter.
 */

export type ScreenplayEditorOptions = {
  readonly documentId: string
  readonly mint: () => NodeId
  readonly log: IdentityLog
  readonly store: EditorStore
  readonly labelFor: LabelFor
  /** The label book as the workspace currently holds it; read, never copied. */
  readonly labels: () => readonly MentionLabel[]
  readonly onCreateMention: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
  readonly sheet: SheetInputs
  readonly onLayout: (layout: SheetLayout) => void
  readonly onIds: (ids: readonly string[]) => void
}

export const screenplayExtensions = (options: ScreenplayEditorOptions): Extensions => [
  ScreenplayDocument,
  ScreenplayText,
  ...blockExtensions({ documentId: options.documentId }),
  Mention.configure({ labelFor: options.labelFor }),
  ScreenplayIdentity.configure({ mint: options.mint, log: options.log, onIds: options.onIds }),
  ScreenplayClipboard.configure({ documentId: options.documentId, mint: options.mint }),
  ScreenplayKeymap,
  ScreenplaySlash.configure({ store: options.store }),
  ScreenplayMentionSuggestion.configure({ store: options.store, labels: options.labels, onCreate: options.onCreateMention }),
  ScreenplayPickers.configure({ store: options.store, labels: options.labels }),
  SheetDecorations.configure({ inputs: options.sheet, onLayout: options.onLayout }),
]

export type { SheetInputs } from './sheet-decorations'
export { sheetInputsTransaction, sheetLayoutOf } from './sheet-decorations'
export { blockIds } from './identity'
export { caretBlock } from './commands'
