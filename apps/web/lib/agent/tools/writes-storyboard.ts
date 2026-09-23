import { CameraAngleSchema, ContentInputSchema, InlineContentSchema, NodeIdSchema, ShotIdSchema, ShotMovementSchema, ShotSizeSchema } from '@folio/contracts'
import { listEpisodes, listSceneIndex, listSceneShots, readShot } from '@folio/db'
import type { ShotId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { text } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { formatSceneRef, sceneRefOf } from '../../characters/figures'
import { acceptShotsWith, addShotWith, discardShotsWith, placeShotWith, proposeShotsForSceneWith, saveShotWith } from '../../storyboard/core'
import { inEpisode } from '../episode-gate'
import type { ExecOutcome } from '../executors'
import type { ToolContext } from '../registry'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * The Storyboard's write tools - `docs/agents/tools.md`, *Storyboard*, the
 * Phase 3 rows, roadmap task 3.6. Every one is `lib/storyboard/actions.ts`,
 * over the `shots` table - never Production's `reel_shots`; the two toolsets
 * never cross.
 *
 * `propose_storyboard_shots` is **direct**: the rule-based shot list lands as
 * *proposed* rows on the board, which is already a review - the writer accepts
 * or discards them there. Its undo discards the ones still waiting. Accepting
 * and discarding cannot be taken back (a discarded shot is deleted, an
 * accepted one has no "un-accept"), and the card says so before either runs.
 */

type Failure = { readonly status: string; readonly message?: string }

const failure = (result: Failure, fallback: string): ExecOutcome => ({ ok: false, message: result.message ?? fallback })

/** The scene's citation and the slug of the episode it is in - what every storyboard action is addressed by. */
const sceneOf = async (ctx: { readonly gate: ToolContext['gate'] }, sceneId: string): Promise<{ readonly ref: string; readonly episode: string; readonly ordinal: number } | null> => {
  const [index, episodes] = await Promise.all([listSceneIndex(ctx.gate.scope), listEpisodes(ctx.gate.scope)])
  const row = index.find((entry) => entry.sceneNodeId === sceneId)
  const episode = row === undefined ? undefined : episodes.find((entry) => entry.ordinal === row.episodeOrdinal)
  return row === undefined || episode === undefined ? null : { ref: formatSceneRef(sceneRefOf(row)), episode: episode.slug, ordinal: episode.ordinal }
}

const SpecInput = z.object({
  size: ShotSizeSchema,
  movement: ShotMovementSchema,
  angle: CameraAngleSchema,
  lensMm: z.number().int().min(8).max(1200).nullable().default(null),
  durationSeconds: z.number().int().min(0).max(3600).nullable().default(null),
  description: ContentInputSchema.describe('What the frame shows: plain text, or runs with a character or location mention by id.'),
})

const SpecStored = z.object({
  size: ShotSizeSchema,
  movement: ShotMovementSchema,
  angle: CameraAngleSchema,
  lensMm: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  description: InlineContentSchema,
})

type Spec = z.infer<typeof SpecStored>

const specOf = (input: z.infer<typeof SpecInput>): Spec | null => {
  const description = SpecStored.shape.description.safeParse(typeof input.description === 'string' ? (input.description.length === 0 ? [] : [text(input.description)]) : input.description)
  return description.success ? { size: input.size, movement: input.movement, angle: input.angle, lensMm: input.lensMm, durationSeconds: input.durationSeconds, description: description.data } : null
}

const Where = z.object({ sceneId: z.uuid(), episode: z.string(), ref: z.string() })

// ---------------------------------------------------------------------------

export const proposeStoryboardShotsTool = defineWriteTool({
  name: 'propose_storyboard_shots',
  description:
    "Draft a scene's shot list on the Storyboard from its lines - the board's own rule-based proposal. They land as proposed shots the writer accepts or discards there; any proposals already waiting on that scene are replaced.",
  toolset: 'storyboard',
  minimumRole: ROLE.productionEdit,
  mode: 'direct',
  input: z.object({ sceneId: NodeIdSchema }),
  label: () => 'Drafting shots',
  prepare: async (ctx, input) => {
    const scene = await sceneOf(ctx, input.sceneId)
    return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { sceneId: input.sceneId, episode: scene.episode, ref: scene.ref } }
  },
  executor: {
    args: Where,
    describe: (args) => `Draft shots for ${args.ref} on the board`,
    target: (args) => ({ type: 'scene', id: args.sceneId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.episode, (gate) => proposeShotsForSceneWith(gate, args.sceneId))
      if (result.status !== 'saved') return failure(result, 'The shots could not be drafted.')
      const proposed = result.shots.filter((shot) => shot.state === 'proposed').map((shot) => shot.id)
      return { ok: true, result: { proposed: proposed.length }, undo: { shotIds: proposed } }
    },
    // Only what is still waiting goes: a shot the writer accepted since is theirs.
    invert: async (ctx, args, undo) => {
      const { shotIds } = z.object({ shotIds: z.array(z.uuid()) }).parse(undo)
      const waiting = (await listSceneShots(ctx.gate.scope, args.sceneId as NodeId)).filter((shot) => shot.state === 'proposed' && shotIds.includes(shot.id)).map((shot) => shot.id)
      if (waiting.length === 0) return { kind: 'undone', note: 'None of the drafted shots were still waiting.' }
      const result = await inEpisode(ctx.gate, args.episode, (gate) => discardShotsWith(gate, { sceneNodeId: args.sceneId, shotIds: waiting }))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: () => Promise.resolve({ open: { route: 'storyboard' } }),
  },
})

const EditInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), sceneId: NodeIdSchema, shot: SpecInput }),
  z.object({ action: z.literal('save'), shotId: ShotIdSchema, shot: SpecInput }),
])

const EditArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), sceneId: z.uuid(), episode: z.string(), ref: z.string(), shot: SpecStored }),
  z.object({ action: z.literal('save'), shotId: z.uuid(), sceneId: z.uuid(), episode: z.string(), ref: z.string(), shot: SpecStored }),
])

const specOfShot = (shot: { readonly size: Spec['size']; readonly movement: Spec['movement']; readonly angle: Spec['angle']; readonly lensMm: number | null; readonly durationSeconds: number | null; readonly description: Spec['description'] }): Spec => ({
  size: shot.size,
  movement: shot.movement,
  angle: shot.angle,
  lensMm: shot.lensMm,
  durationSeconds: shot.durationSeconds,
  description: shot.description,
})

export const editStoryboardShotTool = defineWriteTool({
  name: 'edit_storyboard_shot',
  description: 'Propose a storyboard shot: "add" one at the end of a scene, or "save" an existing shot\'s size, movement, angle, lens, duration and description.',
  toolset: 'storyboard',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: EditInput,
  label: (input) => (input.action === 'add' ? 'Proposing a shot' : 'Proposing a shot edit'),
  prepare: async (ctx, input) => {
    const spec = specOf(input.shot)
    if (spec === null) return { ok: false, message: 'That description did not read.' }
    if (input.action === 'add') {
      const scene = await sceneOf(ctx, input.sceneId)
      return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { action: 'add' as const, sceneId: input.sceneId, episode: scene.episode, ref: scene.ref, shot: spec } }
    }
    const shot = await readShot(ctx.gate.scope, input.shotId)
    if (shot === null) return { ok: false, message: 'There is no such shot.' }
    const scene = await sceneOf(ctx, shot.sceneNodeId)
    return scene === null ? { ok: false, message: "That shot's scene is gone." } : { ok: true, args: { action: 'save' as const, shotId: input.shotId, sceneId: shot.sceneNodeId, episode: scene.episode, ref: scene.ref, shot: spec } }
  },
  executor: {
    args: EditArgs,
    describe: (args) => (args.action === 'add' ? `Add a ${args.shot.size} shot to ${args.ref}` : `Edit a shot in ${args.ref}`),
    target: (args) => (args.action === 'save' ? { type: 'shot', id: args.shotId } : { type: 'scene', id: args.sceneId }),
    capture: async (ctx, args) => {
      if (args.action === 'add') return { before: (await listSceneShots(ctx.gate.scope, args.sceneId as NodeId)).map((shot) => shot.id) }
      const shot = await readShot(ctx.gate.scope, args.shotId as ShotId)
      return shot === null ? null : { spec: specOfShot(shot) }
    },
    run: async (ctx, args, captured) => {
      if (args.action === 'add') {
        const result = await inEpisode(ctx.gate, args.episode, (gate) => addShotWith(gate, args.sceneId, args.shot, ctx.idempotencyKey))
        if (result.status !== 'saved') return failure(result, 'The shot could not be added.')
        const before = z.object({ before: z.array(z.string()) }).safeParse(captured).data?.before ?? []
        const added = result.shots.find((shot) => !before.includes(shot.id))
        return { ok: true, result: { shotId: added?.id ?? null }, undo: { shotId: added?.id ?? null } }
      }
      const result = await inEpisode(ctx.gate, args.episode, (gate) => saveShotWith(gate, args.shotId, args.shot))
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The shot could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      if (args.action === 'add') {
        const { shotId } = z.object({ shotId: z.uuid().nullable() }).parse(undo)
        if (shotId === null) return { kind: 'skipped', reason: 'The added shot could not be found.' }
        const result = await inEpisode(ctx.gate, args.episode, (gate) => discardShotsWith(gate, { sceneNodeId: args.sceneId, shotIds: [shotId] }))
        return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
      }
      const { spec } = z.object({ spec: SpecStored }).parse(undo)
      const now = await readShot(ctx.gate.scope, args.shotId as ShotId)
      if (now === null) return { kind: 'skipped', reason: 'The shot no longer exists.' }
      if (JSON.stringify(specOfShot(now)) !== JSON.stringify(args.shot)) {
        return { kind: 'changed', note: `A shot in ${args.ref} was edited after the run.`, ops: [{ tool: 'edit_storyboard_shot', args: { ...args, shot: spec }, mode: 'propose' }] }
      }
      const result = await inEpisode(ctx.gate, args.episode, (gate) => saveShotWith(gate, args.shotId, spec))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: () => Promise.resolve({ open: { route: 'storyboard' } }),
  },
})

const PickInput = z.object({ action: z.enum(['accept', 'discard']), sceneId: NodeIdSchema, shotIds: z.array(ShotIdSchema).min(1).max(200) })
const PickArgs = z.object({ action: z.enum(['accept', 'discard']), sceneId: z.uuid(), shotIds: z.array(z.uuid()), episode: z.string(), ref: z.string() })

export const acceptOrDiscardShotsTool = defineWriteTool({
  name: 'accept_or_discard_shots',
  description: 'Propose accepting proposed storyboard shots onto the board, or discarding them. Neither can be undone.',
  toolset: 'storyboard',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: PickInput,
  label: (input) => `Proposing to ${input.action} shots`,
  prepare: async (ctx, input) => {
    const scene = await sceneOf(ctx, input.sceneId)
    return scene === null ? { ok: false, message: 'There is no such scene in this project.' } : { ok: true, args: { ...input, episode: scene.episode, ref: scene.ref } }
  },
  executor: {
    args: PickArgs,
    describe: (args) => `${args.action === 'accept' ? 'Accept' : 'Discard'} ${String(args.shotIds.length)} ${args.shotIds.length === 1 ? 'shot' : 'shots'} in ${args.ref}`,
    target: (args) => ({ type: 'scene', id: args.sceneId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const input = { sceneNodeId: args.sceneId, shotIds: args.shotIds }
      const result = args.action === 'accept' ? await inEpisode(ctx.gate, args.episode, (gate) => acceptShotsWith(gate, input)) : await inEpisode(ctx.gate, args.episode, (gate) => discardShotsWith(gate, input))
      return result.status === 'saved' ? { ok: true, result: { done: args.shotIds.length } } : failure(result, 'The shots could not be changed.')
    },
    preview: () => Promise.resolve({ open: { route: 'storyboard' } }),
  },
})

const ReorderArgs = z.object({ shotId: z.uuid(), index: z.number().int().min(0), sceneId: z.uuid(), episode: z.string(), ref: z.string() })

export const reorderStoryboardShotTool = defineWriteTool({
  name: 'reorder_storyboard_shot',
  description: "Propose moving a storyboard shot to another place in its scene's sequence, by 0-based index.",
  toolset: 'storyboard',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: z.object({ shotId: ShotIdSchema, index: z.number().int().min(0).max(10_000) }),
  label: () => 'Proposing a shot move',
  prepare: async (ctx, input) => {
    const shot = await readShot(ctx.gate.scope, input.shotId)
    if (shot === null) return { ok: false, message: 'There is no such shot.' }
    const scene = await sceneOf(ctx, shot.sceneNodeId)
    return scene === null ? { ok: false, message: "That shot's scene is gone." } : { ok: true, args: { shotId: input.shotId, index: input.index, sceneId: shot.sceneNodeId, episode: scene.episode, ref: scene.ref } }
  },
  executor: {
    args: ReorderArgs,
    describe: (args) => `Move a shot in ${args.ref} to position ${String(args.index + 1)}`,
    target: (args) => ({ type: 'shot', id: args.shotId }),
    capture: async (ctx, args) => ({ index: Math.max(0, (await listSceneShots(ctx.gate.scope, args.sceneId as NodeId)).findIndex((shot) => shot.id === args.shotId)) }),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.episode, (gate) => placeShotWith(gate, args.shotId, args.index))
      return result.status === 'saved' ? { ok: true, result: { placed: args.index } } : failure(result, 'The shot could not be moved.')
    },
    invert: async (ctx, args, undo) => {
      const { index } = z.object({ index: z.number().int() }).parse(undo)
      const result = await inEpisode(ctx.gate, args.episode, (gate) => placeShotWith(gate, args.shotId, index))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: () => Promise.resolve({ open: { route: 'storyboard' } }),
  },
})

export const STORYBOARD_WRITE_TOOLS: readonly WriteTool[] = [proposeStoryboardShotsTool, editStoryboardShotTool, acceptOrDiscardShotsTool, reorderStoryboardShotTool]
