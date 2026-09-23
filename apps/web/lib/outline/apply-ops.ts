import { OutlineOpSchema } from '@folio/contracts'
import { applyOutlineOps, byAgent, describeNodeOpError, runId } from '@folio/script'
import type { Editor } from '@tiptap/core'
import { z } from 'zod'

import type { EditorApplyResult } from '../agent/editor-channel'
import { replaceBlocks } from '../agent/editor-channel'
import { fromDoc, toBlock } from './pm-model'

/**
 * An agent's outline edit, applied inside the writer's open editor - the
 * outline's half of `lib/script/apply-ops.ts` (roadmap task 3.4, D10 path A).
 */
export const applyInOutlineEditor = (editor: Editor, raw: unknown, run: string): EditorApplyResult => {
  const ops = z.array(OutlineOpSchema).safeParse(raw)
  if (!ops.success) return { ok: false, message: 'The edit did not read.', stale: false }
  const current = fromDoc(editor.state.doc)
  if (!current.ok) return { ok: false, message: 'The outline on screen would not read.', stale: false }
  const next = applyOutlineOps(current.value, ops.data, byAgent(runId(run)))
  if (!next.ok) return { ok: false, message: `The outline changed since this was proposed. ${describeNodeOpError(next.error)}`, stale: true }
  return replaceBlocks(editor, current.value, next.value, toBlock, run)
}
