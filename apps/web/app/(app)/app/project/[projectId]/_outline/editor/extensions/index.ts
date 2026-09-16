import type { MentionEntity, MentionLabel, NodeId, OutlineHeading } from '@folio/script'
import type { Extensions } from '@tiptap/core'

import type { OutlineShape } from '../../../../../../../../lib/outline/pm-model'
import type { IdentityLog } from '../../../../../../../../lib/script/identity'
import type { OnHandleMenu } from '../../../_script/editor/extensions/handles'
import { Mention } from '../../../_script/editor/extensions/mention'
import { ScreenplayMentionSuggestion } from '../../../_script/editor/extensions/mention-suggestion'
import type { HostRegistry } from '../../../_script/editor/extensions/sheet-decorations'
import type { OutlineStore } from '../outline-store'
import { blockExtensions } from './blocks'
import { OutlineClipboard } from './clipboard'
import { OutlineDecorations } from './decorations'
import type { OutlineInputs } from './decorations'
import { OutlineIdentity } from './identity'
import { OutlineKeymap } from './keymap'
import { OutlineDocument, OutlineText } from './schema'
import { OutlineSlash } from './slash'

/**
 * Tiptap, configured to express exactly `@folio/script`'s outline union
 * and nothing more.
 *
 * The document, the text node, seven blocks, one inline atom, and six
 * extensions of our own. **No other Tiptap extension.** No StarterKit, no
 * paragraph, no heading, no list, no marks - the mockup's bold lead is a
 * decoration over the first colon and Bold / Italic have no inline run to
 * land in. No `UniqueID`: `identity.ts` is the only minter. No drop-cursor:
 * the `⠿` handle rides on ProseMirror's own drag-and-drop (flagged with the
 * Script's).
 *
 * Shared with the Script route, not twinned: the `@mention` atom and its
 * `@` combobox (`mention-suggestion.ts` - the v2 mockup's hint "Mention a
 * character or location to keep it linked" is true here since the
 * Outline's v2 pass), the identity plugin, the block handles. The two
 * block sets share nothing (`blocks.ts`).
 *
 * Priorities, highest first: the slash menu and the `@` combobox (1100)
 * own Enter, Tab and the arrows while open; the outline keymap (1000) has
 * them otherwise; Tiptap's core keymap (100) never sees Enter.
 */

export type OutlineEditorOptions = {
  readonly documentId: string
  readonly mint: () => NodeId
  readonly log: IdentityLog
  readonly store: OutlineStore
  readonly inputs: OutlineInputs
  /** The label book as the workspace currently holds it, for the `@` combobox. */
  readonly labels: () => readonly MentionLabel[]
  readonly onCreateMention: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
  readonly hosts: HostRegistry
  readonly onHandleMenu: OnHandleMenu
  readonly onIds: (ids: readonly string[]) => void
  readonly onShape: (shape: OutlineShape) => void
  readonly onHeadings: (headings: readonly OutlineHeading[]) => void
}

export const outlineExtensions = (options: OutlineEditorOptions): Extensions => [
  OutlineDocument,
  OutlineText,
  ...blockExtensions({ documentId: options.documentId }),
  Mention.configure({ labelFor: options.inputs.labelFor }),
  OutlineIdentity.configure({ mint: options.mint, log: options.log, onIds: options.onIds }),
  OutlineClipboard.configure({ documentId: options.documentId }),
  OutlineKeymap,
  OutlineSlash.configure({ store: options.store }),
  ScreenplayMentionSuggestion.configure({ store: options.store, labels: options.labels, onCreate: options.onCreateMention }),
  OutlineDecorations.configure({
    inputs: options.inputs,
    hosts: options.hosts,
    onHandleMenu: options.onHandleMenu,
    onShape: options.onShape,
    onHeadings: options.onHeadings,
  }),
]

export type { OutlineInputs } from './decorations'
export { labelBookTransaction, outlineHeadingsOf, outlineInputsTransaction, outlineShapeOf } from './decorations'
export { blockIds } from './identity'
export { caretBlock } from './commands'
