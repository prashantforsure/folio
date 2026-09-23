import { ScriptOpSchema } from '@folio/contracts'
import { applyScriptOps, byAgent, describeNodeOpError, runId } from '@folio/script'
import type { Editor } from '@tiptap/core'
import { z } from 'zod'

import type { EditorApplyResult } from '../agent/editor-channel'
import { replaceBlocks } from '../agent/editor-channel'
import { fromDoc, toBlock } from './pm-model'

/**
 * An agent's script edit, applied inside the writer's open editor - roadmap
 * task 3.4, ADR 0003 **D10** path A.
 *
 * The same pure function the server would run (`applyScriptOps`), over the
 * editor's own node list as `pm-model.ts` reads it, stamped `byAgent(run)`
 * (D11); then one transaction replaces the blocks that changed. The editor's
 * `onUpdate` fires as for typing, so the workspace's autosave persists it -
 * the only writer to the node list stays the editor. An operation that no
 * longer applies to what is on screen (the writer deleted its anchor) is
 * `stale`, and nothing is dispatched.
 */
export const applyInScriptEditor = (editor: Editor, raw: unknown, run: string): EditorApplyResult => {
  const ops = z.array(ScriptOpSchema).safeParse(raw)
  if (!ops.success) return { ok: false, message: 'The edit did not read.', stale: false }
  const current = fromDoc(editor.state.doc)
  if (!current.ok) return { ok: false, message: 'The script on screen would not read.', stale: false }
  const next = applyScriptOps(current.value, ops.data, byAgent(runId(run)))
  if (!next.ok) return { ok: false, message: `The script changed since this was proposed. ${describeNodeOpError(next.error)}`, stale: true }
  return replaceBlocks(editor, current.value, next.value, toBlock, run)
}
