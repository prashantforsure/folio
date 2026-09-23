import { z } from 'zod'

import {
  AgentProposalIdSchema,
  AgentProposalOpIdSchema,
  DocumentIdSchema,
  EpisodeIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  UserIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * Proposals - how the agent changes anything (ADR 0003 **D1**, **D10**,
 * **D11**; roadmap Phase 3).
 *
 * A proposal is a stored, ordered list of operations the writer reviews
 * before anything lands. Each operation is one tool call - its name, its
 * arguments, the mode it runs in and the idempotency key the API gave it
 * (D13) - and, once applied, what it returned and what it would take to put
 * it back (`undo`).
 *
 * ## A proposal is a pending intention, never an account of the script
 *
 * ADR 0003's closing warning, repeated where the shape lives: if anything ever
 * reads a proposal to answer "what does the script say", that is a second
 * authority arriving. A proposal is readable only as itself. The node list is
 * what the script says.
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * Where a proposal is.
 *
 *   - `pending` - planned, waiting for the writer (or for the panel, under `auto`).
 *   - `applied` - every operation ran.
 *   - `rejected` - the writer said no; nothing ran.
 *   - `stale` - a document it was planned against changed before it applied
 *     (D10's compare-and-swap); nothing ran, and it is re-planned, never forced.
 *   - `failed` - the first operation failed; nothing landed.
 *   - `partially_applied` - some operations ran and a later one failed. Apply
 *     stops at the first failure, so the applied ones are a prefix.
 */
export const AGENT_PROPOSAL_STATUSES = ['pending', 'applied', 'rejected', 'stale', 'failed', 'partially_applied'] as const

export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number]

export const AgentProposalStatusSchema = z.enum(AGENT_PROPOSAL_STATUSES)

/** Whether a proposal can still be decided. Everything but `pending` is over. */
export const isOpenProposal = (status: AgentProposalStatus): boolean => status === 'pending'

/**
 * Where one operation is. `skipped` is an operation that never ran because an
 * earlier one failed; `undone` is one a run-level undo has reversed.
 */
export const AGENT_OP_STATUSES = ['pending', 'applied', 'failed', 'skipped', 'undone'] as const

export type AgentOpStatus = (typeof AGENT_OP_STATUSES)[number]

export const AgentOpStatusSchema = z.enum(AGENT_OP_STATUSES)

/**
 * The mode an operation runs in - `docs/agents/tools.md`, *Modes*, less the
 * two that never make an operation (`read` runs immediately, `client` is the
 * panel's). `confirm` and `paid` always stop for an explicit confirmation,
 * whatever the writer's autonomy (D1); `direct` has already landed as
 * proposed rows by the time the proposal is written.
 */
export const AGENT_OP_MODES = ['propose', 'confirm', 'paid', 'direct'] as const

export type AgentOpMode = (typeof AGENT_OP_MODES)[number]

export const AgentOpModeSchema = z.enum(AGENT_OP_MODES)

/** Whether an operation in this mode needs a person to say yes, in either autonomy setting (D1). */
export const needsConfirmation = (mode: AgentOpMode): boolean => mode === 'confirm' || mode === 'paid'

/**
 * A writer's autonomy - D1. `review` (the default) shows every proposal;
 * `auto` applies one the moment it is planned. Neither lets a `confirm` or
 * `paid` operation through without a click.
 */
export const AGENT_AUTONOMIES = ['review', 'auto'] as const

export type AgentAutonomy = (typeof AGENT_AUTONOMIES)[number]

export const AgentAutonomySchema = z.enum(AGENT_AUTONOMIES)

// ---------------------------------------------------------------------------
// What a proposal was planned against
// ---------------------------------------------------------------------------

/**
 * One document as it stood when the proposal was planned: its id and the
 * digest of its stored node list (`nodeDigest`, the function that writes
 * `measurements.node_digest`). Applying on the server compares against it
 * (D10); a mismatch is `stale`.
 */
export const ProposalDocumentBaseSchema = z.object({
  documentId: DocumentIdSchema,
  kind: z.enum(['screenplay', 'outline']),
  episodeId: EpisodeIdSchema,
  digest: z.string().min(1).max(128),
})

export type ProposalDocumentBase = z.infer<typeof ProposalDocumentBaseSchema>

/** A proposal's base. A proposal that touches only records has no documents. */
export const ProposalBaseSchema = z.object({
  documents: z.array(ProposalDocumentBaseSchema).max(64),
})

export type ProposalBase = z.infer<typeof ProposalBaseSchema>

export const EMPTY_PROPOSAL_BASE: ProposalBase = { documents: [] }

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const AgentProposalSchema = z.object({
  id: AgentProposalIdSchema,
  projectId: ProjectIdSchema,
  runId: RunIdSchema,
  episodeId: EpisodeIdSchema.nullable(),
  status: AgentProposalStatusSchema,
  /** One line, written by code from the operations' own descriptions - never the model's words. */
  summary: z.string().min(1).max(500),
  base: ProposalBaseSchema,
  /** True when any operation is `confirm` or `paid` (D1). Fixed when the proposal is written. */
  needsConfirmation: z.boolean(),
  /** Credits the proposal would spend, named before it is spent; null when it spends none. */
  creditCost: z.int().min(0).nullable(),
  decidedBy: UserIdSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type AgentProposal = z.infer<typeof AgentProposalSchema>

export const AgentProposalOpSchema = z.object({
  id: AgentProposalOpIdSchema,
  projectId: ProjectIdSchema,
  proposalId: AgentProposalIdSchema,
  /** 0-based position in the proposal. Operations apply in this order and undo in reverse. */
  seq: z.int().min(0),
  /** The tool's name, from `docs/agents/tools.md`. */
  tool: z.string().min(1).max(80),
  /** The tool's input as the tool parsed it. */
  args: z.unknown(),
  mode: AgentOpModeSchema,
  /** The API's `tool_use` id (D13); the wrapped action's idempotency key where it takes one. */
  idempotencyKey: z.string().min(1).max(200),
  status: AgentOpStatusSchema,
  /** What the wrapped action answered, once it ran. */
  result: z.unknown(),
  /** What it would take to put it back: prior values, a restore payload. Null when it cannot be undone. */
  undo: z.unknown(),
  appliedAt: TimestampSchema.nullable(),
})

export type AgentProposalOp = z.infer<typeof AgentProposalOpSchema>

/** A proposal with its operations, in order - what the card reads. */
export type AgentProposalWithOps = {
  readonly proposal: AgentProposal
  readonly ops: readonly AgentProposalOp[]
}
