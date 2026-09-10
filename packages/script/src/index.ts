/**
 * @folio/script - the pure core.
 *
 * What is here: the node model, the two document kinds it comes in, and the
 * seven operations over a node list.
 *
 * The operations implement AGENTS.md open decision 1 as ruled in
 * `docs/adr/0001-node-identity.md` - head-wins split with anchor re-pointing,
 * first-wins merge with a tombstone, paste that preserves ids within a
 * document and mints across one. That ruling was delegated rather than
 * reasoned out with product context, which the ADR records; treat it as
 * reversible.
 *
 * Not here, and not blocked on anything, just later: the parser, the
 * serialiser, derivation, pagination and Fountain.
 *
 * Constraints this package is under (AGENTS.md):
 *   - No React, no database, no fetch, no process.env, no Date.now(),
 *     no Math.random(). Enforced by eslint.config.mjs, not by convention.
 *   - Zero runtime dependencies, now and always.
 *   - It must run identically in the browser, in server code, in the worker
 *     and in tests.
 */
export const PACKAGE_NAME = '@folio/script'

export type { Result } from './result'
export { err, isErr, isOk, ok } from './result'

export type { CharacterId, DocumentId, LocationId, NodeId, RunId } from './ids'
export { characterId, documentId, locationId, nodeId, runId } from './ids'

export type { Provenance, ProvenanceSource } from './provenance'
export { PROVENANCE_SOURCES, byAgent, isAgentAuthored, typed } from './provenance'

export type {
  InlineContent,
  InlineKind,
  InlineRun,
  MentionEntity,
  MentionTarget,
} from './inline'
export { INLINE_KINDS, MENTION_ENTITIES, mention, mentionTargets, text } from './inline'

export type {
  ActionNode,
  CharacterNode,
  CommentNode,
  DeliveryModifier,
  DialogueNode,
  NoPagination,
  PaginationField,
  ParenNode,
  SceneNode,
  ScreenplayNode,
  ScreenplayNodeType,
  SubtitleNode,
  TransitionNode,
} from './node'
export {
  DELIVERY_MODIFIERS,
  PAGINATION_FIELDS,
  SCREENPLAY_NODE_TYPES,
  isDeliveryModifier,
  isScreenplayNodeType,
} from './node'

export type {
  BeatNode,
  BodyNode,
  H1Node,
  H2Node,
  H3Node,
  OutlineNode,
  OutlineNodeType,
  QuoteNode,
  RuleNode,
} from './outline'
export { OUTLINE_NODE_TYPES, isOutlineNodeType } from './outline'

export type { DocumentKind, FolioDocument, OutlineDocument, ScreenplayDocument } from './document'
export { DOCUMENT_KINDS, isDocumentKind } from './document'

export type { RenderableNode } from './stream'
export {
  commentCount,
  isCommentNode,
  renderableCount,
  renderableNodes,
  renderableOrder,
} from './stream'

export type { DefectReason, ModelDefect } from './read'
export {
  readOutlineDocument,
  readOutlineNode,
  readScreenplayDocument,
  readScreenplayNode,
} from './read'

export { contentLength, normaliseContent } from './inline'
export { makeScreenplayNode, modifiersOf } from './node'

export type {
  ContentPoint,
  DroppedAttribute,
  Edit,
  IdentityEvent,
  OperationError,
} from './edit'
export { edit } from './edit'

export type { Clipboard } from './operations'
export {
  changeNodeType,
  deleteNodes,
  insertNodes,
  mergeNodes,
  pasteNodes,
  reorderNode,
  splitContent,
  splitNode,
} from './operations'
