import type { NodeId } from '@folio/script'
import type { Editor, JSONContent } from '@tiptap/core'

/**
 * The panel's way into an open editor - roadmap task 3.4, ADR 0003 **D10**
 * path A. Client only.
 *
 * Until now the only channel ran the other way: the editor published its
 * selection to the panel (`use-selection.ts`). An agent's script edit needs
 * the reverse, because D10 says the node list has one writer at a time and,
 * when the writer has the document open, that writer is their editor - its
 * autosave, not a server save racing it.
 *
 * So each open Script or Outline workspace registers its document here with
 * two functions: `flush` (save what is typed, now) and `apply` (run the
 * agent's operations as one editor transaction). A proposal card that finds
 * its document registered hands the operations over instead of letting the
 * server write; one that does not, lets the server write under the
 * compare-and-swap (path B). A module cell, like the assistant's project cell:
 * the workspace and the panel share no React tree.
 */

export type EditorApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly stale: boolean }

export type EditorHandle = {
  readonly kind: 'screenplay' | 'outline'
  /** Save whatever is waiting, and resolve when the save has answered. */
  readonly flush: () => Promise<void>
  /** Apply stored operations as one transaction stamped with the run. */
  readonly apply: (ops: unknown, runId: string) => EditorApplyResult
}

const editors = new Map<string, EditorHandle>()

/** Register an open document's editor. Returns the unregister. */
export const registerEditor = (documentId: string, handle: EditorHandle): (() => void) => {
  editors.set(documentId, handle)
  return () => {
    if (editors.get(documentId) === handle) editors.delete(documentId)
  }
}

export const editorFor = (documentId: string): EditorHandle | undefined => editors.get(documentId)

/** The documents open in an editor right now. */
export const openDocuments = (): readonly string[] => [...editors.keys()]

/**
 * Replace the smallest run of top-level blocks that differs between the
 * editor's list and the one the operations produced, in **one transaction** -
 * so one ⌘Z takes the whole agent edit back, and the rest of the document
 * (and the writer's caret, when it is outside the range) is untouched.
 */
export const replaceBlocks = <N extends { readonly id: NodeId }>(
  editor: Editor,
  current: readonly N[],
  next: readonly N[],
  toBlock: (node: N) => JSONContent,
  runId: string,
): EditorApplyResult => {
  const same = (a: N | undefined, b: N | undefined): boolean => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b)
  let start = 0
  while (start < current.length && start < next.length && same(current[start], next[start])) start += 1
  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && same(current[endCurrent - 1], next[endNext - 1])) {
    endCurrent -= 1
    endNext -= 1
  }
  if (start === endCurrent && start === endNext) return { ok: true }
  const { doc } = editor.state
  let from = 0
  for (let index = 0; index < start; index += 1) from += doc.child(index).nodeSize
  let to = from
  for (let index = start; index < endCurrent; index += 1) to += doc.child(index).nodeSize
  try {
    const blocks = next.slice(start, endNext).map((node) => editor.schema.nodeFromJSON(toBlock(node)))
    const tr = editor.state.tr.replaceWith(from, to, blocks)
    tr.setMeta('folio:agent-run', runId)
    editor.view.dispatch(tr)
    return { ok: true }
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? `The editor could not take that edit (${cause.message}).` : 'The editor could not take that edit.', stale: false }
  }
}
