'use server'

import type { TextExportResult } from '../workspace/export'
import { openEpisode } from '../script/gate'
import { outlineExport } from './server'

import type { DocumentId } from '@folio/script'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisodeWith } from '../script/gate'
import { outlineReadsFor, parseOutlineSave, saveOutlineWith } from './core'
import type { SaveOutlineInput } from './core'
import type { SaveOutlineResult } from './result'

export type { SaveOutlineInput } from './core'

/**
 * The Outline route's writes. The document is its own; nothing here reads
 * or writes a screenplay node, and nothing here paginates or derives.
 *
 * ## The whole list, every save
 *
 * The Script route sends a delta because a feature is half a megabyte. An
 * outline is a page or two of prose - tens of blocks - so the client sends
 * the list it holds, whole, and the server plans the fewest rows that turn
 * the stored list into it (`planNodeWrite`) and writes them in one
 * statement (`commitNodePlan`, with the tombstones for every id that left).
 * The rows are read beside the gate, so a save is the gate's round trip,
 * the write, and nothing after it.
 *
 * Last-write-wins with a conflict banner, as the script: the client sends
 * the `documents.updated_at` it last saw and the write still lands when the
 * row has moved on; the result names both stamps.
 *
 * ## The first save creates the document
 *
 * There is no "Start the outline" button (removed 2026-09-13 on the user's
 * instruction): the empty state is the editor over one blank Body block,
 * and the writer just types. So the first save arrives with
 * `documentId: null`, and this creates the `kind = 'outline'` document row
 * before planning the write against no rows - or finds one another tab
 * created in the meantime and plans against its rows. The result carries
 * the document's id and stamps so the workspace saves into it from then on.
 * No `revalidatePath`: the workspace writes the nav's row itself, and a
 * layout refresh mid-typing would hand the editor back its own document.
 *
 * ## What a save reports back
 *
 * The nav's `Outline` row prints `N acts` (the H1 count), read from this
 * document. The save returns the count from the list it just wrote so the
 * workspace can keep the row in the nav honest without a `revalidatePath`
 * over the whole layout on every keystroke.
 *
 * ## A thin action over a core function (roadmap task 4.2)
 *
 * The save itself is `saveOutlineWith` in `core.ts`, which the agent's
 * `propose_outline_edit` and the worker call with a gate of their own; the
 * action parses, runs the reads beside the cookie gate, and calls it.
 */

/**
 * Save the outline (`saveOutlineWith`). The rows are read beside the gate,
 * so a save is the gate's round trip, the write, and nothing after it.
 */
export const saveOutline = async (raw: SaveOutlineInput): Promise<SaveOutlineResult> => {
  const parsed = parseOutlineSave(raw)
  if (!parsed.ok) return parsed.result
  const input = parsed.input
  const documentId = input.documentId === null ? null : (input.documentId as DocumentId)
  const gate = await openEpisodeWith(input.projectId, input.episode, outlineReadsFor(documentId), ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  return saveOutlineWith(gate, raw, gate.extra)
}

// ---------------------------------------------------------------------------
// Export (roadmap task 2.4)
// ---------------------------------------------------------------------------

/** The episode's outline as Markdown, for the requesting user (`ROLE.export`, ADR 0003 D16). */
export const exportOutlineMarkdown = async (projectId: string, episode: string): Promise<TextExportResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.export)
  if (isRefusal(gate)) return gate
  return outlineExport(gate.scope, gate.episode)
}
