import type { StoryThread, StoryThreadRow, TimelineEpisodeColumn, TimelineSceneRow } from '@folio/contracts'
import { episodeSlug, projectId, storyThreadId } from '@folio/contracts'
import { chronology, nodeId } from '@folio/script'
import type { NodeId, PlacementProposal } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { chronologyFilename, chronologyMarkdown } from '../lib/timeline/markdown'
import type { NoteBook } from '../lib/timeline/view'
import {
  applyPatches,
  bucketFindings,
  cellOf,
  chipOf,
  countChip,
  countsOf,
  eighthsLabel,
  emptyLeft,
  episodeFigures,
  findingNote,
  findingsAbout,
  findingsOf,
  gridOf,
  lastFrameDay,
  matchesFind,
  nextDayAfter,
  pagesLabel,
  patchLanded,
  placedNote,
  placedPercent,
  previousFrameScene,
  proposalLine,
  relativeLine,
  rowOf,
  rulerOf,
  sceneRef,
  shortSlug,
  statusLeft,
  threadFigures,
  threadPresence,
  threadSpanLine,
  verdictOf,
} from '../lib/timeline/view'

/**
 * The lines the rebuilt Timeline prints and the grid it lays out, each a
 * pure function over the loader's rows. The first pass computed these
 * inside the components and tested none of them.
 */

const E1 = episodeSlug('ep_001')
const E2 = episodeSlug('ep_002')
const WATER = storyThreadId('11111111-1111-4111-8111-111111111111')
const LOVE = storyThreadId('22222222-2222-4222-8222-222222222222')
const MEERA = 'c-meera'
const RAJU = 'c-raju'

const id = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const scene = (n: number, over: Partial<TimelineSceneRow> = {}): TimelineSceneRow => ({
  sceneNodeId: id(n),
  episode: E1,
  episodeOrdinal: 1,
  number: n,
  heading: `INT. WATER TANKER - DAY`,
  synopsis: null,
  page: n * 3,
  eighths: 8,
  cast: [],
  set: null,
  storyTime: null,
  flashback: false,
  threads: [],
  light: 'unspecified',
  cues: null,
  ...over,
})

const thread = (threadId: StoryThread['id'], name: string, position: number): StoryThread => ({
  id: threadId,
  projectId: projectId('33333333-3333-4333-8333-333333333333'),
  name,
  colour: 'slate',
  position,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
})

const SCENES: readonly TimelineSceneRow[] = [
  scene(1, { storyTime: { day: 1, clock: '06:40' }, threads: [WATER], cast: [{ id: MEERA as never, name: 'Meera' }], set: { id: 'kitchen' as never, name: 'Kitchen' } }),
  scene(2, { storyTime: { day: 1, clock: '22:15' }, threads: [WATER, LOVE], cast: [{ id: MEERA as never, name: 'Meera' }, { id: RAJU as never, name: 'Raju' }] }),
  scene(3, { storyTime: { day: 2, clock: null }, threads: [LOVE] }),
  scene(4, { storyTime: null, threads: [] }),
  scene(5, { episode: E2, episodeOrdinal: 2, storyTime: { day: -300, clock: null }, flashback: true, threads: [LOVE] }),
  scene(6, { episode: E2, episodeOrdinal: 2, storyTime: { day: 1, clock: '05:50' }, threads: [WATER] }),
]

const THREADS: readonly StoryThreadRow[] = threadFigures([thread(WATER, 'Water', 0), thread(LOVE, 'Love', 1)], SCENES)

const EPISODES: readonly TimelineEpisodeColumn[] = [
  episodeFigures({ slug: E1, ordinal: 1, title: 'Standpipe', pages: 104 }, SCENES),
  episodeFigures({ slug: E2, ordinal: 2, title: 'The Tiffin', pages: null }, SCENES),
]

const pure = SCENES.map((entry) => ({ id: entry.sceneNodeId, storyTime: entry.storyTime, flashback: entry.flashback }))
const CHRONO = chronology(pure)
const FINDINGS = findingsOf(SCENES, {}, THREADS)
const BUCKETS = bucketFindings(FINDINGS, new Set())

const BOOK: NoteBook = {
  sceneOf: (sceneId) => SCENES.find((entry) => entry.sceneNodeId === sceneId) ?? null,
  characterName: (person) => (person === MEERA ? 'Meera' : person === RAJU ? 'Raju' : null),
  threadName: (threadId) => THREADS.find((entry) => entry.id === threadId)?.name ?? null,
}

describe('the figures', () => {
  it('prints a scene ref as E1 Sc 14', () => {
    expect(sceneRef({ episodeOrdinal: 1, number: 14 })).toBe('E1 Sc 14')
  })

  it('shortens a heading to its set - every segment but the prefix and the time of day', () => {
    expect(shortSlug('INT. WATER TANKER - DAY')).toBe('WATER TANKER')
    // The first pass cut at the first ` - ` and printed `HOUSE`.
    expect(shortSlug('INT. HOUSE - KITCHEN - NIGHT')).toBe('HOUSE - KITCHEN')
    expect(shortSlug('EXT. CHAWL ROOF')).toBe('CHAWL ROOF')
    expect(shortSlug('not a heading')).toBe('not a heading')
  })

  it('prints an episode’s pages, a day’s eighths as pages, or a dash', () => {
    expect(pagesLabel(104)).toBe('104 pp')
    expect(pagesLabel(null)).toBe('—')
    expect(eighthsLabel(38)).toBe('4 6/8 pp')
    expect(eighthsLabel(null)).toBe('—')
  })

  it('the chip says when in story order and where on the page in chronology', () => {
    const placed = SCENES[0]
    const unplaced = SCENES[3]
    if (placed === undefined || unplaced === undefined) throw new Error('fixture')
    expect(chipOf(placed, 'story')).toBe('Day 1 · 06:40')
    expect(chipOf(unplaced, 'story')).toBe('no time')
    expect(chipOf(placed, 'chrono')).toBe('E1 · p.3')
    expect(chipOf({ ...placed, page: null }, 'chrono')).toBe('E1 · Sc 1')
  })
})

describe('the thread and episode figures', () => {
  it('counts a thread’s scenes, its own row, and the episodes it spans', () => {
    const water = THREADS[0]
    const love = THREADS[1]
    if (water === undefined || love === undefined) throw new Error('fixture')
    expect(water).toMatchObject({ scenes: 3, lanes: 3, span: { from: 1, to: 2 } })
    // Sc 2 carries Love second, so it is shared, not Love’s row.
    expect(love).toMatchObject({ scenes: 3, lanes: 2, span: { from: 1, to: 2 } })
    expect(threadSpanLine(water)).toBe('E1 → E2 · 3 scenes')
    expect(threadSpanLine(love)).toBe('E1 → E2 · 2 scenes · +1 shared')
    expect(threadSpanLine({ ...water, scenes: 0, lanes: 0, span: null })).toBe('no scenes yet')
    expect(threadSpanLine({ ...water, scenes: 1, lanes: 1, span: { from: 2, to: 2 } })).toBe('E2 · 1 scene')
  })

  it('counts a thread’s presence per episode, for the sidebar’s bars', () => {
    expect(threadPresence({ id: WATER }, SCENES, EPISODES)).toEqual([2, 1])
    expect(threadPresence({ id: LOVE }, SCENES, EPISODES)).toEqual([2, 1])
  })

  it('counts an episode’s placed scenes and the frame story’s days in it', () => {
    expect(EPISODES[0]).toMatchObject({ scenes: 4, placed: 3, days: { from: 1, to: 2 }, pages: 104 })
    // E2’s only frame-story scene is Day 1; the flashback sits outside the count.
    expect(EPISODES[1]).toMatchObject({ scenes: 2, placed: 2, days: { from: 1, to: 1 }, pages: null })
  })
})

describe('the grid', () => {
  const numbers = (cards: ReturnType<typeof cellOf>) => cards.map((card) => (card.ghost ? -card.scene.number : card.scene.number))

  it('a scene sits in its first thread’s row, else the No thread row', () => {
    expect(rowOf({ threads: [WATER, LOVE] })).toBe(WATER)
    expect(rowOf({ threads: [] })).toBe('none')
  })

  it('story order: columns are the episodes, every scene listed, a ghost in each further thread’s row, the No thread row last', () => {
    const grid = gridOf('story', SCENES, THREADS, EPISODES, CHRONO)
    expect(grid.columns.map((column) => column.name)).toEqual(['E1', 'E2'])
    expect(grid.columns[0]?.meta).toBe('104 pp · 3 placed · Day 1 → 2')
    expect(grid.columns[1]?.meta).toBe('— · 2 placed · Day 1')
    expect(grid.rows.map((row) => row.name)).toEqual(['Water', 'Love', 'No thread'])
    expect(numbers(cellOf(grid, WATER, E1))).toEqual([1, 2])
    // Sc 2 is on Love second: a ghost (negative here) in Love’s row beside Sc 3’s card.
    expect(numbers(cellOf(grid, LOVE, E1))).toEqual([-2, 3])
    expect(numbers(cellOf(grid, 'none', E1))).toEqual([4])
    expect(numbers(cellOf(grid, LOVE, E2))).toEqual([5])
  })

  it('chronology: columns are the days with their pages, flashback-only days say so, unplaced scenes are in no cell', () => {
    const grid = gridOf('chrono', SCENES, THREADS, EPISODES, CHRONO)
    expect(grid.columns.map((column) => column.name)).toEqual(['Day -300', 'Day 1', 'Day 2'])
    expect(grid.columns[0]).toMatchObject({ sub: 'flashback', flashback: true, meta: '1 scene · 1 pp', day: -300, eighths: 8 })
    expect(grid.columns[1]).toMatchObject({ flashback: false, meta: '3 scenes · 3 pp', day: 1, eighths: 24 })
    // Day 1 in story-time order: 05:50 (E2 Sc 6), 06:40, 22:15.
    expect(grid.columns[1]?.sceneIds).toEqual([id(6), id(1), id(2)])
    const inCells = [...grid.cells.values()].flatMap((byColumn) => [...byColumn.values()].flat()).map((card) => card.scene.number)
    expect(inCells).not.toContain(4)
    expect(rulerOf(grid.columns)).toEqual([8 / 24, 1, 8 / 24])
  })

  it('a scope narrows the columns to one episode and drops the No thread row when nothing in it is threadless', () => {
    const story = gridOf('story', SCENES, THREADS, EPISODES, CHRONO, E2)
    expect(story.columns.map((column) => column.name)).toEqual(['E2'])
    expect(story.rows.map((row) => row.name)).toEqual(['Water', 'Love'])
    const chrono = gridOf('chrono', SCENES, THREADS, EPISODES, CHRONO, E2)
    expect(chrono.columns.map((column) => column.name)).toEqual(['Day -300', 'Day 1'])
    expect(chrono.columns[1]?.sceneIds).toEqual([id(6)])
  })

  it('lanes by character put a scene in every cast member’s row, whole; lanes by location in its set’s', () => {
    const people = gridOf('story', SCENES, THREADS, EPISODES, CHRONO, null, 'character')
    expect(people.rows.map((row) => row.name)).toEqual(['Meera', 'Raju', 'No one'])
    expect(numbers(cellOf(people, MEERA, E1))).toEqual([1, 2])
    expect(numbers(cellOf(people, RAJU, E1))).toEqual([2])
    const sets = gridOf('story', SCENES, THREADS, EPISODES, CHRONO, null, 'location')
    expect(sets.rows.map((row) => row.name)).toEqual(['Kitchen', 'No set'])
    expect(numbers(cellOf(sets, 'kitchen', E1))).toEqual([1])
  })

  it('the day a drop past the last column creates is one after the frame story', () => {
    expect(nextDayAfter(SCENES)).toBe(3)
    expect(nextDayAfter([])).toBe(1)
  })
})

describe('patches', () => {
  it('overlay a row until the refreshed row agrees', () => {
    const first = SCENES[0]
    if (first === undefined) throw new Error('fixture')
    const patch = { storyTime: { day: 9, clock: null }, threads: [LOVE] }
    const patched = applyPatches(SCENES, new Map([[first.sceneNodeId, patch]]))
    expect(patched[0]).toMatchObject({ storyTime: { day: 9, clock: null }, threads: [LOVE], flashback: false })
    expect(patchLanded(first, patch)).toBe(false)
    expect(patchLanded({ ...first, storyTime: { day: 9, clock: null }, threads: [LOVE] }, patch)).toBe(true)
    expect(applyPatches(SCENES, new Map())).toBe(SCENES)
  })
})

describe('neighbours and findings', () => {
  it('the scene before it is the last placed, non-flashback scene on the page', () => {
    // Sc 6 follows the flashback Sc 5 and the unplaced Sc 4: its neighbour is Sc 3.
    expect(previousFrameScene(SCENES, id(6))?.number).toBe(3)
    expect(previousFrameScene(SCENES, id(1))).toBeNull()
  })

  it('the last frame day ignores flashbacks', () => {
    expect(lastFrameDay(SCENES)).toBe(2)
    expect(lastFrameDay([scene(1, { storyTime: { day: 900, clock: null }, flashback: true })])).toBeNull()
  })

  it('buckets the findings: open, notes, deliberate, flagged', () => {
    expect(BUCKETS.open.map((finding) => [finding.kind, finding.sceneId])).toEqual([['order', id(6)]])
    expect(BUCKETS.flagged.map((finding) => [finding.kind, finding.sceneId])).toEqual([['flashback', id(5)]])
    expect(BUCKETS.notes).toEqual([])
    const marked = bucketFindings(FINDINGS, new Set(['order:' + id(6)]))
    expect(marked.open).toEqual([])
    expect(marked.deliberate.map((finding) => finding.key)).toEqual(['order:' + id(6)])
    expect(findingsAbout(BUCKETS, id(6)).length).toBe(1)
    expect(findingsAbout(BUCKETS, id(1)).length).toBe(0)
  })

  it('words each kind over the names only this side knows', () => {
    const order = BUCKETS.open[0]
    if (order === undefined) throw new Error('fixture')
    expect(findingNote(order, BOOK)).toBe("Happens before E1 Sc 3 (Day 2) though it's on the page after it.")
    expect(findingNote({ ...order, otherId: null, otherTime: null }, BOOK)).toBe("Happens before the scene before it (no time) though it's on the page after it.")
    expect(findingNote({ ...order, kind: 'two-places', subject: MEERA, otherId: id(2), sceneId: id(1), sceneTime: { day: 1, clock: '06:40' } }, BOOK)).toBe(
      'Meera is at Kitchen and at another set at Day 1 · 06:40 (E1 Sc 2).',
    )
    expect(findingNote({ ...order, kind: 'before-introduction', subject: RAJU, otherId: id(2), otherTime: { day: 1, clock: '22:15' }, sceneTime: { day: 1, clock: '06:40' } }, BOOK)).toBe(
      'Raju is present here (Day 1 · 06:40) but is introduced in E1 Sc 2 (Day 1 · 22:15).',
    )
    expect(findingNote({ ...order, kind: 'light-vs-clock', sceneId: id(1), sceneTime: { day: 1, clock: '02:00' } }, BOOK)).toBe('The heading says UNSPECIFIED but the clock says 02:00.')
    expect(findingNote({ ...order, kind: 'light-vs-clock', sceneId: id(1), sceneTime: { day: 1, clock: '02:00' } }, { ...BOOK, sceneOf: () => ({ episodeOrdinal: 1, number: 1, set: null, light: 'day' }) })).toBe(
      'The heading says DAY but the clock says 02:00.',
    )
    expect(findingNote({ ...order, kind: 'thread-silent', subject: LOVE, otherId: id(2), gap: { unit: 'episodes', size: 1 } }, BOOK)).toBe('Love goes quiet for 1 whole episode between E1 Sc 2 and here.')
    expect(findingNote({ ...order, kind: 'day-gap', otherId: id(2), otherTime: { day: 1, clock: null }, sceneTime: { day: 12, clock: null }, gap: { unit: 'days', size: 11 } }, BOOK)).toBe(
      '11 days pass between E1 Sc 2 (Day 1) and here (Day 12).',
    )
    expect(findingNote({ ...order, kind: 'same-day-unclocked', otherId: id(2) }, BOOK)).toBe('Same day as E1 Sc 2 with no clock on one of them, so their order is unknown. Add a clock to order them.')
    expect(verdictOf(order)).toEqual({ kind: 'order', key: 'order:' + id(6), aRef: id(6), bRef: id(3), subject: null })
  })

  it('the relative line', () => {
    const [sc1, sc2, sc3, sc4, sc5] = SCENES
    if (sc1 === undefined || sc2 === undefined || sc3 === undefined || sc4 === undefined || sc5 === undefined) throw new Error('fixture')
    expect(relativeLine(sc4, sc3)).toBe('No story time yet. Give it a day to place it.')
    expect(relativeLine(sc5, sc3)).toBe('Flashback. Sits outside the day count.')
    expect(relativeLine(sc1, null)).toBe('First scene in story time.')
    expect(relativeLine(sc2, sc1)).toBe('Same day as E1 Sc 1, 06:40 → 22:15')
    expect(relativeLine(sc3, sc2)).toBe('1 day after E1 Sc 2.')
    expect(relativeLine(sc1, sc3)).toBe('Earlier than E1 Sc 3 (Day 2).')
  })
})

describe('proposals', () => {
  const proposal = (reason: PlacementProposal['reason'], quote: string | null): PlacementProposal => ({ sceneNodeId: id(4), time: { day: 3, clock: null }, reason, quote, cueNodeId: null })
  const previous = SCENES[2] ?? null

  it('the queue row’s line says what and why', () => {
    expect(proposalLine(proposal('continuous', 'CONTINUOUS'), previous)).toBe('CONTINUOUS → same day and clock as E1 Sc 3')
    expect(proposalLine({ ...proposal('continuous', 'CONTINUOUS'), time: { day: 1, clock: null } }, null)).toBe('CONTINUOUS → Day 1')
    expect(proposalLine(proposal('later', 'LATER'), previous)).toBe('LATER → Day 3, later the same day')
    expect(proposalLine(proposal('cue', 'The next morning'), previous)).toBe('"The next morning" → Day 3')
    expect(proposalLine(proposal('carried', null), previous)).toBe('no cue → Day 3, carried from E1 Sc 3')
    expect(proposalLine(proposal('carried', null), null)).toBe('no cue → Day 3, carried from the start')
  })
})

describe('counts and the status bar', () => {
  const counts = countsOf(SCENES, THREADS.length, BUCKETS.open.length)

  it('counts', () => {
    expect(counts).toEqual({ scenes: 6, placed: 5, unplaced: 1, threads: 2, flashbacks: 1, flags: 1 })
  })

  it('the status bar’s left, with the selection', () => {
    expect(statusLeft(counts, null)).toBe('5 placed · 1 unplaced · 2 threads · 1 flashback')
    expect(statusLeft(counts, SCENES[0] ?? null)).toBe('5 placed · 1 unplaced · 2 threads · 1 flashback · E1 Sc 1')
    expect(emptyLeft('Monsoon Line')).toBe('Monsoon Line · nothing placed')
  })

  it('the chip, the widget', () => {
    expect(countChip('story', counts)).toBe('5 placed')
    expect(countChip('continuity', counts)).toBe('1 flag')
    expect(placedNote(counts)).toBe('1 scene has no time yet')
    expect(placedNote({ ...counts, unplaced: 0 })).toBe('Every scene has a time')
    expect(placedPercent(counts)).toBe(83)
    expect(placedPercent({ ...counts, scenes: 0, placed: 0 })).toBe(0)
  })

  it('the find field matches a ref, a heading, a set or a name', () => {
    const row = scene(7, { heading: 'EXT. STANDPIPE - DAWN', set: { id: 'loc' as never, name: 'Kamathi Chawl' }, cast: [{ id: 'c' as never, name: 'Meera Pawar' }] })
    expect(matchesFind(row, '')).toBe(true)
    expect(matchesFind(row, 'sc 7')).toBe(true)
    expect(matchesFind(row, 'standpipe')).toBe(true)
    expect(matchesFind(row, 'kamathi')).toBe(true)
    expect(matchesFind(row, 'meera')).toBe(true)
    expect(matchesFind(row, 'farida')).toBe(false)
  })
})

describe('the Markdown export', () => {
  it('lists the scenes by story day with refs, clocks and threads, the unplaced at the foot', () => {
    const markdown = chronologyMarkdown('Monsoon Line', SCENES, THREADS, CHRONO)
    expect(markdown).toContain('# Monsoon Line — story chronology')
    expect(markdown).toContain('5 scenes placed across 3 story days.')
    expect(markdown).toContain('## Day -300 · flashback\n\n- **E2 Sc 5** WATER TANKER — Love _(flashback)_')
    expect(markdown).toContain('## Day 1\n\n- **E2 Sc 6** WATER TANKER · 05:50 — Water\n- **E1 Sc 1** WATER TANKER · 06:40 — Water\n- **E1 Sc 2** WATER TANKER · 22:15 — Water, Love')
    expect(markdown).toContain('## Not placed in time (1)\n\n- **E1 Sc 4** WATER TANKER')
    expect(chronologyFilename('Monsoon Line')).toBe('monsoon-line-chronology.md')
    expect(chronologyFilename('')).toBe('story-chronology.md')
  })
})
