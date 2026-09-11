'use server'

import { NodeIdSchema } from '@folio/contracts'
import { writeSceneSynopsis } from '@folio/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openEpisode } from '../script/gate'
import type { SynopsisResult } from './result'

/**
 * The Scenes route's writes. There is one.
 *
 * The synopsis is authored data on a derived row (AGENTS.md, Derivation), and
 * it lives on `scenes` - never on the node, never in the document. Saving it
 * runs no pipeline: nothing about the script changed, so there is nothing to
 * re-measure or re-derive, and a re-derive that *does* run later leaves the
 * row alone because `commitDerivation` never touches `scenes`.
 *
 * The gate is the Script route's (`gate.ts`): identity, membership, scope,
 * project, episode - the same order, the same refusal for a stranger and a
 * missing project. Membership, not role: `memberships.role` is enforced
 * nowhere yet (`docs/build-decisions.md`), and this is not the place to start.
 *
 * There is no create, delete or reorder here, and there will not be. Scenes
 * come from headings, through derivation, and the Script route is where a
 * heading is written.
 */

const SYNOPSIS_MAX = 20_000

const SaveSynopsisInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  sceneNodeId: NodeIdSchema,
  synopsis: z.string().max(SYNOPSIS_MAX),
})

export type SaveSynopsisInput = z.input<typeof SaveSynopsisInputSchema>

export const saveSynopsis = async (raw: SaveSynopsisInput): Promise<SynopsisResult> => {
  const parsed = SaveSynopsisInputSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 'error', message: `A synopsis is text up to ${String(SYNOPSIS_MAX)} characters.` }
  }
  const input = parsed.data
  const gate = await openEpisode(input.projectId, input.episode)
  if (isRefusal(gate)) return gate

  const written = await writeSceneSynopsis(gate.scope, input.sceneNodeId, input.synopsis)
  if (!written) {
    return { status: 'error', message: 'That scene has no record in this project. Reload the board.' }
  }
  revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  const trimmed = input.synopsis.trim()
  return { status: 'saved', synopsis: trimmed === '' ? null : trimmed }
}
