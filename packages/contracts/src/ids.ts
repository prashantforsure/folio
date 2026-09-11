import { characterId, documentId, locationId, nodeId, runId } from '@folio/script'
import type { CharacterId, DocumentId, LocationId, NodeId, RunId } from '@folio/script'
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
/** A BullMQ job. No table this phase; the ledger carries the id as a forward reference. */
export type JobId = Branded<'JobId'>

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

// The five brands the pure core owns must survive the round trip through Zod.
// If one of these stops compiling, a schema has started minting its own brand
// and `@folio/script` and the wire have quietly diverged.
assertExact<Equals<z.infer<typeof NodeIdSchema>, NodeId>>()
assertExact<Equals<z.infer<typeof DocumentIdSchema>, DocumentId>>()
assertExact<Equals<z.infer<typeof RunIdSchema>, RunId>>()
assertExact<Equals<z.infer<typeof CharacterIdSchema>, CharacterId>>()
assertExact<Equals<z.infer<typeof LocationIdSchema>, LocationId>>()

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
 * `locations`, `timeline`, `bible`, `research`, `insights`, `production`,
 * `settings`, `assets`" - quoted verbatim, in its order.
 *
 * `ep_NNN` cannot collide with any of them, which is the point of the shape.
 * The list is here rather than in the router because "do not rely on
 * static-first precedence" is a rule about the data, not about Next.js.
 */
export const RESERVED_PROJECT_SEGMENTS = [
  'characters',
  'locations',
  'timeline',
  'bible',
  'research',
  'insights',
  'production',
  'settings',
  'assets',
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
 * `locations`, `timeline`, `bible`, `research`, `insights`, `production`,
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
