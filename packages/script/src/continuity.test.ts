import { describe, expect, it } from 'vitest'

import { DAY_GAP_DAYS, THREAD_SILENT_EPISODES, THREAD_SILENT_PAGES, continuityFindings } from './continuity'
import type { ContinuityInput, ContinuityScene } from './continuity'
import type { Light } from './entities'
import { nodeId } from './ids'
import type { StoryTime } from './timeline'

/**
 * Eight rules, each with the false positive it refuses. Every scene here
 * is authored: the check reads what the writer typed and what the page
 * says, and guesses nothing.
 */

const at = (day: number, clock: string | null = null): StoryTime => ({ day, clock })

type Parts = Partial<Omit<ContinuityScene, 'id' | 'storyTime'>>

const scene = (id: string, storyTime: StoryTime | null, parts: Parts = {}): ContinuityScene => ({
  id: nodeId(id),
  storyTime,
  flashback: parts.flashback ?? false,
  episodeOrdinal: parts.episodeOrdinal ?? 1,
  page: parts.page ?? null,
  cast: parts.cast ?? [],
  set: parts.set ?? null,
  light: parts.light ?? ('unspecified' as Light),
  threads: parts.threads ?? [],
})

const check = (scenes: readonly ContinuityScene[], extra: Partial<Omit<ContinuityInput, 'scenes'>> = {}) =>
  continuityFindings({ scenes, introductions: extra.introductions ?? new Map(), threads: extra.threads ?? [] })

const kinds = (scenes: readonly ContinuityScene[], extra?: Partial<Omit<ContinuityInput, 'scenes'>>) =>
  check(scenes, extra).map((finding) => [finding.kind, finding.sceneId, finding.otherId])

describe('order', () => {
  it('finds nothing in a straight read, with unplaced scenes in between', () => {
    expect(check([scene('a', at(1, '07:10')), scene('b', at(1, '09:30')), scene('c', null), scene('d', at(2, '06:00')), scene('e', at(2, '06:40'))])).toEqual([])
  })

  it('flags a scene earlier than the latest scene before it, keyed on the scene alone', () => {
    const findings = check([scene('a', at(2, '06:40')), scene('b', at(2, '05:50')), scene('c', at(3))])
    expect(findings).toEqual([
      {
        kind: 'order',
        key: 'order:b',
        sceneId: nodeId('b'),
        otherId: nodeId('a'),
        subject: null,
        sceneTime: at(2, '05:50'),
        otherTime: at(2, '06:40'),
        gap: null,
      },
    ])
  })

  it('compares against the latest, not the adjacent: Day 5, Day 3, Day 4 is one run, flagged once', () => {
    expect(kinds([scene('a', at(5)), scene('b', at(3)), scene('c', at(4))])).toEqual([['order', 'b', 'a']])
  })

  it('a second step back inside a run is its own finding', () => {
    expect(kinds([scene('a', at(5)), scene('b', at(3)), scene('c', at(2))])).toEqual([
      ['order', 'b', 'a'],
      ['order', 'c', 'a'],
    ])
  })

  it('reports a flashback as a flashback and compares the return against the frame', () => {
    expect(kinds([scene('a', at(2, '06:40')), scene('past', at(-3650), { flashback: true }), scene('b', at(2, '08:00'))])).toEqual([
      ['flashback', 'past', 'a'],
    ])
  })

  it('a flagged scene that goes forward is a flash-forward', () => {
    expect(kinds([scene('a', at(1)), scene('later', at(9), { flashback: true }), scene('b', at(2))])).toEqual([['flashforward', 'later', 'a']])
  })

  it('does not let a flashback hide a real step backwards', () => {
    expect(kinds([scene('a', at(5)), scene('past', at(-10), { flashback: true }), scene('b', at(3))])).toEqual([
      ['flashback', 'past', 'a'],
      ['order', 'b', 'a'],
    ])
  })

  it('same day, one clock missing: not an order finding, but noted as unclocked', () => {
    expect(kinds([scene('a', at(3, '23:30')), scene('b', at(3))])).toEqual([['same-day-unclocked', 'b', 'a']])
  })
})

describe('day-gap', () => {
  it(`notes a jump of more than ${String(DAY_GAP_DAYS)} days between consecutive frame scenes, with its size`, () => {
    const findings = check([scene('a', at(1)), scene('b', at(1 + DAY_GAP_DAYS)), scene('c', at(2 + DAY_GAP_DAYS + DAY_GAP_DAYS))])
    expect(findings.map((finding) => [finding.kind, finding.sceneId, finding.gap])).toEqual([['day-gap', 'c', { unit: 'days', size: DAY_GAP_DAYS + 1 }]])
  })
})

describe('two-places', () => {
  it('a character at one clocked moment in two sets, one finding per shared person', () => {
    const findings = check([
      scene('a', at(2, '06:40'), { set: 'kitchen', cast: ['meera', 'raju'] }),
      scene('b', at(2, '06:40'), { set: 'standpipe', cast: ['meera', 'raju', 'anu'] }),
      scene('c', at(2, '06:40'), { set: 'kitchen', cast: ['meera'] }),
    ])
    expect(findings.filter((finding) => finding.kind === 'two-places').map((finding) => [finding.sceneId, finding.otherId, finding.subject])).toEqual([
      ['b', 'a', 'meera'],
      ['b', 'a', 'raju'],
      ['c', 'b', 'meera'],
    ])
  })

  it('needs both clocks and both sets: an unclocked scene or an unresolved heading is not one', () => {
    expect(
      kinds([
        scene('a', at(2, '06:40'), { set: 'kitchen', cast: ['meera'] }),
        scene('b', at(2), { set: 'standpipe', cast: ['meera'] }),
        scene('c', at(2, '06:40'), { set: null, cast: ['meera'] }),
      ]).filter(([kind]) => kind === 'two-places'),
    ).toEqual([])
  })
})

describe('before-introduction', () => {
  it('a character present earlier in story time than their introducing scene', () => {
    const introductions = new Map([['farida', nodeId('intro')]])
    const findings = check(
      [scene('early', at(1), { cast: ['farida'] }), scene('intro', at(3), { cast: ['farida'] }), scene('later', at(4), { cast: ['farida'] })],
      { introductions },
    )
    expect(findings.map((finding) => [finding.kind, finding.sceneId, finding.otherId, finding.subject])).toEqual([
      ['before-introduction', 'early', 'intro', 'farida'],
    ])
  })

  it('a flashback showing someone before their introduction is the point, not a finding', () => {
    const introductions = new Map([['farida', nodeId('intro')]])
    expect(check([scene('intro', at(3), { cast: ['farida'] }), scene('past', at(1), { cast: ['farida'], flashback: true })], { introductions }).map((f) => f.kind)).toEqual([
      'flashback',
    ])
  })
})

describe('light-vs-clock', () => {
  it('a DAY heading clocked at night, a NIGHT heading clocked in the day', () => {
    const findings = check([
      scene('a', at(1, '02:00'), { light: 'day' }),
      scene('b', at(1, '14:00'), { light: 'night' }),
      scene('c', at(1, '20:30'), { light: 'day' }),
      scene('d', at(1, '22:00'), { light: 'night' }),
      scene('e', at(1, '06:30'), { light: 'night' }),
      scene('f', at(1, '14:00'), { light: 'unspecified' }),
    ])
    expect(findings.filter((finding) => finding.kind === 'light-vs-clock').map((finding) => finding.sceneId)).toEqual(['a', 'b'])
  })
})

describe('thread-silent', () => {
  it(`a thread with no scene for ${String(THREAD_SILENT_EPISODES)} whole episode(s), or ${String(THREAD_SILENT_PAGES)} pages`, () => {
    const findings = check(
      [
        scene('a', null, { episodeOrdinal: 1, page: 1, threads: ['love'] }),
        scene('b', null, { episodeOrdinal: 1, page: 2 + THREAD_SILENT_PAGES, threads: ['love'] }),
        scene('c', null, { episodeOrdinal: 2, page: 40, threads: ['love'] }),
        scene('d', null, { episodeOrdinal: 3 + THREAD_SILENT_EPISODES, page: 90, threads: ['love'] }),
        scene('e', null, { episodeOrdinal: 4, page: 100, threads: ['water'] }),
      ],
      { threads: ['love', 'water'] },
    )
    expect(findings.map((finding) => [finding.kind, finding.sceneId, finding.otherId, finding.subject, finding.gap])).toEqual([
      ['thread-silent', 'b', 'a', 'love', { unit: 'pages', size: 1 + THREAD_SILENT_PAGES }],
      ['thread-silent', 'd', 'c', 'love', { unit: 'episodes', size: THREAD_SILENT_EPISODES }],
    ])
  })
})
