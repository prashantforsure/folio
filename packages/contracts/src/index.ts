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
 *   - **Lenses.** A real entity, sketched in the design handoff's Appendix A,
 *     and out of scope so far - no brief has named its table. **Props** were on
 *     this list beside it until the Props pass; `props.ts` is what one now is,
 *     and it is the authoritative record Production's two free-text `prop`
 *     columns became foreign keys to. Story threads were on this list until the
 *     Timeline phase, research sources until the Research v2 pass
 *     (2026-09-16); `timeline.ts` and `research.ts` say what each now is.
 *     Bible entries were on it too, until the Bible phase, then off it again
 *     when the route was cut (`docs/build-decisions.md`, "Bible route
 *     removed") - there is no `bible.ts` here any more.
 *   - **Jobs and generations** were on this list until the Storyboard phase;
 *     `storyboard.ts` says what each now is. The ledger still carries `jobId`
 *     as a forward reference with no foreign key.
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
  AgentProposalId,
  AgentProposalOpId,
  AssistantChatId,
  AssistantMessageId,
  EpisodeId,
  EpisodeSegmentResult,
  EpisodeSlug,
  GenerationId,
  JobId,
  LedgerEntryId,
  MeasurementId,
  MembershipId,
  ProjectId,
  ReelId,
  ReelShotId,
  SheetId,
  ClipId,
  AssetId,
  ProductionGenerationId,
  ArtStyleId,
  ResearchClipId,
  ResearchCollectionId,
  ResearchFilingId,
  ResearchSourceId,
  ReservedProjectSegment,
  RevisionId,
  ShareLinkId,
  ShotId,
  StoryThreadId,
  ThreadCommentId,
  ThreadId,
  UserId,
  VersionId,
} from './ids'
export {
  AgentProposalIdSchema,
  AgentProposalOpIdSchema,
  ArtStyleIdSchema,
  AssetIdSchema,
  AssistantChatIdSchema,
  AssistantMessageIdSchema,
  CharacterIdSchema,
  ClipIdSchema,
  DocumentIdSchema,
  EPISODE_SLUG_PATTERN,
  EpisodeIdSchema,
  EpisodeSlugSchema,
  GenerationIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  LedgerEntryIdSchema,
  LocationIdSchema,
  MeasurementIdSchema,
  MembershipIdSchema,
  NodeIdSchema,
  ProductionGenerationIdSchema,
  ProjectIdSchema,
  PropIdSchema,
  RESERVED_PROJECT_SEGMENTS,
  ReelIdSchema,
  ReelShotIdSchema,
  ResearchClipIdSchema,
  ResearchCollectionIdSchema,
  ResearchFilingIdSchema,
  ResearchSourceIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  ShareLinkIdSchema,
  SheetIdSchema,
  ShotIdSchema,
  StoryThreadIdSchema,
  ThreadCommentIdSchema,
  ThreadIdSchema,
  UserIdSchema,
  VersionIdSchema,
  agentProposalId,
  agentProposalOpId,
  artStyleId,
  assetId,
  assistantChatId,
  assistantMessageId,
  clipId,
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
  productionGenerationId,
  projectId,
  reelId,
  reelShotId,
  researchClipId,
  researchCollectionId,
  researchFilingId,
  researchSourceId,
  revisionId,
  shareLinkId,
  sheetId,
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
  RateLimitBucket,
  ShotOrigin,
  ShotState,
  ThreadAnchorKind,
  ThreadNodeKind,
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
  RATE_LIMIT_BUCKETS,
  RateLimitBucketSchema,
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
  ThreadNodeKindSchema,
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
  PreviewLine,
  Project,
  ProjectCard,
  ProjectMember,
  TitlePage,
  TitlePageField,
  TitlePageInput,
  User,
} from './tenancy'
export {
  CreateProjectInputSchema,
  EpisodeSchema,
  LoglineSchema,
  MembershipSchema,
  PREVIEW_LINES,
  PreviewLineSchema,
  ProjectCardSchema,
  ProjectMemberSchema,
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
  AliasProvenance,
  CastRow,
  CharacterColor,
  CharacterGender,
  CharacterOrigin,
  CharacterProfile,
  CharacterProfileEdit,
  CharacterStatus,
  CueBookEntry,
  CueVariantRow,
  ExchangeRow,
  NewCharacter,
  PairItem,
  PairSide,
  PortraitType,
  Relationship,
  RelationshipInput,
  ResolveCandidate,
  ResolveItem,
  ResolveProposal,
  SceneRef,
} from './characters'
export {
  CHARACTER_COLORS,
  CHARACTER_COLOR_IDS,
  CHARACTER_GENDERS,
  CHARACTER_GENDER_LABELS,
  CHARACTER_ORIGINS,
  CHARACTER_ORIGIN_LABELS,
  CHARACTER_STATUSES,
  CHARACTER_STATUS_LABELS,
  CharacterColorSchema,
  CharacterGenderSchema,
  CharacterOriginSchema,
  CharacterProfileEditSchema,
  CharacterStatusSchema,
  DEFAULT_CHARACTER_COLOR,
  NewCharacterSchema,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
  RelationshipInputSchema,
  hueOfColor,
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
  BoardCoverageRow,
  CanvasPosition,
  FrameGeneration,
  FrameState,
  Job,
  Shot,
  ShotEdit,
  ShotRow,
  StoryboardScene,
} from './storyboard'
export {
  BoardCoverageRowSchema,
  CanvasPositionSchema,
  FRAME_GENERATION_COST,
  FRAME_UPLOAD_MAX_BYTES,
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
  ArtStyle,
  AspectRatio,
  Asset,
  AssetKind,
  AssetSource,
  Assignee,
  BoardView,
  BulkPatch,
  CameraMotion,
  CameraStyle,
  Clip,
  ClipLength,
  ClipState,
  Continuity,
  DurationPreset,
  EpisodeSettings,
  FieldId,
  FrameState as ProductionFrameState,
  Generation,
  GenerationJob,
  GenerationState,
  GenerationTarget,
  IntExt,
  Lighting,
  MoveShot,
  NewShot,
  NoteInput,
  NoteTarget,
  Pacing,
  Priority,
  ProductionCastMember,
  ProductionScene,
  ProductionType,
  Readiness,
  ReadinessFlag,
  Reel,
  ReelPatch,
  ReelShot,
  ReelStatus,
  RetimeShot,
  SceneSetup,
  SceneSetupPatch,
  SettingsInput,
  Sheet,
  SheetFrame,
  SheetState,
  ShotCharacterSource,
  ShotPatch,
  ShotStatus,
  ShotType,
  SortMode,
  StatusFilter,
  Tier,
  ViewPreferences,
  ViewPreferencesPatch,
} from './production'
export {
  ART_STYLE_PRESET_KEYS,
  ASPECT_RATIOS,
  ASPECT_RATIO_CARDS,
  ASSET_KINDS,
  ASSET_SOURCES,
  AspectRatioSchema,
  AssetKindSchema,
  BOARD_VIEWS,
  BoardViewSchema,
  BulkPatchSchema,
  CAMERA_MOTIONS,
  CAMERA_STYLES,
  CLIP_LENGTHS,
  CLIP_STATES,
  CONTINUITIES,
  CameraMotionSchema,
  CameraStyleSchema,
  ClipLengthSchema,
  ContinuitySchema,
  DEFAULT_ART_STYLE_KEY,
  DEFAULT_CLIP_LENGTH,
  DEFAULT_SETTINGS,
  DEFAULT_VIEW_PREFERENCES,
  DESCRIPTION_PART_KINDS,
  DURATION_PRESETS,
  DurationPresetSchema,
  FIELD_IDS,
  FIELD_LABELS,
  FRAME_STATES as PRODUCTION_FRAME_STATES,
  FieldIdSchema,
  GENERATION_COSTS,
  GENERATION_JOBS,
  GENERATION_STATES,
  GENERATION_TARGETS,
  GenerationJobSchema,
  INT_EXT,
  IntExtSchema,
  LIGHTINGS,
  LightingSchema,
  MODEL_REGISTRY,
  MoveShotSchema,
  NOTE_TARGETS,
  NOT_READY_TITLE,
  NewShotSchema,
  NoteInputSchema,
  NoteTargetSchema,
  PACINGS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRODUCTION_IMAGE_MAX_BYTES,
  PRODUCTION_IMAGE_TYPES,
  PRODUCTION_TYPES,
  PacingSchema,
  PrioritySchema,
  ProductionTypeSchema,
  READINESS_FLAGS,
  REEL_STATUSES,
  REEL_STATUS_LABELS,
  ReelPatchSchema,
  ReelStatusSchema,
  RetimeShotSchema,
  SETTINGS_GROUPS,
  SHEET_STATES,
  SHEET_STATE_LABELS,
  SHOT_CHARACTER_SOURCES,
  SHOT_STATUSES,
  SHOT_STATUS_LABELS,
  SHOT_TYPES,
  SORT_MODES,
  SORT_MODE_LABELS,
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  SceneSetupPatchSchema,
  SettingsInputSchema,
  SheetStateSchema,
  ShotPatchSchema,
  ShotStatusSchema,
  ShotTypeSchema,
  SortModeSchema,
  StatusFilterSchema,
  TIERS,
  ViewPreferencesPatchSchema,
  isLiveGeneration,
} from './production'

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
  FindingVerdict,
  Placement,
  SceneCues,
  StoryThread,
  StoryThreadColour,
  StoryThreadEdit,
  StoryThreadRow,
  StoryTimeEdit,
  TimelineEpisodeColumn,
  TimelineSceneRow,
} from './timeline'
export {
  CONTINUITY_KINDS,
  ContinuityKindSchema,
  FindingVerdictSchema,
  PlacementSchema,
  PlacementsSchema,
  STORY_THREAD_COLOURS,
  SceneThreadsSchema,
  StoryClockSchema,
  StoryThreadColourSchema,
  StoryThreadEditSchema,
  StoryThreadSchema,
  StoryTimeEditSchema,
  StoryTimeSchema,
  ThreadOrderSchema,
} from './timeline'

export type {
  BoundSetView,
  EstablishingRow,
  FiledClip,
  LocationCounts,
  LocationEdit,
  LocationKind,
  LocationPersonRow,
  LocationRow,
  LocationSceneRow,
  LocationStatus,
  SimilarSetRow,
  SluglineCandidate,
  SluglineResolveItem,
  SluglineResolveProposal,
  SluglineVariantRow,
  StructureResolveItem,
  StructureResolveProposal,
} from './locations'
export {
  LOCATION_PHOTO_MAX_BYTES,
  LOCATION_STATUSES,
  LOCATION_STATUS_LABELS,
  LocationEditSchema,
  LocationStatusSchema,
  ParentEditSchema,
} from './locations'

export type { PropAliasView, PropEdit, PropEvidenceRow, PropRow, PropShotRow, PropStatus } from './props'
export {
  PROP_PHOTO_MAX_BYTES,
  PROP_STATUSES,
  PROP_STATUS_LABELS,
  PropAliasSchema,
  PropEditSchema,
  PropStatusSchema,
} from './props'

export type { ShareLink, ShareLinkRole } from './share'
export { SHARE_LINK_ROLES, ShareLinkRoleSchema, ShareLinkSchema, ShareTokenSchema } from './share'

export type { AskFocus, AskRequest, AskScope, AskSelection, AssistantChat, AssistantContent, AssistantMessage, AssistantRole } from './assistant'
export {
  ASK_SCOPES,
  ASK_SELECTION_MAX,
  ASSISTANT_MESSAGE_MAX,
  ASSISTANT_ROLES,
  AskFocusSchema,
  AskInputSchema,
  AskScopeSchema,
  AskSelectionSchema,
  AssistantChatSchema,
  AssistantContentSchema,
  AssistantMessageSchema,
  AssistantRoleSchema,
} from './assistant'

export type { AgentEvent, AgentEventType, AgentRoute, AgentRun, AgentRunMode, AgentRunStatus, AgentStopReason, NavigateTarget } from './agent'
export {
  AGENT_DOWNLOAD_MAX,
  AGENT_EPISODE_ROUTES,
  AGENT_PROJECT_ROUTES,
  AGENT_RUN_MODES,
  AGENT_RUN_STATUSES,
  AGENT_STOP_REASONS,
  AGENT_STREAM_MEDIA_TYPE,
  AgentEpisodeRouteSchema,
  AgentEventSchema,
  AgentProjectRouteSchema,
  AgentRouteSchema,
  AgentRunModeSchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  AgentStopReasonSchema,
  NavigateTargetSchema,
  isTerminalRunStatus,
} from './agent'

export type {
  AgentAutonomy,
  AgentOpMode,
  AgentOpStatus,
  AgentProposal,
  AgentProposalOp,
  AgentProposalStatus,
  AgentProposalWithOps,
  ContentInput,
  OutlineOpInput,
  ProposalBase,
  ProposalDocumentBase,
  ScriptOpInput,
} from './proposals'
export {
  AGENT_AUTONOMIES,
  AGENT_OP_MODES,
  AGENT_OP_STATUSES,
  AGENT_PROPOSAL_STATUSES,
  AgentAutonomySchema,
  AgentOpModeSchema,
  AgentOpStatusSchema,
  AgentProposalOpSchema,
  AgentProposalSchema,
  AgentProposalStatusSchema,
  AnchorSchema,
  ContentInputSchema,
  EMPTY_PROPOSAL_BASE,
  InlineRunInputSchema,
  OutlineOpInputSchema,
  OutlineOpSchema,
  ProposalBaseSchema,
  ProposalDocumentBaseSchema,
  ScriptOpInputSchema,
  ScriptOpSchema,
  isOpenProposal,
  needsConfirmation,
} from './proposals'

export type {
  ResearchClipEdit,
  ResearchClipRow,
  ResearchCollectionColour,
  ResearchCollectionPick,
  ResearchCollectionRow,
  ResearchFilingKind,
  ResearchFilingRow,
  ResearchFilingTarget,
  ResearchSource,
  ResearchSourceEdit,
  ResearchSourceKind,
  ResearchSourceRow,
} from './research'
export {
  RESEARCH_BODY_MAX,
  RESEARCH_CLIP_MAX,
  RESEARCH_COLLECTION_COLOURS,
  RESEARCH_COLLECTION_NAME_MAX,
  RESEARCH_FILING_KINDS,
  RESEARCH_NOTE_MAX,
  RESEARCH_ORIGIN_MAX,
  RESEARCH_SOURCE_KINDS,
  RESEARCH_SOURCE_KIND_GLYPHS,
  RESEARCH_SOURCE_KIND_LABELS,
  RESEARCH_TITLE_MAX,
  ResearchClipEditSchema,
  ResearchCollectionColourSchema,
  ResearchCollectionPickSchema,
  ResearchFilingKindSchema,
  ResearchFilingTargetSchema,
  ResearchSourceEditSchema,
  ResearchSourceKindSchema,
} from './research'
