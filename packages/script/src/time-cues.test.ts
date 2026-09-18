import { describe, expect, it } from 'vitest'

import { nodeId } from './ids'
import { idAt, nodesOf } from './testing/derive-corpus'
import { CUE_ACTION_LINES, proposePlacements, timeCuesOf } from './time-cues'
import type { SceneTimeCues } from './time-cues'
import type { StoryTime } from './timeline'

/**
 * What the page says about when, and the proposals that follow. Nothing
 * here writes a day: a proposal is a reading the writer accepts or skips.
 */

const heads = (...indices: number[]): ReadonlySet<ReturnType<typeof idAt>> => new Set(indices.map(idAt))

describe('timeCuesOf', () => {
  it('reads the heading\'s time of day and how it binds', () => {
    const nodes = nodesOf([
      'scene:INT. CHAWL - DAY',
      'action:Meera fills a bucket.',
      'scene:INT. CHAWL - CONTINUOUS',
      'action:She carries it out.',
      'scene:EXT. STANDPIPE - LATER',
      'scene:EXT. STANDPIPE - SAME TIME',
      'scene:INT. WARD - NIGHT',
    ])
    const cues = timeCuesOf(nodes, heads(0, 2, 4, 5, 6))
    expect(cues.get(idAt(0))).toMatchObject({ timeOfDay: 'DAY', light: 'day', bind: null, action: null })
    expect(cues.get(idAt(2))).toMatchObject({ timeOfDay: 'CONTINUOUS', bind: 'continuous' })
    expect(cues.get(idAt(4))).toMatchObject({ timeOfDay: 'LATER', bind: 'later' })
    expect(cues.get(idAt(5))).toMatchObject({ timeOfDay: 'SAME TIME', bind: 'continuous' })
    expect(cues.get(idAt(6))).toMatchObject({ timeOfDay: 'NIGHT', light: 'night', bind: null })
  })

  it('quotes the first action line that counts days, with the count', () => {
    const nodes = nodesOf([
      'scene:INT. CHAWL - DAY',
      'action:The next morning. Meera is already up.',
      'scene:INT. CHAWL - DAY',
      'action:Three days later, the tap is still dry.',
      'scene:INT. CHAWL - DAY',
      'action:Two weeks later.',
      'scene:INT. CHAWL - NIGHT',
      'action:Later that night.',
      'scene:INT. CHAWL - DAY',
      'action:An hour later, nothing has changed.',
      'scene:INT. CHAWL - DAY',
      'action:A year later. The chawl is gone.',
      'scene:INT. CHAWL - DAY',
      'action:Bombay, 1997.',
      'scene:INT. CHAWL - DAY',
      'action:Two days earlier.',
    ])
    const cues = timeCuesOf(nodes, heads(0, 2, 4, 6, 8, 10, 12, 14))
    const action = (index: number): SceneTimeCues['action'] => cues.get(idAt(index))?.action ?? null
    expect(action(0)).toEqual({ nodeId: idAt(1), quote: 'The next morning', offsetDays: 1 })
    expect(action(2)).toEqual({ nodeId: idAt(3), quote: 'Three days later', offsetDays: 3 })
    expect(action(4)).toEqual({ nodeId: idAt(5), quote: 'Two weeks later', offsetDays: 14 })
    expect(action(6)).toEqual({ nodeId: idAt(7), quote: 'Later that night', offsetDays: 0 })
    expect(action(8)).toEqual({ nodeId: idAt(9), quote: 'An hour later', offsetDays: 0 })
    // A year is not a count of days: quoted, not counted.
    expect(action(10)).toEqual({ nodeId: idAt(11), quote: 'A year later', offsetDays: null })
    expect(action(12)).toEqual({ nodeId: idAt(13), quote: '1997', offsetDays: null })
    expect(action(14)).toEqual({ nodeId: idAt(15), quote: 'Two days earlier', offsetDays: -2 })
  })

  it(`reads only the first ${String(CUE_ACTION_LINES)} action lines of a scene, and action only`, () => {
    const nodes = nodesOf([
      'scene:INT. CHAWL - DAY',
      'action:Meera at the tap.',
      'action:She waits.',
      'action:The next morning she is back.',
      'scene:INT. CHAWL - DAY',
      'cue:MEERA',
      'dialogue:The next morning, then.',
      'action:Two days later.',
    ])
    const cues = timeCuesOf(nodes, heads(0, 4))
    expect(cues.get(idAt(0))?.action).toBeNull()
    expect(cues.get(idAt(4))?.action).toEqual({ nodeId: idAt(7), quote: 'Two days later', offsetDays: 2 })
  })

  it('a heading the pass did not accept ends no scene', () => {
    const nodes = nodesOf(['scene:INT. CHAWL - DAY', 'scene:NOT A HEADING', 'action:The next day.'])
    const cues = timeCuesOf(nodes, heads(0))
    expect([...cues.keys()]).toEqual([idAt(0)])
    expect(cues.get(idAt(0))?.action?.quote).toBe('The next day')
  })
})

describe('proposePlacements', () => {
  const at = (day: number, clock: string | null = null): StoryTime => ({ day, clock })
  const cue = (parts: Partial<SceneTimeCues>): SceneTimeCues => ({
    sceneNodeId: nodeId('x'),
    timeOfDay: null,
    light: 'unspecified',
    bind: null,
    action: null,
    ...parts,
  })
  const scene = (id: string, storyTime: StoryTime | null, cues: SceneTimeCues | null = null, flashback = false) => ({
    id: nodeId(id),
    storyTime,
    flashback,
    cues,
  })

  it('counts each proposal from the frame scene before it, placed or proposed', () => {
    const proposals = proposePlacements([
      scene('a', at(2, '06:40')),
      scene('b', null, cue({ timeOfDay: 'CONTINUOUS', bind: 'continuous' })),
      scene('c', null, cue({ timeOfDay: 'LATER', bind: 'later' })),
      scene('d', null, cue({ action: { nodeId: nodeId('n'), quote: 'The next morning', offsetDays: 1 } })),
      scene('e', null),
      scene('f', null, cue({ action: { nodeId: nodeId('n2'), quote: 'A year later', offsetDays: null } })),
    ])
    expect(proposals).toEqual([
      { sceneNodeId: nodeId('b'), time: at(2, '06:40'), reason: 'continuous', quote: 'CONTINUOUS', cueNodeId: null },
      { sceneNodeId: nodeId('c'), time: at(2), reason: 'later', quote: 'LATER', cueNodeId: null },
      { sceneNodeId: nodeId('d'), time: at(3), reason: 'cue', quote: 'The next morning', cueNodeId: nodeId('n') },
      { sceneNodeId: nodeId('e'), time: at(3), reason: 'carried', quote: null, cueNodeId: null },
      { sceneNodeId: nodeId('f'), time: at(3), reason: 'carried', quote: null, cueNodeId: null },
    ])
  })

  it('starts on the first day with nothing placed, and skips flashbacks without counting from them', () => {
    const proposals = proposePlacements([
      scene('a', null, cue({ timeOfDay: 'CONTINUOUS', bind: 'continuous' })),
      scene('past', null, null, true),
      scene('older', at(-100), null, true),
      scene('b', null),
    ])
    expect(proposals.map((proposal) => [proposal.sceneNodeId, proposal.time.day, proposal.reason])).toEqual([
      ['a', 1, 'continuous'],
      ['b', 1, 'carried'],
    ])
  })

  it('a placed scene resets the count, so a later proposal follows the writer', () => {
    const proposals = proposePlacements([scene('a', null), scene('b', at(10)), scene('c', null)])
    expect(proposals.map((proposal) => proposal.time.day)).toEqual([1, 10])
  })
})
