import { describe, expect, it } from 'vitest'

import { characterId, propId } from './ids'
import { mention } from './inline'
import { PROP_EVIDENCE_LIMIT, propEvidence, propEvidenceCounts, propScenes } from './props'
import { idAt, nodesOf } from './testing/derive-corpus'

/**
 * The Props route's reader over the script. Evidence the route quotes,
 * never a binding: nothing here mints a record, and a line matching
 * nothing in the pool is simply not in the answer.
 *
 * The corpus is the point the module's header makes: `Game Ball` is never
 * written in the prose, `the ball` is - so the record collects lines only
 * because the writer bound the alias.
 */

const ball = propId('ball')
const bag = propId('bag')
const other = propId('other')

const pool = [
  { id: ball, name: 'Game Ball', aliases: ['the ball'] },
  { id: bag, name: 'Kit Bag', aliases: ['the bag'] },
  { id: other, name: 'Brass Whistle', aliases: [] },
]

const noLabels = () => undefined

const script = nodesOf([
  'scene:INT. CHANGING ROOM - DAY',
  'action:The bag sits open on the bench.',
  'cue:MEERA',
  'dialogue:Where is the ball?',
  'scene:EXT. MAIDAN - DAY',
  'action:The ball rolls under the bench.',
  'action:Rain.',
])

describe('propEvidence', () => {
  it('quotes the lines of action a bound alias reads in, under their heading', () => {
    const found = propEvidence(script, pool, noLabels)
    expect(found.get(ball)).toEqual([
      // A leading run of the line's tokens: `likely`, the same rule the cue queue scores by.
      { nodeId: idAt(5), sceneNodeId: idAt(4), text: 'The ball rolls under the bench.', confidence: 'likely' },
    ])
    expect(found.get(bag)).toEqual([
      { nodeId: idAt(1), sceneNodeId: idAt(0), text: 'The bag sits open on the bench.', confidence: 'likely' },
    ])
  })

  it('reads action only - a line of dialogue asking for the ball is not the page describing it', () => {
    const found = propEvidence(script, pool, noLabels)
    expect(found.get(ball)?.map((line) => line.nodeId)).toEqual([idAt(5)])
  })

  it('has no entry for a record nothing on the page reads as', () => {
    expect(propEvidence(script, pool, noLabels).has(other)).toBe(false)
  })

  it('does not mint from prose: a thing nobody wrote down collects nothing', () => {
    // `bench` is in two lines and in no pool entry, so it is not in the answer.
    const found = propEvidence(script, pool, noLabels)
    expect([...found.keys()].sort()).toEqual([bag, ball].sort())
  })

  it('scores an exact line as certain and a leading run as likely', () => {
    const lines = nodesOf(['scene:INT. ROOM - DAY', 'action:The ball.', 'action:The ball bounces.'])
    const found = propEvidence(lines, [{ id: ball, name: 'x', aliases: ['the ball'] }], noLabels)
    expect(found.get(ball)?.map((line) => line.confidence)).toEqual(['certain', 'likely'])
  })

  it('resolves a mention to the record name so the quoted line has no hole', () => {
    const meera = characterId('meera')
    const lines = nodesOf([
      'scene:INT. ROOM - DAY',
      { type: 'action', runs: [mention({ entity: 'character', id: meera }), { kind: 'text', text: ' picks up the ball.' }] },
    ])
    const found = propEvidence(lines, pool, (target) => (target.entity === 'character' && target.id === meera ? 'MEERA' : undefined))
    expect(found.get(ball)?.[0]?.text).toBe('MEERA picks up the ball.')
  })

  it('lets two records hold the same alias - there is no unique index on the table', () => {
    const twins = [
      { id: ball, name: 'Meera’s bag', aliases: ['the bag'] },
      { id: bag, name: 'Kit Bag', aliases: ['the bag'] },
    ]
    const found = propEvidence(script, twins, noLabels)
    expect(found.get(ball)).toHaveLength(1)
    expect(found.get(bag)).toHaveLength(1)
  })

  it('credits the node itself when no heading precedes it', () => {
    const found = propEvidence(nodesOf(['action:The ball rolls.']), pool, noLabels)
    expect(found.get(ball)?.[0]?.sceneNodeId).toBe(idAt(0))
  })

  it('caps a record at the limit and keeps document order', () => {
    const many = nodesOf(['scene:INT. ROOM - DAY', ...Array.from({ length: PROP_EVIDENCE_LIMIT + 10 }, () => 'action:The ball rolls on.')])
    const lines = propEvidence(many, pool, noLabels).get(ball) ?? []
    expect(lines).toHaveLength(PROP_EVIDENCE_LIMIT)
    expect(lines[0]?.nodeId).toBe(idAt(1))
    expect(lines[PROP_EVIDENCE_LIMIT - 1]?.nodeId).toBe(idAt(PROP_EVIDENCE_LIMIT))
  })

  it('is empty for an empty pool and for a script with no action', () => {
    expect(propEvidence(script, [], noLabels).size).toBe(0)
    expect(propEvidence(nodesOf(['scene:INT. ROOM - DAY', 'cue:MEERA', 'dialogue:The ball.']), pool, noLabels).size).toBe(0)
  })
})

describe('propEvidenceCounts and propScenes', () => {
  it('counts every record in the pool, zeros included', () => {
    const counts = propEvidenceCounts(propEvidence(script, pool, noLabels), pool)
    expect([...counts.entries()]).toEqual([
      [ball, 1],
      [bag, 1],
      [other, 0],
    ])
  })

  it('lists each scene once, in document order', () => {
    const lines = nodesOf(['scene:INT. ROOM - DAY', 'action:The ball rolls.', 'action:The ball stops.', 'scene:EXT. STREET - DAY', 'action:The ball again.'])
    const found = propEvidence(lines, pool, noLabels).get(ball) ?? []
    expect(propScenes(found)).toEqual([idAt(0), idAt(3)])
  })
})
