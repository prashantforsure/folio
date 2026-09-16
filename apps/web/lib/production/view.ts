import type { ProductionScene, ProductionShot, ReelRow, RenderResolution, Take } from '@folio/contracts'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL, SHOT_SIZE_LABEL } from '@folio/script'

import { describeReason, episodeStats, hasDescription, isFlagged, reelGates, reelTiming, sceneMode } from './status'
import type { EpisodeStats, GateInput, ProductionMode, ReelGates } from './status'

/**
 * What the Production route derives before it draws - the mockup's `data()`
 * method (`docs/ui design/Route - Production v2.dc.html`) over real rows.
 * Pure, and tested in `tests/production-view.test.ts`, so the scene strip,
 * the reel cards, the frame tiles, the episode table, the sidebar group and
 * its widget, the toolbar chip and the status bar agree on every count and
 * every colour.
 *
 * Nothing here is stored and nothing here decides: the fold is
 * `status.ts` (`reelGates`, `sceneMode`, `episodeStats`) and this file only
 * says how a folded value is printed. A count that appears twice on the
 * page is computed once here and read twice.
 *
 * ## Colour is semantic and strict, plus one
 *
 * README, "Tokens": green is settled, amber needs a decision, orange is
 * destructive or live, accent is links, selection and AI. This mockup adds
 * `--bad` (red) for a refused shot and the frame it cannot have - the one
 * route that declares a fifth hue (`packages/ui/src/tokens/palette.css`).
 * `Tone` names all of them so a component never spells a colour.
 */

export type Tone = 'ok' | 'warn' | 'live' | 'accent' | 'bad' | 'none'

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`

// ---------------------------------------------------------------------------
// The shot row
// ---------------------------------------------------------------------------

/** The three chips under a shot's number: size, movement, angle - the pure core's own labels. */
export const shotChips = (shot: ProductionShot): readonly string[] => [
  SHOT_SIZE_LABEL[shot.size].name,
  SHOT_MOVEMENT_LABEL[shot.movement],
  CAMERA_ANGLE_LABEL[shot.angle],
]

/** `4s`, or `—` while the shot has no duration. */
export const secondsLabel = (seconds: number | null): string => (seconds === null ? '—' : `${String(seconds)}s`)

/**
 * A text run split at its spoken lines. The mockup sets a quoted line in
 * full ink, italic ("quote spoken lines" is the placeholder's own advice);
 * the description model has text and mentions and no quote run, so this is
 * a presentational parse over the text: everything between a pair of
 * double quotes - straight or curly - is a `quote` piece. An unclosed
 * quote is text.
 */
export type TextPiece = { readonly kind: 'text' | 'quote'; readonly text: string }

const QUOTE = /[“”"]/g

export const quotePieces = (text: string): readonly TextPiece[] => {
  const marks: number[] = []
  for (const match of text.matchAll(QUOTE)) marks.push(match.index)
  if (marks.length < 2) return text === '' ? [] : [{ kind: 'text', text }]
  const pieces: TextPiece[] = []
  let at = 0
  for (let i = 0; i + 1 < marks.length; i += 2) {
    const open = marks[i]
    const close = marks[i + 1]
    if (open === undefined || close === undefined) break
    if (open > at) pieces.push({ kind: 'text', text: text.slice(at, open) })
    pieces.push({ kind: 'quote', text: text.slice(open, close + 1) })
    at = close + 1
  }
  if (at < text.length) pieces.push({ kind: 'text', text: text.slice(at) })
  return pieces
}

/** The row's ground and border: a proposal is amber and dashed, a refused shot red, anything else plain. */
export type ShotRowTone = 'plain' | 'proposed' | 'flagged'

export const shotRowTone = (shot: ProductionShot): ShotRowTone =>
  shot.state === 'proposed' ? 'proposed' : isFlagged(shot) ? 'flagged' : 'plain'

// ---------------------------------------------------------------------------
// The frame tile
// ---------------------------------------------------------------------------

/**
 * One tile per shot, in shot order, in whichever state its rows say. The
 * mockup draws six (`done`, `await`, `needs`, `queued`, `gen`, `blocked`);
 * the job row has two more outcomes, failed and cancelled, and a proposal
 * is a shot row too, so the tile has nine. Each carries the caption's
 * state word, the tile's own label, its tone, and whether its border is
 * dashed (a frame that could exist and does not).
 *
 * `progress` is the percentage the mockup prints on a generating tile.
 * The `jobs` row has a status and no progress column, and no worker writes
 * one, so it is `null` today and the tile draws an indeterminate bar; when
 * a column lands the fold sets it and the tile prints it.
 */
export type FrameTileKind =
  | 'done'
  | 'await'
  | 'needs'
  | 'queued'
  | 'generating'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'proposed'

export type FrameTile = {
  readonly kind: FrameTileKind
  /** The caption's state: `Shot 2 · 5s · <word>`. */
  readonly word: string
  /** The tile's own line under the glyph; empty on a drawn frame. */
  readonly label: string
  readonly glyph: string
  readonly tone: Tone
  readonly dashed: boolean
  readonly url: string | null
  readonly progress: number | null
  /** `takes appear when the frame lands` while one is on its way; `no takes yet` otherwise. */
  readonly noTakesLabel: string
}

export const frameTileOf = (shot: ProductionShot): FrameTile => {
  const base = { url: null, progress: null, noTakesLabel: 'no takes yet' } as const
  if (shot.state === 'proposed') {
    return { ...base, kind: 'proposed', word: 'Proposed', label: 'Accept the shot to generate', glyph: '◍', tone: 'warn', dashed: true }
  }
  const { frame } = shot
  switch (frame.kind) {
    case 'drawn':
      return { ...base, kind: 'done', word: 'Done', label: '', glyph: '', tone: 'ok', dashed: false, url: frame.url }
    case 'queued':
      return {
        ...base,
        kind: 'queued',
        word: 'Queued',
        label: 'Queued',
        glyph: '◐',
        tone: 'accent',
        dashed: false,
        noTakesLabel: 'takes appear when the frame lands',
      }
    case 'running':
      return {
        ...base,
        kind: 'generating',
        word: 'Generating',
        label: 'Generating',
        glyph: '◐',
        tone: 'accent',
        dashed: false,
        noTakesLabel: 'takes appear when the frame lands',
      }
    case 'blocked':
      if (isFlagged(shot)) {
        return {
          ...base,
          kind: 'blocked',
          word: 'Blocked',
          label: `Can't render — Rewrite shot ${shot.number}`,
          glyph: '⚠',
          tone: 'bad',
          dashed: false,
        }
      }
      break
    case 'failed':
      if (hasDescription(shot)) {
        return {
          ...base,
          kind: 'failed',
          word: 'Failed',
          label: frame.refunded ? 'Failed · credits refunded' : 'Failed · not yet refunded',
          glyph: '⚠',
          tone: 'live',
          dashed: true,
        }
      }
      break
    case 'cancelled':
      if (hasDescription(shot)) {
        return { ...base, kind: 'cancelled', word: 'Cancelled', label: 'Cancelled · awaiting frame', glyph: '◍', tone: 'none', dashed: true }
      }
      break
    case 'empty':
      break
  }
  if (!hasDescription(shot)) {
    return { ...base, kind: 'needs', word: 'Needs description', label: 'Needs description', glyph: '⌖', tone: 'warn', dashed: true }
  }
  return { ...base, kind: 'await', word: 'Awaiting frame', label: 'Awaiting frame', glyph: '◍', tone: 'none', dashed: true }
}

/** The tile's caption: `Shot 2 · 5s ·` - the state word follows in its own colour. */
export const frameCaption = (shot: ProductionShot): string => `Shot ${shot.number} · ${secondsLabel(shot.durationSeconds)} ·`

/** The takes a writer can page through: the drawn ones, kept first then newest, as the repository orders them. */
export const drawnTakes = (shot: ProductionShot): readonly Take[] => shot.takes.filter((take) => take.frame.kind === 'drawn')

/** `take 2 of 3`. */
export const takeLabel = (index: number, total: number): string => `take ${String(index + 1)} of ${String(total)}`

// ---------------------------------------------------------------------------
// The reel
// ---------------------------------------------------------------------------

export type ReelView = {
  readonly gates: ReelGates
  /** `3 shots · 12 s` - accepted shots and their seconds. */
  readonly shotMeta: string
  /** `12 / 15 s`; red when over. */
  readonly durLabel: string
  readonly over: boolean
  /** The bar: one segment per accepted shot, then the overrun in red. Widths are percentages. */
  readonly segments: readonly { readonly width: number; readonly tone: 'seg-1' | 'seg-2' | 'seg-3' | 'seg-4' | 'bad' }[]
  readonly status: { readonly label: string; readonly tone: Tone }
  /** `✦ Generate 2 frames · 8 cr`, `✦ Regenerate frames · 12 cr`. */
  readonly generate: { readonly label: string; readonly enabled: boolean; readonly title: string | null }
  /** Finalize, or Unlock once finalized. */
  readonly lock: { readonly label: 'Finalize' | 'Unlock'; readonly enabled: boolean }
  readonly render:
    | { readonly kind: 'render'; readonly label: string; readonly enabled: boolean }
    | { readonly kind: 'rendering'; readonly label: string }
    | { readonly kind: 'view'; readonly label: string; readonly url: string }
  /** The line under the buttons. */
  readonly reason: { readonly text: string; readonly tone: 'none' | 'live' | 'bad' }
  readonly proposed: number
}

const SEGMENT_TONES = ['seg-1', 'seg-2', 'seg-3', 'seg-4'] as const

const reelStatusView = (gates: ReelGates): ReelView['status'] => {
  switch (gates.status) {
    case 'writing':
    case 'ready':
    case 'needs-credits':
      return { label: 'Writing shots', tone: 'none' }
    case 'generating':
      return { label: 'Generating frames', tone: 'accent' }
    case 'blocked':
      return { label: 'Blocked', tone: 'bad' }
    case 'frames-done':
      return { label: 'Frames done', tone: 'ok' }
    case 'finalized':
      return { label: 'Finalized', tone: 'ok' }
    case 'rendering':
      return { label: 'Rendering', tone: 'accent' }
    case 'rendered':
      return { label: 'Rendered · view', tone: 'ok' }
  }
}

/**
 * The reason line. The fold's sentence, except where the mockup speaks of
 * something the fold does not count: a proposal still waiting in a reel
 * that could otherwise generate.
 */
const reelReason = (gates: ReelGates, proposed: number): ReelView['reason'] => {
  if (proposed > 0 && (gates.status === 'ready' || gates.status === 'writing')) {
    return {
      text: `${plural(proposed, 'shot is still a proposal. Accept it', 'shots are still proposals. Accept them')} to generate frames.`,
      tone: 'none',
    }
  }
  return {
    text: describeReason(gates.reason),
    tone: gates.status === 'needs-credits' ? 'live' : gates.status === 'blocked' ? 'bad' : 'none',
  }
}

export const reelViewOf = (reel: ReelRow, input: GateInput): ReelView => {
  const gates = reelGates(reel, input)
  const timing = reelTiming(reel.shots, reel.clipSeconds)
  const accepted = reel.shots.filter((shot) => shot.state === 'accepted')
  const proposed = reel.shots.length - accepted.length
  const over = timing.over > 0
  const span = Math.max(reel.clipSeconds, timing.total)
  const segments: { readonly width: number; readonly tone: ReelView['segments'][number]['tone'] }[] = timing.segments.map((segment, index) => {
    const shot = accepted[index]
    return {
      width: span === 0 ? 0 : Math.min(100, ((segment.seconds ?? 0) / span) * 100),
      tone: shot !== undefined && isFlagged(shot) ? 'bad' : (SEGMENT_TONES[index % SEGMENT_TONES.length] ?? 'seg-1'),
    }
  })
  if (over && timing.total > 0) segments.push({ width: (timing.over / timing.total) * 100, tone: 'bad' })

  const regenerate = gates.status === 'frames-done' || gates.status === 'finalized' || gates.status === 'rendered' || gates.status === 'rendering'
  const generateCost = regenerate ? accepted.length * input.frameCost : gates.cost
  const generateLabel = regenerate
    ? `✦ Regenerate frames · ${String(generateCost)} cr`
    : `✦ Generate ${plural(gates.pending.length, 'frame', 'frames')} · ${String(generateCost)} cr`
  const finalized = reel.finalizedAt !== null
  const generateTitle = finalized
    ? 'Unlock the reel to regenerate its frames'
    : gates.status === 'needs-credits'
      ? `${String(input.available)} credits available · ${String(gates.cost)} needed`
      : null

  const render: ReelView['render'] =
    reel.clip.kind === 'rendered'
      ? { kind: 'view', label: 'Rendered · view', url: reel.clip.url }
      : gates.status === 'rendering'
        ? { kind: 'rendering', label: 'Rendering…' }
        : {
            kind: 'render',
            label: `▶ ${reel.clip.kind === 'failed' || reel.clip.kind === 'blocked' || reel.clip.kind === 'cancelled' ? 'Render again' : 'Render reel'} · ${String(input.renderCost)} cr`,
            enabled: gates.canRender,
          }

  return {
    gates,
    shotMeta: `${plural(accepted.length, 'shot', 'shots')} · ${String(timing.total)} s`,
    durLabel: `${String(timing.total)} / ${String(reel.clipSeconds)} s`,
    over,
    segments,
    status: reelStatusView(gates),
    generate: { label: generateLabel, enabled: gates.canGenerate, title: generateTitle },
    lock: finalized ? { label: 'Unlock', enabled: gates.canUnlock } : { label: 'Finalize', enabled: gates.canFinalize },
    render,
    reason: reelReason(gates, proposed),
    proposed,
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * One scene's coverage - what the strip tab, the sidebar row, the episode
 * table row and the widget all read. Published to the sidebar after every
 * write (`coverage.ts`), seeded by the server from the same rows.
 */
export type SceneCoverage = {
  readonly sceneNodeId: string
  readonly number: number
  readonly heading: string
  readonly mode: ProductionMode
  readonly reels: number
  /** Accepted shots in reels. */
  readonly shots: number
  readonly done: number
  readonly total: number
  /** Seconds the scene's reels render to; `null` with no reel. */
  readonly seconds: number | null
  /** The Storyboard's shots not yet in a reel. */
  readonly unreeled: number
}

export const sceneCoverageOf = (scene: ProductionScene, input: GateInput): SceneCoverage => {
  let shots = 0
  let done = 0
  let seconds = 0
  for (const reel of scene.reels) {
    const accepted = reel.shots.filter((shot) => shot.state === 'accepted')
    shots += accepted.length
    done += accepted.filter((shot) => shot.frame.kind === 'drawn').length
    seconds += reel.clipSeconds
  }
  return {
    sceneNodeId: scene.sceneNodeId,
    number: scene.number,
    heading: scene.heading,
    mode: sceneMode(scene, input),
    reels: scene.reels.length,
    shots,
    done,
    total: shots,
    seconds: scene.reels.length === 0 ? null : seconds,
    unreeled: scene.unreeled.filter((shot) => shot.state === 'accepted').length,
  }
}

export const coverageRows = (scenes: readonly ProductionScene[], input: GateInput): readonly SceneCoverage[] =>
  scenes.map((scene) => sceneCoverageOf(scene, input))

/** The mockup's `stMap`: the pill in the episode table, the dot on the strip tab. */
export const sceneStatus = (mode: ProductionMode): { readonly label: string; readonly tone: Tone } => {
  switch (mode) {
    case 'empty':
      return { label: 'No reels', tone: 'none' }
    case 'authoring':
      return { label: 'Writing shots', tone: 'warn' }
    case 'nocredits':
      return { label: 'Needs credits', tone: 'live' }
    case 'generating':
      return { label: 'Generating', tone: 'accent' }
    case 'blocked':
      return { label: 'Blocked', tone: 'bad' }
    case 'finished':
      return { label: 'Rendered', tone: 'ok' }
  }
}

/** The sidebar row's bar: green once rendered, bare with no reel, accent on the way. */
export const sceneBarTone = (coverage: SceneCoverage): 'ok' | 'accent' | 'none' =>
  coverage.mode === 'finished' ? 'ok' : coverage.mode === 'empty' ? 'none' : 'accent'

export const scenePercent = (coverage: SceneCoverage): number =>
  coverage.total === 0 ? 0 : Math.round((coverage.done / coverage.total) * 100)

/** The sidebar row's meta: `no reels`, `rendered`, `2/6 frames · 2 reels`. */
export const sceneMeta = (coverage: SceneCoverage): string => {
  if (coverage.mode === 'empty') return 'no reels'
  if (coverage.mode === 'finished') return 'rendered'
  return `${String(coverage.done)}/${String(coverage.total)} frames · ${plural(coverage.reels, 'reel', 'reels')}`
}

/** `1. EXT. COMMUNITY PITCH – DUSK`; a heading not yet written prints as the Storyboard's `No heading yet`. */
export const sceneTabLabel = (coverage: Pick<SceneCoverage, 'number' | 'heading'>): string =>
  `${String(coverage.number)}. ${coverage.heading === '' ? 'No heading yet' : coverage.heading}`

/** `18s`, or `—` with no reel. */
export const sceneSecondsLabel = (coverage: SceneCoverage): string => (coverage.seconds === null ? '—' : `${String(coverage.seconds)}s`)

/** The orphan strip: `3 shots from the Storyboard aren't in a reel yet`. */
export const orphanLabel = (count: number): string =>
  `${plural(count, 'shot', 'shots')} from the Storyboard ${count === 1 ? "isn't" : "aren't"} in a reel yet`

// ---------------------------------------------------------------------------
// The episode
// ---------------------------------------------------------------------------

export type StatTile = {
  readonly label: string
  readonly value: string
  readonly note: string
  readonly tone: 'ink' | 'ok'
}

/** The four tiles of the Episode view, from one `EpisodeStats`. */
export const statTiles = (stats: EpisodeStats, coverage: readonly SceneCoverage[], resolution: RenderResolution): readonly StatTile[] => [
  {
    label: 'Scenes with reels',
    value: `${String(stats.scenesWithReels)} / ${String(stats.scenes)}`,
    note: `of ${String(stats.scenes)} in the episode`,
    tone: 'ink',
  },
  {
    label: 'Reels',
    value: String(stats.reels),
    note:
      stats.reels === 0
        ? 'none yet'
        : coverage
            .filter((row) => row.reels > 0)
            .map((row) => `${String(row.reels)} in Scene ${String(row.number)}`)
            .join(' · '),
    tone: 'ink',
  },
  {
    label: 'Frames done',
    value: `${String(stats.framesDone)} / ${String(stats.framesTotal)}`,
    note: `${String(stats.framesTotal - stats.framesDone)} awaiting generation`,
    tone: 'ink',
  },
  {
    label: 'Clips rendered',
    value: String(stats.clipsRendered),
    note: `${resolution} · ${String(stats.renderedSeconds)} s total`,
    tone: stats.clipsRendered > 0 ? 'ok' : 'ink',
  },
]

/** The widget: `2 / 6`, its bar, `4 frames left to generate`. */
export const episodeFrames = (stats: EpisodeStats): { readonly label: string; readonly percent: number; readonly note: string } => ({
  label: `${String(stats.framesDone)} / ${String(stats.framesTotal)}`,
  percent: stats.framesTotal === 0 ? 0 : Math.round((stats.framesDone / stats.framesTotal) * 100),
  note: `${plural(stats.framesTotal - stats.framesDone, 'frame', 'frames')} left to generate`,
})

/** The toolbar chip: `2 reels in this scene`. */
export const reelsChip = (reels: number): string => `${plural(reels, 'reel', 'reels')} in this scene`

/** The status bar's left: `Ep 1 · 3 scenes · 2 reels · Scene 1 · Writing shots`. */
export const statusLeft = (
  ordinal: number,
  stats: EpisodeStats,
  scene: SceneCoverage | null,
  reelLabel: string | null,
): string => {
  const parts = [`Ep ${String(ordinal)}`, plural(stats.scenes, 'scene', 'scenes')]
  if (scene !== null) {
    parts.push(plural(scene.reels, 'reel', 'reels'), `Scene ${String(scene.number)}`, reelLabel ?? sceneStatus(scene.mode).label)
  }
  return parts.join(' · ')
}

export { episodeStats }
export type { EpisodeStats }
