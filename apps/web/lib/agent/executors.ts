import type { AgentOpMode, AgentOpStatus, AgentProposalId, AgentRoute, MembershipRole, VersionId } from '@folio/contracts'
import type { DocumentId, NodeId, RunId } from '@folio/script'
import type { z } from 'zod'

import type { DiffView, RecordChange } from './diff-view'
import type { ToolGate } from './registry'

/**
 * Executors - what an operation *does* once the writer says yes (roadmap
 * task 3.2, ADR 0003 **D1**, **D11**).
 *
 * A write tool does not write. When the model calls one it validates the call
 * and adds an operation to a proposal (`registry.ts`, `ctx.propose`). The
 * operation is applied later - by the writer's click, or at once under `auto` -
 * and that is this file: one executor per write tool, keyed by the tool's
 * name, holding four things `apply.ts` needs and a tool does not.
 *
 *   - **`describe`** - the operation in plain language, for the card and the
 *     proposal's summary. Written by code from the arguments, never the model's
 *     words (the summary column says so).
 *   - **`capture`** - the undo record, read **before** the operation runs:
 *     the prior field values for an update, the membership of a set for a
 *     placement. `null` means it cannot be undone (a merge, a hard delete), and
 *     the card says so before the writer applies it.
 *   - **`run`** - the wrapped action, called with the operation's idempotency
 *     key where the action takes one. It may hand back a better undo record
 *     than `capture` could - a rename's restore payload only exists after the
 *     rename - which replaces the captured one.
 *   - **`invert`** - put it back, for "undo this run". When the thing it
 *     changed has changed again since, it does not overwrite: it answers
 *     `changed` with the operations that would put it back, and `undoRun`
 *     makes those a new proposal the writer reviews.
 *
 * Executors are registered beside their tools (`tools/writes-*.ts`), so a tool
 * and what applying it means are read in one file.
 */

/** What an executor runs as: the gate the apply opened, the run the proposal belongs to. */
export type ExecContext = {
  readonly gate: ToolGate
  readonly runId: RunId
  readonly proposalId: AgentProposalId
  /** The operation's `tool_use` id (D13) - the wrapped action's idempotency key. */
  readonly idempotencyKey: string
  /**
   * Each document's digest as this apply has left it, starting from the
   * proposal's base. A document operation compares against it and writes the
   * new digest back, so the second edit to one script in a proposal checks
   * against the first edit's result rather than the stale base (D10).
   */
  readonly digests: Map<DocumentId, string>
  /** The `before_agent_run` snapshot apply took of each document, before anything ran (D11). */
  readonly snapshots: ReadonlyMap<DocumentId, VersionId>
  /**
   * Documents the writer has open in an editor (roadmap task 3.4, D10 path
   * A). A document operation on one of these does not write: it answers
   * `deferred`, and the panel hands the operations to that editor.
   */
  readonly editorDocuments: ReadonlySet<DocumentId>
}

export type ExecOutcome =
  | {
      readonly ok: true
      /** What the action answered, stored on the operation. */
      readonly result: unknown
      /** A better undo record than `capture`'s, known only after the run. Omitted: keep the captured one. */
      readonly undo?: unknown
      /**
       * Not written here: the writer's open editor applies it (D10 path A). The
       * operation stays pending, with its undo record, until the panel reports.
       */
      readonly deferred?: { readonly documentId: DocumentId; readonly kind: 'screenplay' | 'outline'; readonly ops: unknown }
    }
  | {
      readonly ok: false
      readonly message: string
      /** The document moved under it (D10): the proposal is `stale`, not `failed`. */
      readonly stale?: boolean
    }

/** An operation that would put something back, proposed rather than applied when the target has moved on. */
export type InverseOp = {
  readonly tool: string
  readonly args: unknown
  readonly mode: AgentOpMode
}

export type InvertOutcome =
  | { readonly kind: 'undone'; readonly note?: string }
  /** The target changed since the run: nothing was overwritten, and these operations would restore it. */
  | { readonly kind: 'changed'; readonly ops: readonly InverseOp[]; readonly note: string }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * What the card shows for one operation (roadmap task 3.3): record changes as
 * before and after values, a document change as hunks, and where Open goes.
 * Every part is optional - a comment has no before, a merge no hunk.
 */
export type OpPreview = {
  readonly changes?: readonly RecordChange[]
  readonly diff?: DiffView
  readonly open?: OpenTarget
}

/** Where the card's Open button takes the writer - resolved to a URL target on the server (`targets.ts`). */
export type OpenTarget = {
  readonly route: AgentRoute
  readonly episode?: number
  readonly sceneId?: NodeId
  readonly recordId?: string
}

/**
 * What a preview reads with. `scratch` is shared by the operations of one
 * proposal, in order, so the second edit to one script previews on top of the
 * first rather than against the stored list.
 */
export type PreviewContext = {
  readonly gate: ToolGate
  readonly runId: RunId
  readonly scratch: Map<string, unknown>
}

/** An operation as the preview sees it: pending ones read current state, applied ones their undo record. */
export type StoredOp = { readonly status: AgentOpStatus; readonly undo: unknown; readonly result: unknown }

/** Who the activity row is about. `id` is a uuid or null - `activity_log.target_id` is a uuid column. */
export type ActivityTarget = { readonly type: string; readonly id: string | null }

export type ExecutorDefinition<Args> = {
  readonly tool: string
  /** The stored `args`, parsed again before anything runs - a row is data, not a promise. */
  readonly args: z.ZodType<Args>
  /** The minimum role to apply it - the tool's, from `lib/auth/roles.ts`. */
  readonly minimumRole: MembershipRole
  readonly describe: (args: Args) => string
  readonly target: (args: Args) => ActivityTarget
  /** Documents to snapshot `before_agent_run` beside the proposal's base - every script a rename rewrites. */
  readonly documents?: (ctx: ExecContext, args: Args) => Promise<readonly DocumentId[]>
  /** The undo record, read before the run. `null`: this cannot be undone. */
  readonly capture: (ctx: ExecContext, args: Args) => Promise<unknown>
  readonly run: (ctx: ExecContext, args: Args, captured: unknown) => Promise<ExecOutcome>
  /** Absent: the operation cannot be undone, whatever `capture` said. */
  readonly invert?: (ctx: ExecContext, args: Args, undo: unknown, result: unknown) => Promise<InvertOutcome>
  /** What the card shows. Absent: the description is all there is to show. */
  readonly preview?: (ctx: PreviewContext, args: Args, op: StoredOp) => Promise<OpPreview>
}

/** An executor as the registry holds it: `args` erased, parsed on the way in. */
export type Executor = {
  readonly tool: string
  readonly minimumRole: MembershipRole
  readonly reversible: boolean
  readonly parse: (raw: unknown) => { readonly ok: true; readonly args: unknown } | { readonly ok: false; readonly message: string }
  readonly describe: (raw: unknown) => string
  readonly target: (raw: unknown) => ActivityTarget
  readonly documents: (ctx: ExecContext, raw: unknown) => Promise<readonly DocumentId[]>
  readonly capture: (ctx: ExecContext, raw: unknown) => Promise<unknown>
  readonly run: (ctx: ExecContext, raw: unknown, captured: unknown) => Promise<ExecOutcome>
  readonly invert: ((ctx: ExecContext, raw: unknown, undo: unknown, result: unknown) => Promise<InvertOutcome>) | null
  readonly preview: (ctx: PreviewContext, raw: unknown, op: StoredOp) => Promise<OpPreview>
}

const unreadable = (tool: string): string => `The stored ${tool} operation did not read.`

/** Typed at the definition, erased in the registry - through a parse, never a cast. */
export const defineExecutor = <Args>(definition: ExecutorDefinition<Args>): Executor => {
  const parse = (raw: unknown): Args | null => {
    const parsed = definition.args.safeParse(raw)
    return parsed.success ? parsed.data : null
  }
  const invert = definition.invert
  const preview = definition.preview
  return {
    tool: definition.tool,
    minimumRole: definition.minimumRole,
    reversible: invert !== undefined,
    parse: (raw) => {
      const args = parse(raw)
      return args === null ? { ok: false, message: unreadable(definition.tool) } : { ok: true, args }
    },
    describe: (raw) => {
      const args = parse(raw)
      return args === null ? definition.tool : definition.describe(args)
    },
    target: (raw) => {
      const args = parse(raw)
      return args === null ? { type: definition.tool, id: null } : definition.target(args)
    },
    documents: async (ctx, raw) => {
      const args = parse(raw)
      return args === null || definition.documents === undefined ? [] : definition.documents(ctx, args)
    },
    capture: async (ctx, raw) => {
      const args = parse(raw)
      return args === null ? null : definition.capture(ctx, args)
    },
    run: async (ctx, raw, captured) => {
      const args = parse(raw)
      return args === null ? { ok: false, message: unreadable(definition.tool) } : definition.run(ctx, args, captured)
    },
    invert:
      invert === undefined
        ? null
        : async (ctx, raw, undo, result) => {
            const args = parse(raw)
            return args === null ? { kind: 'failed', message: unreadable(definition.tool) } : invert(ctx, args, undo, result)
          },
    preview: async (ctx, raw, op) => {
      const args = parse(raw)
      return args === null || preview === undefined ? {} : preview(ctx, args, op)
    },
  }
}

const executors = new Map<string, Executor>()

/** Register executors. The same executor again is a no-op (a second import); another under a taken name is a programming error. */
export const registerExecutors = (list: readonly Executor[]): void => {
  for (const executor of list) {
    const held = executors.get(executor.tool)
    if (held === executor) continue
    if (held !== undefined) throw new Error(`Folio: the executor ${executor.tool} is registered twice.`)
    executors.set(executor.tool, executor)
  }
}

export const executorFor = (tool: string): Executor | undefined => executors.get(tool)

export const registeredExecutors = (): readonly Executor[] => [...executors.values()]
