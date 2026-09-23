import type { EpisodeGate, GateRefusal } from '../script/actor-gate'
import { episodeGateOf, isRefusal } from '../script/actor-gate'
import type { ToolGate } from './registry'

/**
 * Run a core function against one episode of the turn's project - roadmap
 * task 4.2.
 *
 * A tool's operation names its episode by slug (`args.episode`), which is not
 * always the one the turn is on: a synopsis, a title page or a shot can belong
 * to any episode of the project. The turn's gate already checked membership
 * and role; this narrows it to that episode (one read, `episodeGateOf`) and
 * hands the core the episode gate - or answers with the gate's own refusal
 * when the slug is not this project's, in the words the action's cookie gate
 * would have used.
 */
export const inEpisode = async <R>(gate: ToolGate, slug: string, run: (episodeGate: EpisodeGate) => Promise<R>): Promise<R | GateRefusal> => {
  const narrowed = slug === gate.episode.slug ? gate : await episodeGateOf(gate, slug)
  return isRefusal(narrowed) ? narrowed : run(narrowed)
}
