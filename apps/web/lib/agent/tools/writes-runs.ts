import type { AgentRoute } from '@folio/contracts'
import { AgentRouteSchema, AssistantChatIdSchema, RunIdSchema } from '@folio/contracts'
import { cancelBackgroundRun, startBackgroundRun } from '@folio/db'
import type { RunId } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { CONCURRENT_RUNS_PER_PROJECT } from '../limits'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * Background runs - `docs/agents/tools.md`, *Episodes, runs and pipelines*,
 * roadmap task 4.4, ADR 0003 **D4** and **D5**.
 *
 * `start_background_task` is how a turn hands on work past its own caps (12
 * steps, 60 seconds): a **direct** operation - nothing of the script changes
 * when it runs, and what the run then changes is proposed as any turn's is -
 * that writes the run, its own chat, the model's brief as that chat's first
 * message and an `agent_run` job, in one transaction (`startBackgroundRun`).
 * The worker runs it (`lib/agent/background.ts`); the panel shows a card for
 * it and polls it every two seconds (D7).
 *
 * **D14:** two background runs working per project at once. A third is refused
 * with the count, before anything is written.
 *
 * The run reads what the turn read: the route the writer asked from decides
 * its toolset and whether it reads the episode or the whole project (the
 * panel's own rule - Characters, Locations and Timeline read every episode).
 * Undoing the starting turn cancels the run if it is still going; what the
 * run proposed is undone with the run's own undo.
 */

/** The routes whose turns read the whole project (the panel's `WHOLE_PROJECT_ROUTES`). */
const WHOLE_PROJECT: readonly AgentRoute[] = ['characters', 'locations', 'timeline']

const StartedSchema = z.object({ runId: RunIdSchema, chatId: AssistantChatIdSchema, title: z.string() })

const Args = z.object({
  title: z.string(),
  brief: z.string(),
  route: AgentRouteSchema.nullable(),
  scope: z.enum(['episode', 'project']),
})

const startBackgroundTaskBase = defineWriteTool({
  name: 'start_background_task',
  description:
    'Hand a long task to a background run, for work past this turn’s dozen steps: drafting many scenes, a pass over every character, a whole-script check. It runs on its own, in a chat of its own, as the writer, and everything it changes is still a proposal. Write the brief as the complete instructions - the run sees the script and the project, but not this conversation.',
  toolset: 'core',
  minimumRole: ROLE.authoredEdit,
  mode: 'direct',
  input: z.object({
    title: z.string().trim().min(1).max(120).describe('A short name for the task, shown on its card: "Draft act two".'),
    brief: z.string().trim().min(1).max(4_000).describe('Everything the run needs to know to do the task without this conversation.'),
  }),
  label: (input) => `Starting a background run: ${input.title}`,
  prepare: (ctx, input) => {
    const route = ctx.route ?? null
    return Promise.resolve({ ok: true as const, args: { title: input.title, brief: input.brief, route, scope: route !== null && WHOLE_PROJECT.includes(route) ? ('project' as const) : ('episode' as const) } })
  },
  executor: {
    args: Args,
    describe: (args) => `Start a background run: ${args.title}`,
    target: () => ({ type: 'agent_run', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const started = await startBackgroundRun(ctx.gate.scope, {
        episodeId: ctx.gate.episode.id,
        title: args.title,
        brief: args.brief,
        input: { kind: 'task', title: args.title, task: args.brief, route: args.route, scope: args.scope },
        limit: CONCURRENT_RUNS_PER_PROJECT,
      })
      if (started.status === 'busy') {
        return {
          ok: false,
          message: `This project already has ${String(started.live)} background runs working, which is the limit. Wait for one to finish, or cancel one.`,
        }
      }
      return { ok: true, result: { runId: started.runId, chatId: started.chatId, title: args.title }, undo: { runId: started.runId } }
    },
    // A run still going is stopped; one that has finished is left - what it proposed is its own run's to undo.
    invert: async (ctx, _args, undo) => {
      const prior = z.object({ runId: RunIdSchema }).safeParse(undo)
      if (!prior.success) return { kind: 'skipped', reason: 'There is no run to stop.' }
      const cancelled = await cancelBackgroundRun(ctx.gate.scope, prior.data.runId as RunId)
      return cancelled.status === 'cancelled'
        ? { kind: 'undone', note: 'The background run was cancelled.' }
        : { kind: 'skipped', reason: 'The background run had already finished. Undo its own run to take back what it proposed.' }
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: 'Background run', before: null, after: args.title }] }),
  },
})

/** The panel's card for the run starts the moment the tool does: a `background_run` event beside the tool's result. */
export const startBackgroundTaskTool: WriteTool = {
  executor: startBackgroundTaskBase.executor,
  tool: {
    ...startBackgroundTaskBase.tool,
    run: async (ctx, raw) => {
      const result = await startBackgroundTaskBase.tool.run(ctx, raw)
      if (result.ok && typeof result.content === 'object' && result.content !== null && 'result' in result.content) {
        const started = StartedSchema.safeParse(result.content.result)
        if (started.success) ctx.emit({ type: 'background_run', ...started.data })
      }
      return result
    },
  },
}

export const RUN_WRITE_TOOLS: readonly WriteTool[] = [startBackgroundTaskTool]
