import type { SceneRef } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import type { SceneText } from '../lib/assistant/context'
import { claimHash, evidenceFor, normaliseForMatch, validateDraft, validateFindings } from '../lib/characters/evidence'

/**
 * What a model action is handed and what its answer must survive -
 * `lib/characters/evidence.ts`. Cite or drop, checked here character for
 * character.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const ref = (n: number, episodeOrdinal: number, number: number): SceneRef => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneRef['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
})

const text = (n: number, episodeOrdinal: number, number: number, body: string): SceneText => ({
  ref: ref(n, episodeOrdinal, number),
  label: `E${String(episodeOrdinal)} Sc ${String(number)}`,
  text: body,
})

const scenes = new Map<NodeId, SceneText>([
  [node(1), text(1, 1, 1, 'MEERA\n    Two buckets. I counted.')],
  [node(2), text(2, 1, 2, 'KADAM\n    Madam, the paper is the paper.')],
  [node(3), text(3, 2, 1, 'MEERA\n    I have never been to Pune.')],
  [node(4), text(4, 2, 2, 'ANIL\n    Remember Pune, Meera? You said ‘never again’.')],
])

describe('evidenceFor', () => {
  it('renders whole scenes in script order with their labels, and says so when it cuts', () => {
    const evidence = evidenceFor([node(1), node(3), node(99)], scenes, 10_000)
    expect(evidence.shown).toBe(2)
    expect(evidence.total).toBe(2)
    expect([...evidence.labels]).toEqual(['E1 Sc 1', 'E2 Sc 1'])
    expect(evidence.text.startsWith('[E1 Sc 1] INT. SCENE 1 - DAY\nMEERA')).toBe(true)
    expect(evidence.text).not.toContain('cut to fit')

    const cut = evidenceFor([node(1), node(2), node(3)], scenes, 60)
    expect(cut.shown).toBe(1)
    expect(cut.total).toBe(3)
    expect(cut.text).toContain('[2 later scenes were cut to fit. Say nothing about them.]')
  })

  it('always shows at least the first scene, however small the cap', () => {
    const evidence = evidenceFor([node(1)], scenes, 1)
    expect(evidence.shown).toBe(1)
  })
})

describe('validateDraft', () => {
  const allowed = ['E1 Sc 1', 'E2 Sc 1']

  it('keeps a cited draft with its refs in script order, unknown refs dropped', () => {
    const checked = validateDraft({ text: '  She counts what others waste. ', refs: ['E2 Sc 1', 'E9 Sc 9', 'E1 Sc 1'] }, allowed, 700)
    expect(checked).toEqual({ ok: true, text: 'She counts what others waste.', refs: ['E1 Sc 1', 'E2 Sc 1'] })
  })

  it('refuses an empty draft and an uncited one', () => {
    expect(validateDraft({ text: '   ', refs: ['E1 Sc 1'] }, allowed, 700)).toEqual({ ok: false, reason: 'empty' })
    expect(validateDraft({ text: 'A guess.', refs: [] }, allowed, 700)).toEqual({ ok: false, reason: 'uncited' })
    expect(validateDraft({ text: 'A guess.', refs: ['E9 Sc 9'] }, allowed, 700)).toEqual({ ok: false, reason: 'uncited' })
  })

  it('cuts a long draft at a sentence end', () => {
    const long = 'First sentence here. Second sentence follows it. Third one runs on and on and on.'
    const checked = validateDraft({ text: long, refs: ['E1 Sc 1'] }, allowed, 50)
    expect(checked.ok && checked.text).toBe('First sentence here. Second sentence follows it.')
  })
})

describe('validateFindings', () => {
  const shown = new Map<string, SceneText>([...scenes.values()].map((scene) => [scene.label, scene]))

  it('keeps a finding whose quotes are on the page, sides sorted, curly quotes straightened', () => {
    const { findings, dropped } = validateFindings(
      {
        findings: [
          {
            claim: 'Meera says she has never been to Pune; Anil says she has.',
            a: { ref: 'E2 Sc 2', quote: "Remember Pune, Meera? You said 'never again'." },
            b: { ref: 'E2 Sc 1', quote: 'I have never been to Pune.' },
          },
        ],
      },
      shown,
      8,
    )
    expect(dropped).toBe(0)
    expect(findings).toEqual([
      {
        claim: 'Meera says she has never been to Pune; Anil says she has.',
        a: { label: 'E2 Sc 1', quote: 'I have never been to Pune.' },
        b: { label: 'E2 Sc 2', quote: "Remember Pune, Meera? You said 'never again'." },
      },
    ])
  })

  it('drops a paraphrase, an unknown scene, one scene twice, a short quote and a duplicate; caps the list', () => {
    const good = { claim: 'A claim.', a: { ref: 'E1 Sc 1', quote: 'Two buckets. I counted.' }, b: { ref: 'E1 Sc 2', quote: 'the paper is the paper' } }
    const { findings, dropped } = validateFindings(
      {
        findings: [
          { claim: 'Paraphrased.', a: { ref: 'E1 Sc 1', quote: 'She counted two buckets.' }, b: { ref: 'E1 Sc 2', quote: 'the paper is the paper' } },
          { claim: 'Unknown scene.', a: { ref: 'E1 Sc 1', quote: 'Two buckets.' }, b: { ref: 'E9 Sc 9', quote: 'anything' } },
          { claim: 'Same scene.', a: { ref: 'E1 Sc 1', quote: 'Two buckets.' }, b: { ref: 'E1 Sc 1', quote: 'I counted.' } },
          { claim: 'Too short.', a: { ref: 'E1 Sc 1', quote: 'I' }, b: { ref: 'E1 Sc 2', quote: 'paper' } },
          good,
          { ...good, a: { ...good.a, quote: 'Two buckets.  I counted.' } },
          { claim: 'Another.', a: { ref: 'E2 Sc 1', quote: 'never been to Pune' }, b: { ref: 'E2 Sc 2', quote: 'Remember Pune' } },
        ],
      },
      shown,
      8,
    )
    expect(findings.map((finding) => finding.claim)).toEqual(['A claim.', 'Another.'])
    expect(dropped).toBe(5)
    expect(validateFindings({ findings: [good, { ...good, claim: 'B claim.' }] }, shown, 1).findings).toHaveLength(1)
  })
})

describe('normaliseForMatch and claimHash', () => {
  it('folds quotes and whitespace, and hashes the folded claim to sixteen hex characters', () => {
    expect(normaliseForMatch('  ‘never  again’ ')).toBe("'never again'")
    expect(normaliseForMatch('“quoted”')).toBe('"quoted"')
    expect(claimHash('A  claim.')).toBe(claimHash('A claim.'))
    expect(claimHash('A claim.')).toMatch(/^[0-9a-f]{16}$/u)
    expect(claimHash('A claim.')).not.toBe(claimHash('Another claim.'))
  })
})
