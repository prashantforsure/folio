import type { LabelBook, RenderableNode, ScreenplayNode, ScreenplayNodeType } from '@folio/script'
import { isCommentNode, readSlugline } from '@folio/script'
import type { NodeId, SluglineRejection } from '@folio/script'

/**
 * A scene's text, cut out of the node list. Pure; no table is read here.
 *
 * ## What an excerpt is
 *
 * AGENTS.md's brief for the route: "Each card carries a real script excerpt,
 * not a summary. Actual lines from the node list." A line here is a *node* -
 * the heading, an action, a cue, a parenthetical, a speech - with its inline
 * runs flattened to text. It is not a rendered, wrapped line: wrapping is the
 * pagination engine's and its result is on the measurement record, which this
 * file never touches.
 *
 * ## Where a scene ends
 *
 * A scene runs from its heading node to the next heading that derivation
 * accepted. That set - the present scenes' node ids - is passed in from the
 * `scene_derivations` rows, so this file does not decide what a scene is; it
 * cuts along lines derivation already drew. A scene-typed node derivation did
 * not accept is not a boundary: `derive.ts` says "the nodes after a demoted
 * heading go on belonging to the scene they were in", and the same rule holds
 * here, so the demoted heading appears inside its scene's excerpt as the text
 * the writer typed.
 *
 * Comment nodes are skipped: they occupy zero page space and never reach an
 * export (AGENTS.md, The node model), and an excerpt is a view of the page.
 */

export type ExcerptLine = {
  readonly id: NodeId
  readonly type: Exclude<ScreenplayNodeType, 'comment'>
  readonly text: string
}

export type SceneExcerpt = {
  readonly sceneNodeId: NodeId
  /** Every renderable node of the scene, heading first. */
  readonly lines: readonly ExcerptLine[]
}

/**
 * A scene-typed node that is not a scene.
 *
 * Derivation refused its heading and the refusal is data, not an exception
 * (AGENTS.md, Conventions > Errors). `readSlugline` is the same function
 * `derive.ts` called to refuse it, so the reason shown is the reason it was
 * refused - not a second opinion formed here. `accepted` covers the other way
 * a scene node can lack a derived row: the row has not been written yet.
 */
export type UnacceptedHeading = {
  readonly nodeId: NodeId
  readonly text: string
  readonly why: SluglineRejection | { readonly kind: 'not-derived' }
}

/** Inline runs, flattened. A mention prints as `@Name`; an unlabelled one as `@?`. */
export const lineText = (node: RenderableNode, labels: LabelBook): string =>
  node.content
    .map((run) => (run.kind === 'text' ? run.text : `@${labels.labelFor(run.target) ?? '?'}`))
    .join('')

/** How many lines a card shows before the fade. The bundle draws six to eight. */
export const CARD_EXCERPT_LINES = 8

export const cutExcerpts = (
  nodes: readonly ScreenplayNode[],
  presentSceneIds: readonly NodeId[],
  labels: LabelBook,
): { readonly excerpts: ReadonlyMap<NodeId, SceneExcerpt>; readonly unaccepted: readonly UnacceptedHeading[] } => {
  const present = new Set<NodeId>(presentSceneIds)
  const excerpts = new Map<NodeId, SceneExcerpt>()
  const unaccepted: UnacceptedHeading[] = []

  let current: { readonly sceneNodeId: NodeId; readonly lines: ExcerptLine[] } | null = null

  for (const node of nodes) {
    if (isCommentNode(node)) continue
    const text = lineText(node, labels)
    if (node.type === 'scene') {
      if (present.has(node.id)) {
        if (current !== null) excerpts.set(current.sceneNodeId, current)
        current = { sceneNodeId: node.id, lines: [{ id: node.id, type: 'scene', text }] }
        continue
      }
      const reading = readSlugline(text)
      unaccepted.push({
        nodeId: node.id,
        text,
        why: reading.ok ? { kind: 'not-derived' } : reading.error,
      })
    }
    // Before the first heading there is no scene to belong to.
    if (current !== null) current.lines.push({ id: node.id, type: node.type, text })
  }
  if (current !== null) excerpts.set(current.sceneNodeId, current)
  return { excerpts, unaccepted }
}
