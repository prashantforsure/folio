import { describe, expect, it } from 'vitest'

import { nodeId } from './ids'
import {
  chronology,
  compareStoryTime,
  continuityFindings,
  formatStoryTime,
  isStoryClock,
  precedesStoryTime,
  storyJumps,
  storySpan,
} from './timeline'
import type { StoryTime, TimelineScene } from './timeline'

/**
 * Story time against page order. Every scene here is authored: nothing is
 * parsed from a slugline, and an unplaced scene is a state, not Day 1.
 */

const at = (day: number, clock: string | null = null): StoryTime => ({ day, clock })

const scene = (id: string, storyTime: StoryTime | null, flashback = false): TimelineScene => ({
  id: nodeId(id),
  storyTime,
  flashback,
})

describe('the clock shape', () => {
  it('accepts zero-padded 24-hour HH:MM and nothing else', () => {
    expect(isStoryClock('00:00')).toBe(true)
    expect(isStoryClock('06:40')).toBe(true)
    expect(isStoryClock('23:59')).toBe(true)
    expect(isStoryClock('24:00')).toBe(false)
    expect(isStoryClock('6:40')).toBe(false)
    expect(isStoryClock('06:60')).toBe(false)
    expect(isStoryClock('0640')).toBe(false)
    expect(isStoryClock('')).toBe(false)
  })

  it('formats a day and a clock the way the chip prints them', () => {
    expect(formatStoryTime(at(2, '06:40'))).toBe('Day 2 · 06:40')
    expect(formatStoryTime(at(2))).toBe('Day 2')
    expect(formatStoryTime(at(-3))).toBe('Day -3')
  })
})

describe('compareStoryTime', () => {
  it('orders by day, then clock, with an unclocked scene after the clocked ones', () => {
    expect(compareStoryTime(at(1, '22:15'), at(2, '05:50'))).toBeLessThan(0)
    expect(compareStoryTime(at(2, '05:50'), at(2, '06:40'))).toBeLessThan(0)
    expect(compareStoryTime(at(2, '23:30'), at(2))).toBeLessThan(0)
    expect(compareStoryTime(at(2), at(2, '00:00'))).toBeGreaterThan(0)
    expect(compareStoryTime(at(2), at(2))).toBe(0)
    expect(compareStoryTime(at(2, '06:40'), at(2, '06:40'))).toBe(0)
  })
})

describe('precedesStoryTime', () => {
  it('is strict, and an unknown clock never precedes', () => {
    expect(precedesStoryTime(at(1), at(2))).toBe(true)
    expect(precedesStoryTime(at(2), at(1))).toBe(false)
    expect(precedesStoryTime(at(2, '05:50'), at(2, '06:40'))).toBe(true)
    expect(precedesStoryTime(at(2, '06:40'), at(2, '06:40'))).toBe(false)
    expect(precedesStoryTime(at(2), at(2, '06:40'))).toBe(false)
    expect(precedesStoryTime(at(2, '06:40'), at(2))).toBe(false)
    expect(precedesStoryTime(at(2), at(2))).toBe(false)
  })
})

describe('continuityFindings', () => {
  it('finds nothing in a straight read, with unplaced scenes in between', () => {
    const scenes = [
      scene('a', at(1, '07:10')),
      scene('b', at(1, '09:30')),
      scene('c', null),
      scene('d', at(1)),
      scene('e', at(2, '06:40')),
    ]
    expect(continuityFindings(scenes)).toEqual([])
  })

  it('flags a scene whose story time precedes the scene before it on the page', () => {
    const scenes = [scene('a', at(2, '06:40')), scene('b', at(2, '05:50')), scene('c', at(3))]
    expect(continuityFindings(scenes)).toEqual([
      {
        sceneId: nodeId('b'),
        previousId: nodeId('a'),
        kind: 'order',
        sceneTime: at(2, '05:50'),
        previousTime: at(2, '06:40'),
      },
    ])
  })

  it('reports a flashback as a flashback and compares the return against the frame story', () => {
    const scenes = [
      scene('a', at(2, '06:40')),
      scene('past', at(-3650), true),
      scene('b', at(2, '08:00')),
    ]
    expect(continuityFindings(scenes)).toEqual([
      {
        sceneId: nodeId('past'),
        previousId: nodeId('a'),
        kind: 'flashback',
        sceneTime: at(-3650),
        previousTime: at(2, '06:40'),
      },
    ])
  })

  it('does not let a flashback hide a real step backwards', () => {
    const scenes = [scene('a', at(5)), scene('past', at(-10), true), scene('b', at(3))]
    expect(continuityFindings(scenes).map((f) => [f.sceneId, f.previousId, f.kind])).toEqual([
      ['past', 'a', 'flashback'],
      ['b', 'a', 'order'],
    ])
  })

  it('a flashback that goes forward is not a finding', () => {
    const scenes = [scene('a', at(1)), scene('later', at(9), true), scene('b', at(2))]
    expect(continuityFindings(scenes)).toEqual([])
  })

  it('compares across the unplaced: the scene before it is the last one with a time', () => {
    const scenes = [scene('a', at(3)), scene('gap', null), scene('b', at(1))]
    expect(continuityFindings(scenes).map((f) => f.sceneId)).toEqual(['b'])
  })

  it('same day, one clock missing: not a finding', () => {
    const scenes = [scene('a', at(3, '23:30')), scene('b', at(3))]
    expect(continuityFindings(scenes)).toEqual([])
  })

  it('a flashback first on the page has nothing before it', () => {
    expect(continuityFindings([scene('past', at(-1), true), scene('a', at(1))])).toEqual([])
  })
})

describe('storyJumps', () => {
  it('marks back for an order finding and ahead for a skipped day, never on a flashback', () => {
    const scenes = [
      scene('a', at(1)),
      scene('b', at(2)),
      scene('c', at(4)),
      scene('past', at(-100), true),
      scene('d', at(3)),
      scene('e', at(5)),
    ]
    expect([...storyJumps(scenes).entries()]).toEqual([
      ['c', 'ahead'],
      ['d', 'back'],
      ['e', 'ahead'],
    ])
  })

  it('is empty when nothing is placed', () => {
    expect(storyJumps([scene('a', null), scene('b', null)]).size).toBe(0)
  })
})

describe('chronology', () => {
  it('one column per day ascending, clocked first, page order between equals, unplaced aside', () => {
    const scenes = [
      scene('e1s1', at(1, '07:10')),
      scene('e1s9', at(1, '22:15')),
      scene('past', at(-3650), true),
      scene('e1s14', at(2, '06:40')),
      scene('e2s3', at(2, '05:50')),
      scene('e2s6', at(2)),
      scene('e2s7', at(2)),
      scene('e4s1', null),
    ]
    expect(chronology(scenes)).toEqual({
      days: [
        { day: -3650, sceneIds: ['past'], flashbacksOnly: true },
        { day: 1, sceneIds: ['e1s1', 'e1s9'], flashbacksOnly: false },
        { day: 2, sceneIds: ['e2s3', 'e1s14', 'e2s6', 'e2s7'], flashbacksOnly: false },
      ],
      unplaced: ['e4s1'],
    })
  })

  it('a day with a flashback and a frame-story scene is not a flashback column', () => {
    const scenes = [scene('a', at(1), true), scene('b', at(1))]
    expect(chronology(scenes).days[0]?.flashbacksOnly).toBe(false)
  })

  it('is empty columns and everything unplaced for an unplaced script', () => {
    expect(chronology([scene('a', null), scene('b', null)])).toEqual({ days: [], unplaced: ['a', 'b'] })
  })
})

describe('storySpan', () => {
  it('runs first to last placed day of the frame story, flashbacks outside the count', () => {
    const scenes = [
      scene('past', at(-3650), true),
      scene('a', at(1)),
      scene('b', at(9)),
      scene('c', at(5)),
      scene('d', null),
    ]
    expect(storySpan(scenes)).toEqual({ from: 1, to: 9, days: 9 })
  })

  it('is one day for one placed day', () => {
    expect(storySpan([scene('a', at(4)), scene('b', at(4, '10:00'))])).toEqual({ from: 4, to: 4, days: 1 })
  })

  it('is null when nothing is placed, or only flashbacks are', () => {
    expect(storySpan([scene('a', null)])).toBeNull()
    expect(storySpan([scene('a', at(1), true)])).toBeNull()
  })
})
