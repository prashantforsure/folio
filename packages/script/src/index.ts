/**
 * @folio/script - the pure core.
 *
 * What is here: the node model, the two document kinds it comes in, the seven
 * operations over a node list, and Fountain in both directions.
 *
 * The operations implement AGENTS.md open decision 1 as ruled in
 * `docs/adr/0001-node-identity.md` - head-wins split with anchor re-pointing,
 * first-wins merge with a tombstone, paste that preserves ids within a
 * document and mints across one. That ruling was delegated rather than
 * reasoned out with product context, which the ADR records; treat it as
 * reversible.
 *
 * Fountain is `parseFountain` / `serialiseFountain`, with the generated-text
 * rules they share in `generated-text.ts` - the one place `(V.O.)` is told from
 * `(CONT'D)`, so that a second importer cannot get it slightly differently.
 * Because this package cannot mint an id, `parseFountain` takes `freshIds` from
 * the caller and refuses rather than inventing one.
 *
 * FDX import is `importFinalDraft`, and it takes an **already-parsed XML tree**
 * rather than a string: AGENTS.md names `fast-xml-parser` for FDX and forbids a
 * runtime dependency in this package, and the ruling was that the caller parses
 * the XML and the mapping stays pure here. It shares `generated-text.ts` with
 * Fountain, so there is one implementation of the `(V.O.)`-versus-`(CONT'D)`
 * rule and not two.
 *
 * Not here, and not blocked on anything, just later: derivation, pagination and
 * FDX *export*.
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

export type { CueReading, GeneratedArtefact, GeneratedArtefactKind } from './generated-text'
export {
  GENERATED_ARTEFACT_KINDS,
  carriesGeneratedText,
  isContinuedLine,
  isMoreLine,
  readCue,
  writeCue,
} from './generated-text'

export type { HeadingClass, RejectedHeadingReason } from './fountain-syntax'
export { classifyHeading, mentionToken } from './fountain-syntax'

export type {
  FountainParse,
  FountainParseError,
  FountainParseOptions,
  RejectedHeading,
  RejoinedContinuation,
  StrippedGeneratedText,
  UnsupportedElement,
  UnsupportedElementKind,
} from './fountain-parse'
export { UNSUPPORTED_ELEMENT_KINDS, countFountainNodes, parseFountain } from './fountain-parse'

export type {
  FountainSerialise,
  Unrepresentable,
  UnrepresentableReason,
} from './fountain-serialise'
export { serialiseFountain } from './fountain-serialise'

export type {
  CoercedParagraph,
  DiscardedField,
  FdxImport,
  FdxImportError,
  FdxImportOptions,
  FdxNode,
  FdxRejoinedContinuation,
  FdxStrippedGeneratedText,
  FdxUnsupported,
  FdxUnsupportedKind,
  HeadingNotRecognised,
} from './fdx'
export {
  FDX_DISCARDED_PAGINATION,
  FDX_UNSUPPORTED_KINDS,
  countFdxNodes,
  fdxNode,
  importFinalDraft,
} from './fdx'

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
