// @vitest-environment node
import type { Episode, Project } from '@folio/contracts'
import { episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Roadmap task 2.4: the Characters, Locations and Props reads, end to end
 * through their route loaders.
 *
 * The predicates and the CSV writers are asserted row by row elsewhere
 * (`server-reads.test.ts`, `characters-list.test.ts`, `locations-sheet.test.ts`);
 * what can go wrong here is the wiring - a server read that calls the loader
 * with the wrong context, or builds its CSV from something other than what
 * the view exports. So each runs over a project whose repositories answer
 * empty, and must produce exactly what the client's own helper produces for
 * the same empty load.
 */

const empty = () => Promise.resolve([])

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const answers: Record<string, unknown> = {
    listBoundCues: empty,
    listCharacterRecords: empty,
    listCueTallies: empty,
    listOpenCueRows: empty,
    listRelationships: empty,
    listResolveDecisions: empty,
    listSceneIndex: empty,
    readMergedInto: () => Promise.resolve(null),
    listBoundSluglines: empty,
    listClipsFiledToLocations: empty,
    listLocationRecords: empty,
    listOpenLocationRows: empty,
    listSceneEighths: empty,
    listSceneStoryTime: empty,
    listSceneSynopses: empty,
    listSluglineTallies: empty,
    readProjectScreenplayNodes: () => Promise.resolve({ ok: true, value: [] }),
    listPropAliases: empty,
    listPropRecords: empty,
    listPropShots: empty,
    countPropSceneSetups: () => Promise.resolve(new Map()),
  }
  return { ...real, ...answers }
})

// No record at all makes each loader ask what a derivation pass would find; with no nodes, nothing.
vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  readDerivationReads: () => Promise.resolve({ all: { ok: true, value: [] }, previous: null }),
  deriveSpeculatively: () => null,
}))

const { castFiguresOf, charactersCsv, readCharacterFacts } = await import('../lib/characters/server')
const { csvOf: castCsvOf, sortCast } = await import('../lib/characters/list')
const { locationBreakdownCsv, locationsCsv, readLocationFacts } = await import('../lib/locations/server')
const { csvOf: sheetCsvOf } = await import('../lib/locations/sheet')
const { readPropFacts } = await import('../lib/props/server')

const SCOPE = {} as ProjectScope<'transaction'>
const PROJECT = { id: projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'), title: 'Harbour Lights', format: 'hollywood' } as Project
const EPISODES = [
  { id: episodeId('7a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c11'), slug: episodeSlug('ep_001'), ordinal: 1, title: 'Pilot' } as Episode,
  { id: episodeId('7a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c12'), slug: episodeSlug('ep_002'), ordinal: 2, title: 'Tide' } as Episode,
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Characters', () => {
  it('reads the facts and the CSV the workspace and the List view build', async () => {
    const context = { scope: SCOPE, episodes: EPISODES }
    expect(await readCharacterFacts(context)).toEqual({ noDescription: [], unrelated: [] })
    const { figures, ordinals } = await castFiguresOf(context)
    expect(ordinals).toEqual([1, 2])
    const csv = await charactersCsv(context, { words: true, share: false, episodes: true })
    expect(csv).toEqual({
      filename: 'characters.csv',
      mime: 'text/csv;charset=utf-8',
      text: castCsvOf(sortCast(figures, 'scenes', 'desc'), { words: true, share: false, episodes: [1, 2] }),
    })
  })
})

describe('Locations', () => {
  const context = { scope: SCOPE, project: PROJECT, episodes: EPISODES }

  it('reads the facts and the CSV the workspace and the Sheet view build, series or one episode', async () => {
    expect(await readLocationFacts(context)).toEqual({ oneOffs: [], nightExteriors: [] })
    expect((await locationsCsv(context, null)).text).toBe(sheetCsvOf([], null, [1, 2]))
    expect((await locationsCsv(context, 2)).text).toBe(sheetCsvOf([], 2, [2]))
  })

  it('has no breakdown for a set that is not there', async () => {
    expect(await locationBreakdownCsv(context, '20000000-0000-4000-8000-000000000001')).toBeNull()
  })
})

describe('Props', () => {
  it('reads the facts the workspace publishes', async () => {
    expect(await readPropFacts({ scope: SCOPE })).toEqual({ unsourced: [], unwritten: [] })
  })
})
