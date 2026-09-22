import type { ProjectCard as Card } from '@folio/contracts'
import { episodeSlug, projectId, userId } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import {
  countLabel,
  filterCounts,
  kindLine,
  lengthOf,
  matchesFilter,
  sortCards,
  stageOf,
  statsLine,
} from '../lib/projects/view'

/**
 * The Projects route computes its chips, its counts, its sort and its two
 * metadata lines here, so this is where the empty-meta convention is proved:
 * "things that legitimately count to zero show `0`; things that either exist
 * or don't show `—`; the script says `empty`" (AGENTS.md, UI fidelity).
 */

const ME = '00000000-0000-4000-8000-0000000000aa'
const SOMEBODY = '00000000-0000-4000-8000-0000000000bb'

let n = 0

const card = ({
  project,
  ...overrides
}: Partial<Omit<Card, 'project'>> & { readonly project?: Partial<Card['project']> } = {}): Card => {
  n += 1
  return {
    project: {
      id: projectId(`00000000-0000-4000-8000-00000000000${n.toString(16)}`),
      title: 'Monsoon Line',
      kind: 'screenwriting',
      projectType: 'series',
      format: 'hollywood',
      pageMode: 'paged',
      liveRepaginate: false,
      tags: [],
      logline: null,
      createdBy: userId(ME),
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-11T11:29:00.000Z',
      trashedAt: null,
      archivedAt: null,
      ...project,
    },
    episodes: 6,
    script: 'present',
    scenes: 34,
    pages: 104,
    lastEditedAt: '2026-09-11T11:29:00.000Z',
    openingEpisode: episodeSlug('ep_001'),
    members: [],
    generating: 0,
    preview: [],
    ...overrides,
  }
}

describe('the stats line', () => {
  it('shows episodes, scenes and pages for a measured series', () => {
    expect(statsLine(card())).toBe('6 eps · 34 scenes · 104pp')
  })

  it('hides the episode count on a film, whose one row is a schema shape not a fact about the film', () => {
    expect(statsLine(card({ project: { projectType: 'film' }, episodes: 1 }))).toBe('34 scenes · 104pp')
  })

  it('shows — for pages when a script exists but has never been measured', () => {
    expect(statsLine(card({ pages: null, scenes: 0 }))).toBe('6 eps · 0 scenes · pages —')
  })

  it('says the script is empty, in place of a page count, when there is no script', () => {
    expect(statsLine(card({ script: 'absent', scenes: 0, pages: null }))).toBe('6 eps · script empty')
  })

  it('says the same three ways in the list’s Length column', () => {
    expect(lengthOf(card())).toBe('104pp')
    expect(lengthOf(card({ pages: null }))).toBe('—')
    expect(lengthOf(card({ script: 'absent' }))).toBe('empty')
  })
})

describe('the stage', () => {
  it('is what exists, never a draft number', () => {
    expect(stageOf(card())).toBe('written')
    expect(stageOf(card({ scenes: 0 }))).toBe('no-scenes')
    expect(stageOf(card({ script: 'absent' }))).toBe('no-script')
    expect(stageOf(card({ project: { archivedAt: '2026-09-20T00:00:00.000Z' } }))).toBe('archived')
  })

  it('puts a live generation ahead of everything else, because it is the thing that is happening', () => {
    expect(stageOf(card({ generating: 1, project: { archivedAt: '2026-09-20T00:00:00.000Z' } }))).toBe(
      'generating',
    )
  })
})

describe('the filters', () => {
  const cards = [
    card(),
    card({ project: { kind: 'filmmaking' } }),
    card({ project: { createdBy: userId(SOMEBODY) } }),
    card({ project: { archivedAt: '2026-09-20T00:00:00.000Z' } }),
  ]

  it('leaves archived projects out of every chip but Archived', () => {
    const counts = filterCounts(cards, ME)
    expect(counts.all).toBe(3)
    expect(counts.archived).toBe(1)
    expect(counts.screenwriting).toBe(2)
    expect(counts.filmmaking).toBe(1)
  })

  it('calls a project shared when somebody else made it', () => {
    expect(filterCounts(cards, ME).shared).toBe(1)
    expect(matchesFilter(cards[2] as Card, 'shared', ME)).toBe(true)
    expect(matchesFilter(cards[0] as Card, 'shared', ME)).toBe(false)
  })

  it('does not let an archived project reappear under its kind', () => {
    const archived = card({ project: { archivedAt: '2026-09-20T00:00:00.000Z', kind: 'filmmaking' } })
    expect(matchesFilter(archived, 'filmmaking', ME)).toBe(false)
    expect(matchesFilter(archived, 'archived', ME)).toBe(true)
  })
})

describe('the sort', () => {
  const a = card({ project: { title: 'Winter Ad Spot' } })
  const b = card({ project: { title: 'Monsoon Line' } })
  const c = card({ project: { title: 'Housekeeping' } })

  it('leaves the repository’s order alone for Recently edited', () => {
    expect(sortCards([a, b, c], 'recent').map((entry) => entry.project.title)).toEqual([
      'Winter Ad Spot',
      'Monsoon Line',
      'Housekeeping',
    ])
  })

  it('sorts by title, ignoring case', () => {
    expect(sortCards([a, b, c], 'title').map((entry) => entry.project.title)).toEqual([
      'Housekeeping',
      'Monsoon Line',
      'Winter Ad Spot',
    ])
  })

  it('is stable: equal keys keep the order they came in', () => {
    const one = card({ project: { title: 'Same' } })
    const two = card({ project: { title: 'Same' } })
    const sorted = sortCards([one, two], 'stage')
    expect(sorted[0]?.project.id).toBe(one.project.id)
    expect(sorted[1]?.project.id).toBe(two.project.id)
  })
})

describe('the labels', () => {
  it('names the kind and the shape together', () => {
    expect(kindLine(card())).toBe('Screenwriting · Series')
    expect(kindLine(card({ project: { kind: 'filmmaking', projectType: 'film' } }))).toBe(
      'Filmmaking · Film',
    )
  })

  it('counts what is on screen, and says nothing about what is not', () => {
    expect(countLabel([card(), card({ project: { kind: 'filmmaking' } })])).toBe(
      '2 projects · 1 screenplay · 1 filmmaking',
    )
    expect(countLabel([card()])).toBe('1 project · 1 screenplay')
    expect(countLabel([])).toBe('0 projects')
  })
})
