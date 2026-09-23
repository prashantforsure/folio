import type { MentionTarget, NodeId, ScreenplayNode } from '@folio/script'

/**
 * `search_project`'s search - roadmap task 2.5, `docs/agents/tools.md`: "node
 * content plus entity names".
 *
 * Pure: the project's nodes by episode, the records' names, and a query in;
 * the matching lines and records out, each with where it is. A case-folded
 * substring match, because the question an agent is asked is "where does she
 * say *the harbour*?", not a ranking problem. Mentions are read as the names
 * they render as, so `@Meera` matches `meera`. Scene numbers are the ones the
 * route headers print (`E2 Sc 9`, the scene's ordinal in its episode) - the
 * same count `sceneRefOf` gives. `tests/agent-tools.test.ts`.
 */

export type SearchRun = {
  readonly ordinal: number
  readonly nodes: readonly ScreenplayNode[]
}

export type SearchRecord = {
  readonly entity: 'character' | 'location' | 'prop'
  readonly id: string
  readonly name: string
}

export type LineHit = {
  readonly ref: string | null
  readonly sceneId: NodeId | null
  readonly nodeId: NodeId
  readonly type: ScreenplayNode['type']
  readonly text: string
}

export type SearchResult = {
  readonly lines: readonly LineHit[]
  /** Every line that matched, before the cut to `limit`. */
  readonly lineCount: number
  readonly records: readonly SearchRecord[]
}

/** A long line is cut around the match, so a result stays readable and small. */
const EXCERPT = 160

const excerpt = (text: string, at: number, length: number): string => {
  if (text.length <= EXCERPT) return text
  const start = Math.max(0, at - Math.floor((EXCERPT - length) / 2))
  const end = Math.min(text.length, start + EXCERPT)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

const textOf = (node: ScreenplayNode, labelFor: (target: MentionTarget) => string | undefined): string =>
  node.content.map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target) ?? ''))).join('')

export const searchProject = (
  runs: readonly SearchRun[],
  records: readonly SearchRecord[],
  query: string,
  labelFor: (target: MentionTarget) => string | undefined,
  limit = 30,
): SearchResult => {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return { lines: [], lineCount: 0, records: [] }
  const lines: LineHit[] = []
  let lineCount = 0
  for (const run of runs) {
    let scene: { readonly id: NodeId; readonly ref: string } | null = null
    let number = 0
    for (const node of run.nodes) {
      if (node.type === 'scene') {
        number += 1
        scene = { id: node.id, ref: `E${String(run.ordinal)} Sc ${String(number)}` }
      }
      const text = textOf(node, labelFor)
      const at = text.toLocaleLowerCase().indexOf(needle)
      if (at === -1) continue
      lineCount += 1
      if (lines.length < limit) {
        lines.push({ ref: scene?.ref ?? null, sceneId: scene?.id ?? null, nodeId: node.id, type: node.type, text: excerpt(text, at, needle.length) })
      }
    }
  }
  return {
    lines,
    lineCount,
    records: records.filter((record) => record.name.toLocaleLowerCase().includes(needle)),
  }
}
