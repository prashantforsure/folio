import { nodeId } from '@folio/script'
import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

import type { IdentityOptions } from '../../../_script/editor/extensions/identity'
import { identityKey, identityPlugin } from '../../../_script/editor/extensions/identity'
import { idsOf } from '../../../../../../../../lib/outline/pm-model'

/**
 * Node identity on the outline: ADR 0001, enforced at the one door every
 * change uses - the same plugin the Script route runs.
 *
 * The rules are the document's, not the block set's. The head keeps its id
 * on a split, the first block wins a merge, a deleted id is retired, a
 * pasted id is kept only if absent - and the plugin that states them reads
 * nothing but `id`, `provenance` and `origin` off the top-level blocks,
 * which the seven carry exactly as the eight do. So it is *reused*, not
 * twinned: one minter, one merge log, one set of rules, and a change to
 * ADR 0001 lands on both editors at once.
 */

export const OutlineIdentity = Extension.create<IdentityOptions>({
  name: 'outlineIdentity',
  addOptions() {
    return { mint: () => nodeId('unminted'), log: { mergedInto: new Map(), minted: new Set() }, onIds: undefined }
  },
  addProseMirrorPlugins() {
    return [identityPlugin(this.options)]
  },
})

/** The block ids in order, as the plugin last saw them. */
export const blockIds = (state: EditorState): readonly string[] => identityKey.getState(state)?.ids ?? idsOf(state.doc)
