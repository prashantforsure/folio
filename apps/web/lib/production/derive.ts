import type { ProductionScene, Readiness, ReadinessFlag, Reel, ReelShot, ShotStatus } from '@folio/contracts'

/**
 * The spec's derived values (`docs/production/production.md` §7, "Derived
 * values - compute, don't store"), each a pure function over the rows the
 * server hands the page. Nothing here reads a clock or a store; the server
 * runs the same functions to gate a shoot, so the button and the action
 * cannot disagree.
 */

// ---------------------------------------------------------------------------
// Shot status
// ---------------------------------------------------------------------------

/**
 * §6, "Status derivation (when no explicit override exists)": blocked →
 * refused, proposed → proposed, else from the frame state.
 */
export const shotStatusOf = (shot: ReelShot): ShotStatus => {
  if (shot.status !== null) return shot.status
  if (shot.blocked) return 'refused'
  if (shot.proposed) return 'proposed'
  switch (shot.frameState) {
    case 'gen':
      return 'generating'
    case 'queued':
      return 'queued'
    case 'stale':
      return 'out_of_date'
    case 'drawn':
    case 'uploaded':
      return 'drawn'
    default:
      return 'to_draw'
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const MAX_SECONDS = 15

export const secondsOf = (shot: ReelShot): number => shot.durationS ?? 0

/** `used_seconds = Σ shots.duration_s where proposed = false`. */
export const usedSeconds = (reel: Pick<Reel, 'shots'>): number =>
  reel.shots.reduce((total, shot) => total + (shot.proposed ? 0 : secondsOf(shot)), 0)

/** Every shot's seconds, proposals included - the bar's denominator with the clip length. */
export const totalSeconds = (reel: Pick<Reel, 'shots'>): number => reel.shots.reduce((total, shot) => total + secondsOf(shot), 0)

export type TimingTone = 'ok' | 'bad' | 'dim'

export type TimingSegment = {
  readonly shotId: ReelShot['id']
  readonly index: number
  readonly seconds: number
  /** Percent of the bar, two decimals, as the mockup prints it. */
  readonly width: string
  readonly proposed: boolean
}

export type ReelTiming = {
  readonly used: number
  readonly target: number
  readonly total: number
  readonly tone: TimingTone
  readonly segments: readonly TimingSegment[]
  /** Seconds not yet filled, or 0 when full or over. */
  readonly rest: number
  readonly restWidth: string
}

const pct = (part: number, whole: number): string => (whole <= 0 ? '0.00%' : `${((part / whole) * 100).toFixed(2)}%`)

/** §3.1–3.2: `{used} / {target} s`, green when equal, red when over, dim when under; widths over `max(clipLength, total)`. */
export const reelTiming = (reel: Pick<Reel, 'shots' | 'clipLengthS'>): ReelTiming => {
  const used = usedSeconds(reel)
  const total = totalSeconds(reel)
  const target = Math.min(reel.clipLengthS, MAX_SECONDS)
  const denom = Math.max(target, total)
  const rest = Math.max(0, target - total)
  return {
    used,
    target,
    total,
    tone: used === target ? 'ok' : used > target ? 'bad' : 'dim',
    segments: reel.shots.map((shot, index) => ({
      shotId: shot.id,
      index,
      seconds: secondsOf(shot),
      width: pct(secondsOf(shot), denom),
      proposed: shot.proposed,
    })),
    rest,
    restWidth: pct(rest, denom),
  }
}

/** The four-colour cycle: a shot's segment and badge colour token, by index. */
export const segmentTone = (index: number): 'seg-1' | 'seg-2' | 'seg-3' | 'seg-4' =>
  (['seg-1', 'seg-2', 'seg-3', 'seg-4'] as const)[index % 4] ?? 'seg-1'

/** §3.2: a retime is clamped to `1 … min(clipLength, 15) − sum(other shots)`, whole seconds. */
export const clampRetime = (reel: Pick<Reel, 'shots' | 'clipLengthS'>, shotId: ReelShot['id'], next: number): number => {
  const others = reel.shots.filter((shot) => shot.id !== shotId).reduce((total, shot) => total + secondsOf(shot), 0)
  const max = Math.max(1, Math.min(reel.clipLengthS, MAX_SECONDS) - others)
  return Math.max(1, Math.min(max, Math.round(next)))
}

/** The bar's `{from}–{to}s` clock per shot, proposals included as the mockup counts them. */
export const shotClocks = (reel: Pick<Reel, 'shots'>): readonly { readonly shotId: ReelShot['id']; readonly from: number; readonly to: number }[] => {
  let clock = 0
  return reel.shots.map((shot) => {
    const from = clock
    clock += secondsOf(shot)
    return { shotId: shot.id, from, to: clock }
  })
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * §3.7, the four steps. Step 3 counts an uploaded still as well as a drawn
 * one - the spec says `drawn`, the mockup's `Upload scene` would otherwise
 * never satisfy the step it sits under (flagged as a reading, not a rule).
 */
export const readinessOf = (scene: Pick<ProductionScene, 'plateReady' | 'stillState' | 'cast'>, reel: Pick<Reel, 'shots' | 'clipLengthS' | 'sheet'>): Readiness => {
  const timing = reelTiming(reel)
  const shotlist = reel.shots.length > 0 && timing.used === timing.target
  const sheet = reel.sheet?.state === 'done'
  const sceneImage = scene.plateReady && (scene.stillState === 'drawn' || scene.stillState === 'uploaded')
  const characters = scene.cast.every((member) => member.appearanceReady)
  const failed: ReadinessFlag[] = []
  if (!shotlist) failed.push('shotlist')
  if (!sheet) failed.push('sheet')
  if (!sceneImage) failed.push('scene_image')
  if (!characters) failed.push('characters')
  return { shotlist, sheet, sceneImage, characters, canShoot: failed.length === 0, failed }
}

/** The cast members with no appearance reference - step 4's `{names} missing`. */
export const missingAppearances = (scene: Pick<ProductionScene, 'cast'>): readonly ProductionScene['cast'][number][] =>
  scene.cast.filter((member) => !member.appearanceReady)

/** `▶ Start shooting` until a clip exists; `▶ Reshoot reel` after. */
export const hasClip = (reel: Pick<Reel, 'clip'>): boolean => reel.clip !== null && reel.clip.state !== 'gate'

// ---------------------------------------------------------------------------
// Scene-level
// ---------------------------------------------------------------------------

export type SceneDot = 'bad' | 'warn' | 'accent' | 'ok' | 'idle' | 'none'

/** §7: refused > proposed/stale > generating > all rendered > idle; `none` with no reels. */
export const sceneDot = (scene: Pick<ProductionScene, 'reels'>): SceneDot => {
  const reels = scene.reels
  if (reels.length === 0) return 'none'
  if (reels.some((reel) => reel.shots.some((shot) => shot.blocked))) return 'bad'
  if (reels.some((reel) => reel.status === 'stale' || reel.shots.some((shot) => shot.proposed))) return 'warn'
  if (reels.some((reel) => reel.status === 'generating')) return 'accent'
  if (reels.every((reel) => reel.status === 'rendered')) return 'ok'
  return 'idle'
}

/** §4: `{reels} reels · {shots} shots · {secs} s`. */
export const sceneSummary = (scene: Pick<ProductionScene, 'reels'>): string => {
  const reels = scene.reels.length
  const shots = scene.reels.reduce((total, reel) => total + reel.shots.length, 0)
  const secs = scene.reels.reduce((total, reel) => total + usedSeconds(reel), 0)
  return `${String(reels)} ${reels === 1 ? 'reel' : 'reels'} · ${String(shots)} shots · ${String(secs)} s`
}

/** The tab's `title` and the Columns header's pill: `EXT · DUSK`. */
export const sceneFacts = (scene: Pick<ProductionScene, 'intExt' | 'timeOfDay'>): string =>
  [scene.intExt, scene.timeOfDay].filter((part): part is string => part !== null && part.length > 0).join(' · ')

/** The first scene with reels, else the first - what the page opens on. */
export const firstSelection = (scenes: readonly ProductionScene[]): { readonly sceneNodeId: ProductionScene['sceneNodeId']; readonly reelId: Reel['id'] | null } | null => {
  const scene = scenes.find((candidate) => candidate.reels.length > 0) ?? scenes[0]
  if (scene === undefined) return null
  return { sceneNodeId: scene.sceneNodeId, reelId: scene.reels[0]?.id ?? null }
}
