import { characterId, documentId, locationId, nodeId, propId, runId } from '@folio/script'
import type { CharacterId, DocumentId, LocationId, NodeId, PropId, RunId } from '@folio/script'
import { z } from 'zod'

import { assertExact } from './equality'
import type { Equals } from './equality'

/**
 * Identifiers, and the one place their *format* is written down.
 *
 * `docs/adr/0001-node-identity.md`, Ruling 6: ids are branded strings in
 * `packages/script` with no format at all, because "the pure core cannot mint
 * an id, so the format belongs where ids are minted - `packages/db` and
 * `packages/contracts`". This file is the contracts half. `packages/db` mints;
 * this file says what a minted id looks like and refuses anything else at the
 * boundary.
 *
 * Two id spaces, per that ADR's Consequences, and they must not be confused:
 *
 *   - **Opaque keys.** Node, document, project, episode, user, thread,
 *     revision, version, measurement, ledger entry. UUIDs. No prefix, no
 *     ordinal, no embedded meaning. A node id in particular carries no type
 *     prefix - it survives a type change, so a `SCENE_` prefix would have to
 *     change with the type, which AGENTS.md forbids.
 *   - **Slugs.** `ep_NNN`, and only `ep_NNN`. A slug is what the router shows;
 *     it is not a key and nothing joins on it.
 *
 * ## Why UUID and not something shorter
 *
 * Delegated, like the rest of ADR 0001, and recorded as such in
 * `docs/adr/0002-episode-identity.md`. `gen_random_uuid()` is in core Postgres,
 * needs no extension on Supabase, and lets a client mint an id before a round
 * trip - which matters because the editor creates nodes optimistically and the
 * pure core refuses to mint one for it. A shorter opaque id would need an
 * alphabet ruling and buys nothing this application can spend.
 *
 * ## The `SCENE_xxx` contradiction, unresolved on purpose
 *
 * ADR 0001 Ruling 3 says `SCENE_xxx` is the derived scene record's id, "in a
 * different id space" from node ids, and its Consequences say a node id
 * "appears in no URL". `packages/script`'s `entities.ts` then made
 * `SceneRecord.id` **be the heading node's id**, deliberately, so that moving a
 * scene does not detach its synopsis. Both cannot be true: either the scene
 * record's id is a node id and node ids do appear in URLs, or the scene record
 * needs a second, minted id and the ADR's "different id space" is real.
 *
 * This file codifies neither. There is no `SceneRecordIdSchema`; a scene is
 * addressed by `NodeIdSchema`, matching the implemented core. The URL form is a
 * routing decision and routing is not in this phase. Flagged, not resolved.
 */

// ---------------------------------------------------------------------------
// Brands this package owns
// ---------------------------------------------------------------------------

/**
 * `@folio/script` brands the five ids the pure core handles. The rest are
 * schema-side and are branded here, using the same technique so that passing a
 * `ProjectId` where an `EpisodeId` belongs does not compile.
 */
declare const idBrand: unique symbol

type Branded<Tag extends string> = string & { readonly [idBrand]: Tag }

/** The tenant. Every table's `project_id` is one of these. */
export type ProjectId = Branded<'ProjectId'>
/** The episode's *key*. Not `ep_NNN` - see `EpisodeSlug`. */
export type EpisodeId = Branded<'EpisodeId'>
/** Our user row, one-to-one with a Supabase `auth.users` row. */
export type UserId = Branded<'UserId'>
export type MembershipId = Branded<'MembershipId'>
/** A comment thread. Anchored by id, so it survives edits to surrounding text. */
export type ThreadId = Branded<'ThreadId'>
export type ThreadCommentId = Branded<'ThreadCommentId'>
/** A production revision - colour, note, locked flag. Never a `VersionId`. */
export type RevisionId = Branded<'RevisionId'>
/** An editor undo-history snapshot. Never a `RevisionId`. */
export type VersionId = Branded<'VersionId'>
export type MeasurementId = Branded<'MeasurementId'>
export type LedgerEntryId = Branded<'LedgerEntryId'>
/**
 * A job. Was a forward reference with no table; `jobs` is a table since the
 * Storyboard phase and the ledger's `job_id` now resolves to a row of it.
 */
export type JobId = Branded<'JobId'>
/** A storyboard shot. Authored, hangs off a scene by the heading node's id. */
export type ShotId = Branded<'ShotId'>
/** One attempt at drawing a shot's frame. Links a shot to its job, and on failure to its refund. */
export type GenerationId = Branded<'GenerationId'>
/** A story thread on the Timeline. Authored; never a comment `ThreadId`. See `timeline.ts`. */
export type StoryThreadId = Branded<'StoryThreadId'>
/** A reel: one clip's worth of a scene, with the shots that fill it. Authored; keyed to the heading node like a shot. See `production.ts`. */
export type ReelId = Branded<'ReelId'>
/** A Production shot: one timed segment of a reel. Its own space beside the Storyboard's `ShotId` (2026-09-22). See `production.ts`. */
export type ReelShotId = Branded<'ReelShotId'>
/** A storyboard sheet: one image per reel. See `production.ts`. */
export type SheetId = Branded<'SheetId'>
/** A clip: what `Start shooting` renders for a reel. See `production.ts`. */
export type ClipId = Branded<'ClipId'>
/** A stored image or video: a frame, a sheet, a still, a reference, a clip. See `production.ts`. */
export type AssetId = Branded<'AssetId'>
/** One AI job in Production: shotlist, sheet, scene image, frame, reel. Not the Storyboard's `GenerationId`. */
export type ProductionGenerationId = Branded<'ProductionGenerationId'>
/** An art style: one of the 14 presets or a project's own. See `production.ts`. */
export type ArtStyleId = Branded<'ArtStyleId'>
/** A share link: the in-app invite AGENTS.md, Constraints names. One row per issued link. See `share.ts`. */
export type ShareLinkId = Branded<'ShareLinkId'>
/** An assistant chat, per episode. See `assistant.ts`. */
export type AssistantChatId = Branded<'AssistantChatId'>
export type AssistantMessageId = Branded<'AssistantMessageId'>
/** A research collection: a named, coloured group of sources. See `research.ts`. */
export type ResearchCollectionId = Branded<'ResearchCollectionId'>
/** A research source: an article, document, image set, interview or recording. See `research.ts`. */
export type ResearchSourceId = Branded<'ResearchSourceId'>
/** A clip: one highlighted line of a source. See `research.ts`. */
export type ResearchClipId = Branded<'ResearchClipId'>
/** A filing: a clip sent to a character, a location or a scene. See `research.ts`. */
export type ResearchFilingId = Branded<'ResearchFilingId'>
/** A continuity finding on a character: two quotes that contradict. See `characters.ts`. */

export const projectId = (raw: string): ProjectId => raw as ProjectId
export const episodeId = (raw: string): EpisodeId => raw as EpisodeId
export const userId = (raw: string): UserId => raw as UserId
export const membershipId = (raw: string): MembershipId => raw as MembershipId
export const threadId = (raw: string): ThreadId => raw as ThreadId
export const threadCommentId = (raw: string): ThreadCommentId => raw as ThreadCommentId
export const revisionId = (raw: string): RevisionId => raw as RevisionId
export const versionId = (raw: string): VersionId => raw as VersionId
export const measurementId = (raw: string): MeasurementId => raw as MeasurementId
export const ledgerEntryId = (raw: string): LedgerEntryId => raw as LedgerEntryId
export const jobId = (raw: string): JobId => raw as JobId
export const shotId = (raw: string): ShotId => raw as ShotId
export const generationId = (raw: string): GenerationId => raw as GenerationId
export const storyThreadId = (raw: string): StoryThreadId => raw as StoryThreadId
export const reelId = (raw: string): ReelId => raw as ReelId
export const reelShotId = (raw: string): ReelShotId => raw as ReelShotId
export const sheetId = (raw: string): SheetId => raw as SheetId
export const clipId = (raw: string): ClipId => raw as ClipId
export const assetId = (raw: string): AssetId => raw as AssetId
export const productionGenerationId = (raw: string): ProductionGenerationId => raw as ProductionGenerationId
export const artStyleId = (raw: string): ArtStyleId => raw as ArtStyleId
export const shareLinkId = (raw: string): ShareLinkId => raw as ShareLinkId
export const assistantChatId = (raw: string): AssistantChatId => raw as AssistantChatId
export const assistantMessageId = (raw: string): AssistantMessageId => raw as AssistantMessageId
export const researchCollectionId = (raw: string): ResearchCollectionId => raw as ResearchCollectionId
export const researchSourceId = (raw: string): ResearchSourceId => raw as ResearchSourceId
export const researchClipId = (raw: string): ResearchClipId => raw as ResearchClipId
export const researchFilingId = (raw: string): ResearchFilingId => raw as ResearchFilingId

// ---------------------------------------------------------------------------
// The schemas
// ---------------------------------------------------------------------------

/**
 * A UUID, re-branded.
 *
 * `.transform` rather than Zod's own `.brand()`: Zod's brand is Zod's symbol,
 * which is a *different* type from the brand `@folio/script` declares, so a
 * `z.uuid().brand()` would produce something that is not a `NodeId` and every
 * consumer would have to launder it. Transforming through the pure core's own
 * constructor gives the real brand.
 */
const brandedUuid = <T extends string>(make: (raw: string) => T): z.ZodType<T, string> =>
  z.uuid().transform(make)

export const NodeIdSchema = brandedUuid(nodeId)
export const DocumentIdSchema = brandedUuid(documentId)
export const RunIdSchema = brandedUuid(runId)
export const CharacterIdSchema = brandedUuid(characterId)
export const LocationIdSchema = brandedUuid(locationId)
export const PropIdSchema = brandedUuid(propId)

export const ProjectIdSchema = brandedUuid(projectId)
export const EpisodeIdSchema = brandedUuid(episodeId)
export const UserIdSchema = brandedUuid(userId)
export const MembershipIdSchema = brandedUuid(membershipId)
export const ThreadIdSchema = brandedUuid(threadId)
export const ThreadCommentIdSchema = brandedUuid(threadCommentId)
export const RevisionIdSchema = brandedUuid(revisionId)
export const VersionIdSchema = brandedUuid(versionId)
export const MeasurementIdSchema = brandedUuid(measurementId)
export const LedgerEntryIdSchema = brandedUuid(ledgerEntryId)
export const JobIdSchema = brandedUuid(jobId)
export const ShotIdSchema = brandedUuid(shotId)
export const GenerationIdSchema = brandedUuid(generationId)
export const StoryThreadIdSchema = brandedUuid(storyThreadId)
export const ReelIdSchema = brandedUuid(reelId)
export const ReelShotIdSchema = brandedUuid(reelShotId)
export const SheetIdSchema = brandedUuid(sheetId)
export const ClipIdSchema = brandedUuid(clipId)
export const AssetIdSchema = brandedUuid(assetId)
export const ProductionGenerationIdSchema = brandedUuid(productionGenerationId)
export const ArtStyleIdSchema = brandedUuid(artStyleId)
export const ShareLinkIdSchema = brandedUuid(shareLinkId)
export const AssistantChatIdSchema = brandedUuid(assistantChatId)
export const AssistantMessageIdSchema = brandedUuid(assistantMessageId)
export const ResearchCollectionIdSchema = brandedUuid(researchCollectionId)
export const ResearchSourceIdSchema = brandedUuid(researchSourceId)
export const ResearchClipIdSchema = brandedUuid(researchClipId)
export const ResearchFilingIdSchema = brandedUuid(researchFilingId)

// The five brands the pure core owns must survive the round trip through Zod.
// If one of these stops compiling, a schema has started minting its own brand
// and `@folio/script` and the wire have quietly diverged.
assertExact<Equals<z.infer<typeof NodeIdSchema>, NodeId>>()
assertExact<Equals<z.infer<typeof DocumentIdSchema>, DocumentId>>()
assertExact<Equals<z.infer<typeof RunIdSchema>, RunId>>()
assertExact<Equals<z.infer<typeof CharacterIdSchema>, CharacterId>>()
assertExact<Equals<z.infer<typeof LocationIdSchema>, LocationId>>()
assertExact<Equals<z.infer<typeof PropIdSchema>, PropId>>()

// ---------------------------------------------------------------------------
// The one slug
// ---------------------------------------------------------------------------

/**
 * `ep_NNN`, three digits or more.
 *
 * AGENTS.md, Conventions > Naming: "Episode ids are `ep_NNN`", and Routing
 * requires every episode id in a URL to be validated against the reserved
 * project-scoped names. This is the validator.
 *
 * It is a **slug, not a key** - `docs/adr/0002-episode-identity.md`. `ep_007`
 * visibly encodes an ordinal and an ordinal moves when an episode is reordered
 * or deleted; an identifier that changes is not an identifier. So `episodes.id`
 * is a UUID and this is a display-and-routing handle, unique within a project
 * and re-issuable.
 */
export const EPISODE_SLUG_PATTERN = /^ep_[0-9]{3,}$/

declare const slugBrand: unique symbol

export type EpisodeSlug = string & { readonly [slugBrand]: 'EpisodeSlug' }

export const episodeSlug = (raw: string): EpisodeSlug => raw as EpisodeSlug

export const EpisodeSlugSchema: z.ZodType<EpisodeSlug, string> = z
  .string()
  .regex(EPISODE_SLUG_PATTERN, 'An episode slug is ep_NNN - lower case, at least three digits.')
  .transform(episodeSlug)

/** `1` becomes `ep_001`. The only place the slug is written, so padding is not guessed twice. */
export const formatEpisodeSlug = (ordinal: number): EpisodeSlug =>
  episodeSlug(`ep_${String(ordinal).padStart(3, '0')}`)

/**
 * The reserved names an episode slug shares a path position with.
 *
 * AGENTS.md, Routing: "`:episodeId` shares a path position with the
 * project-scoped names. Validate every episode id against `characters`,
 * `locations`, `timeline`, `research`, `insights`, `production`,
 * `settings`, `assets`" - quoted verbatim, in its order. `bible` was in this
 * list while the route existed; the Bible route was cut 2026-09-15
 * (`docs/build-decisions.md`, "Bible route removed"), same treatment as
 * `build`/`search` - not reserved once cut.
 *
 * `props` is **not** in AGENTS.md's sentence: the Props route was built after
 * it was written (the Props pass), and a name in the episode's path position
 * must be reserved the day its route exists or `/props` and an episode slug
 * compete for the segment. It is appended rather than slotted in, so the
 * eight AGENTS.md names keep their order and the diff says which one is new.
 *
 * `ep_NNN` cannot collide with any of them, which is the point of the shape.
 * The list is here rather than in the router because "do not rely on
 * static-first precedence" is a rule about the data, not about Next.js.
 */
export const RESERVED_PROJECT_SEGMENTS = [
  'characters',
  'locations',
  'timeline',
  'research',
  'insights',
  'production',
  'settings',
  'assets',
  'props',
] as const

export type ReservedProjectSegment = (typeof RESERVED_PROJECT_SEGMENTS)[number]

export const isReservedProjectSegment = (value: string): value is ReservedProjectSegment =>
  (RESERVED_PROJECT_SEGMENTS as readonly string[]).includes(value)

/**
 * What a URL segment in the episode position turns out to be.
 *
 * `reserved` is reported *before* `shape` on purpose. `characters` fails the
 * `ep_NNN` regex too, so a shape-only check would refuse it - but for the
 * wrong reason, and nothing would ever learn that a project-scoped name had
 * reached the episode validator at all. Naming the reserved case is what makes
 * "do not rely on static-first precedence" a check rather than a hope.
 */
export type EpisodeSegmentResult =
  | { readonly ok: true; readonly slug: EpisodeSlug }
  | { readonly ok: false; readonly reason: 'reserved'; readonly segment: ReservedProjectSegment }
  | { readonly ok: false; readonly reason: 'shape'; readonly segment: string }

/**
 * The one validator for a segment that claims to be an episode.
 *
 * AGENTS.md, Routing: "Validate every episode id against `characters`,
 * `locations`, `timeline`, `research`, `insights`, `production`,
 * `settings`, `assets`, and keep ids to the `ep_NNN` shape. Static-first
 * precedence saves this tree by accident; do not rely on it."
 *
 * Both halves, in that order, in one function, so the router and the
 * repository that mints a slug run the same check. It returns a result rather
 * than throwing: a bad segment in a URL is data - the router turns it into a
 * 404 - and a bad slug at creation is a bug, which is the repository's call.
 */
export const parseEpisodeSegment = (raw: string): EpisodeSegmentResult => {
  if (isReservedProjectSegment(raw)) return { ok: false, reason: 'reserved', segment: raw }
  const parsed = EpisodeSlugSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'shape', segment: raw }
  return { ok: true, slug: parsed.data }
}

/**
 * The key that makes a create safe to retry.
 *
 * Not a uuid: the API's `tool_use` id is the key (ADR 0003 **D13**) and that
 * is an opaque string of the provider's choosing, so the schema checks a shape
 * a column can hold rather than a format nobody controls. Bounded because it
 * is indexed, and trimmed because whitespace either side of an id is a
 * different key for the same call.
 */
export const IdempotencyKeySchema = z.string().trim().min(1).max(200)
