import type { ClipState, FrameState, ProductionScene, ProductionShot, ReelRow, RenderResolution } from '@folio/contracts'

/**
 * A reel's status, folded from its rows. Pure, and the only place the rule
 * lives: the repository returns rows (`@folio/db`, `production.ts`) and the
 * UI - whatever the redesign makes it - prints what this returns.
 *
 * AGENTS.md's exception table on `production.state`: "the generation job's
 * status. Drive it from the job row; all six states get built." Every
 * input here is a job's status folded into a `FrameState` or `ClipState`,
 * plus the shots' own text and durations. Nothing is stored that this
 * computes.
 *
 * ## The rules, in precedence order
 *
 *   rendered       the latest render finished with a clip
 *   rendering      a render is queued or running
 *   finalized      `finalized_at` set; shots locked; render allowed
 *   generating     a frame job is queued or running
 *   blocked        a frame was refused and the shot has not been edited since
 *   writing        no accepted shot, or one without a description
 *   needs-credits  frames to generate cost more than the balance
 *   frames-done    every accepted shot has a drawn frame
 *   ready          frames to generate, and the credits for them
 *
 * A blocked frame stops counting once the shot is edited (`updatedAt` after
 * the take's `createdAt`): the refusal was of the text that was refused, and
 * the fix is a rewrite - "fix it and the rest of the reel generates". The
 * take stays in the list, as history.
 *
 * ## Timing
 *
 * A reel renders as one clip of `clipSeconds` (ruling A). The accepted
 * shots' durations must fill it exactly: `remaining` and `over` say which
 * way the gap runs, `missing` how many shots have no duration yet. Timing
 * gates Finalize, not frame generation - a frame is a picture and needs no
 * length.
 *
 * ## Copy
 *
 * `describeReason` holds the mock's final copy (`docs/ui design/Route -
 * Production.dc.html`) in one place, with the cap rules' sentences beside
 * it. The reason is a code so the redesign may print it its own way and the
 * test can assert on the rule, not the sentence.
 */

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type ReelTiming = {
  /** Seconds the accepted shots with a duration add up to. */
  readonly total: number
  /** Accepted shots with no duration yet. */
  readonly missing: number
  /** Seconds short of the clip; zero when full or over. */
  readonly remaining: number
  /** Seconds past the clip; zero when under or exact. */
  readonly over: number
  /** Full to the second, every shot timed. What Finalize needs. */
  readonly exact: boolean
  /** One segment per accepted shot, in order, for a bar. `null` seconds is an untimed shot. */
  readonly segments: readonly { readonly shotId: ProductionShot['id']; readonly seconds: number | null }[]
}

export const reelTiming = (shots: readonly ProductionShot[], clipSeconds: number): ReelTiming => {
  const accepted = shots.filter(isAccepted)
  const segments = accepted.map((shot) => ({ shotId: shot.id, seconds: shot.durationSeconds }))
  const total = accepted.reduce((sum, shot) => sum + (shot.durationSeconds ?? 0), 0)
  const missing = accepted.filter((shot) => shot.durationSeconds === null).length
  return {
    total,
    missing,
    remaining: Math.max(0, clipSeconds - total),
    over: Math.max(0, total - clipSeconds),
    exact: accepted.length > 0 && missing === 0 && total === clipSeconds,
    segments,
  }
}

// ---------------------------------------------------------------------------
// The shot-level facts the fold reads
// ---------------------------------------------------------------------------

const isAccepted = (shot: ProductionShot): boolean => shot.state === 'accepted'

/** A description with no text and no mention is no description. */
export const hasDescription = (shot: ProductionShot): boolean =>
  shot.description.some((run) => run.kind === 'mention' || run.text.trim().length > 0)

/** The frame was refused, and the shot has not been rewritten since. */
export const isFlagged = (shot: ProductionShot): boolean => {
  if (shot.frame.kind !== 'blocked') return false
  const take = shot.takes[0]
  if (take === undefined) return false
  return shot.updatedAt <= take.createdAt
}

const inFlight = (frame: FrameState): boolean => frame.kind === 'queued' || frame.kind === 'running'

/** A shot that needs a frame: none yet, or the last one failed, was cancelled, or was refused and the shot rewritten. */
export const needsFrame = (shot: ProductionShot): boolean => {
  switch (shot.frame.kind) {
    case 'empty':
    case 'failed':
    case 'cancelled':
      return true
    case 'blocked':
      return !isFlagged(shot)
    case 'drawn':
    case 'queued':
    case 'running':
      return false
  }
}

const clipInFlight = (clip: ClipState): boolean => clip.kind === 'queued' || clip.kind === 'running'

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

export type ReelStatus =
  | 'writing'
  | 'ready'
  | 'needs-credits'
  | 'generating'
  | 'blocked'
  | 'frames-done'
  | 'finalized'
  | 'rendering'
  | 'rendered'

export type ReasonCode =
  | { readonly kind: 'no-shots' }
  | { readonly kind: 'missing-descriptions'; readonly count: number }
  | { readonly kind: 'blocked'; readonly shotNumber: string; readonly reason: string }
  | { readonly kind: 'generating' }
  | { readonly kind: 'needs-credits'; readonly needed: number; readonly available: number }
  | { readonly kind: 'ready'; readonly pending: number; readonly costEach: number }
  | { readonly kind: 'frames-done' }
  | { readonly kind: 'missing-durations'; readonly count: number }
  | { readonly kind: 'timing'; readonly total: number; readonly clipSeconds: number }
  | { readonly kind: 'finalized' }
  | { readonly kind: 'rendering' }
  | { readonly kind: 'rendered'; readonly resolution: RenderResolution; readonly cost: number }
  | { readonly kind: 'clip-failed'; readonly error: string | null; readonly refunded: boolean }
  | { readonly kind: 'clip-blocked'; readonly reason: string }

export type ReelGates = {
  readonly status: ReelStatus
  readonly timing: ReelTiming
  /** Accepted shots that need a frame. What Generate would queue. */
  readonly pending: readonly ProductionShot[]
  /** Credits Generate would reserve: `pending × costEach`. */
  readonly cost: number
  readonly canGenerate: boolean
  readonly canFinalize: boolean
  readonly canUnlock: boolean
  readonly canRender: boolean
  /** Why the reel is where it is - the line under the buttons. */
  readonly reason: ReasonCode
}

export type GateInput = {
  readonly available: number
  readonly frameCost: number
  readonly renderCost: number
  readonly resolution: RenderResolution
}

export const reelGates = (reel: ReelRow, input: GateInput): ReelGates => {
  const accepted = reel.shots.filter(isAccepted)
  const timing = reelTiming(reel.shots, reel.clipSeconds)
  const missing = accepted.filter((shot) => !hasDescription(shot))
  const flagged = accepted.find(isFlagged)
  const busy = accepted.some((shot) => inFlight(shot.frame))
  const pending = accepted.filter(needsFrame)
  const allDrawn = accepted.length > 0 && accepted.every((shot) => shot.frame.kind === 'drawn')
  const cost = pending.length * input.frameCost
  const short = pending.length > 0 && input.available < cost
  const finalized = reel.finalizedAt !== null
  const clipBusy = clipInFlight(reel.clip)

  const none: Omit<ReelGates, 'status' | 'reason'> = {
    timing,
    pending,
    cost,
    canGenerate: false,
    canFinalize: false,
    canUnlock: false,
    canRender: false,
  }

  if (reel.clip.kind === 'rendered') {
    return {
      ...none,
      status: 'rendered',
      canRender: finalized && input.available >= input.renderCost,
      canUnlock: finalized,
      reason: { kind: 'rendered', resolution: input.resolution, cost: input.renderCost },
    }
  }
  if (clipBusy) return { ...none, status: 'rendering', reason: { kind: 'rendering' } }
  if (finalized) {
    const reason: ReasonCode =
      reel.clip.kind === 'failed'
        ? { kind: 'clip-failed', error: reel.clip.error, refunded: reel.clip.refunded }
        : reel.clip.kind === 'blocked'
          ? { kind: 'clip-blocked', reason: reel.clip.reason }
          : { kind: 'finalized' }
    return {
      ...none,
      status: 'finalized',
      canUnlock: true,
      canRender: input.available >= input.renderCost,
      reason,
    }
  }
  if (busy) return { ...none, status: 'generating', reason: { kind: 'generating' } }
  if (flagged !== undefined && flagged.frame.kind === 'blocked') {
    return {
      ...none,
      status: 'blocked',
      reason: { kind: 'blocked', shotNumber: flagged.number, reason: flagged.frame.reason },
    }
  }
  if (accepted.length === 0) return { ...none, status: 'writing', reason: { kind: 'no-shots' } }
  if (missing.length > 0) {
    return { ...none, status: 'writing', reason: { kind: 'missing-descriptions', count: missing.length } }
  }
  if (short) {
    return { ...none, status: 'needs-credits', reason: { kind: 'needs-credits', needed: cost, available: input.available } }
  }
  if (allDrawn) {
    // Frames done. Finalize needs the timing too; the reason says which is missing.
    const reason: ReasonCode =
      timing.missing > 0
        ? { kind: 'missing-durations', count: timing.missing }
        : timing.exact
          ? { kind: 'frames-done' }
          : { kind: 'timing', total: timing.total, clipSeconds: reel.clipSeconds }
    return { ...none, status: 'frames-done', canFinalize: timing.exact, reason }
  }
  return {
    ...none,
    status: 'ready',
    canGenerate: pending.length > 0,
    reason: { kind: 'ready', pending: pending.length, costEach: input.frameCost },
  }
}

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** The line under the buttons. The mock's sentences, plus the cap rules'. */
export const describeReason = (reason: ReasonCode): string => {
  switch (reason.kind) {
    case 'no-shots':
      return 'No shots in this reel yet. Add one, or propose shots from the scene.'
    case 'missing-descriptions':
      return `${plural(reason.count, 'shot needs', 'shots need')} a description before frames can generate.`
    case 'blocked':
      return `Shot ${reason.shotNumber} can't be rendered: ${reason.reason} Fix it and the rest of the reel generates.`
    case 'generating':
      return "Frames are generating. You can keep editing shots that haven't started."
    case 'needs-credits':
      return `Needs ${reason.needed} credits, you have ${reason.available}. Top up to continue.`
    case 'ready':
      return `Complete list. ${plural(reason.pending, 'frame', 'frames')} at ${reason.costEach} credits each.`
    case 'frames-done':
      return 'All frames done. Finalize locks them, then the reel can render.'
    case 'missing-durations':
      return `All frames done. ${plural(reason.count, 'shot needs', 'shots need')} a duration before the reel can be finalized.`
    case 'timing': {
      const gap = Math.abs(reason.clipSeconds - reason.total)
      return reason.total < reason.clipSeconds
        ? `Shots run ${reason.total} s; the clip is ${reason.clipSeconds} s. Add ${gap} s, or pick a shorter clip.`
        : `Shots run ${reason.total} s; the clip is ${reason.clipSeconds} s. Cut ${gap} s, or pick a longer clip.`
    }
    case 'finalized':
      return 'Finalized. Render the reel, or unlock to keep editing.'
    case 'rendering':
      return 'The clip is rendering. Unlock waits until it is done.'
    case 'rendered':
      return `Rendered at ${reason.resolution} · ${reason.cost} credits spent.`
    case 'clip-failed':
      return reason.refunded
        ? `The render failed and the credits were refunded.${reason.error === null ? '' : ` ${reason.error}`}`
        : `The render failed.${reason.error === null ? '' : ` ${reason.error}`}`
    case 'clip-blocked':
      return `The render was refused: ${reason.reason}`
  }
}

// ---------------------------------------------------------------------------
// Scene and episode
// ---------------------------------------------------------------------------

/** The bundle's six route modes, for one scene. "Drive it from the job row." */
export type ProductionMode = 'authoring' | 'empty' | 'generating' | 'finished' | 'blocked' | 'nocredits'

export const sceneMode = (scene: ProductionScene, input: GateInput): ProductionMode => {
  if (scene.reels.length === 0) return 'empty'
  const gates = scene.reels.map((reel) => reelGates(reel, input))
  if (gates.some((gate) => gate.status === 'blocked' || gate.reason.kind === 'clip-blocked')) return 'blocked'
  if (gates.some((gate) => gate.status === 'needs-credits')) return 'nocredits'
  if (gates.some((gate) => gate.status === 'generating' || gate.status === 'rendering')) return 'generating'
  if (gates.every((gate) => gate.status === 'rendered')) return 'finished'
  return 'authoring'
}

export type EpisodeStats = {
  readonly scenes: number
  readonly scenesWithReels: number
  readonly reels: number
  /** Accepted shots in reels. */
  readonly shots: number
  readonly framesDone: number
  readonly framesTotal: number
  readonly clipsRendered: number
  /** Total seconds of rendered clips. */
  readonly renderedSeconds: number
}

/** The tiles, the column footer, the status bar. Counts, never opinions. */
export const episodeStats = (scenes: readonly ProductionScene[]): EpisodeStats => {
  let scenesWithReels = 0
  let reels = 0
  let shots = 0
  let framesDone = 0
  let clipsRendered = 0
  let renderedSeconds = 0
  for (const scene of scenes) {
    if (scene.reels.length > 0) scenesWithReels += 1
    for (const reel of scene.reels) {
      reels += 1
      const accepted = reel.shots.filter(isAccepted)
      shots += accepted.length
      framesDone += accepted.filter((shot) => shot.frame.kind === 'drawn').length
      if (reel.clip.kind === 'rendered') {
        clipsRendered += 1
        renderedSeconds += reel.clipSeconds
      }
    }
  }
  return { scenes: scenes.length, scenesWithReels, reels, shots, framesDone, framesTotal: shots, clipsRendered, renderedSeconds }
}
