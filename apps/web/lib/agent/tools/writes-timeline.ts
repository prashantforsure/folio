import { FindingVerdictSchema, NodeIdSchema, PlacementsSchema, StoryThreadColourSchema, StoryThreadIdSchema } from '@folio/contracts'
import { listEpisodes, listSceneIndex, listStoryThreads, readFindingVerdict, readSceneAuthored } from '@folio/db'
import type { NodeId } from '@folio/script'
import { formatStoryTime } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { formatSceneRef, sceneRefOf } from '../../characters/figures'
import { saveSynopsisWith } from '../../scenes/core'
import {
  createThreadWith,
  deleteThreadWith,
  markDeliberateWith,
  orderThreadsWith,
  placeScenesWith,
  reopenFindingWith,
  saveStoryTimeWith,
  saveThreadWith,
  setSceneThreadsWith,
  unplaceScenesWith,
} from '../../timeline/core'
import { readContinuity } from '../../timeline/server'
import { findingNote, verdictOf } from '../../timeline/view'
import type { ExecOutcome, InvertOutcome } from '../executors'
import type { ToolContext } from '../registry'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * The Timeline's write tools and `set_synopsis` - `docs/agents/tools.md`,
 * Phase 3 rows, roadmap task 3.5.
 *
 * Timeline never reads a slugline as a date (`time-cues.ts` proposes, the
 * writer accepts), and these tools keep that: story time is written only
 * because the agent **proposed** it and the writer applied it. `place_scenes`
 * writes only where a scene has no story day yet, as the route's own bulk
 * placement does, and its undo takes back exactly the placements that landed
 * (`unplaceScenes`).
 *
 * Every other write stores the value it overwrote. On undo each checks the
 * value still holds what the agent wrote; if the writer changed it since,
 * nothing is overwritten and the old value comes back as a new proposal.
 */

type Failure = { readonly status: string; readonly message?: string }

const failure = (result: Failure, fallback: string): ExecOutcome => ({ ok: false, message: result.message ?? fallback })

const undone = (result: Failure): InvertOutcome => (result.status === 'saved' || result.status === 'placed' || result.status === 'unplaced' || result.status === 'deleted' ? { kind: 'undone' } : { kind: 'failed', message: result.message ?? 'It could not be put back.' })

/** "E1 Sc 3", or the id when the scene is not in the index. */
const refOf = async (ctx: { readonly gate: ToolContext['gate'] }, sceneId: string): Promise<{ readonly ref: string; readonly episode: number } | null> => {
  const row = (await listSceneIndex(ctx.gate.scope)).find((entry) => entry.sceneNodeId === sceneId)
  return row === undefined ? null : { ref: formatSceneRef(sceneRefOf(row)), episode: row.episodeOrdinal }
}

// ---------------------------------------------------------------------------
// Synopsis
// ---------------------------------------------------------------------------

const SynopsisInput = z.object({ sceneId: NodeIdSchema.describe('The scene id (its heading node id).'), synopsis: z.string().max(20_000).describe('One or two sentences; empty clears it.') })
const SynopsisArgs = z.object({ sceneId: z.uuid(), synopsis: z.string(), ref: z.string(), episode: z.number().int() })
const SynopsisUndo = z.object({ synopsis: z.string().nullable() })

const writeSynopsis = async (ctx: { readonly gate: ToolContext['gate'] }, ordinal: number, sceneId: string, synopsis: string): Promise<Failure> => {
  const episode = (await listEpisodes(ctx.gate.scope)).find((entry) => entry.ordinal === ordinal)
  if (episode === undefined) return { status: 'error', message: 'That episode no longer exists.' }
  return saveSynopsisWith({ ...ctx.gate, episode }, { projectId: ctx.gate.project.id, episode: episode.slug, sceneNodeId: sceneId, synopsis })
}

export const setSynopsisTool = defineWriteTool({
  name: 'set_synopsis',
  description: "Propose a scene's synopsis - the line the Scenes cards and the scene list print. Read the scene first.",
  toolset: 'script',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: SynopsisInput,
  label: () => 'Proposing a synopsis',
  prepare: async (ctx, input) => {
    const scene = await refOf(ctx, input.sceneId)
    return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { sceneId: input.sceneId, synopsis: input.synopsis.trim(), ref: scene.ref, episode: scene.episode } }
  },
  executor: {
    args: SynopsisArgs,
    describe: (args) => (args.synopsis.length === 0 ? `Clear the synopsis of ${args.ref}` : `Set the synopsis of ${args.ref}`),
    target: (args) => ({ type: 'scene', id: args.sceneId }),
    capture: async (ctx, args) => ({ synopsis: (await readSceneAuthored(ctx.gate.scope, args.sceneId as NodeId))?.synopsis ?? null }),
    run: async (ctx, args) => {
      const result = await writeSynopsis(ctx, args.episode, args.sceneId, args.synopsis)
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The synopsis could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      const prior = SynopsisUndo.parse(undo)
      const now = (await readSceneAuthored(ctx.gate.scope, args.sceneId as NodeId))?.synopsis ?? null
      if (now !== (args.synopsis.length === 0 ? null : args.synopsis)) {
        return { kind: 'changed', note: `The synopsis of ${args.ref} was edited after the run.`, ops: [{ tool: 'set_synopsis', args: { ...args, synopsis: prior.synopsis ?? '' }, mode: 'propose' }] }
      }
      const result = await writeSynopsis(ctx, args.episode, args.sceneId, prior.synopsis ?? '')
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message ?? 'It could not be put back.' }
    },
    preview: async (ctx, args, op) => {
      const before = op.status === 'pending' ? ((await readSceneAuthored(ctx.gate.scope, args.sceneId as NodeId))?.synopsis ?? null) : (SynopsisUndo.safeParse(op.undo).data?.synopsis ?? null)
      return { changes: [{ field: `${args.ref} synopsis`, before, after: args.synopsis.length === 0 ? null : args.synopsis }], open: { route: 'scenes', episode: args.episode } }
    },
  },
})

// ---------------------------------------------------------------------------
// Story time
// ---------------------------------------------------------------------------

const StoryTimeFields = z.object({
  day: z.number().int().min(-100_000).max(100_000).nullable().describe('The story day, 1 for the first; null for no day.'),
  clock: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .describe('"HH:MM", or null. A clock needs a day.'),
  flashback: z.boolean().default(false),
})
const StoryTimeInput = StoryTimeFields.extend({ sceneId: NodeIdSchema })
const StoryTimeArgs = StoryTimeFields.extend({ sceneId: z.uuid(), ref: z.string() })
const StoryTimeUndo = z.object({ day: z.number().int().nullable(), clock: z.string().nullable(), flashback: z.boolean() })

const timeText = (day: number | null, clock: string | null, flashback: boolean): string | null =>
  day === null ? (flashback ? 'flashback' : null) : `${formatStoryTime({ day, clock })}${flashback ? ', flashback' : ''}`

const storyTimeOf = async (ctx: { readonly gate: ToolContext['gate'] }, sceneId: string) => {
  const row = await readSceneAuthored(ctx.gate.scope, sceneId as NodeId)
  return { day: row?.storyDay ?? null, clock: row?.storyClock ?? null, flashback: row?.flashback ?? false }
}

export const setStoryTimeTool = defineWriteTool({
  name: 'set_story_time',
  description:
    "Propose where a scene sits in story time: its day, an optional clock, and whether it is a flashback. Base it on the page's own cues and say which line you read it from - never on the slugline's DAY or NIGHT alone.",
  toolset: 'timeline',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: StoryTimeInput,
  label: () => 'Proposing a story time',
  prepare: async (ctx, input) => {
    if (input.day === null && input.clock !== null) return { ok: false, message: 'A clock needs a day.' }
    const scene = await refOf(ctx, input.sceneId)
    return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { ...input, ref: scene.ref } }
  },
  executor: {
    args: StoryTimeArgs,
    describe: (args) => `Place ${args.ref} at ${timeText(args.day, args.clock, args.flashback) ?? 'no time'}`,
    target: (args) => ({ type: 'scene', id: args.sceneId }),
    capture: (ctx, args) => storyTimeOf(ctx, args.sceneId),
    run: async (ctx, args) => {
      const result = await saveStoryTimeWith(ctx.gate, args.sceneId, { day: args.day, clock: args.clock, flashback: args.flashback })
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The story time could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      const prior = StoryTimeUndo.parse(undo)
      const now = await storyTimeOf(ctx, args.sceneId)
      if (now.day !== args.day || now.clock !== (args.day === null ? null : args.clock) || now.flashback !== args.flashback) {
        return { kind: 'changed', note: `${args.ref}'s story time was changed after the run.`, ops: [{ tool: 'set_story_time', args: { ...prior, sceneId: args.sceneId, ref: args.ref }, mode: 'propose' }] }
      }
      return undone(await saveStoryTimeWith(ctx.gate, args.sceneId, prior))
    },
    preview: async (ctx, args, op) => {
      const before = op.status === 'pending' ? await storyTimeOf(ctx, args.sceneId) : (StoryTimeUndo.safeParse(op.undo).data ?? null)
      return {
        changes: [{ field: `${args.ref} story time`, before: before === null ? null : timeText(before.day, before.clock, before.flashback), after: timeText(args.day, args.clock, args.flashback) }],
        open: { route: 'timeline' },
      }
    },
  },
})

const PlaceInput = z.object({ placements: PlacementsSchema.describe('Scenes and the story time each goes at: { sceneNodeId, time: { day, clock } }.') })

export const placeScenesTool = defineWriteTool({
  name: 'place_scenes',
  description:
    'Propose story times for several unplaced scenes at once - the Timeline\'s "Place all". A scene that already has a day is left alone. Use run_continuity_check\'s suggested placements, which come from the page\'s own cues.',
  toolset: 'timeline',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: PlaceInput,
  label: (input) => `Proposing ${String(input.placements.length)} placements`,
  prepare: (_ctx, input) => Promise.resolve({ ok: true, args: input }),
  executor: {
    args: PlaceInput,
    describe: (args) => `Place ${String(args.placements.length)} ${args.placements.length === 1 ? 'scene' : 'scenes'} in story time`,
    target: () => ({ type: 'timeline', id: null }),
    capture: () => Promise.resolve({ placements: [] }),
    run: async (ctx, args) => {
      const result = await placeScenesWith(ctx.gate, args.placements)
      // The undo record is what landed - `unplaceScenes` takes exactly that back.
      return result.status === 'placed' ? { ok: true, result: { placed: result.placements.length }, undo: { placements: result.placements } } : failure(result, 'The placements could not be saved.')
    },
    invert: async (ctx, _args, undo) => {
      const { placements } = z.object({ placements: z.array(z.unknown()) }).parse(undo)
      if (placements.length === 0) return { kind: 'undone', note: 'Nothing had been placed.' }
      return undone(await unplaceScenesWith(ctx.gate, placements))
    },
    preview: async (ctx, args) => {
      const index = await listSceneIndex(ctx.gate.scope)
      const byId = new Map(index.map((row) => [row.sceneNodeId as string, formatSceneRef(sceneRefOf(row))]))
      return {
        changes: args.placements.slice(0, 20).map((placement) => ({ field: byId.get(placement.sceneNodeId) ?? placement.sceneNodeId, before: null, after: formatStoryTime(placement.time) })),
        open: { route: 'timeline' },
      }
    },
  },
})

// ---------------------------------------------------------------------------
// Story threads
// ---------------------------------------------------------------------------

const ThreadsInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(80), colour: StoryThreadColourSchema }),
  z.object({ action: z.literal('save'), id: StoryThreadIdSchema, name: z.string().trim().min(1).max(80), colour: StoryThreadColourSchema }),
  z.object({ action: z.literal('order'), ids: z.array(StoryThreadIdSchema).min(1).max(256).describe("Every thread's id, in the new order.") }),
  z.object({ action: z.literal('set_scene'), sceneId: NodeIdSchema, threadIds: z.array(StoryThreadIdSchema).max(64).describe("The scene's threads; the first is its row.") }),
  z.object({ action: z.literal('delete'), id: StoryThreadIdSchema }),
])

const ThreadsArgs = z.intersection(ThreadsInput, z.object({ label: z.string() }))

type ThreadsArgs = z.infer<typeof ThreadsArgs>

const threadName = async (ctx: { readonly gate: ToolContext['gate'] }, id: string): Promise<string | null> =>
  (await listStoryThreads(ctx.gate.scope)).find((thread) => thread.id === id)?.name ?? null

export const manageThreadsTool = defineWriteTool({
  name: 'manage_threads',
  description:
    'Propose changes to the Timeline\'s story threads: "create" one (name, colour), "save" its name and colour, "order" them all, "set_scene" to put a scene on threads (first is its row), or "delete" one - which the writer always confirms.',
  toolset: 'timeline',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: ThreadsInput,
  label: (input) => `Proposing a thread change (${input.action})`,
  prepare: async (ctx, input) => {
    switch (input.action) {
      case 'create':
        return { ok: true, args: { ...input, label: input.name } }
      case 'save':
      case 'delete': {
        const name = await threadName(ctx, input.id)
        if (name === null) return { ok: false, message: 'There is no such thread.' }
        // Deleting a thread takes it off every scene and cannot be undone: confirm (tools.md, "propose · confirm").
        return { ok: true, args: { ...input, label: name }, ...(input.action === 'delete' ? { mode: 'confirm' as const } : {}) }
      }
      case 'order':
        return { ok: true, args: { ...input, label: `${String(input.ids.length)} threads` } }
      case 'set_scene': {
        const scene = await refOf(ctx, input.sceneId)
        return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { ...input, label: scene.ref } }
      }
    }
  },
  executor: {
    args: ThreadsArgs,
    describe: (args) => {
      switch (args.action) {
        case 'create':
          return `Create the thread ${args.name}`
        case 'save':
          return args.name === args.label ? `Recolour the thread ${args.label}` : `Rename the thread ${args.label} to ${args.name}`
        case 'order':
          return `Reorder ${args.label}`
        case 'set_scene':
          return args.threadIds.length === 0 ? `Take ${args.label} off every thread` : `Put ${args.label} on ${String(args.threadIds.length)} ${args.threadIds.length === 1 ? 'thread' : 'threads'}`
        case 'delete':
          return `Delete the thread ${args.label}`
      }
    },
    target: (args) => (args.action === 'save' || args.action === 'delete' ? { type: 'story_thread', id: args.id } : args.action === 'set_scene' ? { type: 'scene', id: args.sceneId } : { type: 'story_thread', id: null }),
    irreversible: (args) => args.action === 'delete',
    capture: async (ctx, args) => {
      switch (args.action) {
        case 'create':
        case 'delete':
          return null
        case 'save': {
          const thread = (await listStoryThreads(ctx.gate.scope)).find((entry) => entry.id === args.id)
          return thread === undefined ? null : { name: thread.name, colour: thread.colour }
        }
        case 'order':
          return { ids: (await listStoryThreads(ctx.gate.scope)).map((thread) => thread.id) }
        case 'set_scene':
          return { threadIds: (await readSceneAuthored(ctx.gate.scope, args.sceneId))?.threads ?? [] }
      }
    },
    run: async (ctx, args) => {
      switch (args.action) {
        case 'create': {
          const result = await createThreadWith(ctx.gate, { name: args.name, colour: args.colour }, ctx.idempotencyKey)
          return result.status === 'created' ? { ok: true, result: { id: result.id }, undo: { id: result.id } } : failure(result, 'The thread could not be created.')
        }
        case 'save': {
          const result = await saveThreadWith(ctx.gate, args.id, { name: args.name, colour: args.colour })
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The thread could not be saved.')
        }
        case 'order': {
          const result = await orderThreadsWith(ctx.gate, args.ids)
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The threads could not be reordered.')
        }
        case 'set_scene': {
          const result = await setSceneThreadsWith(ctx.gate, args.sceneId, args.threadIds)
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, "The scene's threads could not be saved.")
        }
        case 'delete': {
          const result = await deleteThreadWith(ctx.gate, args.id)
          return result.status === 'deleted' ? { ok: true, result: { deleted: args.id } } : failure(result, 'The thread could not be deleted.')
        }
      }
    },
    invert: async (ctx, args, undo) => {
      switch (args.action) {
        case 'create': {
          const { id } = z.object({ id: z.uuid() }).parse(undo)
          return undone(await deleteThreadWith(ctx.gate, id))
        }
        case 'save': {
          const prior = z.object({ name: z.string(), colour: StoryThreadColourSchema }).parse(undo)
          const thread = (await listStoryThreads(ctx.gate.scope)).find((entry) => entry.id === args.id)
          if (thread === undefined) return { kind: 'skipped', reason: 'The thread no longer exists.' }
          if (thread.name !== args.name || thread.colour !== args.colour) {
            return { kind: 'changed', note: `The thread ${args.name} was edited after the run.`, ops: [{ tool: 'manage_threads', args: { action: 'save', id: args.id, ...prior, label: args.name }, mode: 'propose' }] }
          }
          return undone(await saveThreadWith(ctx.gate, args.id, prior))
        }
        case 'order': {
          const prior = z.object({ ids: z.array(z.uuid()) }).parse(undo)
          const now = (await listStoryThreads(ctx.gate.scope)).map((thread) => thread.id as string)
          const kept = prior.ids.filter((id) => now.includes(id))
          return kept.length === now.length ? undone(await orderThreadsWith(ctx.gate, kept)) : { kind: 'skipped', reason: 'The threads changed since; their order was left.' }
        }
        case 'set_scene': {
          const prior = z.object({ threadIds: z.array(z.string()) }).parse(undo)
          const now = (await readSceneAuthored(ctx.gate.scope, args.sceneId))?.threads ?? []
          if (JSON.stringify(now) !== JSON.stringify(args.threadIds)) {
            return { kind: 'changed', note: `${args.label}'s threads were changed after the run.`, ops: [{ tool: 'manage_threads', args: { action: 'set_scene', sceneId: args.sceneId, threadIds: prior.threadIds, label: args.label }, mode: 'propose' }] }
          }
          return undone(await setSceneThreadsWith(ctx.gate, args.sceneId, prior.threadIds))
        }
        case 'delete':
          return { kind: 'skipped', reason: 'A deleted thread cannot be brought back.' }
      }
    },
    preview: () => Promise.resolve({ open: { route: 'timeline' } }),
  },
})

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const FindingInput = z.object({
  action: z.enum(['mark', 'reopen']).describe('"mark" says a finding is deliberate; "reopen" puts one back on the list.'),
  key: z.string().min(1).max(200).describe("The finding's key, from run_continuity_check."),
})
const FindingArgs = FindingInput.extend({ note: z.string(), verdict: FindingVerdictSchema.nullable() })

export const markFindingDeliberateTool = defineWriteTool({
  name: 'mark_finding_deliberate',
  description:
    "Propose marking a continuity finding as deliberate - the writer meant it (a flashback, a jump) - so the check stops raising it; or reopen one marked before. Only when the writer has said it is deliberate, or the page makes it plain.",
  toolset: 'timeline',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: FindingInput,
  label: (input) => (input.action === 'mark' ? 'Proposing a finding is deliberate' : 'Proposing to reopen a finding'),
  prepare: async (ctx, input) => {
    if (input.action === 'reopen') {
      const verdict = await readFindingVerdict(ctx.gate.scope, input.key)
      return verdict === null ? { ok: false, message: 'That finding is not marked deliberate.' } : { ok: true, args: { ...input, note: input.key, verdict } }
    }
    const read = await readContinuity({ scope: ctx.gate.scope, project: ctx.gate.project, episodes: await listEpisodes(ctx.gate.scope) })
    const finding = read.continuity.buckets.open.find((entry) => entry.key === input.key)
    if (finding === undefined) return { ok: false, message: 'There is no open finding with that key. Run the continuity check again.' }
    return { ok: true, args: { ...input, note: findingNote(finding, read.continuity.book), verdict: verdictOf(finding) } }
  },
  executor: {
    args: FindingArgs,
    describe: (args) => (args.action === 'mark' ? `Mark as deliberate: ${args.note}` : `Reopen the finding ${args.note}`),
    target: (args) => ({ type: 'timeline_finding', id: args.verdict?.aRef ?? null }),
    capture: (_ctx, args) => Promise.resolve(args.verdict),
    run: async (ctx, args) => {
      const result = args.action === 'mark' ? await markDeliberateWith(ctx.gate, args.verdict) : await reopenFindingWith(ctx.gate, args.key)
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The verdict could not be saved.')
    },
    invert: async (ctx, args, undo) => (args.action === 'mark' ? undone(await reopenFindingWith(ctx.gate, args.key)) : undone(await markDeliberateWith(ctx.gate, undo))),
    preview: () => Promise.resolve({ open: { route: 'timeline' } }),
  },
})

export const TIMELINE_WRITE_TOOLS: readonly WriteTool[] = [setSynopsisTool, setStoryTimeTool, placeScenesTool, manageThreadsTool, markFindingDeliberateTool]
