import {
  CAMERA_ANGLES,
  CONFIDENCES,
  DELIVERY_MODIFIERS,
  DOCUMENT_KINDS,
  INTERIOR_EXTERIOR,
  LIGHT_STATES,
  MENTION_ENTITIES,
  OUTLINE_NODE_TYPES,
  PAGE_MODES,
  PRESENCE_STATES,
  PROVENANCE_SOURCES,
  RESOLVE_ROW_STATES,
  REVISION_COLOURS,
  SCREENPLAY_NODE_TYPES,
  SCRIPT_FORMATS,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
} from '@folio/script'
import type {
  CameraAngle,
  Confidence,
  DeliveryModifier,
  DocumentKind,
  InteriorExterior,
  Light,
  MentionEntity,
  OutlineNodeType,
  PageMode,
  Presence,
  ProvenanceSource,
  ResolveRowState,
  RevisionColour,
  ScreenplayNodeType,
  ScriptFormat,
  ShotMovement,
  ShotSize,
} from '@folio/script'
import { z } from 'zod'

import { assertExact } from './equality'
import type { Equals } from './equality'

/**
 * Closed sets at the boundary.
 *
 * Two groups, and the split is the whole point of the file.
 *
 * **Group one is imported, never retyped.** Every enum `@folio/script` already
 * owns is built from that package's own `as const` tuple. Writing
 * `z.enum(['scene', 'action', ...])` here would be a second declaration of the
 * eight element types, and AGENTS.md, The node model says "rejecting anything
 * outside the eight types is that schema's entire job" - a job that cannot be
 * done by two lists that might disagree. Each one is followed by an
 * `assertExact` so a ninth type added to the core fails the compile here rather
 * than passing silently over the wire.
 *
 * **Group two is declared here**, because it is boundary vocabulary the pure
 * core has no business knowing: how a project is billed, what role a member
 * has, what a comment thread is anchored to. `packages/script` must not learn
 * any of it.
 */

// ---------------------------------------------------------------------------
// Group one: the pure core's closed sets, re-expressed as schemas
// ---------------------------------------------------------------------------

export const ScreenplayNodeTypeSchema = z.enum(SCREENPLAY_NODE_TYPES)
export const OutlineNodeTypeSchema = z.enum(OUTLINE_NODE_TYPES)
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS)
export const ProvenanceSourceSchema = z.enum(PROVENANCE_SOURCES)
export const DeliveryModifierSchema = z.enum(DELIVERY_MODIFIERS)
export const MentionEntitySchema = z.enum(MENTION_ENTITIES)
export const RevisionColourSchema = z.enum(REVISION_COLOURS)
export const ScriptFormatSchema = z.enum(SCRIPT_FORMATS)
export const PageModeSchema = z.enum(PAGE_MODES)
export const ConfidenceSchema = z.enum(CONFIDENCES)
export const PresenceSchema = z.enum(PRESENCE_STATES)
export const ResolveRowStateSchema = z.enum(RESOLVE_ROW_STATES)
export const InteriorExteriorSchema = z.enum(INTERIOR_EXTERIOR)
export const LightSchema = z.enum(LIGHT_STATES)

assertExact<Equals<z.infer<typeof ScreenplayNodeTypeSchema>, ScreenplayNodeType>>()
assertExact<Equals<z.infer<typeof OutlineNodeTypeSchema>, OutlineNodeType>>()
assertExact<Equals<z.infer<typeof DocumentKindSchema>, DocumentKind>>()
assertExact<Equals<z.infer<typeof ProvenanceSourceSchema>, ProvenanceSource>>()
assertExact<Equals<z.infer<typeof DeliveryModifierSchema>, DeliveryModifier>>()
assertExact<Equals<z.infer<typeof MentionEntitySchema>, MentionEntity>>()
assertExact<Equals<z.infer<typeof RevisionColourSchema>, RevisionColour>>()
assertExact<Equals<z.infer<typeof ScriptFormatSchema>, ScriptFormat>>()
assertExact<Equals<z.infer<typeof PageModeSchema>, PageMode>>()
assertExact<Equals<z.infer<typeof ConfidenceSchema>, Confidence>>()
assertExact<Equals<z.infer<typeof PresenceSchema>, Presence>>()
assertExact<Equals<z.infer<typeof ResolveRowStateSchema>, ResolveRowState>>()
assertExact<Equals<z.infer<typeof InteriorExteriorSchema>, InteriorExterior>>()
assertExact<Equals<z.infer<typeof LightSchema>, Light>>()

// ---------------------------------------------------------------------------
// Group two: boundary vocabulary the pure core does not know
// ---------------------------------------------------------------------------

/**
 * The three axes a project is created with. Together they decide the whole
 * workspace the writer lands in, which is why `/app/new` collects all three
 * before it can create anything.
 *
 * ## `kind` - which product this is
 *
 * `screenwriting` or `filmmaking`. It decides the rail, the routes and the
 * default landing. AGENTS.md, Constraints: "`/app/filmmaking` is a project list
 * and a creation entry point. Stop there. It needs an ADR first" - open
 * decision 9. So a `filmmaking` project can be created and listed, and nothing
 * in this repository yet knows what its workspace is.
 *
 * **This used to be the film-or-series axis.** The schema phase named the
 * column `kind` after the design handoff's Appendix A (`Project { kind: 'film'
 * | 'series' }`). AGENTS.md's own vocabulary for that axis is "project type" -
 * Routing: "`projectType: 'film'` hides the episode segment"; Constraints: "No
 * `short` project type" - and the `/app/new` brief uses `kind` for
 * screenwriting-or-filmmaking. The contract follows AGENTS.md and the brief;
 * migration `0002` renames the column to match.
 */
export const PROJECT_KINDS = ['screenwriting', 'filmmaking'] as const

export type ProjectKind = (typeof PROJECT_KINDS)[number]

export const ProjectKindSchema = z.enum(PROJECT_KINDS)

/**
 * ## `projectType` - one document, or episodes
 *
 * AGENTS.md, Constraints: "**No `short` project type.** `film` and `series`
 * only." The design bundle's older Appendix A said
 * `'series' | 'feature' | 'short'`; that is retracted and the README says so.
 *
 * A `film` still stores one episode row. AGENTS.md, Routing: "`projectType:
 * 'film'` **hides** the episode segment. The database still stores one episode
 * row. The router special-cases the shape; the schema never does."
 */
export const PROJECT_TYPES = ['film', 'series'] as const

export type ProjectType = (typeof PROJECT_TYPES)[number]

export const ProjectTypeSchema = z.enum(PROJECT_TYPES)

/*
 * ## `format` - the third axis - is `ScriptFormatSchema` above
 *
 * `hollywood` (US Letter) or `asian` (A4). Owned by `@folio/script` because it
 * is an **input to the pagination engine, not a print preference**: AGENTS.md,
 * Pagination and the sheet says it "changes line width, page count, page
 * numbers and eighths". It is stored on the project so every episode is
 * measured at the same width, and so the project card can read the one
 * measurement that matches.
 */

/**
 * What a membership lets someone do.
 *
 * Three roles, not a permission matrix. AGENTS.md gives no role model, and a
 * matrix invented here would be a product decision taken in a commit. These
 * three are the minimum the constraints already imply: team invites are share
 * links (Constraints), so somebody issues them (`owner`), somebody writes
 * (`writer`), and a link can be handed to somebody who should only read
 * (`reader`). Nothing in this phase reads the role - it is stored, and every
 * gate that will consult it is a later phase's server-side check.
 */
export const MEMBERSHIP_ROLES = ['owner', 'writer', 'reader'] as const

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const MembershipRoleSchema = z.enum(MEMBERSHIP_ROLES)

/**
 * The four things a comment thread can be anchored to.
 *
 * Modelled as four from the start even though storyboard shots do not exist
 * yet, because widening a union later is the expensive direction and the fourth
 * variant is free today. AGENTS.md, Development philosophy 6: "Prefer a
 * discriminated union over a boolean plus a comment."
 *
 * Three of the four resolve to a `nodes` row - a beat and an outline block are
 * both outline nodes, a script node is a screenplay node - and the fourth
 * resolves to nothing yet. The discriminator is not redundant with the column:
 * it says what the writer thinks they commented on, which is what the Notes
 * inbox groups by, and it is what will keep working when a shot becomes a row
 * of its own.
 */
export const THREAD_ANCHOR_KINDS = ['script_node', 'beat', 'outline_block', 'storyboard_shot'] as const

export type ThreadAnchorKind = (typeof THREAD_ANCHOR_KINDS)[number]

export const ThreadAnchorKindSchema = z.enum(THREAD_ANCHOR_KINDS)

/**
 * The design README describes Notes as "an inbox of open/mine/resolved
 * comments". `mine` is a filter over the author, not a state, so the states are
 * two.
 */
export const THREAD_STATES = ['open', 'resolved'] as const

export type ThreadState = (typeof THREAD_STATES)[number]

export const ThreadStateSchema = z.enum(THREAD_STATES)

/**
 * Why a node id was retired.
 *
 * `docs/adr/0001-node-identity.md`, Consequences: "Delete tombstones and an id
 * is never reused, so `packages/db` needs somewhere to record a retired id and
 * the detached anchors that used to point at it." A merge retires the loser's
 * id the same way a delete does, and undo has to bring either back, so both are
 * tombstones and the reason says which.
 */
export const TOMBSTONE_REASONS = ['deleted', 'merged'] as const

export type TombstoneReason = (typeof TOMBSTONE_REASONS)[number]

export const TombstoneReasonSchema = z.enum(TOMBSTONE_REASONS)

/**
 * The kinds of entry in the credits ledger.
 *
 * AGENTS.md, Jobs, credits and cost: "The credits ledger is **append-only** and
 * the balance is **computed, never stored**", "**Reserve then execute.** The
 * balance check happens *before* the job is enqueued, never inside it", and
 * "**Failure refunds.**" Those three sentences are what this list has to be
 * able to express, and the shape they force is a reservation that is later
 * either released or converted:
 *
 *   `grant`    credits given - trial, plan allowance, goodwill
 *   `purchase` credits bought through Dodo. Carries the external reference
 *   `reserve`  negative. Taken before a job is enqueued
 *   `release`  positive. A reservation given back because the job never ran
 *   `spend`    negative. Work actually done
 *   `refund`   positive. A job that ran and failed
 *   `expire`   negative. A grant that timed out
 *   `adjust`   signed. A human correction, which is why `reason` is not null
 *
 * A `release` and a `refund` are both positive and both undo a charge, and they
 * are separate because they answer different questions: a release means nothing
 * was consumed, a refund means something was and we are eating it. Collapsing
 * them would make "how much did failure cost us" unanswerable from the ledger,
 * and the ledger is the only place it could be answered from.
 */
export const LEDGER_ENTRY_KINDS = [
  'grant',
  'purchase',
  'reserve',
  'release',
  'spend',
  'refund',
  'expire',
  'adjust',
] as const

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number]

export const LedgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS)

/**
 * Which pooler a connection came through.
 *
 * AGENTS.md, Tech stack: "Session pooler for the worker, transaction pooler for
 * requests." It is here rather than in `@folio/db` because it is a type the
 * worker and the web app both name when they ask for a connection, and because
 * a repository function that genuinely needs a session - an advisory lock, a
 * `LISTEN` - should be able to say so in its signature.
 */
export const POOLER_MODES = ['session', 'transaction'] as const

export type PoolerMode = (typeof POOLER_MODES)[number]

export const PoolerModeSchema = z.enum(POOLER_MODES)

// ---------------------------------------------------------------------------
// Storyboard: shots, jobs, generations
// ---------------------------------------------------------------------------

/**
 * A shot's three closed vocabularies are the pure core's (`@folio/script`,
 * `shots.ts`), borrowed here the way the eight element types are.
 */
export const ShotSizeSchema = z.enum(SHOT_SIZES)
export const ShotMovementSchema = z.enum(SHOT_MOVEMENTS)
export const CameraAngleSchema = z.enum(CAMERA_ANGLES)

assertExact<Equals<z.infer<typeof ShotSizeSchema>, ShotSize>>()
assertExact<Equals<z.infer<typeof ShotMovementSchema>, ShotMovement>>()
assertExact<Equals<z.infer<typeof CameraAngleSchema>, CameraAngle>>()

/**
 * Where a shot came from, and whether the writer has taken it.
 *
 * The Storyboard brief: "Provenance. Proposed, then accepted." Two columns,
 * because they answer different questions. `origin` is history and never
 * changes: `typed` is a shot the writer added by hand, `auto_board` one the
 * proposer wrote. `state` is the writer's verdict: `proposed` until they
 * accept it (or edit it, which is acceptance), `accepted` from then on. A
 * typed shot is born accepted - the database checks the pair.
 *
 * Only an accepted shot is on the shot list. A proposal is drawn as one,
 * counted separately, and is what "a list you accept or edit" means.
 */
export const SHOT_ORIGINS = ['typed', 'auto_board'] as const

export type ShotOrigin = (typeof SHOT_ORIGINS)[number]

export const ShotOriginSchema = z.enum(SHOT_ORIGINS)

export const SHOT_STATES = ['proposed', 'accepted'] as const

export type ShotState = (typeof SHOT_STATES)[number]

export const ShotStateSchema = z.enum(SHOT_STATES)

/**
 * What a job does. One kind this phase - a frame for a shot. Export, agent
 * runs and reels join it as they are built; the column is an enum so a
 * consumer switching on it is told when they do.
 */
export const JOB_KINDS = ['frame_generation'] as const

export type JobKind = (typeof JOB_KINDS)[number]

export const JobKindSchema = z.enum(JOB_KINDS)

/**
 * A job's lifecycle. AGENTS.md, Jobs, credits and cost, and the Production
 * bundle's six modes, which are driven "from the job row":
 *
 *   `queued`     written, reservation held, not yet picked up
 *   `running`    a worker has it
 *   `finished`   done; the reservation became a spend
 *   `failed`     it ran and broke; the reservation was refunded
 *   `blocked`    moderation refused it; the reason is on the row, in the
 *                writer's terms, and the reservation was released
 *   `cancelled`  the writer stopped it before it finished; released
 *
 * The three terminal-and-not-finished states each name what the ledger did,
 * so a balance can always be explained from a job row and its entries.
 */
export const JOB_STATUSES = ['queued', 'running', 'finished', 'failed', 'blocked', 'cancelled'] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export const JobStatusSchema = z.enum(JOB_STATUSES)

/** A job that will not change again. */
export const isTerminalJobStatus = (status: JobStatus): boolean =>
  status === 'finished' || status === 'failed' || status === 'blocked' || status === 'cancelled'
