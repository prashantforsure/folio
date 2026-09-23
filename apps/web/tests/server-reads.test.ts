// @vitest-environment node
import type { Episode, Project, ProjectCard, StoryThreadRow, TimelineSceneRow } from '@folio/contracts'
import { MeasurementSchema, episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { NodeId, OutlineNode, ScreenplayNode } from '@folio/script'
import { chronology, documentId, labelBook, nodeId, paginate, parseFountain, proposePlacements, typed } from '@folio/script'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Roadmap task 2.4: the reads that lived only in a component, on the server.
 *
 * Each server function is run against a fixture and compared with what the
 * client computes from the same fixture - written out here the way the
 * workspace wrote it before this task moved it, so a drift between the two
 * sides fails a test rather than a writer. The repositories underneath are
 * mocked; nothing needs a database (CLAUDE.md).
 */

const spies = vi.hoisted(() => ({
  listTimelineScenes: vi.fn(),
  listStoryThreads: vi.fn(),
  readMentionLabels: vi.fn(),
  readEpisodeBoard: vi.fn(),
  readProjectScreenplayNodes: vi.fn(),
  listCharacterRecords: vi.fn(),
  listFindingVerdicts: vi.fn(),
  readDocumentByKind: vi.fn(),
  readScreenplayNodes: vi.fn(),
  readMeasurement: vi.fn(),
  listSceneMeasurements: vi.fn(),
  readLatestLockedPages: vi.fn(),
  readOutlineNodes: vi.fn(),
  listProjectsFor: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  ...Object.fromEntries(Object.keys(spies).map((name) => [name, (...args: readonly unknown[]) => spies[name as keyof typeof spies](...args)])),
}))

const { readContinuity, readTimelineFacts, chronologyExport } = await import('../lib/timeline/server')
const { chronologyMarkdown } = await import('../lib/timeline/markdown')
const { bucketFindings, findingNote, findingsOf, noteBookOf } = await import('../lib/timeline/view')
const { readPageCount, ASIAN_REFUSAL } = await import('../lib/script/page-count')
const { nodeDigest } = await import('../lib/script/server')
const { outlineExport } = await import('../lib/outline/server')
const { outlineMarkdown } = await import('../lib/outline/markdown')
const { readProjectList } = await import('../lib/projects/server')
const { filterCounts, matchesFilter, sortCards } = await import('../lib/projects/view')
const characterFacts = await import('../lib/characters/facts')
const locationFacts = await import('../lib/locations/facts')
const propFacts = await import('../lib/props/facts')

const SCOPE = {} as ProjectScope<'transaction'>
const id = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const PROJECT = {
  id: projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'),
  title: 'Harbour Lights',
  format: 'hollywood',
  pageMode: 'paged',
  liveRepaginate: false,
} as Project

const EPISODE = {
  id: episodeId('7a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c11'),
  slug: episodeSlug('ep_001'),
  ordinal: 1,
  title: 'Pilot',
  revisionColour: 'white',
} as Episode

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// (a) The continuity check, chronology and placement proposals
// ---------------------------------------------------------------------------

describe('readContinuity', () => {
  const record = (n: number, day: number | null, flashback = false) => ({
    sceneNodeId: id(n),
    episode: episodeSlug('ep_001'),
    episodeOrdinal: 1,
    number: n,
    heading: n === 2 ? 'EXT. PIER - NIGHT' : 'INT. HARBOUR OFFICE - DAY',
    synopsis: null,
    page: n,
    eighths: 8,
    cast: [],
    locationId: null,
    storyDay: day,
    storyClock: n === 2 ? '10:00' : null,
    flashback,
    threads: [],
  })

  beforeEach(() => {
    spies.listTimelineScenes.mockResolvedValue([record(1, 2), record(2, 1), record(3, null), record(4, -30, true)])
    spies.listStoryThreads.mockResolvedValue([])
    spies.readMentionLabels.mockResolvedValue([])
    spies.readEpisodeBoard.mockResolvedValue([])
    spies.readProjectScreenplayNodes.mockResolvedValue({ ok: true, value: [] })
    spies.listCharacterRecords.mockResolvedValue([])
    spies.listFindingVerdicts.mockResolvedValue([])
  })

  const context = { scope: SCOPE, project: PROJECT, episodes: [EPISODE] }

  it('finds what the workspace finds, orders what it orders, and proposes what it proposes', async () => {
    const read = await readContinuity(context)
    const scenes: readonly TimelineSceneRow[] = read.scenes
    const threads: readonly StoryThreadRow[] = read.threads
    // The client, as `timeline-workspace.tsx` wrote it before task 2.4.
    const pure = scenes.map((scene) => ({ id: scene.sceneNodeId, storyTime: scene.storyTime, flashback: scene.flashback }))
    const buckets = bucketFindings(findingsOf(scenes, read.introductions, threads), new Set(read.deliberate))
    const proposals = proposePlacements(
      scenes.map((scene) => ({
        id: scene.sceneNodeId,
        storyTime: scene.storyTime,
        flashback: scene.flashback,
        cues: scene.cues === null ? null : { ...scene.cues, sceneNodeId: scene.sceneNodeId, light: scene.light },
      })),
    )
    expect(read.continuity.chronology).toEqual(chronology(pure))
    expect(read.continuity.buckets).toEqual(buckets)
    expect(read.continuity.proposals).toEqual(proposals)
    // Scene 1 is day 2 and scene 2 is day 1: the check has something to say.
    expect(read.continuity.buckets.open.length).toBeGreaterThan(0)
    const book = noteBookOf(scenes, threads)
    expect(read.continuity.buckets.open.map((finding) => findingNote(finding, read.continuity.book))).toEqual(
      buckets.open.map((finding) => findingNote(finding, book)),
    )
  })

  it('answers the panel`s unplaced chip as the workspace did', async () => {
    const read = await readContinuity(context)
    const client = read.scenes
      .filter((scene) => scene.storyTime === null)
      .map((scene) => ({ sceneNodeId: scene.sceneNodeId, episode: scene.episode, episodeOrdinal: scene.episodeOrdinal, number: scene.number, heading: scene.heading }))
    expect(readTimelineFacts(read).unplaced).toEqual(client)
    expect(readTimelineFacts(read).unplaced.map((ref) => ref.number)).toEqual([3])
  })

  it('exports the chronology the toolbar exports', async () => {
    const read = await readContinuity(context)
    const pure = read.scenes.map((scene) => ({ id: scene.sceneNodeId, storyTime: scene.storyTime, flashback: scene.flashback }))
    const exported = chronologyExport(read, PROJECT.title)
    expect(exported.text).toBe(chronologyMarkdown(PROJECT.title, read.scenes, read.threads, chronology(pure)))
    expect(exported.filename).toBe('harbour-lights-chronology.md')
  })
})

// ---------------------------------------------------------------------------
// (b) Page counts
// ---------------------------------------------------------------------------

describe('readPageCount', () => {
  const freshIds = Array.from({ length: 40 }, (_, index) => id(index + 100))
  const parsed = parseFountain(
    ['INT. HARBOUR OFFICE - NIGHT', '', 'MEERA counts the ledgers.', '', 'MEERA', 'Forty-one.', '', 'EXT. PIER - DAY', '', 'Gulls.'].join('\n'),
    { freshIds },
  )
  if (!parsed.ok) throw new Error('fixture did not parse')
  const NODES: readonly ScreenplayNode[] = parsed.value.nodes
  const DOCUMENT = { id: documentId('8a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c12') }
  const client = paginate(NODES, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false, lockedPages: [], mentionLabels: [], revision: 'white' })
  if (!client.ok) throw new Error('fixture did not paginate')

  beforeEach(() => {
    spies.readDocumentByKind.mockResolvedValue(DOCUMENT)
    spies.readScreenplayNodes.mockResolvedValue({ ok: true, value: NODES.map((node) => ({ node })) })
    spies.readMentionLabels.mockResolvedValue([])
    spies.readLatestLockedPages.mockResolvedValue([])
    spies.listSceneMeasurements.mockResolvedValue([])
  })

  it('measures on the server, with the engine the editor runs, when nothing current is stored', async () => {
    spies.readMeasurement.mockResolvedValue(null)
    const result = await readPageCount(SCOPE, PROJECT, EPISODE)
    if (result.status !== 'ok') throw new Error(`expected a count, got ${result.status}`)
    expect(result.count.source).toBe('computed')
    expect(result.count.pages).toBe(client.value.totals.pages)
    expect(result.count.eighths).toBe(client.value.totals.eighths)
    expect(result.count.perScene.map((scene) => scene.eighths)).toEqual(client.value.scenes.map((scene) => scene.eighths))
  })

  it('reads the stored measurement when its digest matches the stored nodes', async () => {
    const stored = MeasurementSchema.parse({
      id: 'aa1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c14',
      projectId: PROJECT.id,
      episodeId: EPISODE.id,
      documentId: DOCUMENT.id,
      format: 'hollywood',
      pageMode: 'paged',
      liveRepaginate: false,
      sheet: {},
      totalPages: 7,
      totalLines: 300,
      totalScenes: 2,
      totalEighths: 50,
      nodeDigest: nodeDigest(NODES),
      computedAt: '2026-09-23T10:00:00.000Z',
    })
    spies.readMeasurement.mockResolvedValue(stored)
    const result = await readPageCount(SCOPE, PROJECT, EPISODE)
    expect(result).toMatchObject({ status: 'ok', count: { source: 'stored', pages: 7 } })
  })

  it('does not trust a stored measurement of a different node list', async () => {
    spies.readMeasurement.mockResolvedValue({ id: 'm1', totalPages: 99, nodeDigest: 'stale'.padEnd(64, '0') })
    const result = await readPageCount(SCOPE, PROJECT, EPISODE)
    expect(result).toMatchObject({ status: 'ok', count: { source: 'computed', pages: client.value.totals.pages } })
  })

  it('refuses the asian format in words, before reading anything', async () => {
    expect(await readPageCount(SCOPE, { ...PROJECT, format: 'asian' }, EPISODE)).toEqual({ status: 'refused', message: ASIAN_REFUSAL })
    expect(spies.readDocumentByKind).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (c) The four facts cells' predicates
// ---------------------------------------------------------------------------

describe('the facts predicates', () => {
  it('Characters: the no-description and no-relationship lists', () => {
    const figures = [
      { id: 'a' as never, name: 'MEERA', bio: 'Harbourmaster.' },
      { id: 'b' as never, name: 'RAJU', bio: null },
      { id: 'c' as never, name: 'ANIL', bio: null },
    ]
    const relationships = [{ aId: 'a' as never, bId: 'c' as never }]
    // The client, as `characters-workspace.tsx` wrote it.
    const related = new Set(relationships.flatMap((row) => [row.aId, row.bId]))
    expect(characterFacts.noDescriptionOf(figures)).toEqual(figures.filter((figure) => figure.bio === null).map((figure) => ({ id: figure.id, name: figure.name })))
    expect(characterFacts.unrelatedOf(figures, relationships)).toEqual(figures.filter((figure) => !related.has(figure.id)).map((figure) => ({ id: figure.id, name: figure.name })))
    expect(characterFacts.unrelatedOf(figures, relationships).map((person) => person.name)).toEqual(['RAJU'])
  })

  it('Locations: the one-off sets and the night exteriors, most first', () => {
    const quadrant = (extNight: number) => ({ intDay: 0, intNight: 0, extDay: 0, extNight, other: 0 })
    const row = (n: number, kind: 'one-off' | 'primary', parentId: string | null, extNight: number, scenes: number) => ({
      id: `loc-${String(n)}` as never,
      name: `SET ${String(n)}`,
      kind,
      parentId: parentId as never,
      firstSeen: null,
      rollup: { scenes } as never,
      rollupQuadrant: quadrant(extNight) as never,
    })
    const rows = [row(1, 'one-off', null, 0, 1), row(2, 'primary', null, 1, 4), row(3, 'primary', null, 3, 6), row(4, 'primary', 'loc-3', 2, 2)]
    expect(locationFacts.oneOffsOf(rows).map((place) => place.name)).toEqual(['SET 1'])
    expect(locationFacts.nightExteriorsOf(rows).map((place) => [place.name, place.nights])).toEqual([
      ['SET 3', 3],
      ['SET 2', 1],
    ])
  })

  it('Props: the unsourced and the unwritten', () => {
    const row = (n: number, status: 'needed' | 'sourced', lines: number) => ({
      id: `prop-${String(n)}` as never,
      name: `PROP ${String(n)}`,
      status,
      scenes: Array.from({ length: n }, () => ({}) as never),
      firstSeen: null,
      lines,
    })
    const rows = [row(1, 'needed', 2), row(2, 'sourced', 0), row(3, 'needed', 0)]
    expect(propFacts.unsourcedOf(rows)).toEqual(rows.filter((entry) => entry.status === 'needed').map((entry) => ({ id: entry.id, name: entry.name, scenes: entry.scenes.length, first: entry.firstSeen })))
    expect(propFacts.unwrittenOf(rows).map((entry) => entry.name)).toEqual(['PROP 2', 'PROP 3'])
  })
})

// ---------------------------------------------------------------------------
// (d) Exports - the outline's (the chronology's is above)
// ---------------------------------------------------------------------------

describe('outlineExport', () => {
  const NODES: readonly OutlineNode[] = [
    { id: id(200), provenance: typed(), type: 'h1', content: [{ kind: 'text', text: 'Act One' }] },
    { id: id(201), provenance: typed(), type: 'beat', content: [{ kind: 'text', text: 'Meera finds the ledger.' }] },
  ]

  it('writes the Markdown the Outline menu writes, from the stored blocks', async () => {
    spies.readDocumentByKind.mockResolvedValue({ id: documentId('9a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c13') })
    spies.readOutlineNodes.mockResolvedValue({ ok: true, value: NODES.map((node) => ({ node })) })
    spies.readMentionLabels.mockResolvedValue([])
    const result = await outlineExport(SCOPE, EPISODE)
    expect(result).toEqual({ status: 'exported', filename: 'pilot-outline.md', mime: 'text/markdown;charset=utf-8', text: outlineMarkdown('Pilot', NODES, labelBook([])) })
  })

  it('refuses when there is no outline', async () => {
    spies.readDocumentByKind.mockResolvedValue(null)
    expect(await outlineExport(SCOPE, EPISODE)).toMatchObject({ status: 'error' })
  })
})

// ---------------------------------------------------------------------------
// (e) Project list filtering and counting
// ---------------------------------------------------------------------------

describe('readProjectList', () => {
  const ME = userId('00000000-0000-4000-8000-0000000000aa')
  const card = (n: number, over: Partial<ProjectCard['project']>): ProjectCard => ({
    project: {
      id: projectId(`00000000-0000-4000-8000-00000000000${String(n)}`),
      title: `Project ${String(n)}`,
      kind: 'screenwriting',
      projectType: 'film',
      format: 'hollywood',
      pageMode: 'paged',
      liveRepaginate: false,
      tags: [],
      logline: null,
      createdBy: ME,
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-11T11:29:00.000Z',
      trashedAt: null,
      archivedAt: null,
      ...over,
    },
    episodes: 1,
    script: 'present',
    scenes: 1,
    pages: 1,
    lastEditedAt: '2026-09-11T11:29:00.000Z',
    openingEpisode: episodeSlug('ep_001'),
    members: [],
    generating: 0,
    preview: [],
  })
  const CARDS = [
    card(1, { title: 'Monsoon Line' }),
    card(2, { title: 'Archive Tapes', archivedAt: '2026-09-20T00:00:00.000Z' }),
    card(3, { title: 'Borrowed', createdBy: userId('00000000-0000-4000-8000-0000000000bb') }),
    card(4, { title: 'A Film Thing', kind: 'filmmaking' }),
  ]

  it('filters, counts and sorts as the Projects route does', async () => {
    spies.listProjectsFor.mockResolvedValue(CARDS)
    const list = await readProjectList({} as never, ME, 'all', 'title')
    // The client, as `projects-workspace.tsx` wrote it.
    expect(list.cards).toEqual(sortCards(CARDS.filter((entry) => matchesFilter(entry, 'all', ME)), 'title'))
    expect(list.counts).toEqual(filterCounts(CARDS, ME))
    expect(list.cards.map((entry) => entry.project.title)).toEqual(['A Film Thing', 'Borrowed', 'Monsoon Line'])
  })

  it('answers "which projects are archived?" with the chip`s own predicate', async () => {
    spies.listProjectsFor.mockResolvedValue(CARDS)
    const list = await readProjectList({} as never, ME, 'archived', 'recent')
    expect(list.cards.map((entry) => entry.project.title)).toEqual(['Archive Tapes'])
    expect(list.counts.archived).toBe(1)
  })
})
