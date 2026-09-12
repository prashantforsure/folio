/**
 * @folio/contracts - Zod schemas shared by web and worker.
 *
 * AGENTS.md, Architecture: "Types flow from here; do not redeclare them
 * downstream." That is the whole job, and this package does it in two ways
 * which are worth telling apart.
 *
 * **What it declares.** The shapes storage and the wire invent: a project row,
 * a membership, a document header, a node row, a comment thread, a revision, a
 * measurement, a ledger entry. None of these exist in `packages/script`,
 * because none of them are a function of the node list.
 *
 * **What it borrows.** Everything the pure core already declares -
 * `ScreenplayNode`, `OutlineNode`, the two document kinds, the derived entity
 * records, the revision colours, the eight element types. Those are imported
 * and re-expressed as schemas that **delegate to the pure core's own reader**,
 * never re-implemented. `packages/script`'s `read.ts` is strict, rejects
 * unrecognised fields, and rejects the five `PAGINATION_FIELDS` by name; a
 * hand-written Zod object here would be a third enforcement point that knew
 * about neither.
 *
 * The seam between the two is held by `assertExact` from `equality.ts`. Every
 * borrowed shape is followed by a compile-time proof that the schema's inferred
 * type is *exactly* the pure core's type, in both directions. Adding a ninth
 * element type, or a field to `CharacterRecord`, breaks the compile here rather
 * than passing silently over the wire. `pnpm typecheck` is a test suite in this
 * package for the same reason it is in `packages/script`.
 *
 * **These are boundary contracts, not a mirror of the database.** They are not
 * generated from Drizzle and they do not follow it: timestamps are ISO strings
 * because a `Date` does not survive a queue payload, fields are `camelCase`
 * because columns are `snake_case`, and the derived entities are split into
 * authored and derived halves because that split is the mechanism which stops a
 * re-derive clobbering a synopsis. `packages/db` maps between the two, and it
 * is the only place that mapping exists.
 *
 * What is deliberately **not** here, and why:
 *
 *   - **Research sources, props, lenses.** Real entities, sketched in the
 *     design handoff's Appendix A, and out of scope so far - each brief names
 *     its tables and these are not among them. Story threads were on this
 *     list until the Timeline phase and bible entries until the Bible phase;
 *     `timeline.ts` and `bible.ts` are what they are.
 *   - **Jobs and generations.** Same. The ledger carries `jobId` as a forward
 *     reference with no foreign key so that early rows are not unattributable.
 *   - **A scene *record* id.** `docs/adr/0001-node-identity.md` Ruling 3 says
 *     `SCENE_xxx` is a derived id in its own space; `packages/script` then made
 *     a scene record's id be the heading node's id. Both cannot hold. See the
 *     header of `ids.ts` - flagged, not resolved.
 *   - **Project settings `transfer`, `keys` and `episodes`.** AGENTS.md open
 *     decision 7. Nothing here guesses where they went.
 */
export const PACKAGE_NAME = '@folio/contracts'

export type { Equals, Extends } from './equality'
export { assertExact } from './equality'

export type {
  ArcTurnId,
  BibleEntryId,
  BibleFactId,
  BiblePitchFieldId,
  BibleQuestionId,
  BibleTermId,
  EpisodeId,
  EpisodeSegmentResult,
  EpisodeSlug,
  GenerationId,
  JobId,
  LedgerEntryId,
  MeasurementId,
  MembershipId,
  ProjectId,
  ReservedProjectSegment,
  RevisionId,
  ShotId,
  StoryThreadId,
  ThreadCommentId,
  ThreadId,
  UserId,
  VersionId,
} from './ids'
export {
  ArcTurnIdSchema,
  BibleEntryIdSchema,
  BibleFactIdSchema,
  BiblePitchFieldIdSchema,
  BibleQuestionIdSchema,
  BibleTermIdSchema,
  CharacterIdSchema,
  DocumentIdSchema,
  EPISODE_SLUG_PATTERN,
  EpisodeIdSchema,
  EpisodeSlugSchema,
  GenerationIdSchema,
  JobIdSchema,
  LedgerEntryIdSchema,
  LocationIdSchema,
  MeasurementIdSchema,
  MembershipIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RESERVED_PROJECT_SEGMENTS,
  RevisionIdSchema,
  RunIdSchema,
  ShotIdSchema,
  StoryThreadIdSchema,
  ThreadCommentIdSchema,
  ThreadIdSchema,
  UserIdSchema,
  VersionIdSchema,
  arcTurnId,
  bibleEntryId,
  bibleFactId,
  biblePitchFieldId,
  bibleQuestionId,
  bibleTermId,
  episodeId,
  episodeSlug,
  formatEpisodeSlug,
  generationId,
  isReservedProjectSegment,
  jobId,
  ledgerEntryId,
  measurementId,
  membershipId,
  parseEpisodeSegment,
  projectId,
  revisionId,
  shotId,
  storyThreadId,
  threadCommentId,
  threadId,
  userId,
  versionId,
} from './ids'

export type {
  JobKind,
  JobStatus,
  LedgerEntryKind,
  MembershipRole,
  PoolerMode,
  ProjectKind,
  ProjectType,
  ShotOrigin,
  ShotState,
  ThreadAnchorKind,
  ThreadState,
  TombstoneReason,
} from './enums'
export {
  CameraAngleSchema,
  ConfidenceSchema,
  DeliveryModifierSchema,
  DocumentKindSchema,
  InteriorExteriorSchema,
  JOB_KINDS,
  JOB_STATUSES,
  JobKindSchema,
  JobStatusSchema,
  LEDGER_ENTRY_KINDS,
  LedgerEntryKindSchema,
  LightSchema,
  MEMBERSHIP_ROLES,
  MembershipRoleSchema,
  MentionEntitySchema,
  OutlineNodeTypeSchema,
  POOLER_MODES,
  PROJECT_KINDS,
  PROJECT_TYPES,
  PageModeSchema,
  PoolerModeSchema,
  PresenceSchema,
  ProjectKindSchema,
  ProjectTypeSchema,
  ProvenanceSourceSchema,
  ResolveRowStateSchema,
  RevisionColourSchema,
  SHOT_ORIGINS,
  SHOT_STATES,
  ScreenplayNodeTypeSchema,
  ScriptFormatSchema,
  ShotMovementSchema,
  ShotOriginSchema,
  ShotSizeSchema,
  ShotStateSchema,
  THREAD_ANCHOR_KINDS,
  THREAD_STATES,
  TOMBSTONE_REASONS,
  ThreadAnchorKindSchema,
  ThreadStateSchema,
  TombstoneReasonSchema,
  isTerminalJobStatus,
} from './enums'

export type { OrderKey, PageRequest, Timestamp } from './primitives'
export {
  AuthoredNotesSchema,
  AuthoredValueSchema,
  CreditDeltaSchema,
  CursorSchema,
  OrderKeySchema,
  PageRequestSchema,
  TimestampSchema,
  TitleSchema,
  toTimestamp,
} from './primitives'

export {
  FolioDocumentSchema,
  InlineContentSchema,
  OutlineDocumentSchema,
  OutlineNodeSchema,
  ScreenplayDocumentSchema,
  ScreenplayNodeSchema,
} from './model'

export type {
  CreateProjectInput,
  Episode,
  Membership,
  Project,
  ProjectCard,
  TitlePage,
  TitlePageField,
  TitlePageInput,
  User,
} from './tenancy'
export {
  CreateProjectInputSchema,
  EpisodeSchema,
  MembershipSchema,
  ProjectCardSchema,
  ProjectSchema,
  TITLE_PAGE_FIELDS,
  TitlePageInputSchema,
  TitlePageSchema,
  UserSchema,
} from './tenancy'

export type {
  DocumentRecord,
  NodeProvenanceRow,
  NodeRow,
  NodeTombstone,
  NodeType,
} from './documents'
export {
  DocumentRecordSchema,
  NodeProvenanceRowSchema,
  NodeRowSchema,
  NodeTombstoneSchema,
  NodeTypeSchema,
} from './documents'

export type { Thread, ThreadAnchor, ThreadComment } from './threads'
export { ThreadAnchorSchema, ThreadCommentSchema, ThreadSchema } from './threads'

export type {
  LockedPage,
  Revision,
  Version,
  VersionReason,
  VersionSnapshot,
} from './history'
export {
  LockedPageSchema,
  RevisionSchema,
  VERSION_REASONS,
  VersionReasonSchema,
  VersionSchema,
  VersionSnapshotSchema,
} from './history'

export type {
  ArcTurnEdit,
  ArcTurnRow,
  CastRow,
  CharacterGroup,
  CharacterMap,
  CharacterProfile,
  CharacterProfileEdit,
  CueVariantRow,
  EpisodeBar,
  KeyLineRow,
  MapColumn,
  PlaceRow,
  PresenceGap,
  RelationshipEdit,
  RelationshipRow,
  ResolveItem,
  ResolveProposal,
  SceneRef,
  WalkOnRow,
} from './characters'
export {
  ArcTurnEditSchema,
  CHARACTER_GROUPS,
  CHARACTER_HUES,
  CharacterGroupSchema,
  CharacterProfileEditSchema,
  KeyLinesEditSchema,
  RelationshipEditSchema,
} from './characters'

export type {
  Measurement,
  MeasurementNode,
  MeasurementPage,
  MeasurementScene,
} from './measurement'
export {
  MeasurementNodeSchema,
  MeasurementPageSchema,
  MeasurementSceneSchema,
  MeasurementSchema,
} from './measurement'

export type {
  CharacterAuthoredRow,
  CharacterBoundCue,
  CharacterCueTally,
  CharacterDerivation,
  CharacterRelationshipRow,
  LocationAuthoredRow,
  LocationBoundSlugline,
  LocationDerivation,
  LocationSluglineTally,
  ProposalRow,
  ProposalTargetRow,
  ResolveDecision,
  ResolveQueueRow,
  ResolveSubjectRow,
  SceneAuthoredRow,
  SceneDerivation,
  SluglineReadingRow,
} from './derived'
export {
  CharacterAuthoredSchema,
  CharacterBoundCueSchema,
  CharacterCueTallySchema,
  CharacterDerivationSchema,
  CharacterRelationshipSchema,
  LocationAuthoredSchema,
  LocationBoundSluglineSchema,
  LocationDerivationSchema,
  LocationSluglineTallySchema,
  ProposalSchema,
  ProposalTargetSchema,
  ResolveDecisionSchema,
  ResolveRowSchema,
  ResolveSubjectSchema,
  SceneAuthoredSchema,
  SceneDerivationSchema,
  SluglineReadingSchema,
} from './derived'

export type { CreditBalance, LedgerEntry } from './credits'
export { CreditBalanceSchema, LedgerEntrySchema } from './credits'

export type {
  FrameGeneration,
  FrameState,
  Job,
  Shot,
  ShotEdit,
  ShotRow,
  StoryboardScene,
} from './storyboard'
export {
  FRAME_GENERATION_COST,
  FrameGenerationSchema,
  FrameStateSchema,
  JobSchema,
  ShotEditSchema,
  ShotRowSchema,
  ShotSchema,
  ShotSpecSchema,
  StoryboardSceneSchema,
} from './storyboard'

export type {
  EpisodeBoardRow,
  EpisodeNavMeta,
  EpisodeSceneRow,
  RailBadges,
  SceneBoardRow,
} from './workspace'
export {
  EpisodeBoardRowSchema,
  EpisodeNavMetaSchema,
  EpisodeSceneRowSchema,
  RailBadgesSchema,
  SceneBoardRowSchema,
} from './workspace'

export type {
  StoryThread,
  StoryThreadColour,
  StoryThreadEdit,
  StoryThreadRow,
  StoryTimeEdit,
  TimelineEpisodeColumn,
  TimelineSceneRow,
} from './timeline'
export {
  STORY_THREAD_COLOURS,
  StoryClockSchema,
  StoryThreadColourSchema,
  StoryThreadEditSchema,
  StoryThreadSchema,
  StoryTimeEditSchema,
  StoryTimeSchema,
} from './timeline'

export type {
  ArcNoteEdit,
  BreakdownCell,
  BreakdownRow,
  LocationArcNoteRow,
  LocationCounts,
  LocationEdit,
  LocationEpisodeBar,
  LocationPersonRow,
  LocationRecordView,
  LocationRow,
  LocationSceneRow,
  SluglineResolveItem,
  SluglineResolveProposal,
  SluglineVariantRow,
  StructureResolveItem,
  StructureResolveProposal,
} from './locations'
export { ArcNoteEditSchema, LocationEditSchema, ParentEditSchema } from './locations'

export type {
  BibleConflictEdit,
  BibleCounts,
  BibleEntryCreate,
  BibleEntryEdit,
  BibleEntryLinks,
  BibleEntryView,
  BibleFactEdit,
  BibleFactRow,
  BibleNavEntry,
  BiblePitchFieldEdit,
  BiblePitchFieldRow,
  BibleQuestionEdit,
  BibleQuestionRow,
  BibleTermEdit,
  CanonConflictRow,
  GlossaryRow,
} from './bible'
export {
  BibleConflictEditSchema,
  BibleEntryCreateSchema,
  BibleEntryEditSchema,
  BibleEntryKindSchema,
  BibleEntryStatusSchema,
  BibleFactEditSchema,
  BiblePitchFieldEditSchema,
  BibleQuestionEditSchema,
  BibleSectionSchema,
  BibleTermEditSchema,
} from './bible'
