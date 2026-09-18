import { describe, expect, it } from 'vitest'

import { characterId, locationId, nodeId } from './ids'
import { mention } from './inline'
import { addQuadrants, establishingLines, matchSetNames, quadrantOf, similarSets } from './sets'
import { idAt, nodesOf } from './testing/derive-corpus'

/**
 * The Locations route's readers over the script - matching, the
 * establishing line, the quadrant. Evidence the route quotes and counts,
 * never a binding: nothing here touches what a heading resolves to.
 */

const chawl = locationId('chawl')
const corridor = locationId('corridor')
const tanker = locationId('tanker')
const ward = locationId('ward')

const pool = [
  { id: chawl, name: 'KAMATHI CHAWL', boundSluglines: ['KAMATHI CHAWL', 'THE CHAWL'], parentId: null },
  { id: corridor, name: 'KAMATHI CHAWL - CORRIDOR', boundSluglines: ['KAMATHI CHAWL - CORRIDOR'], parentId: chawl },
  { id: tanker, name: 'WATER TANKER STAND', boundSluglines: ['WATER TANKER STAND'], parentId: null },
  { id: ward, name: 'WARD OFFICE', boundSluglines: ['WARD OFFICE'], parentId: null },
]

describe('matchSetNames', () => {
  it('ranks by confidence, best first, with the rule that matched', () => {
    const matches = matchSetNames('WATER TANKER', pool)
    expect(matches[0]).toEqual({ id: tanker, confidence: 'likely', reason: { kind: 'leading', shorter: 'WATER TANKER' } })
  })

  it('reads a bound spelling as well as the name', () => {
    const matches = matchSetNames('THE CHAWL', pool)
    expect(matches[0]?.id).toBe(chawl)
    expect(matches[0]?.confidence).toBe('certain')
  })

  it('is empty for a set text with no letters, and for nothing alike', () => {
    expect(matchSetNames('---', pool)).toEqual([])
    expect(matchSetNames('ROOFTOP TANK ROOM', pool)).toEqual([])
  })

  it('keeps pool order on a tie', () => {
    const twins = [
      { id: locationId('a'), name: 'OFFICE', boundSluglines: [], parentId: null },
      { id: locationId('b'), name: 'OFFICE', boundSluglines: [], parentId: null },
    ]
    expect(matchSetNames('OFFICE', twins).map((match) => match.id)).toEqual(['a', 'b'])
  })
})

describe('similarSets', () => {
  it('pairs two records whose spellings read as one place, at certain or likely only', () => {
    const twin = { id: locationId('twin'), name: 'WARD OFFICE ANNEX', boundSluglines: ['WARD OFFICE ANNEX'], parentId: null }
    const pairs = similarSets([...pool, twin])
    expect(pairs).toContainEqual({ a: ward, b: twin.id, confidence: 'likely', reason: { kind: 'leading', shorter: 'WARD OFFICE' } })
    // `contains` is only `possible`, and a possible is not put in front of the writer.
    const loose = { id: locationId('loose'), name: 'THE WARD OFFICE', boundSluglines: ['THE WARD OFFICE'], parentId: null }
    expect(similarSets([...pool, loose]).some((pair) => pair.b === loose.id)).toBe(false)
  })

  it('never pairs a sub-set with its own parent - the tree already says so', () => {
    const pairs = similarSets(pool)
    expect(pairs.some((pair) => (pair.a === chawl && pair.b === corridor) || (pair.a === corridor && pair.b === chawl))).toBe(false)
  })
})

describe('establishingLines', () => {
  const nodes = nodesOf([
    'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
    'cue:MEERA',
    'dialogue:Two buckets.',
    'action:The tap coughs twice and gives up.',
    'action:Meera hangs the washing.',
    'scene:EXT. WATER TANKER STAND - DAWN',
    'scene:INT. WARD OFFICE - DAY',
    { type: 'action', runs: [{ kind: 'text', text: 'A form, a queue, ' }, mention({ entity: 'character', id: characterId('m') }), { kind: 'text', text: ' waits.' }] },
    'scene:INT. KAMATHI CHAWL - CORRIDOR - DAY',
    'action:Later. The same tap.',
  ])
  const locationOf = (id: string): ReturnType<typeof locationId> | null =>
    id === idAt(0) || id === idAt(8) ? corridor : id === idAt(5) ? tanker : id === idAt(6) ? ward : null

  it('quotes the first action under any of the record\'s headings, skipping cues and dialogue', () => {
    const lines = establishingLines(nodes, (id) => locationOf(id), () => undefined)
    expect(lines.get(corridor)).toEqual({ nodeId: idAt(3), sceneNodeId: idAt(0), text: 'The tap coughs twice and gives up.' })
  })

  it('has no entry for a set with headings but no action, and none for an unresolved heading', () => {
    const lines = establishingLines(nodes, (id) => locationOf(id), () => undefined)
    expect(lines.has(tanker)).toBe(false)
    expect(lines.size).toBe(2)
  })

  it('renders a mention by its label and folds whitespace', () => {
    const lines = establishingLines(nodes, (id) => locationOf(id), () => 'Meera')
    expect(lines.get(ward)?.text).toBe('A form, a queue, Meera waits.')
    expect(lines.get(ward)?.nodeId).toBe(nodeId('n8'))
  })
})

describe('quadrantOf', () => {
  it('counts INT as interior and EXT, INT/EXT and EST as exterior, by light', () => {
    expect(
      quadrantOf([
        { ie: 'INT', light: 'day' },
        { ie: 'INT', light: 'night' },
        { ie: 'EXT', light: 'day' },
        { ie: 'INT/EXT', light: 'night' },
        { ie: 'EST', light: 'day' },
        { ie: 'INT', light: 'unspecified' },
      ]),
    ).toEqual({ intDay: 1, intNight: 1, extDay: 2, extNight: 1, unlit: 1 })
  })

  it('adds box by box', () => {
    const a = quadrantOf([{ ie: 'INT', light: 'day' }])
    const b = quadrantOf([{ ie: 'EXT', light: 'night' }, { ie: 'INT', light: 'day' }])
    expect(addQuadrants(a, b)).toEqual({ intDay: 2, intNight: 0, extDay: 0, extNight: 1, unlit: 0 })
  })
})
