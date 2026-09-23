import type { ReelShotId } from '@folio/contracts'
import {
  AspectRatioSchema,
  BulkPatchSchema,
  CameraStyleSchema,
  ClipLengthSchema,
  DEFAULT_ART_STYLE_KEY,
  DEFAULT_SETTINGS,
  DurationPresetSchema,
  LightingSchema,
  NodeIdSchema,
  PacingSchema,
  ProductionGenerationIdSchema,
  ProductionTypeSchema,
  ReelIdSchema,
  ReelShotIdSchema,
  ShotPatchSchema,
  ArtStyleIdSchema,
} from '@folio/contracts'
import { readArtStyleByKey, readEpisodeSettings, readReel, readReelIdOfShot } from '@folio/db'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { addReelWith, addShotWith, bulkPatchShotsWith, deleteReelWith, deleteShotWith, moveShotWith, patchReelWith, patchShotWith, retimeShotWith, saveSettingsWith } from '../../production/core'
import { aiShotlistWith, cancelGenerationWith } from '../../production/generate-core'
import { inEpisode } from '../episode-gate'
import { episodeNumbered } from '../document-ops'
import type { ExecOutcome } from '../executors'
import type { ToolContext } from '../registry'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * Production's non-paid write tools - `docs/agents/tools.md`, *Production*,
 * the Phase 3 rows, roadmap task 3.6. Every one is
 * `lib/production/actions.ts` or `generate.ts`, over `reels` and `reel_shots`
 * - Production's own tables, never the Storyboard's `shots`.
 *
 * `ai_shotlist` is **direct** and costs **0 credits** (`GENERATION_COSTS`):
 * its output lands as *proposed* shots in the reel, which the writer accepts
 * there. `cancel_generation` only stops something. The paid generations -
 * sheets, frames, scene images, shooting a reel - are Phase 5 and are not
 * here: nothing in this file can spend a credit.
 *
 * Deleting a reel is `confirm` (tools.md, "propose · confirm"); a soft delete
 * with no restore action, so it cannot be undone, and neither can deleting a
 * shot. Patches keep the fields they overwrote and put them back - except the
 * side effects the action itself cannot reverse (a clip marked stale, a frame
 * marked stale), which undo does not pretend to.
 */

type Failure = { readonly status: string; readonly message?: string }

const failure = (result: Failure, fallback: string): ExecOutcome => ({ ok: false, message: result.message ?? fallback })

const EpisodeNumber = z.number().int().min(1).optional().describe('The episode, by its number. Omit for the one the writer has open.')

const slugOf = async (ctx: { readonly gate: ToolContext['gate'] }, ordinal: number | undefined): Promise<{ readonly slug: string; readonly id: string } | null> => {
  const episode = await episodeNumbered(ctx.gate, ordinal)
  return episode === null ? null : { slug: episode.slug, id: episode.id }
}

// ---------------------------------------------------------------------------
// Episode settings
// ---------------------------------------------------------------------------

const Settings = z.object({ aspectRatio: AspectRatioSchema, productionType: ProductionTypeSchema, cameraStyle: CameraStyleSchema, pacing: PacingSchema, lighting: LightingSchema, artStyleId: ArtStyleIdSchema })

const currentSettings = async (ctx: { readonly gate: ToolContext['gate'] }, episodeId: string): Promise<z.infer<typeof Settings> | null> => {
  const settings = await readEpisodeSettings(ctx.gate.scope, episodeId as Parameters<typeof readEpisodeSettings>[1])
  if (settings !== null) return { aspectRatio: settings.aspectRatio, productionType: settings.productionType, cameraStyle: settings.cameraStyle, pacing: settings.pacing, lighting: settings.lighting, artStyleId: settings.artStyleId }
  const style = await readArtStyleByKey(ctx.gate.scope, DEFAULT_ART_STYLE_KEY)
  return style === null ? null : { ...DEFAULT_SETTINGS, artStyleId: style.id }
}

export const saveEpisodeSettingsTool = defineWriteTool({
  name: 'save_episode_settings',
  description: "Propose an episode's film settings for Production: aspect ratio, production type, camera style, pacing, lighting, art style. Only the fields you name change. Settings lock after the first shoot.",
  toolset: 'production',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: z.object({ episode: EpisodeNumber, settings: Settings.partial() }),
  label: () => 'Proposing episode settings',
  prepare: async (ctx, input) => {
    const episode = await slugOf(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    const edited = Object.keys(input.settings)
    if (edited.length === 0) return { ok: false, message: 'The edit names no setting.' }
    const current = await currentSettings(ctx, episode.id)
    if (current === null) return { ok: false, message: 'The default art style could not be found.' }
    return { ok: true, args: { episode: episode.slug, episodeId: episode.id, settings: Settings.parse({ ...current, ...input.settings }), edited } }
  },
  executor: {
    args: z.object({ episode: z.string(), episodeId: z.uuid(), settings: Settings, edited: z.array(z.string()) }),
    describe: (args) => `Episode settings: ${args.edited.join(', ')}`,
    target: (args) => ({ type: 'episode', id: args.episodeId }),
    capture: (ctx, args) => currentSettings(ctx, args.episodeId),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.episode, (gate) => saveSettingsWith(gate, args.settings))
      if (result.status === 'locked') return { ok: false, message: 'The settings are locked: this episode has been shot.' }
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The settings could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      const prior = Settings.parse(undo)
      const result = await inEpisode(ctx.gate, args.episode, (gate) => saveSettingsWith(gate, prior))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.status === 'locked' ? 'The settings are locked now.' : result.message }
    },
    preview: async (ctx, args, op) => {
      const before = op.status === 'pending' ? await currentSettings(ctx, args.episodeId) : (Settings.safeParse(op.undo).data ?? null)
      return {
        changes: args.edited.map((field) => ({ field, before: before === null ? null : String(before[field as keyof typeof before]), after: String(args.settings[field as keyof typeof args.settings]) })),
        open: { route: 'production' },
      }
    },
  },
})

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

const ReelsInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), episode: EpisodeNumber, sceneId: NodeIdSchema }),
  z.object({ action: z.literal('patch'), episode: EpisodeNumber, reelId: ReelIdSchema, name: z.string().trim().min(1).max(80).optional(), clipLengthS: ClipLengthSchema.optional() }),
  z.object({ action: z.literal('delete'), episode: EpisodeNumber, reelId: ReelIdSchema }),
])

const ReelsArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), episode: z.string(), sceneId: z.uuid() }),
  z.object({ action: z.literal('patch'), episode: z.string(), reelId: z.uuid(), label: z.string(), patch: z.object({ name: z.string().optional(), clipLengthS: ClipLengthSchema.optional() }) }),
  z.object({ action: z.literal('delete'), episode: z.string(), reelId: z.uuid(), label: z.string() }),
])

export const manageReelsTool = defineWriteTool({
  name: 'manage_reels',
  description: 'Propose Production reels: "add" a reel to a scene, "patch" a reel\'s name or clip length, or "delete" one - which the writer always confirms and which cannot be undone.',
  toolset: 'production',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: ReelsInput,
  label: (input) => `Proposing a reel change (${input.action})`,
  prepare: async (ctx, input) => {
    const episode = await slugOf(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    if (input.action === 'add') return { ok: true, args: { action: 'add' as const, episode: episode.slug, sceneId: input.sceneId } }
    const reel = await readReel(ctx.gate.scope, input.reelId)
    if (reel === null) return { ok: false, message: 'There is no such reel.' }
    if (input.action === 'delete') return { ok: true, args: { action: 'delete' as const, episode: episode.slug, reelId: input.reelId, label: reel.name }, mode: 'confirm' as const }
    const patch = { ...(input.name === undefined ? {} : { name: input.name }), ...(input.clipLengthS === undefined ? {} : { clipLengthS: input.clipLengthS }) }
    if (Object.keys(patch).length === 0) return { ok: false, message: 'The patch names nothing.' }
    return { ok: true, args: { action: 'patch' as const, episode: episode.slug, reelId: input.reelId, label: reel.name, patch } }
  },
  executor: {
    args: ReelsArgs,
    describe: (args) => (args.action === 'add' ? 'Add a reel' : args.action === 'delete' ? `Delete the reel ${args.label}` : `Change the reel ${args.label}: ${Object.keys(args.patch).join(', ')}`),
    target: (args) => (args.action === 'add' ? { type: 'scene', id: args.sceneId } : { type: 'reel', id: args.reelId }),
    irreversible: (args) => args.action === 'delete',
    capture: async (ctx, args) => {
      if (args.action !== 'patch') return null
      const reel = await readReel(ctx.gate.scope, args.reelId as Parameters<typeof readReel>[1])
      return reel === null ? null : { name: reel.name, clipLengthS: reel.clipLengthS }
    },
    run: async (ctx, args) => {
      if (args.action === 'add') {
        const result = await inEpisode(ctx.gate, args.episode, (gate) => addReelWith(gate, args.sceneId, ctx.idempotencyKey))
        return result.status === 'saved' ? { ok: true, result: { reelId: result.reel.id }, undo: { reelId: result.reel.id } } : failure(result, 'The reel could not be added.')
      }
      if (args.action === 'delete') {
        const result = await inEpisode(ctx.gate, args.episode, (gate) => deleteReelWith(gate, args.reelId))
        return result.status === 'deleted' ? { ok: true, result: { deleted: args.reelId } } : failure(result, 'The reel could not be deleted.')
      }
      const result = await inEpisode(ctx.gate, args.episode, (gate) => patchReelWith(gate, args.reelId, args.patch))
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The reel could not be changed.')
    },
    invert: async (ctx, args, undo) => {
      if (args.action === 'add') {
        const { reelId } = z.object({ reelId: z.uuid() }).parse(undo)
        const result = await inEpisode(ctx.gate, args.episode, (gate) => deleteReelWith(gate, reelId))
        return result.status === 'deleted' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
      }
      if (args.action === 'delete') return { kind: 'skipped', reason: 'A deleted reel cannot be brought back.' }
      const prior = z.object({ name: z.string(), clipLengthS: ClipLengthSchema }).parse(undo)
      const patch = Object.fromEntries(Object.keys(args.patch).map((field) => [field, prior[field as keyof typeof prior]]))
      const result = await inEpisode(ctx.gate, args.episode, (gate) => patchReelWith(gate, args.reelId, patch))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: () => Promise.resolve({ open: { route: 'production' } }),
  },
})

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

const ShotsInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), episode: EpisodeNumber, reelId: ReelIdSchema, description: z.string().max(2000).optional(), durationS: DurationPresetSchema.nullable().optional() }),
  z.object({ action: z.literal('patch'), episode: EpisodeNumber, shotId: ReelShotIdSchema, patch: ShotPatchSchema }),
  z.object({ action: z.literal('bulk_patch'), episode: EpisodeNumber, ids: BulkPatchSchema.shape.ids, patch: BulkPatchSchema.shape.patch }),
  z.object({ action: z.literal('move'), episode: EpisodeNumber, shotId: ReelShotIdSchema, reelId: ReelIdSchema, beforeId: ReelShotIdSchema.nullable() }),
  z.object({ action: z.literal('retime'), episode: EpisodeNumber, shotId: ReelShotIdSchema, durationS: z.number().int().min(1).max(15) }),
  z.object({ action: z.literal('delete'), episode: EpisodeNumber, shotId: ReelShotIdSchema }),
])

type ShotsInput = z.infer<typeof ShotsInput>

const ShotsArgs = z.intersection(ShotsInput, z.object({ slug: z.string() }))

type ShotsArgs = z.infer<typeof ShotsArgs>

/** A shot as its reel holds it - what a patch overwrites. */
const shotRecord = async (ctx: { readonly gate: ToolContext['gate'] }, shotId: string): Promise<Readonly<Record<string, unknown>> | null> => {
  const reelId = await readReelIdOfShot(ctx.gate.scope, shotId as ReelShotId)
  if (reelId === null) return null
  const reel = await readReel(ctx.gate.scope, reelId)
  const shot = reel?.shots.find((entry) => entry.id === shotId)
  return shot === undefined || reel === null ? null : { ...shot, reelId: reel.id, following: reel.shots[reel.shots.findIndex((entry) => entry.id === shotId) + 1]?.id ?? null }
}

const PATCHABLE = Object.keys(ShotPatchSchema.shape).filter((field) => field !== 'characters')

const priorOf = (record: Readonly<Record<string, unknown>>, fields: readonly string[]): Record<string, unknown> => Object.fromEntries(fields.map((field) => [field, record[field] ?? null]))

const describeShots = (args: ShotsArgs): string => {
  switch (args.action) {
    case 'add':
      return 'Add a shot to a reel'
    case 'patch':
      return `Change a shot: ${Object.keys(args.patch).join(', ')}`
    case 'bulk_patch':
      return `Change ${String(args.ids.length)} shots: ${Object.keys(args.patch).join(', ')}`
    case 'move':
      return 'Move a shot'
    case 'retime':
      return `Retime a shot to ${String(args.durationS)} s`
    case 'delete':
      return 'Delete a shot'
  }
}

export const manageShotsTool = defineWriteTool({
  name: 'manage_shots',
  description:
    'Propose Production shots in a reel: "add", "patch" one shot\'s fields, "bulk_patch" status / assignee / priority on several, "move" one to another place or reel, "retime" its duration (1-15 s), or "delete" one (it cannot be undone).',
  toolset: 'production',
  minimumRole: ROLE.productionEdit,
  mode: 'propose',
  input: ShotsInput,
  label: (input) => `Proposing a shot change (${input.action})`,
  prepare: async (ctx, input) => {
    const episode = await slugOf(ctx, input.episode)
    return episode === null ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { ...input, slug: episode.slug } }
  },
  executor: {
    args: ShotsArgs,
    describe: describeShots,
    target: (args) => ('shotId' in args ? { type: 'reel_shot', id: args.shotId } : args.action === 'add' ? { type: 'reel', id: args.reelId } : { type: 'reel_shot', id: null }),
    irreversible: (args) => args.action === 'delete' || (args.action === 'patch' && args.patch.characters !== undefined),
    capture: async (ctx, args) => {
      switch (args.action) {
        case 'add':
        case 'delete':
          return null
        case 'patch': {
          const record = await shotRecord(ctx, args.shotId)
          return record === null ? null : priorOf(record, Object.keys(args.patch).filter((field) => PATCHABLE.includes(field)))
        }
        case 'bulk_patch': {
          const records = await Promise.all(args.ids.map((id) => shotRecord(ctx, id)))
          return { shots: args.ids.map((id, index) => ({ id, prior: priorOf(records[index] ?? {}, Object.keys(args.patch)) })) }
        }
        case 'move': {
          const record = await shotRecord(ctx, args.shotId)
          return record === null ? null : { reelId: record['reelId'], beforeId: record['following'] }
        }
        case 'retime': {
          const record = await shotRecord(ctx, args.shotId)
          return record === null ? null : { durationS: record['durationS'] ?? null }
        }
      }
    },
    run: async (ctx, args) => {
      switch (args.action) {
        case 'add': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => addShotWith(gate, { reelId: args.reelId, ...(args.description === undefined ? {} : { description: args.description }), ...(args.durationS === undefined ? {} : { durationS: args.durationS }) }, ctx.idempotencyKey))
          return result.status === 'saved' ? { ok: true, result: { shotId: result.shot.id }, undo: { shotId: result.shot.id } } : failure(result, 'The shot could not be added.')
        }
        case 'patch': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => patchShotWith(gate, args.shotId, args.patch))
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The shot could not be changed.')
        }
        case 'bulk_patch': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => bulkPatchShotsWith(gate, { ids: args.ids, patch: args.patch }))
          return result.status === 'saved' ? { ok: true, result: { changed: result.changed } } : failure(result, 'The shots could not be changed.')
        }
        case 'move': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => moveShotWith(gate, { shotId: args.shotId, reelId: args.reelId, beforeId: args.beforeId }))
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The shot could not be moved.')
        }
        case 'retime': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => retimeShotWith(gate, { shotId: args.shotId, durationS: args.durationS }))
          return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The shot could not be retimed.')
        }
        case 'delete': {
          const result = await inEpisode(ctx.gate, args.slug, (gate) => deleteShotWith(gate, args.shotId))
          return result.status === 'saved' ? { ok: true, result: { deleted: args.shotId } } : failure(result, 'The shot could not be deleted.')
        }
      }
    },
    invert: async (ctx, args, undo) => {
      const done = (result: Failure) => (result.status === 'saved' ? { kind: 'undone' as const } : { kind: 'failed' as const, message: result.message ?? 'It could not be put back.' })
      switch (args.action) {
        case 'add':
          return done(await inEpisode(ctx.gate, args.slug, (gate) => deleteShotWith(gate, z.object({ shotId: z.uuid() }).parse(undo).shotId)))
        case 'patch':
          return done(await inEpisode(ctx.gate, args.slug, (gate) => patchShotWith(gate, args.shotId, ShotPatchSchema.parse(undo))))
        case 'bulk_patch': {
          const { shots } = z.object({ shots: z.array(z.object({ id: z.uuid(), prior: z.record(z.string(), z.unknown()) })) }).parse(undo)
          for (const shot of shots) {
            const result = await inEpisode(ctx.gate, args.slug, (gate) => patchShotWith(gate, shot.id, ShotPatchSchema.parse(shot.prior)))
            if (result.status !== 'saved') return { kind: 'failed', message: result.message }
          }
          return { kind: 'undone' }
        }
        case 'move': {
          const prior = z.object({ reelId: z.uuid(), beforeId: z.uuid().nullable() }).parse(undo)
          return done(await inEpisode(ctx.gate, args.slug, (gate) => moveShotWith(gate, { shotId: args.shotId, reelId: prior.reelId, beforeId: prior.beforeId })))
        }
        case 'retime': {
          const prior = z.object({ durationS: z.number().int().nullable() }).parse(undo)
          if (prior.durationS === null) return done(await inEpisode(ctx.gate, args.slug, (gate) => patchShotWith(gate, args.shotId, { durationS: null })))
          return done(await inEpisode(ctx.gate, args.slug, (gate) => retimeShotWith(gate, { shotId: args.shotId, durationS: prior.durationS })))
        }
        case 'delete':
          return { kind: 'skipped', reason: 'A deleted shot cannot be brought back.' }
      }
    },
    preview: () => Promise.resolve({ open: { route: 'production' } }),
  },
})

// ---------------------------------------------------------------------------
// The shotlist and cancelling - direct
// ---------------------------------------------------------------------------

export const aiShotlistTool = defineWriteTool({
  name: 'ai_shotlist',
  description: "Draft a reel's shots with Production's AI shotlist. It costs no credits and lands as proposed shots the writer accepts in the reel.",
  toolset: 'production',
  minimumRole: ROLE.paidGeneration,
  mode: 'direct',
  input: z.object({ episode: EpisodeNumber, reelId: ReelIdSchema }),
  label: () => 'Drafting a shotlist',
  prepare: async (ctx, input) => {
    const episode = await slugOf(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    const reel = await readReel(ctx.gate.scope, input.reelId)
    return reel === null ? { ok: false, message: 'There is no such reel.' } : { ok: true, args: { episode: episode.slug, reelId: input.reelId, label: reel.name } }
  },
  executor: {
    args: z.object({ episode: z.string(), reelId: z.uuid(), label: z.string() }),
    describe: (args) => `Draft a shotlist for ${args.label}`,
    target: (args) => ({ type: 'reel', id: args.reelId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.episode, (gate) => aiShotlistWith(gate, args.reelId))
      // Without a model key the rule-based proposal lands instead - still proposed shots, still no credits.
      if (result.status === 'queued') return { ok: true, result: { queued: true, generationId: result.generation.id } }
      if (result.status === 'disconnected') return { ok: true, result: { proposed: 'rule-based', note: result.message } }
      if (result.status === 'insufficient') return { ok: false, message: 'There are not enough credits.' }
      return failure(result, 'The shotlist could not be drafted.')
    },
    preview: () => Promise.resolve({ open: { route: 'production' } }),
  },
})

export const cancelGenerationTool = defineWriteTool({
  name: 'cancel_generation',
  description: 'Cancel a queued or running Production generation, by its id from get_run_status. What it held is released.',
  toolset: 'production',
  minimumRole: ROLE.paidGeneration,
  mode: 'direct',
  input: z.object({ episode: EpisodeNumber, generationId: ProductionGenerationIdSchema }),
  label: () => 'Cancelling a generation',
  prepare: async (ctx, input) => {
    const episode = await slugOf(ctx, input.episode)
    return episode === null ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { episode: episode.slug, generationId: input.generationId } }
  },
  executor: {
    args: z.object({ episode: z.string(), generationId: z.uuid() }),
    describe: () => 'Cancel a generation',
    target: (args) => ({ type: 'generation', id: args.generationId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await inEpisode(ctx.gate, args.episode, (gate) => cancelGenerationWith(gate, args.generationId))
      if (result.status === 'cancelled') return { ok: true, result: { cancelled: true } }
      if (result.status === 'already-over') return { ok: true, result: { cancelled: false, note: 'It had already finished.' } }
      return failure(result, 'The generation could not be cancelled.')
    },
  },
})

export const PRODUCTION_WRITE_TOOLS: readonly WriteTool[] = [saveEpisodeSettingsTool, manageReelsTool, manageShotsTool, aiShotlistTool, cancelGenerationTool]
