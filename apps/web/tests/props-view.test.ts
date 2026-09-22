import type { PropRow } from '@folio/contracts'
import { propId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  categoriesOf,
  DEFAULT_SORT,
  FILTER_LABELS,
  grouped,
  lineLabel,
  matchesFind,
  metaLine,
  metaLong,
  passesFilter,
  productionLine,
  routeIdOf,
  sceneLabel,
  sorted,
  sourcedLine,
  statusLeft,
  statusTone,
  UNCATEGORISED,
} from '../lib/props/view'

/**
 * The Props route's pure half. Every line a view prints, computed from a
 * row - nothing here estimates and nothing calls a model.
 */

const ref = (n: number) => ({ sceneNodeId: `n${String(n)}`, episode: 'ep_001', episodeOrdinal: 1, number: n, heading: `INT. ROOM ${String(n)} - DAY` }) as PropRow['scenes'][number]

const row = (over: Partial<PropRow> = {}): PropRow => ({
  id: propId('p1'),
  name: 'Game Ball',
  category: 'Hand prop',
  description: null,
  status: 'needed',
  photoUrl: null,
  aliases: ['Game Ball', 'the ball'],
  bound: [],
  evidence: [],
  lines: 0,
  scenes: [],
  shots: [],
  sceneSetups: 0,
  firstSeen: null,
  lastSeen: null,
  createdAt: '2026-09-22T00:00:00.000Z',
  ...over,
})

describe('counts and labels', () => {
  it('prints the no-ref line rather than a zero', () => {
    expect(sceneLabel(0)).toBe('Not on the page yet')
    expect(sceneLabel(1)).toBe('1 scene')
    expect(sceneLabel(4)).toBe('4 scenes')
    expect(lineLabel(0)).toBe('no lines')
    expect(lineLabel(1)).toBe('1 line')
    expect(lineLabel(12)).toBe('12 lines')
  })

  it('puts the category before the count on a card, and drops it when there is none', () => {
    expect(metaLine(row({ scenes: [ref(1), ref(2)] }))).toBe('Hand prop · 2 scenes')
    expect(metaLine(row({ category: null, scenes: [ref(1)] }))).toBe('1 scene')
    expect(metaLine(row())).toBe('Hand prop · Not on the page yet')
  })

  it("counts the drawer's head from the uncapped total, and names the first scene", () => {
    expect(metaLong(row({ lines: 12, scenes: [ref(3), ref(9)], firstSeen: ref(3) }))).toBe('12 lines across 2 scenes · first in E1 Sc 3')
    expect(metaLong(row())).toBe('Not on the page yet')
  })

  it('says what Production already needs a prop for, and nothing when it needs none', () => {
    expect(productionLine(row())).toBe('')
    expect(productionLine(row({ sceneSetups: 1 }))).toBe('Needed for 1 scene setup')
    expect(
      productionLine(row({ shots: [{ shotId: 's1', label: 'Reel A · Shot 1', sceneNodeId: ref(1).sceneNodeId, sceneNumber: 1 }], sceneSetups: 2 })),
    ).toBe('Needed for 1 shot · 2 scene setups')
  })

  it('reads the status bar and the mono route id', () => {
    const rows = [row(), row({ id: propId('p2'), name: 'Kit Bag' })]
    expect(statusLeft(rows, 29, null)).toBe('2 props · 29 scenes')
    expect(statusLeft(rows, 1, rows[0] ?? null)).toBe('2 props · 1 scene · Game Ball')
    expect(routeIdOf(null)).toBe('props')
    expect(routeIdOf({ id: '3f2a9c1e-0000-4000-8000-000000000000' })).toBe('props/3f2a9c1e')
  })
})

describe('status', () => {
  it('maps the three to the README tones, and counts everything past needed as got hold of', () => {
    expect(statusTone('needed')).toBe('warn')
    expect(statusTone('sourced')).toBe('ok')
    expect(statusTone('on set')).toBe('accent')
    expect(sourcedLine([row(), row({ status: 'sourced' }), row({ status: 'on set' })])).toBe('2 of 3')
    expect(sourcedLine([])).toBe('0 of 0')
  })

  it('labels the filter over the whole list and each status', () => {
    expect(FILTER_LABELS.all).toBe('All props')
    expect(passesFilter(row(), 'all')).toBe(true)
    expect(passesFilter(row(), 'sourced')).toBe(false)
    expect(passesFilter(row({ status: 'on set' }), 'on set')).toBe(true)
  })
})

describe('groups and categories', () => {
  it('groups by category, alphabetically, with the unnamed group last', () => {
    const rows = [row({ category: 'Set dressing' }), row({ category: null }), row({ category: 'Hand prop' }), row({ category: 'Hand prop' })]
    expect(grouped(rows).map((group) => `${group.group} ${String(group.rows.length)}`)).toEqual([
      'Hand prop 2',
      'Set dressing 1',
      `${UNCATEGORISED} 1`,
    ])
  })

  it('offers the categories already in use, case-folded and sorted, blanks dropped', () => {
    expect(categoriesOf([row({ category: 'Set dressing' }), row({ category: 'hand prop' }), row({ category: 'Hand prop' }), row({ category: null }), row({ category: '  ' })])).toEqual([
      'hand prop',
      'Set dressing',
    ])
  })
})

describe('find', () => {
  it('matches a name, a category or any bound spelling, and everything on an empty query', () => {
    expect(matchesFind(row(), '')).toBe(true)
    expect(matchesFind(row(), 'GAME')).toBe(true)
    expect(matchesFind(row(), 'hand')).toBe(true)
    expect(matchesFind(row(), 'the ball')).toBe(true)
    expect(matchesFind(row(), 'bench')).toBe(false)
  })
})

describe('the list sort', () => {
  const rows = [
    row({ id: propId('a'), name: 'Kit Bag', category: 'Set dressing' }),
    row({ id: propId('b'), name: 'Game Ball', category: 'Hand prop' }),
    row({ id: propId('c'), name: 'Brass Whistle', category: null }),
  ]

  it('sorts by name both ways, starting ascending', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'name', descending: false })
    expect(sorted(rows, DEFAULT_SORT).map((entry) => entry.name)).toEqual(['Brass Whistle', 'Game Ball', 'Kit Bag'])
    expect(sorted(rows, { key: 'name', descending: true }).map((entry) => entry.name)).toEqual(['Kit Bag', 'Game Ball', 'Brass Whistle'])
  })

  it('sorts a blank category last whichever way the column points, and breaks ties by name', () => {
    expect(sorted(rows, { key: 'category', descending: false }).map((entry) => entry.name)).toEqual(['Game Ball', 'Kit Bag', 'Brass Whistle'])
    expect(sorted(rows, { key: 'category', descending: true }).map((entry) => entry.name)).toEqual(['Kit Bag', 'Game Ball', 'Brass Whistle'])
    const twins = [row({ id: propId('x'), name: 'Zebra', category: 'Hand prop' }), row({ id: propId('y'), name: 'Apple', category: 'Hand prop' })]
    expect(sorted(twins, { key: 'category', descending: false }).map((entry) => entry.name)).toEqual(['Apple', 'Zebra'])
  })

  it('does not mutate the rows it is given', () => {
    const before = rows.map((entry) => entry.name)
    sorted(rows, { key: 'name', descending: true })
    expect(rows.map((entry) => entry.name)).toEqual(before)
  })
})
