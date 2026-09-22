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
 * Derivation is `derive` - one function, one implementation, which is what makes
 * the speculative pass trustworthy. It takes the previously derived entities and
 * reconciles rather than rebuilding, so authored data hanging off a derived row
 * survives a re-derive; and like everything else here it cannot mint an id, so
 * new records take theirs from `freshIds` and `countDerivationIds` says how many
 * before any is spent.
 *
 * Pagination is `paginate` - one pure function from a node list and a format to
 * a **measurement record**, never to a node. `format` is an engine input, so
 * `resolveSheet` is where a format becomes geometry, and `format: 'asian'`
 * refuses: AGENTS.md open decision 8, the A4 sheet width, is unruled and the
 * engine will not guess it.
 *
 * Comparing two drafts is `diffScreenplays` - the node id is the join key,
 * lines are compared at the sheet's measure, and the result is what the
 * Revisions route draws and what a revision row's line counts are cut from.
 *
 * FDX export is `fdx-export.ts`, the importer's mirror, since 2026-09-13.
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

export type { CharacterId, DocumentId, LocationId, NodeId, PropId, RunId } from './ids'
export { characterId, documentId, locationId, nodeId, propId, runId } from './ids'

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
  readInlineContent,
  readOutlineDocument,
  readOutlineNode,
  readScreenplayDocument,
  readScreenplayNode,
} from './read'

export type {
  CameraAngle,
  ProposeShotsInput,
  ShotMovement,
  ShotSize,
  ShotSpec,
} from './shots'
export {
  CAMERA_ANGLES,
  CAMERA_ANGLE_LABEL,
  SHOT_MOVEMENTS,
  SHOT_MOVEMENT_LABEL,
  SHOT_SIZES,
  SHOT_SIZE_LABEL,
  boundCueMap,
  excerpt,
  isCameraAngle,
  isShotMovement,
  isShotSize,
  proposeShots,
  shotLabel,
} from './shots'

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
export type { FdxExport, FdxExportOptions, FdxUnrepresentable } from './fdx-export'
export { serialiseFinalDraft } from './fdx-export'

export type {
  AuthoredNotes,
  AuthoredValue,
  CharacterAuthored,
  CharacterRecord,
  CharacterRelationship,
  Confidence,
  CueTally,
  Exchange,
  Introduction,
  LongestLine,
  MatchReason,
  DerivedEntities,
  InteriorExterior,
  Light,
  LocationAuthored,
  LocationCounts,
  LocationRecord,
  Presence,
  Proposal,
  ProposalDecision,
  ProposalTarget,
  ResolveRow,
  ResolveRowState,
  ResolveSubject,
  SceneAuthored,
  SceneCount,
  SceneRecord,
  SluglineReading,
  SluglineTally,
  SpokenLine,
} from './entities'
export {
  CONFIDENCES,
  INTERIOR_EXTERIOR,
  LIGHT_STATES,
  NO_COUNTS,
  NO_ENTITIES,
  PRESENCE_STATES,
  RESOLVE_ROW_STATES,
  resolveRowKey,
} from './entities'

export type { SluglineRejection } from './slugline'
export { TIMES_OF_DAY, readSlugline } from './slugline'

export type { MatchScore } from './alias'
export { canonicalKey, scoreMatch } from './alias'

export type {
  AmbiguousBinding,
  BrokenLocationEdge,
  CharacterMatch,
  CharacterNamePool,
  DanglingMention,
  DeriveError,
  DeriveOptions,
  Derivation,
  MintedRecord,
  RejectedSceneHeading,
  SimilarPair,
} from './derive'
export { countDerivationIds, derive, dialogueWords, matchCharacterNames, matchCharacters, similarRecords } from './derive'

export type { Introduced, IntroductionSubject, NameMatch } from './introductions'
export { ageOnThePage, findIntroductions, namedInText } from './introductions'

export { sidesFor } from './sides'

export type { EstablishingLine, MentionLabelFor, Quadrant, SetMatch, SetPool, SimilarSets } from './sets'
export { NO_QUADRANT, addQuadrants, establishingLines, matchSetNames, quadrantOf, similarSets } from './sets'

export type { PropEvidence, PropPool } from './props'
export { PROP_EVIDENCE_LIMIT, propEvidence, propEvidenceCounts, propScenes } from './props'

export type { CueRestore, CueRevert, CueRewrite, HeadingRewrite } from './rename'
export { cueSpelling, renameCharacterCues, renameLocationHeadings, revertCueRewrites, setSpelling } from './rename'

export type { HeadingParts } from './fountain-syntax'
export { headingParts } from './fountain-syntax'

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

export type {
  ElementMetric,
  ElementMetrics,
  ScriptFormat,
  SheetSpec,
  SheetWidthEvidence,
  UnresolvedSheet,
} from './sheet'
export {
  ASIAN_SHEET_WIDTH_EVIDENCE,
  CHAR_WIDTH_PX,
  COURIER_ADVANCE_EM,
  DPI,
  LINES_PER_INCH,
  SCRIPT_FORMATS,
  TYPE_SIZE_PT,
  isScriptFormat,
  resolveSheet,
} from './sheet'

export type { LabelBook, MentionLabel, RenderedText, UnresolvedMention } from './measure'
export { NO_LABELS, UNRESOLVED_MENTION_WIDTH, labelBook, lineCount, renderedText, wrapText } from './measure'

export type {
  LockIssue,
  LockedPage,
  NumberedPage,
  PageNumbering,
  RevisionColour,
  RevisionSequenceExhausted,
} from './revision'
export {
  FIRST_REVISION_COLOUR,
  REVISION_COLOURS,
  isRevisionColour,
  nextRevisionColour,
  numberPages,
  suffixLetters,
} from './revision'

export type {
  BreakRule,
  MeasuredPage,
  MeasurementRecord,
  NodeMeasurement,
  PageArtefact,
  PageBreak,
  PageMode,
  PaginationError,
  PaginationOptions,
  PaginationTotals,
  PlacedRun,
  SceneMeasurement,
} from './paginate'
export {
  BREAK_RULES,
  EIGHTHS_PER_PAGE,
  MIN_ACTION_LINES_EACH_SIDE,
  MIN_DIALOGUE_LINES_AFTER_BREAK,
  MIN_DIALOGUE_LINES_BEFORE_BREAK,
  PAGE_MODES,
  artefactsOf,
  eighthsOf,
  formatEighths,
  isPageMode,
  paginate,
  tallyBreaks,
} from './paginate'

export { CONTINUED_TEXT, MORE_TEXT, writeContinuedCue } from './generated-text'

export type {
  DiffEntry,
  DiffError,
  DiffKind,
  DiffLine,
  DiffOptions,
  DiffTotals,
  ScreenplayDiff,
} from './diff'
export { DIFF_KINDS, diffScreenplays } from './diff'

export type { BeatHeadline, HeadingLevel, OutlineBeat, OutlineHeading } from './beats'
export {
  BEAT_HEADLINE_SEPARATOR,
  outlineBeats,
  outlineContentText,
  outlineHeadings,
  outlineNodeText,
  outlineWordCount,
  readBeatHeadline,
} from './beats'

export type { Chronology, StoryDayColumn, StoryJump, StorySpan, StoryTime, TimelineScene } from './timeline'
export {
  STORY_CLOCK_PATTERN,
  chronology,
  compareStoryTime,
  formatStoryDay,
  formatStoryTime,
  isStoryClock,
  precedesStoryTime,
  storyJumps,
  storySpan,
} from './timeline'
export type { ContinuityFinding, ContinuityInput, ContinuityKind, ContinuityScene } from './continuity'
export {
  DAYLIGHT,
  DAY_GAP_DAYS,
  FLAGGED_KINDS,
  INFORMATIONAL_KINDS,
  NIGHT_HOURS,
  THREAD_SILENT_EPISODES,
  THREAD_SILENT_PAGES,
  continuityFindings,
} from './continuity'
export type { ActionCue, HeadingBind, PlacementProposal, PlacementReason, SceneTimeCues } from './time-cues'
export { CUE_ACTION_LINES, proposePlacements, timeCuesOf } from './time-cues'


export type { DescriptionName, DescriptionPart, DescriptionPartKind } from './description'
export { dialogueOf, mentionedCharacters, parseDescription, partsText } from './description'
