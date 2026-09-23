'use server'

import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode } from '../script/gate'
import { SaveSynopsisInputSchema, saveSynopsisWith, synopsisProblem } from './core'
import type { SaveSynopsisInput } from './core'
import type { SynopsisResult } from './result'

export type { SaveSynopsisInput } from './core'

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
 * missing project - and the role, `ROLE.authoredEdit`: a synopsis is an
 * authored field, so it is a writer's (ADR 0003 D2). The body is a core
 * function (`core.ts`, roadmap task 4.2) the agent's `set_synopsis` and the
 * worker call with a gate of their own.
 *
 * There is no create, delete or reorder here, and there will not be. Scenes
 * come from headings, through derivation, and the Script route is where a
 * heading is written.
 */

export const saveSynopsis = async (raw: SaveSynopsisInput): Promise<SynopsisResult> => {
  const problem = synopsisProblem(raw)
  if (problem !== null) return problem
  const input = SaveSynopsisInputSchema.parse(raw)
  const gate = await openEpisode(input.projectId, input.episode, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveSynopsisWith(gate, raw)
  if (result.status === 'saved') revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  return result
}
