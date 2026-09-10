import { z } from 'zod'

import { ThreadStateSchema } from './enums'
import {
  NodeIdSchema,
  ProjectIdSchema,
  ThreadCommentIdSchema,
  ThreadIdSchema,
  UserIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * Comment threads, and the four things one can be anchored to.
 *
 * ## Anchoring is by id, and only by id
 *
 * AGENTS.md, The AI agent: proposals "are anchored to node ids and rendered as
 * hunks against current node state." The same is true of a comment, and
 * `docs/adr/0001-node-identity.md` says why it matters: an anchor that moves to
 * the wrong place "does not fail loudly - it silently re-points a reviewer's
 * comment at somebody else's line." The ADR's closing question names the
 * failure mode to avoid: a system that, having lost an id at a split, "starts
 * anchoring comments by text offset or by matching prose."
 *
 * So there is no offset, no quoted text, and no line number in this file. A
 * thread knows one id. When that id is retired, `node_tombstones` says whether
 * it was merged into a survivor - and a detached thread is a designed state,
 * the same way `0 appearances - record kept` is for a character.
 *
 * ## Four variants, one of which has nothing to point at yet
 *
 * Storyboard shots do not exist. The variant is modelled anyway, because
 * widening a union after rows exist is the expensive direction and the fourth
 * case costs nothing today.
 *
 * Three of the four resolve to a `nodes` row - a script node is a screenplay
 * node, and a beat and an outline block are both outline nodes. The
 * discriminator is still load-bearing: it records what the writer thinks they
 * annotated, which is what the Notes inbox groups by, and it keeps working when
 * a shot becomes a row of its own and the fourth variant stops being empty.
 */

/** A thread hung on a node: a script node, an outline block, or a beat. */
const NodeAnchorSchema = z.object({
  kind: z.enum(['script_node', 'beat', 'outline_block']),
  nodeId: NodeIdSchema,
})

/**
 * A thread hung on a storyboard shot.
 *
 * `shotId` is a raw UUID rather than a branded `ShotId`, and there is no
 * foreign key behind it, because shots are not a table yet. Both are deliberate
 * placeholders and both are cheap to tighten: the brand is one line here, the
 * constraint is one forward migration.
 */
const ShotAnchorSchema = z.object({
  kind: z.literal('storyboard_shot'),
  shotId: z.uuid(),
})

export const ThreadAnchorSchema = z.discriminatedUnion('kind', [
  NodeAnchorSchema,
  ShotAnchorSchema,
])

export type ThreadAnchor = z.infer<typeof ThreadAnchorSchema>

/**
 * A comment thread.
 *
 * `resolvedAt` and `resolvedBy` travel with `state` rather than being inferred
 * from it, because the Notes route filters on open / mine / resolved and needs
 * to say who closed something.
 *
 * **A thread never reaches an export.** AGENTS.md, Export: "Comments never
 * enter an export. Notes never enter an export." That is enforced in the
 * exporter, which does not read this table at all - not by a flag here.
 */
export const ThreadSchema = z
  .object({
    id: ThreadIdSchema,
    projectId: ProjectIdSchema,
    anchor: ThreadAnchorSchema,
    state: ThreadStateSchema,
    createdBy: UserIdSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    resolvedAt: TimestampSchema.nullable(),
    resolvedBy: UserIdSchema.nullable(),
  })
  .refine(
    (value) => (value.state === 'resolved') === (value.resolvedAt !== null),
    'A resolved thread carries when it was resolved; an open one carries neither.',
  )

export type Thread = z.infer<typeof ThreadSchema>

/**
 * One message in a thread.
 *
 * Threads have replies; Appendix A's `Note` had a single `body`. Splitting the
 * body out is an **assumption** - "Threads" in the brief implies a
 * conversation, and the Notes route shows an inbox of comments rather than a
 * flat list of one-liners - but nobody has specified reply behaviour, and the
 * design bundle for the Notes route was not read as settling it.
 */
export const ThreadCommentSchema = z.object({
  id: ThreadCommentIdSchema,
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  authorId: UserIdSchema,
  body: z.string().trim().min(1).max(10_000),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  editedAt: TimestampSchema.nullable(),
})

export type ThreadComment = z.infer<typeof ThreadCommentSchema>
