import { ASK_SELECTION_MAX } from '@folio/contracts'
import type { EditorState } from '@tiptap/pm/state'

/**
 * The editor selection as the assistant is told it - roadmap task 2.6.
 *
 * The ids of the blocks a selection touches, in document order: every block
 * between its ends, or the caret's own block when it is collapsed. Both
 * editors carry a node's id as the block's `id` attribute (`lib/script/pm-model.ts`,
 * `lib/outline/pm-model.ts`), so one function serves both. Ids only - the
 * server reads the words from the stored document. Capped at
 * `ASK_SELECTION_MAX`; a selection that long is a whole act, and its first
 * blocks say where it is. Pure; `tests/assistant-selection.test.ts`.
 */
export const selectedNodeIds = (state: EditorState): readonly string[] => {
  const { from, to, empty } = state.selection
  const ids: string[] = []
  const seen = new Set<string>()
  state.doc.nodesBetween(from, empty ? from : to, (node) => {
    if (ids.length >= ASK_SELECTION_MAX) return false
    const id: unknown = node.attrs['id']
    if (node.isBlock && typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
    // A text block's children are runs and mentions; nothing below it has an id.
    return !node.isTextblock
  })
  return ids
}

/** Whether two id lists are the same selection - the editors publish only a change. */
export const sameSelection = (a: readonly string[] | null, b: readonly string[]): boolean =>
  a !== null && a.length === b.length && a.every((id, index) => id === b[index])
