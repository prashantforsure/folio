import type { ScreenplayNode } from '@folio/script'
import { countFountainNodes, nodeId, parseFountain, readSlugline, serialiseFountain, unresolvedCues } from '@folio/script'

/**
 * The structural half of the eval - roadmap task 5.5. Code decides these,
 * never a model (AGENTS.md ruling R4), and each is a yes or a count:
 *
 *   - **The script parses.** Written out as Fountain and read back, it is the
 *     same element types in the same order, with no heading the parser
 *     rejects - the draft is a screenplay, not text shaped like one.
 *   - **Every cue resolves.** After the run's own re-derive, the cues that do
 *     not match a bound spelling - `unresolvedCues`, the check the pipeline's
 *     test holds at zero.
 *   - **Every scene has a heading.** The script opens on one, every heading
 *     reads as a slugline, and there is one for every scene the run's scene
 *     list planned.
 */

export type StructuralScore = {
  readonly parses: boolean
  /** Why it did not, in a line; null when it did. */
  readonly parseProblem: string | null
  readonly unresolvedCues: readonly string[]
  readonly headings: number
  /** Scenes the run's scene list planned; null when the run never got that far. */
  readonly plannedScenes: number | null
  readonly opensOnHeading: boolean
  readonly unreadableHeadings: readonly string[]
  /** All three checks. */
  readonly pass: boolean
}

const textOf = (node: ScreenplayNode): string => node.content.map((run) => (run.kind === 'text' ? run.text : '')).join('')

/** The round trip, as a yes and why not. */
export const parsesAsScreenplay = (nodes: readonly ScreenplayNode[]): { readonly ok: boolean; readonly problem: string | null } => {
  const renderable = nodes.filter((node) => node.type !== 'comment')
  const { text } = serialiseFountain(renderable)
  const needed = countFountainNodes(text)
  const back = parseFountain(text, { freshIds: Array.from({ length: needed }, (_, index) => nodeId(`eval-${String(index)}`)) })
  if (!back.ok) return { ok: false, problem: `Fountain would not read back (${back.error.kind}).` }
  if (back.value.rejectedHeadings.length > 0) return { ok: false, problem: `${String(back.value.rejectedHeadings.length)} heading(s) the parser rejects.` }
  const before = renderable.map((node) => node.type).join(' ')
  const after = back.value.nodes.filter((node) => node.type !== 'comment').map((node) => node.type).join(' ')
  return before === after ? { ok: true, problem: null } : { ok: false, problem: 'Read back as different element types.' }
}

export const scoreStructure = (nodes: readonly ScreenplayNode[], boundCues: readonly string[], plannedScenes: number | null): StructuralScore => {
  const parsed = parsesAsScreenplay(nodes)
  const renderable = nodes.filter((node) => node.type !== 'comment')
  const headings = renderable.filter((node) => node.type === 'scene')
  const unreadable = headings.map(textOf).filter((heading) => !readSlugline(heading).ok)
  const unresolved = unresolvedCues(nodes, boundCues)
  const opensOnHeading = renderable[0]?.type === 'scene'
  const everyScene = plannedScenes === null ? headings.length > 0 : headings.length >= plannedScenes
  return {
    parses: parsed.ok,
    parseProblem: parsed.problem,
    unresolvedCues: unresolved,
    headings: headings.length,
    plannedScenes,
    opensOnHeading,
    unreadableHeadings: unreadable,
    pass: parsed.ok && unresolved.length === 0 && opensOnHeading && unreadable.length === 0 && everyScene,
  }
}
