import type { NodeId } from './ids'
import type { CommentNode, ScreenplayNode } from './node'

/**
 * The renderable node stream.
 *
 * AGENTS.md states the same rule three times, in three sections: comment nodes
 * "occupy zero page space", their "presence can never change a page count", and
 * "Comments never enter an export". This module is the one place that rule is
 * implemented, so pagination, export and derivation cannot each get it
 * slightly differently.
 *
 * This is not pagination and it measures nothing. It answers one question -
 * which nodes are visible to anything downstream - and returns a type that
 * cannot contain a comment, so "I forgot to filter comments" is a compile
 * error at the consumer rather than a page-count bug.
 */

/** Everything except a comment. Note that `CommentNode` is not assignable. */
export type RenderableNode = Exclude<ScreenplayNode, CommentNode>

export const isCommentNode = (node: ScreenplayNode): node is CommentNode => node.type === 'comment'

const isRenderable = (node: ScreenplayNode): node is RenderableNode => node.type !== 'comment'

export const renderableNodes = (nodes: readonly ScreenplayNode[]): readonly RenderableNode[] =>
  nodes.filter(isRenderable)

/** The length metric a comment must never move. */
export const renderableCount = (nodes: readonly ScreenplayNode[]): number =>
  renderableNodes(nodes).length

/** The ordering metric a comment must never move. */
export const renderableOrder = (nodes: readonly ScreenplayNode[]): readonly NodeId[] =>
  renderableNodes(nodes).map((node) => node.id)

/** The count of comments themselves - the one metric a comment is allowed to move. */
export const commentCount = (nodes: readonly ScreenplayNode[]): number =>
  nodes.filter(isCommentNode).length
