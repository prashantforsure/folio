import type { NodeId, ScreenplayNode } from '@folio/script'

/**
 * The scene's own nodes, heading first, cut at the next present heading.
 *
 * The cut follows derivation's lines exactly as the Scenes excerpt does: a
 * scene runs to the next heading derivation accepted, and a demoted heading
 * stays inside the scene as the text the writer typed. Shared by the
 * Storyboard's "propose shots for this scene" and Production's "propose
 * shots for this reel" - one cut, one proposer, two buttons.
 */
export const cutScene = (
  nodes: readonly ScreenplayNode[],
  sceneNodeId: NodeId,
  presentSceneIds: ReadonlySet<string>,
): readonly ScreenplayNode[] => {
  const start = nodes.findIndex((node) => node.id === sceneNodeId)
  if (start === -1) return []
  const out: ScreenplayNode[] = []
  for (let index = start; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node === undefined) break
    if (index > start && node.type === 'scene' && presentSceneIds.has(node.id as string)) break
    out.push(node)
  }
  return out
}
