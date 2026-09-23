import { NodeIdSchema } from '@folio/contracts'
import { writeSceneSynopsis } from '@folio/db'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import type { EpisodeGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import type { SynopsisResult } from './result'

/**
 * The Scenes route's one write as a **core function** - roadmap task 4.2.
 * The action (`actions.ts`, whose header says what a synopsis is) parses,
 * opens the cookie gate and revalidates; the agent's `set_synopsis` and the
 * worker call this with a gate of their own. `projectId` and `episode` in the
 * input are the action's to gate on - here the gate decides both.
 */

export const SYNOPSIS_MAX = 20_000

export const SaveSynopsisInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  sceneNodeId: NodeIdSchema,
  synopsis: z.string().max(SYNOPSIS_MAX),
})

export type SaveSynopsisInput = z.input<typeof SaveSynopsisInputSchema>

export const synopsisProblem = (raw: unknown): SynopsisResult | null =>
  SaveSynopsisInputSchema.safeParse(raw).success ? null : { status: 'error', message: `A synopsis is text up to ${String(SYNOPSIS_MAX)} characters.` }

export const saveSynopsisWith = async (gate: EpisodeGate, raw: unknown): Promise<SynopsisResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const parsed = SaveSynopsisInputSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', message: `A synopsis is text up to ${String(SYNOPSIS_MAX)} characters.` }
  const input = parsed.data

  const written = await writeSceneSynopsis(gate.scope, input.sceneNodeId, input.synopsis)
  if (!written) {
    return { status: 'error', message: 'That scene has no record in this project. Reload the board.' }
  }
  const trimmed = input.synopsis.trim()
  return { status: 'saved', synopsis: trimmed === '' ? null : trimmed }
}
