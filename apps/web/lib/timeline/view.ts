import type {
  EpisodeSlug,
  FindingVerdict,
  Placement,
  StoryThread,
  StoryThreadColour,
  StoryThreadId,
  StoryThreadRow,
  TimelineEpisodeColumn,
  TimelineSceneRow,
} from '@folio/contracts'
import type { Chronology, ContinuityFinding, ContinuityKind, ContinuityScene, PlacementProposal, StoryJump, StoryTime } from '@folio/script'
import {
  FLAGGED_KINDS,
  INFORMATIONAL_KINDS,
  chronology,
  continuityFindings,
  formatStoryDay,
  formatStoryTime,
  precedesStoryTime,
  proposePlacements,
  readSlugline,
  storyJumps,
  storySpan,
} from '@folio/script'
import type { NodeId } from '@folio/script'

import { eighths } from '../workspace/format'

/**
 * Every line the Timeline route prints that is not the writer's own text,
 * and the shape of the grid it draws - pure over the rows the loader hands
 * it, tested in `tests/timeline-view.test.ts`. The rebuild (2026-09-18)
 * moved these off the client: the first pass recomputed the grid's rows,
 * columns and cells inside `story-grid.tsx` on every render and
 * re-implemented the core's "the scene before it" rule in the workspace;
 * now the workspace calls one function and draws what comes back.
 *
 * AGENTS.md, UI fidelity: every number on the route is computed from the
 * script or from what the writer typed against it; nothing here estimates,
 * and nothing here reads a node.
 *
 * ## The order the core owns stays the core's
 *
 * `@folio/script`'s `timeline.ts` decides what precedes what, which day a
 * scene sits in and how long the frame story runs; `continuity.ts` decides
 * what is a finding; `time-cues.ts` what to propose. This file only
 * groups, buckets and labels: it takes what the core produced and lays it
 * out, and words each finding as a sentence over the names only this side
 * knows. `previousFrameScene` is the one rule repeated here - "the last
 * placed, non-flashback scene before it on the page" - and it is the
 * core's own definition, kept in one place on this side so the drawer
 * and the grid agree.
 */

export type GridView = 'story' | 'chrono'

/** What the rows are: threads (the default), the cast, or the sets. Same grid, a different `rowsOf`. */
export type GridLanes = 'thread' | 'character' | 'location'

export const GRID_LANES: readonly { readonly id: GridLanes; readonly label: string }[] = [
  { id: 'thread', label: 'Threads' },
  { id: 'character', label: 'Characters' },
  { id: 'location', label: 'Locations' },
]

/** The grid row a scene with no thread, no cast or no set sits in. */
export const NO_ROW = 'none'

/** Which row a scene's card sits in on the thread lanes: its first thread, else the `No thread` row. The contract's rule. */
export const rowOf = (scene: Pick<TimelineSceneRow, 'threads'>): string => scene.threads[0] ?? NO_ROW

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** `E1 Sc 14`, as every scene reference on the route reads. */
export const sceneRef = (scene: Pick<TimelineSceneRow, 'episodeOrdinal' | 'number'>): string =>
  `E${String(scene.episodeOrdinal)} Sc ${String(scene.number)}`

/**
 * The card's short slug: the set as the pure core reads it - every segment
 * of the heading but the `INT./EXT.` prefix and the time-of-day suffix
 * (`readSlugline`, the one reader the whole app uses). `INT. HOUSE -
 * KITCHEN - DAY` is `HOUSE - KITCHEN`; the first pass cut at the first
 * ` - ` and printed `HOUSE`. A heading the reader refuses prints as written.
 */
export const shortSlug = (heading: string): string => {
  const reading = readSlugline(heading)
  return reading.ok && reading.value.set !== '' ? reading.value.set : heading.trim()
}

/** The token a thread's colour name resolves to. `packages/ui`, `palette.css`. */
export const threadColourVar = (colour: StoryThreadColour): string => `var(--thread-${colour})`

/** The story-order chip for an unplaced scene; a placed one prints `formatStoryTime`. */
export const NO_TIME = 'no time'

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** An episode's measured page count: `104 pp`, or `—` unmeasured. */
export const pagesLabel = (pages: number | null): string => (pages === null ? '—' : `${String(pages)} pp`)

/** A run of scenes' length in eighths as pages: `4 6/8 pp`, or `—` unmeasured. */
export const eighthsLabel = (total: number | null): string => (total === null ? '—' : `${eighths(total)} pp`)

/**
 * The card's chip: in story order it says *when* (`Day 2 · 06:40`, or
 * `no time`); in chronology it says *where on the page* (`E1 · p.36`, or
 * `E1 · Sc 4` on an unmeasured script).
 */
export const chipOf = (scene: TimelineSceneRow, view: GridView): string =>
  view === 'story'
    ? scene.storyTime === null
      ? NO_TIME
      : formatStoryTime(scene.storyTime)
    : `E${String(scene.episodeOrdinal)} · ${scene.page === null ? `Sc ${String(scene.number)}` : `p.${String(scene.page)}`}`

/** The sidebar row's second line: `E1 → E3 · 6 scenes`, `+2 shared` appended when scenes carry it as a later thread. */
export const threadSpanLine = (thread: StoryThreadRow): string => {
  if (thread.span === null) return 'no scenes yet'
  const span = thread.span.from === thread.span.to ? `E${String(thread.span.from)}` : `E${String(thread.span.from)} → E${String(thread.span.to)}`
  const shared = thread.scenes - thread.lanes
  return `${span} · ${plural(thread.lanes, 'scene')}${shared > 0 ? ` · +${String(shared)} shared` : ''}`
}

/** A thread's scene count per episode, in episode order - the sidebar row's `EpisodeBars`. */
export const threadPresence = (thread: Pick<StoryThread, 'id'>, scenes: readonly TimelineSceneRow[], episodes: readonly { readonly episode: EpisodeSlug }[]): readonly number[] =>
  episodes.map((episode) => scenes.filter((scene) => scene.episode === episode.episode && scene.threads.includes(thread.id)).length)

// ---------------------------------------------------------------------------
// The loader's figures - what `lib/timeline/server.ts` hangs on each row
// ---------------------------------------------------------------------------

/** A thread with its counts: scenes it runs through, scenes whose row it is, and the episodes it spans. */
export const threadFigures = (threads: readonly StoryThread[], scenes: readonly TimelineSceneRow[]): readonly StoryThreadRow[] =>
  threads.map((thread) => {
    const mine = scenes.filter((scene) => scene.threads.includes(thread.id))
    const ordinals = mine.map((scene) => scene.episodeOrdinal)
    return {
      ...thread,
      scenes: mine.length,
      lanes: mine.filter((scene) => scene.threads[0] === thread.id).length,
      span: ordinals.length === 0 ? null : { from: Math.min(...ordinals), to: Math.max(...ordinals) },
    }
  })

/** One episode column's counts off the scenes in it. */
export const episodeFigures = (
  episode: { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string; readonly pages: number | null },
  scenes: readonly TimelineSceneRow[],
): TimelineEpisodeColumn => {
  const inEpisode = scenes.filter((scene) => scene.episode === episode.slug)
  const days = storySpan(inEpisode.map((scene) => ({ id: scene.sceneNodeId, storyTime: scene.storyTime, flashback: scene.flashback })))
  return {
    episode: episode.slug,
    ordinal: episode.ordinal,
    title: episode.title,
    pages: episode.pages,
    scenes: inEpisode.length,
    placed: inEpisode.filter((scene) => scene.storyTime !== null).length,
    days: days === null ? null : { from: days.from, to: days.to },
  }
}

// ---------------------------------------------------------------------------
// Patches - the optimistic overlay
// ---------------------------------------------------------------------------

/** What a write changes on a row, applied over the loader's rows until the refresh agrees. */
export type ScenePatch = Partial<Pick<TimelineSceneRow, 'storyTime' | 'flashback' | 'threads'>>

const sameTime = (a: StoryTime | null, b: StoryTime | null): boolean => (a === null || b === null ? a === b : a.day === b.day && a.clock === b.clock)

/** Whether a row already says what the patch says - when it does, the patch has landed and can go. */
export const patchLanded = (scene: TimelineSceneRow, patch: ScenePatch): boolean =>
  (patch.storyTime === undefined || sameTime(scene.storyTime, patch.storyTime)) &&
  (patch.flashback === undefined || scene.flashback === patch.flashback) &&
  (patch.threads === undefined || (scene.threads.length === patch.threads.length && scene.threads.every((id, index) => patch.threads?.[index] === id)))

export const applyPatches = (scenes: readonly TimelineSceneRow[], patches: ReadonlyMap<NodeId, ScenePatch>): readonly TimelineSceneRow[] =>
  patches.size === 0
    ? scenes
    : scenes.map((scene) => {
        const patch = patches.get(scene.sceneNodeId)
        return patch === undefined ? scene : { ...scene, ...patch }
      })

// ---------------------------------------------------------------------------
// The check, run on this side
// ---------------------------------------------------------------------------

const toContinuityScene = (scene: TimelineSceneRow): ContinuityScene => ({
  id: scene.sceneNodeId,
  storyTime: scene.storyTime,
  flashback: scene.flashback,
  episodeOrdinal: scene.episodeOrdinal,
  page: scene.page,
  cast: scene.cast.map((person) => person.id),
  set: scene.set?.id ?? null,
  light: scene.light,
  threads: scene.threads,
})

/** The core's check over the route's rows. */
export const findingsOf = (scenes: readonly TimelineSceneRow[], introductions: Readonly<Record<string, NodeId>>, threads: readonly StoryThreadRow[]): readonly ContinuityFinding[] =>
  continuityFindings({
    scenes: scenes.map(toContinuityScene),
    introductions: new Map(Object.entries(introductions)),
    threads: threads.map((thread) => thread.id),
  })

/**
 * The findings, bucketed for the view: `open` are the disagreements the
 * writer has not answered (what the badge counts); `notes` the
 * informational kinds, unanswered; `deliberate` the ones marked so, of
 * either; `flagged` the flashbacks and flash-forwards, which the flag
 * already answers.
 */
export type FindingBuckets = {
  readonly open: readonly ContinuityFinding[]
  readonly notes: readonly ContinuityFinding[]
  readonly deliberate: readonly ContinuityFinding[]
  readonly flagged: readonly ContinuityFinding[]
}

export const bucketFindings = (findings: readonly ContinuityFinding[], deliberate: ReadonlySet<string>): FindingBuckets => ({
  open: findings.filter((finding) => !FLAGGED_KINDS.has(finding.kind) && !INFORMATIONAL_KINDS.has(finding.kind) && !deliberate.has(finding.key)),
  notes: findings.filter((finding) => INFORMATIONAL_KINDS.has(finding.kind) && !deliberate.has(finding.key)),
  deliberate: findings.filter((finding) => !FLAGGED_KINDS.has(finding.kind) && deliberate.has(finding.key)),
  flagged: findings.filter((finding) => FLAGGED_KINDS.has(finding.kind)),
})

/** The findings about one scene - as its subject, or as the scene it was measured against for `two-places`. */
export const findingsAbout = (buckets: FindingBuckets, sceneId: NodeId): readonly ContinuityFinding[] =>
  [...buckets.open, ...buckets.notes].filter((finding) => finding.sceneId === sceneId)

/** The row the verdict write takes, off the finding. */
export const verdictOf = (finding: ContinuityFinding): FindingVerdict => ({
  kind: finding.kind,
  key: finding.key,
  aRef: finding.sceneId,
  bRef: finding.otherId,
  subject: finding.subject,
})

/** The kind's short label, the card's chip. */
export const KIND_LABEL: Readonly<Record<ContinuityKind, string>> = {
  order: 'Steps back',
  flashback: 'Flashback',
  flashforward: 'Flash-forward',
  'same-day-unclocked': 'Unclocked day',
  'two-places': 'Two places',
  'before-introduction': 'Before introduction',
  'light-vs-clock': 'Light vs clock',
  'thread-silent': 'Thread goes quiet',
  'day-gap': 'Day gap',
}

/** What the finding's note needs that the finding does not carry: the rows by id, and names for the ids. */
export type NoteBook = {
  readonly sceneOf: (id: NodeId) => Pick<TimelineSceneRow, 'episodeOrdinal' | 'number' | 'set' | 'light'> | null
  readonly characterName: (id: string) => string | null
  readonly threadName: (id: string) => string | null
}

const refOf = (book: NoteBook, id: NodeId | null, fallback: string): string => {
  const scene = id === null ? null : book.sceneOf(id)
  return scene === null ? fallback : sceneRef(scene)
}

const timeOf = (time: StoryTime | null): string => (time === null ? 'no time' : formatStoryTime(time))

/**
 * A finding's note, the sentence the card and the drawer print verbatim.
 * One per kind; every name in it is the writer's own.
 */
export const findingNote = (finding: ContinuityFinding, book: NoteBook): string => {
  const other = refOf(book, finding.otherId, 'the scene before it')
  switch (finding.kind) {
    case 'order':
      return `Happens before ${other} (${timeOf(finding.otherTime)}) though it's on the page after it.`
    case 'flashback':
      return `Flashback: earlier than ${other} (${timeOf(finding.otherTime)}), as flagged.`
    case 'flashforward':
      return `Flash-forward: later than ${other} (${timeOf(finding.otherTime)}), as flagged.`
    case 'same-day-unclocked':
      return `Same day as ${other} with no clock on one of them, so their order is unknown. Add a clock to order them.`
    case 'two-places': {
      const who = finding.subject === null ? 'Someone' : (book.characterName(finding.subject) ?? 'Someone')
      const here = book.sceneOf(finding.sceneId)?.set?.name ?? 'this set'
      const there = book.sceneOf(finding.otherId ?? finding.sceneId)?.set?.name ?? 'another set'
      return `${who} is at ${here} and at ${there} at ${timeOf(finding.sceneTime)} (${other}).`
    }
    case 'before-introduction': {
      const who = finding.subject === null ? 'Someone' : (book.characterName(finding.subject) ?? 'Someone')
      return `${who} is present here (${timeOf(finding.sceneTime)}) but is introduced in ${other} (${timeOf(finding.otherTime)}).`
    }
    case 'light-vs-clock': {
      const light = book.sceneOf(finding.sceneId)?.light ?? 'unspecified'
      return `The heading says ${light.toUpperCase()} but the clock says ${finding.sceneTime?.clock ?? '—'}.`
    }
    case 'thread-silent': {
      const thread = finding.subject === null ? 'The thread' : (book.threadName(finding.subject) ?? 'The thread')
      const gap = finding.gap === null ? '' : finding.gap.unit === 'episodes' ? ` for ${plural(finding.gap.size, 'whole episode')}` : ` for ${plural(finding.gap.size, 'page')}`
      return `${thread} goes quiet${gap} between ${other} and here.`
    }
    case 'day-gap':
      return `${plural(finding.gap?.size ?? 0, 'day')} pass between ${other} (${timeOf(finding.otherTime)}) and here (${timeOf(finding.sceneTime)}).`
  }
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/**
 * The queue row's line: what the proposal says and why.
 *
 *   `CONTINUOUS → same day and clock as E1 Sc 4`
 *   `LATER → Day 2, later the same day`
 *   `"the next morning" → Day 3`
 *   `no cue → Day 3, carried from E1 Sc 9`
 */
export const proposalLine = (proposal: PlacementProposal, previous: Pick<TimelineSceneRow, 'episodeOrdinal' | 'number'> | null): string => {
  const from = previous === null ? 'the start' : sceneRef(previous)
  switch (proposal.reason) {
    case 'continuous':
      return `${proposal.quote ?? 'CONTINUOUS'} → ${previous === null ? formatStoryTime(proposal.time) : `same day and clock as ${from}`}`
    case 'later':
      return `${proposal.quote ?? 'LATER'} → ${formatStoryDay(proposal.time.day)}, later the same day`
    case 'cue':
      return `"${proposal.quote ?? ''}" → ${formatStoryDay(proposal.time.day)}`
    case 'carried':
      return `no cue → ${formatStoryDay(proposal.time.day)}, carried from ${from}`
  }
}

/** What `proposePlacements` reads of a row: its time, its flag and the cues the heading and first action gave. */
export const placementInputsOf = (scenes: readonly TimelineSceneRow[]): Parameters<typeof proposePlacements>[0] =>
  scenes.map((scene) => ({
    id: scene.sceneNodeId,
    storyTime: scene.storyTime,
    flashback: scene.flashback,
    cues: scene.cues === null ? null : { ...scene.cues, sceneNodeId: scene.sceneNodeId, light: scene.light },
  }))

/** The lookups a finding's note reads, over one load: the rows by id, the cast's names, the threads'. */
export const noteBookOf = (scenes: readonly TimelineSceneRow[], threads: readonly Pick<StoryThreadRow, 'id' | 'name'>[]): NoteBook => {
  const byId = new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene]))
  const people = new Map<string, string>()
  for (const scene of scenes) for (const person of scene.cast) people.set(person.id, person.name)
  const threadNames = new Map<string, string>(threads.map((thread) => [thread.id, thread.name]))
  return {
    sceneOf: (id) => byId.get(id) ?? null,
    characterName: (id) => people.get(id) ?? null,
    threadName: (id) => threadNames.get(id) ?? null,
  }
}

/**
 * Everything the Timeline route computes over one load, in one call - the
 * story order, the jumps, the continuity check bucketed by the writer's
 * verdicts, the placement proposals and the note book (roadmap task 2.4).
 *
 * Until 2026-09-23 this was a column of `useMemo`s in `timeline-workspace.tsx`
 * and, separately, a module-private copy in `lib/assistant/server.ts`; the
 * workspace now reads its pieces from the same helpers and the server reads
 * this (`readContinuity`, `lib/timeline/server.ts`), so a finding the writer
 * sees and one the agent reports are the same finding. Pure: no model, no
 * node - AGENTS.md ruling R4, every number from code.
 */
export type Continuity = {
  readonly chronology: Chronology
  readonly jumps: ReadonlyMap<NodeId, StoryJump>
  readonly findings: readonly ContinuityFinding[]
  readonly buckets: FindingBuckets
  readonly proposals: readonly PlacementProposal[]
  readonly book: NoteBook
}

export type ContinuityInput = {
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly introductions: Readonly<Record<string, NodeId>>
  readonly deliberate: readonly string[]
}

/** The rows as the core's ordering reads them. */
export const timelineScenesOf = (scenes: readonly TimelineSceneRow[]): Parameters<typeof chronology>[0] =>
  scenes.map((scene) => ({ id: scene.sceneNodeId, storyTime: scene.storyTime, flashback: scene.flashback }))

export const continuityOf = (input: ContinuityInput): Continuity => {
  const pure = timelineScenesOf(input.scenes)
  const findings = findingsOf(input.scenes, input.introductions, input.threads)
  return {
    chronology: chronology(pure),
    jumps: storyJumps(pure),
    findings,
    buckets: bucketFindings(findings, new Set(input.deliberate)),
    proposals: proposePlacements(placementInputsOf(input.scenes)),
    book: noteBookOf(input.scenes, input.threads),
  }
}

/** The proposals as placements, for the one bulk write. */
export const placementsOf = (proposals: readonly PlacementProposal[]): readonly Placement[] =>
  proposals.map((proposal) => ({ sceneNodeId: proposal.sceneNodeId, time: proposal.time }))

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export type GridColumn = {
  readonly key: string
  /** `E1` / `Day 2`. */
  readonly name: string
  /** The episode's title, or `flashback` on a day every scene of which is one. */
  readonly sub: string
  /** Mono: `104 pp · 5 placed · Day 1 → 3` / `3 scenes · 4 6/8 pp`. */
  readonly meta: string
  readonly flashback: boolean
  /** The story day, on the chronology; null on the story order. What a drop onto the column writes. */
  readonly day: number | null
  /** Pages in the column, in eighths, or null unmeasured - the ruler's bar. */
  readonly eighths: number | null
  /** Scene ids in the column, in the column's order: page order, or story-time order. */
  readonly sceneIds: readonly NodeId[]
}

export type GridRow = {
  readonly key: string
  readonly threadId: StoryThreadId | null
  readonly name: string
  readonly span: string
  readonly colour: StoryThreadColour | null
}

/** One card in a cell: the scene, and whether it is the ghost of a scene whose row is elsewhere (a further thread's row). */
export type GridCard = {
  readonly scene: TimelineSceneRow
  readonly ghost: boolean
}

export type Grid = {
  readonly columns: readonly GridColumn[]
  readonly rows: readonly GridRow[]
  /** `rowKey` → `columnKey` → the cards in that cell, in the column's order. */
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, readonly GridCard[]>>
}

const daysRange = (days: { readonly from: number; readonly to: number } | null): string =>
  days === null ? '' : days.from === days.to ? ` · ${formatStoryDay(days.from)}` : ` · ${formatStoryDay(days.from)} → ${String(days.to)}`

const sumEighths = (scenes: readonly TimelineSceneRow[]): number | null => {
  let total: number | null = null
  for (const scene of scenes) {
    if (scene.eighths === null) continue
    total = (total ?? 0) + scene.eighths
  }
  return total
}

/** The rows a scene belongs to on the given lanes, first the one its card sits in, then its ghosts. */
const rowKeysOf = (scene: TimelineSceneRow, lanes: GridLanes): readonly string[] => {
  switch (lanes) {
    case 'thread':
      return scene.threads.length === 0 ? [NO_ROW] : scene.threads
    case 'character':
      return scene.cast.length === 0 ? [NO_ROW] : scene.cast.map((person) => person.id)
    case 'location':
      return [scene.set?.id ?? NO_ROW]
  }
}

const rowsOf = (lanes: GridLanes, shown: readonly TimelineSceneRow[], threads: readonly StoryThreadRow[]): readonly GridRow[] => {
  const noRow = (name: string, span: string): GridRow => ({ key: NO_ROW, threadId: null, name, span, colour: null })
  switch (lanes) {
    case 'thread':
      return [
        ...threads.map((thread) => ({ key: thread.id, threadId: thread.id, name: thread.name, span: threadSpanLine(thread), colour: thread.colour })),
        ...(shown.some((scene) => scene.threads.length === 0) ? [noRow('No thread', 'scenes on no storyline')] : []),
      ]
    case 'character': {
      const people = new Map<string, { name: string; scenes: number }>()
      for (const scene of shown) {
        for (const person of scene.cast) {
          const entry = people.get(person.id) ?? { name: person.name, scenes: 0 }
          entry.scenes += 1
          people.set(person.id, entry)
        }
      }
      return [
        ...[...people.entries()]
          .sort(([, a], [, b]) => b.scenes - a.scenes || a.name.localeCompare(b.name))
          .map(([id, entry]) => ({ key: id, threadId: null, name: entry.name, span: plural(entry.scenes, 'scene'), colour: null })),
        ...(shown.some((scene) => scene.cast.length === 0) ? [noRow('No one', 'scenes with no cast')] : []),
      ]
    }
    case 'location': {
      const sets = new Map<string, { name: string; scenes: number }>()
      for (const scene of shown) {
        if (scene.set === null) continue
        const entry = sets.get(scene.set.id) ?? { name: scene.set.name, scenes: 0 }
        entry.scenes += 1
        sets.set(scene.set.id, entry)
      }
      return [
        ...[...sets.entries()]
          .sort(([, a], [, b]) => b.scenes - a.scenes || a.name.localeCompare(b.name))
          .map(([id, entry]) => ({ key: id, threadId: null, name: entry.name, span: plural(entry.scenes, 'scene'), colour: null })),
        ...(shown.some((scene) => scene.set === null) ? [noRow('No set', 'headings not yet resolved')] : []),
      ]
    }
  }
}

/**
 * The lanes: rows are threads in `position` order (a `No thread` row last
 * while any scene has none) - or, on the other lanes, the cast or the
 * sets by scene count; columns are the episodes as written (story order)
 * or the chronology's days (chronology). On the thread lanes a scene's
 * card sits in its first thread's row and a ghost of it in each further
 * thread's - "where threads run in parallel", drawn; on the character
 * lanes it sits in every cast member's row, whole. Story order lists every
 * scene, unplaced ones too, so they can be picked and placed; chronology
 * lists only the placed, and the unplaced go to the strip. `scope` narrows
 * the columns to one episode, and the rows to what is left.
 */
export const gridOf = (
  view: GridView,
  scenes: readonly TimelineSceneRow[],
  threads: readonly StoryThreadRow[],
  episodes: readonly TimelineEpisodeColumn[],
  chronology: Chronology,
  scope: EpisodeSlug | null = null,
  lanes: GridLanes = 'thread',
): Grid => {
  const byId = new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene]))
  const inScope = (scene: TimelineSceneRow): boolean => scope === null || scene.episode === scope

  const columns: readonly GridColumn[] =
    view === 'story'
      ? episodes
          .filter((episode) => scope === null || episode.episode === scope)
          .map((episode) => {
            const inEpisode = scenes.filter((scene) => scene.episode === episode.episode)
            return {
              key: episode.episode,
              name: `E${String(episode.ordinal)}`,
              sub: episode.title,
              meta: `${pagesLabel(episode.pages)} · ${String(episode.placed)} placed${daysRange(episode.days)}`,
              flashback: false,
              day: null,
              eighths: sumEighths(inEpisode),
              sceneIds: inEpisode.map((scene) => scene.sceneNodeId),
            }
          })
      : chronology.days.flatMap((day) => {
          const inDay = day.sceneIds.flatMap((id) => {
            const scene = byId.get(id)
            return scene !== undefined && inScope(scene) ? [scene] : []
          })
          if (inDay.length === 0) return []
          return [
            {
              key: String(day.day),
              name: formatStoryDay(day.day),
              sub: day.flashbacksOnly ? 'flashback' : '',
              meta: `${plural(inDay.length, 'scene')} · ${eighthsLabel(sumEighths(inDay))}`,
              flashback: day.flashbacksOnly,
              day: day.day,
              eighths: sumEighths(inDay),
              sceneIds: inDay.map((scene) => scene.sceneNodeId),
            },
          ]
        })

  const shown = scenes.filter(inScope)
  const rows = rowsOf(lanes, shown, threads)
  const rowKeys = new Set(rows.map((row) => row.key))

  const cells = new Map<string, Map<string, GridCard[]>>()
  for (const column of columns) {
    for (const id of column.sceneIds) {
      const scene = byId.get(id)
      if (scene === undefined) continue
      rowKeysOf(scene, lanes).forEach((row, index) => {
        if (!rowKeys.has(row)) return
        const byColumn = cells.get(row) ?? new Map<string, GridCard[]>()
        const list = byColumn.get(column.key) ?? []
        list.push({ scene, ghost: lanes === 'thread' && index > 0 })
        byColumn.set(column.key, list)
        cells.set(row, byColumn)
      })
    }
  }
  return { columns, rows, cells }
}

/** The cards in one cell, or none. */
export const cellOf = (grid: Grid, rowKey: string, columnKey: string): readonly GridCard[] => grid.cells.get(rowKey)?.get(columnKey) ?? []

/** The chronology's ruler: each day column's pages as a share of the fullest day, 0..1; 0 where unmeasured. */
export const rulerOf = (columns: readonly GridColumn[]): readonly number[] => {
  const peak = columns.reduce((most, column) => Math.max(most, column.eighths ?? 0), 0)
  return columns.map((column) => (peak === 0 || column.eighths === null ? 0 : column.eighths / peak))
}

/** The day a drop past the last chronology column creates: one after the frame story's last day, or Day 1. */
export const nextDayAfter = (scenes: readonly TimelineSceneRow[]): number => (lastFrameDay(scenes) ?? 0) + 1

// ---------------------------------------------------------------------------
// Neighbours and the relative line
// ---------------------------------------------------------------------------

/** The last placed, non-flashback scene before this one on the page - the core's "the scene before it". */
export const previousFrameScene = (scenes: readonly TimelineSceneRow[], sceneId: NodeId): TimelineSceneRow | null => {
  const at = scenes.findIndex((scene) => scene.sceneNodeId === sceneId)
  for (let index = at - 1; index >= 0; index -= 1) {
    const candidate = scenes[index]
    if (candidate !== undefined && candidate.storyTime !== null && !candidate.flashback) return candidate
  }
  return null
}

/** The last day of the frame story - what a carry counts from. Flashback days sit outside it. */
export const lastFrameDay = (scenes: readonly TimelineSceneRow[]): number | null =>
  storySpan(scenes.map((scene) => ({ id: scene.sceneNodeId, storyTime: scene.storyTime, flashback: scene.flashback })))?.to ?? null

/**
 * The drawer's relative block: where this scene sits against the frame
 * story's last placed scene before it on the page.
 *
 *   `Same day as E1 Sc 9, 22:15 → 06:40`   both clocked, same day
 *   `1 day after E1 Sc 9.`                 a later day
 *   `Earlier than E1 Sc 9 (Day 2).`        the finding's own case
 *   `First scene in story time.`           nothing placed before it
 *   `Flashback. Sits outside the day count.`
 *   `No story time yet.`
 */
export const relativeLine = (scene: TimelineSceneRow, previous: TimelineSceneRow | null): string => {
  if (scene.storyTime === null) return 'No story time yet. Give it a day to place it.'
  if (scene.flashback) return 'Flashback. Sits outside the day count.'
  if (previous === null || previous.storyTime === null) return 'First scene in story time.'
  const mine = scene.storyTime
  const theirs = previous.storyTime
  const ref = sceneRef(previous)
  if (precedesStoryTime(mine, theirs)) return `Earlier than ${ref} (${formatStoryTime(theirs)}).`
  if (mine.day === theirs.day) {
    const clocks = theirs.clock !== null && mine.clock !== null ? `, ${theirs.clock} → ${mine.clock}` : ''
    return `Same day as ${ref}${clocks}`
  }
  const gap = mine.day - theirs.day
  return `${plural(gap, 'day')} after ${ref}.`
}

// ---------------------------------------------------------------------------
// Counts, the status bar, the find field
// ---------------------------------------------------------------------------

export type TimelineCounts = {
  readonly scenes: number
  readonly placed: number
  readonly unplaced: number
  readonly threads: number
  readonly flashbacks: number
  readonly flags: number
}

export const countsOf = (scenes: readonly TimelineSceneRow[], threads: number, flags: number): TimelineCounts => {
  const placed = scenes.filter((scene) => scene.storyTime !== null).length
  return {
    scenes: scenes.length,
    placed,
    unplaced: scenes.length - placed,
    threads,
    flashbacks: scenes.filter((scene) => scene.flashback).length,
    flags,
  }
}

/** The status bar's left: `17 placed · 7 unplaced · 4 threads · 2 flashbacks`, then ` · E1 Sc 4` while a card is selected. */
export const statusLeft = (counts: TimelineCounts, selected: TimelineSceneRow | null): string =>
  [
    `${String(counts.placed)} placed`,
    `${String(counts.unplaced)} unplaced`,
    plural(counts.threads, 'thread'),
    plural(counts.flashbacks, 'flashback'),
    ...(selected === null ? [] : [sceneRef(selected)]),
  ].join(' · ')

/** The status bar's left while nothing is placed and no thread exists: `Monsoon Line · nothing placed`. */
export const emptyLeft = (projectTitle: string): string => `${projectTitle} · nothing placed`

/** The toolbar's count chip: `17 placed`, or `4 flags` on the Continuity view. */
export const countChip = (view: GridView | 'continuity', counts: TimelineCounts): string =>
  view === 'continuity' ? plural(counts.flags, 'flag') : `${String(counts.placed)} placed`

/** The sidebar widget's note: `7 scenes have no time yet`, or `Every scene has a time`. */
export const placedNote = (counts: TimelineCounts): string =>
  counts.unplaced === 0 ? 'Every scene has a time' : `${plural(counts.unplaced, 'scene has', 'scenes have')} no time yet`

export const placedPercent = (counts: TimelineCounts): number =>
  counts.scenes === 0 ? 0 : Math.round((counts.placed / counts.scenes) * 100)

/** The find field's match: ref, heading, or a cast member's name. */
export const matchesFind = (scene: TimelineSceneRow, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    sceneRef(scene).toLowerCase().includes(needle) ||
    scene.heading.toLowerCase().includes(needle) ||
    (scene.set?.name.toLowerCase().includes(needle) ?? false) ||
    scene.cast.some((person) => person.name.toLowerCase().includes(needle))
  )
}
