// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ScreenplayNode } from '@folio/script'
import { nodeId, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { FIXTURES, pickFixtures } from '../evals/fixtures'
import type { StoryResult } from '../evals/report'
import { buildReport } from '../evals/report'
import { craftRules, meanScore, verifiedSpots } from '../evals/rubric'
import { parsesAsScreenplay, scoreStructure } from '../evals/structural'

/**
 * The eval harness's scoring - roadmap task 5.5. The harness itself calls a
 * model and runs on demand (`pnpm eval`, never in CI, ADR 0003 D19); what it
 * scores with is code, and is tested here with the rest of the suite: the
 * rubric read from `craft.md` itself, the quotes held to the draft, the
 * structural checks, the fixtures, and the report.
 */

const craft = readFileSync(join(process.cwd(), '..', '..', 'docs', 'agents', 'craft.md'), 'utf8')

let n = 0
const node = (type: 'scene' | 'action' | 'character' | 'dialogue', content: string): ScreenplayNode => {
  n += 1
  const base = { id: nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`), provenance: typed(), content: [text(content)] }
  return type === 'character' ? { type, ...base, modifiers: [] } : { type, ...base }
}

const draft = (): readonly ScreenplayNode[] => [
  node('scene', 'EXT. JETTY - DAWN'),
  node('action', 'Meera coils a rope that does not need coiling.'),
  node('character', 'MEERA'),
  node('dialogue', 'Last ferry went an hour ago.'),
  node('scene', 'INT. FERRY CABIN - NIGHT'),
  node('action', 'A boy of twenty sleeps against the window.'),
]

describe('the rubric', () => {
  it('is the numbered rules of craft.md, wrapped lines joined', () => {
    const rules = craftRules(craft)
    expect(rules.map((rule) => rule.number)).toEqual(Array.from({ length: 14 }, (_, index) => index + 1))
    expect(rules[1]?.text).toBe('Scene headings follow `INT./EXT. PLACE - DAY/NIGHT` and reuse the project\'s bound slugline spellings exactly.')
    expect(rules[13]?.text.startsWith('Respect the writer\'s work.')).toBe(true)
  })

  it('reports only the quotes that are in the draft, whatever their spacing', () => {
    const script = 'EXT. JETTY - DAWN\n\nMeera coils a rope that\ndoes not need coiling.'
    const spots = [
      { rule: 4, quote: 'Meera coils a rope that does not need coiling.', note: 'fine' },
      { rule: 7, quote: 'I feel so abandoned, son.', note: 'on the nose' },
    ]
    expect(verifiedSpots(spots, script)).toEqual({ kept: [spots[0]], dropped: 1 })
  })

  it('averages to one decimal, and has no mean with nothing scored', () => {
    expect(meanScore([{ rule: 1, score: 4, note: '' }, { rule: 2, score: 3, note: '' }, { rule: 3, score: 3, note: '' }])).toBe(3.3)
    expect(meanScore([])).toBeNull()
  })
})

describe('the structural checks', () => {
  it('pass a draft that opens on a heading, reads back from Fountain, resolves every cue and heads every planned scene', () => {
    const score = scoreStructure(draft(), ['MEERA'], 2)
    expect(score).toMatchObject({ parses: true, unresolvedCues: [], headings: 2, opensOnHeading: true, unreadableHeadings: [], pass: true })
  })

  it('fail a cue with no bound spelling, a heading that is not a slugline, a missing scene and a script that opens on action', () => {
    const nodes = [node('action', 'Rain.'), node('scene', 'somewhere near the sea'), node('character', 'MEERA PAWAR'), node('dialogue', 'Late again.')]
    const score = scoreStructure(nodes, ['MEERA'], 3)
    expect(score.unresolvedCues).toEqual(['MEERA PAWAR'])
    expect(score.unreadableHeadings).toEqual(['somewhere near the sea'])
    expect(score.opensOnHeading).toBe(false)
    expect(score.pass).toBe(false)
  })

  it('call a draft that reads back as the same elements a screenplay', () => {
    expect(parsesAsScreenplay(draft())).toEqual({ ok: true, problem: null })
  })
})

describe('the fixtures', () => {
  it('are ten: thin one-liners, treatments, a series pilot and one mixing Hindi and English, with unique ids', () => {
    expect(FIXTURES).toHaveLength(10)
    expect(new Set(FIXTURES.map((fixture) => fixture.id)).size).toBe(10)
    expect(FIXTURES.filter((fixture) => fixture.kind === 'one-liner').length).toBeGreaterThanOrEqual(3)
    expect(FIXTURES.filter((fixture) => fixture.kind === 'treatment').length).toBeGreaterThanOrEqual(2)
    expect(FIXTURES.find((fixture) => fixture.kind === 'pilot')?.projectType).toBe('series')
    expect(FIXTURES.find((fixture) => fixture.kind === 'mixed-language')?.story).toMatch(/[\u0900-\u097F]/u)
  })

  it('are picked by id, and an unknown id is refused rather than skipped', () => {
    expect(pickFixtures('ferry-son, dabba-mix')).toMatchObject({ ok: true, fixtures: [{ id: 'ferry-son' }, { id: 'dabba-mix' }] })
    expect(pickFixtures(null)).toMatchObject({ ok: true, fixtures: FIXTURES })
    expect(pickFixtures('nope')).toMatchObject({ ok: false })
  })
})

describe('the report', () => {
  it('tables every story, then gives each its structure, its rubric and its quoted weak spots', () => {
    const rules = craftRules(craft)
    const [first, second] = FIXTURES
    if (first === undefined || second === undefined) throw new Error('The fixtures are missing.')
    const result: StoryResult = {
      fixture: first,
      outcome: 'done',
      message: null,
      jobs: 8,
      tokens: 184_000,
      seconds: 412,
      logline: 'A ferry captain meets the son she gave up.',
      assumptions: ['It is set in the present day.'],
      structural: scoreStructure(draft(), ['MEERA'], 2),
      judgement: { scores: [{ rule: 7, score: 2, note: 'Says what she feels.' }, { rule: 5, score: 4, note: 'Lean.' }], weakSpots: [{ rule: 7, quote: 'Last ferry went an hour ago.', note: 'Flat.' }], summary: 'Tighten the reunion.' },
      droppedQuotes: 1,
      projectId: '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10',
    }
    const report = buildReport({ startedAt: '2026-09-24T03:00:00.000Z', model: 'claude-test', rules, results: [result, { ...result, fixture: second, outcome: 'stopped', message: 'It did not finish in 40 jobs.', structural: null, judgement: null, droppedQuotes: 0 }] })
    expect(report).toContain('# Story-to-script evals - 2026-09-24')
    expect(report).toContain('**1 of 2** stories pass every structural check. Mean rubric score **3** of 5.')
    expect(report).toContain('| The Last Ferry (`ferry-son`) | one-liner | yes | yes | 0 | 2 / 2 | 3 | 7 (2) Dialogue carries subtext |')
    expect(report).toContain('  > Last ferry went an hour ago.')
    expect(report).toContain('**Stopped:** It did not finish in 40 jobs.')
    expect(report).toContain('_1 quote(s) the judge gave were not in the draft and were left out._')
  })
})
