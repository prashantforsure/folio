import type { AgentOpMode, MembershipRole, ProposalDocumentBase } from '@folio/contracts'
import type { z } from 'zod'

import type { Executor, ExecutorDefinition } from './executors'
import { defineExecutor } from './executors'
import type { Tool, ToolContext, ToolResult, Toolset } from './registry'
import { defineTool } from './registry'

/**
 * A write tool and what applying it means, in one definition - roadmap tasks
 * 3.5 and 3.6.
 *
 * A write tool **never writes** (ADR 0003 D1). When the model calls it, it
 * checks the call, reads what it needs to describe it, and queues one
 * operation for the step's proposal (`ctx.proposals.propose`); the model is
 * told what it proposed and that the writer will review it. What happens on
 * Apply is the executor beside it (`executors.ts`), registered under the same
 * name, so the tool that plans a change and the code that makes it are read
 * in one place.
 *
 * `mode` is the catalogue's (`docs/agents/tools.md`): `propose` groups into
 * the step's one proposal, `confirm` gets a proposal of its own that always
 * asks, and `direct` runs at once through `ctx.proposals.applyNow` - its
 * output already lands as proposed rows, or it only cancels something. A tool
 * whose catalogue mode is `propose · confirm` returns the stronger mode from
 * `prepare` for its destructive action.
 */

export type Prepared<Args> =
  | {
      readonly ok: true
      readonly args: Args
      /** Overrides the tool's mode for this call - `manage_threads`' delete is `confirm`. */
      readonly mode?: AgentOpMode
      readonly base?: ProposalDocumentBase
      readonly mergeKey?: string
      /** Anything worth telling the model beside "proposed": a rename's blast radius. */
      readonly note?: unknown
    }
  | { readonly ok: false; readonly message: string }

export type WriteToolDefinition<Input, Args> = {
  readonly name: string
  readonly description: string
  readonly toolset: Toolset
  readonly minimumRole: MembershipRole
  readonly mode: Exclude<AgentOpMode, 'paid'>
  readonly input: z.ZodType<Input>
  readonly label: (input: Input) => string
  /** The model's input, checked and turned into what is stored. */
  readonly prepare: (ctx: ToolContext, input: Input) => Promise<Prepared<Args>>
  readonly executor: Omit<ExecutorDefinition<Args>, 'tool' | 'minimumRole'>
}

export type WriteTool = { readonly tool: Tool; readonly executor: Executor }

export const defineWriteTool = <Input, Args>(definition: WriteToolDefinition<Input, Args>): WriteTool => {
  const executor = defineExecutor<Args>({ ...definition.executor, tool: definition.name, minimumRole: definition.minimumRole })
  const tool = defineTool<Input>({
    name: definition.name,
    description: definition.description,
    toolset: definition.toolset,
    minimumRole: definition.minimumRole,
    mode: definition.mode,
    input: definition.input,
    label: definition.label,
    run: async (ctx, input): Promise<ToolResult> => {
      const prepared = await definition.prepare(ctx, input)
      if (!prepared.ok) return { ok: false, message: prepared.message }
      const mode = prepared.mode ?? definition.mode
      const description = definition.executor.describe(prepared.args)
      const op = { tool: definition.name, args: prepared.args, mode, description, base: prepared.base, mergeKey: prepared.mergeKey }
      if (mode === 'direct') {
        const done = await ctx.proposals.applyNow(op)
        if (!done.ok) return { ok: false, message: done.message }
        return { ok: true, content: { done: description, proposalId: done.proposalId, result: done.result }, summary: description }
      }
      ctx.proposals.propose(op)
      return {
        ok: true,
        content: {
          proposed: description,
          ...(prepared.note === undefined ? {} : { note: prepared.note }),
          status: mode === 'confirm' ? 'The writer must confirm this before it runs.' : 'The writer will review this proposal; nothing has changed yet.',
        },
        summary: `Proposed: ${description}`,
      }
    },
  })
  return { tool, executor }
}

/** Split write tools into the registry's two lists. */
export const toolsOf = (list: readonly WriteTool[]): readonly Tool[] => list.map((entry) => entry.tool)

export const executorsOf = (list: readonly WriteTool[]): readonly Executor[] => list.map((entry) => entry.executor)
