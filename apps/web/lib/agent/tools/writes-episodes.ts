import { RunIdSchema } from '@folio/contracts'
import { listEpisodes, readAgentRun } from '@folio/db'
import type { RunId } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { createEpisodeWith, renameEpisodeWith } from '../../workspace/core'
import { inEpisode } from '../episode-gate'
import { undoRunWith } from '../apply'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * Episodes and run-level undo - `docs/agents/tools.md`, *Episodes, runs and
 * pipelines*, the Phase 3 rows, roadmap task 3.6.
 *
 * Creating and renaming an episode are a writer's (ADR 0003 D2). Deleting one
 * is an owner's and is not exposed to the agent at all (D16) - which is why a
 * created episode **cannot be undone** by the agent: its only inverse is
 * `deleteEpisode`. The card says so before it is applied.
 *
 * `undo_run` is the whole of "undo this run" (`apply.ts`, `undoRunWith`) as a
 * tool: **confirm** mode, so the writer always says yes first. What changed
 * since the run is not overwritten - it comes back as a new proposal.
 */

export const createEpisodeTool = defineWriteTool({
  name: 'create_episode',
  description: 'Propose a new episode at the end of a series, with an optional title. A film has one episode and cannot have another. It cannot be undone from here.',
  toolset: 'script',
  minimumRole: ROLE.episodeCreate,
  mode: 'propose',
  input: z.object({ title: z.string().trim().min(1).max(200).nullable().default(null) }),
  label: () => 'Proposing an episode',
  prepare: (ctx, input) =>
    Promise.resolve(ctx.gate.project.projectType === 'film' ? { ok: false as const, message: 'A film has one episode.' } : { ok: true as const, args: input }),
  executor: {
    args: z.object({ title: z.string().nullable() }),
    describe: (args) => (args.title === null ? 'Add an episode' : `Add the episode "${args.title}"`),
    target: () => ({ type: 'episode', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await createEpisodeWith(ctx.gate, args.title, ctx.idempotencyKey)
      return result.status === 'done' ? { ok: true, result: { episode: result.episode } } : { ok: false, message: result.message }
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: 'Episode', before: null, after: args.title ?? 'Untitled' }] }),
  },
})

const RenameArgs = z.object({ slug: z.string(), ordinal: z.number().int(), from: z.string(), title: z.string() })

export const renameEpisodeTool = defineWriteTool({
  name: 'rename_episode',
  description: 'Propose a new title for an episode, by its number.',
  toolset: 'script',
  minimumRole: ROLE.episodeCreate,
  mode: 'propose',
  input: z.object({ episode: z.number().int().min(1), title: z.string().trim().min(1).max(200) }),
  label: () => 'Proposing an episode title',
  prepare: async (ctx, input) => {
    const episode = (await listEpisodes(ctx.gate.scope)).find((entry) => entry.ordinal === input.episode)
    return episode === undefined ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { slug: episode.slug, ordinal: episode.ordinal, from: episode.title, title: input.title } }
  },
  executor: {
    args: RenameArgs,
    describe: (args) => `Retitle episode ${String(args.ordinal)} "${args.title}"`,
    target: () => ({ type: 'episode', id: null }),
    capture: (_ctx, args) => Promise.resolve({ title: args.from }),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.slug, (gate) => renameEpisodeWith(gate, args.title))
      return result.status === 'done' ? { ok: true, result: { title: args.title } } : { ok: false, message: result.message }
    },
    invert: async (ctx, args, undo) => {
      const prior = z.object({ title: z.string() }).parse(undo)
      const now = (await listEpisodes(ctx.gate.scope)).find((entry) => entry.slug === args.slug)
      if (now === undefined) return { kind: 'skipped', reason: 'The episode no longer exists.' }
      if (now.title !== args.title) return { kind: 'changed', note: `Episode ${String(args.ordinal)} was retitled after the run.`, ops: [{ tool: 'rename_episode', args: { ...args, from: now.title, title: prior.title }, mode: 'propose' }] }
      const result = await inEpisode(ctx.gate, args.slug, (gate) => renameEpisodeWith(gate, prior.title))
      return result.status === 'done' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: `Episode ${String(args.ordinal)}`, before: args.from, after: args.title }] }),
  },
})

export const undoRunTool = defineWriteTool({
  name: 'undo_run',
  description:
    'Propose undoing everything an earlier run changed, newest first - by its run id from get_run_status. Anything edited since is offered back as a new proposal rather than overwritten; what cannot be undone is named. The writer always confirms it.',
  toolset: 'core',
  minimumRole: ROLE.authoredEdit,
  mode: 'confirm',
  input: z.object({ runId: RunIdSchema }),
  label: () => 'Proposing to undo a run',
  prepare: async (ctx, input) => {
    if (input.runId === ctx.runId) return { ok: false, message: 'This run cannot undo itself. Ask again after this turn.' }
    const run = await readAgentRun(ctx.gate.scope, input.runId)
    return run === null ? { ok: false, message: 'There is no such run on this project.' } : { ok: true, args: { runId: input.runId, at: run.createdAt } }
  },
  executor: {
    args: z.object({ runId: z.uuid(), at: z.string() }),
    describe: (args) => `Undo the run of ${args.at.slice(0, 16).replace('T', ' ')}`,
    target: () => ({ type: 'agent_run', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const outcome = await undoRunWith(ctx.gate, args.runId as RunId)
      if (outcome.status === 'refused') return { ok: false, message: outcome.message }
      if (outcome.failure !== null) return { ok: false, message: `Stopped at ${outcome.failure.tool}: ${outcome.failure.message}` }
      return {
        ok: true,
        result: { undone: outcome.undone, skipped: outcome.skipped, notes: outcome.notes, proposalId: outcome.proposal?.proposal.id ?? null },
      }
    },
  },
})

export const EPISODE_WRITE_TOOLS: readonly WriteTool[] = [createEpisodeTool, renameEpisodeTool, undoRunTool]
