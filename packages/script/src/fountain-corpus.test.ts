import { describe, expect, it } from 'vitest'

import type { FountainParse } from './fountain-parse'
import { countFountainNodes, parseFountain } from './fountain-parse'
import { serialiseFountain } from './fountain-serialise'
import type { NodeId } from './ids'
import { nodeId } from './ids'
import type { ScreenplayNode, ScreenplayNodeType } from './node'
import { SCREENPLAY_NODE_TYPES } from './node'
import {
  MALFORMED_HEADINGS,
  REPAGINATED_EXCERPT,
  VALID_HEADINGS,
  featureLengthScript,
} from './testing/fountain-corpus'

/**
 * The corpus tests.
 *
 * Two claims, both of which the brief calls the highest-risk thing here:
 * zero doubled continueds, and zero silent scenes. Everything else in this file
 * is a count in support of one of them.
 */

const idsFor = (text: string): readonly NodeId[] =>
  Array.from({ length: countFountainNodes(text) }, (_, index) => nodeId(`c${index}`))

const parseOrThrow = (text: string): FountainParse => {
  const parsed = parseFountain(text, { freshIds: idsFor(text) })
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
  return parsed.value
}

const textOf = (node: ScreenplayNode): string =>
  node.content.map((run) => (run.kind === 'text' ? run.text : `@${run.target.entity}`)).join('')

const summarise = (node: ScreenplayNode): unknown => ({
  type: node.type,
  text: textOf(node),
  ...(node.type === 'character' ? { modifiers: node.modifiers } : {}),
})

const countByType = (nodes: readonly ScreenplayNode[]): Record<ScreenplayNodeType, number> => {
  const counts: Record<ScreenplayNodeType, number> = {
    scene: 0,
    action: 0,
    character: 0,
    paren: 0,
    dialogue: 0,
    transition: 0,
    comment: 0,
    subtitle: 0,
  }
  for (const node of nodes) counts[node.type] += 1
  return counts
}

const CONT_D = /\(\s*cont\s*['’ʹʼ´`′.]?\s*d\.?\s*\)/iu
const MORE = /\(\s*more\s*\.{0,3}\s*\)/iu

// ---------------------------------------------------------------------------
// Malformed headings
// ---------------------------------------------------------------------------

describe('a malformed heading never silently becomes a Scene', () => {
  for (const { line, why } of MALFORMED_HEADINGS) {
    it(`${JSON.stringify(line)} - ${why}`, () => {
      const parsed = parseOrThrow(line)
      expect(parsed.nodes.map((node) => node.type)).not.toContain('scene')
      expect(parsed.rejectedHeadings).toHaveLength(1)
      const rejected = parsed.rejectedHeadings[0]
      expect(rejected?.became).not.toBe('scene')
      expect(rejected?.text).toBe(line)
    })
  }

  it('INTERCUT - PHONE CALL is not an interior scene at location ERCUT', () => {
    const parsed = parseOrThrow('INTERCUT - PHONE CALL')
    expect(parsed.nodes.map(summarise)).toEqual([
      { type: 'action', text: 'INTERCUT - PHONE CALL' },
    ])
    expect(parsed.rejectedHeadings[0]?.reason).toEqual({
      kind: 'prefix-not-a-word',
      looksLike: 'INT',
    })
  })

  it('reads as a cue when a line follows it, and is still reported, still not a Scene', () => {
    const parsed = parseOrThrow('INTERCUT - PHONE CALL\nShe picks up.')
    expect(parsed.nodes.map((node) => node.type)).toEqual(['character', 'dialogue'])
    expect(parsed.rejectedHeadings[0]?.became).toBe('character')
  })

  it('but a forced .INTERCUT - PHONE CALL is a Scene, because the writer said so', () => {
    const parsed = parseOrThrow('.INTERCUT - PHONE CALL')
    expect(parsed.nodes.map(summarise)).toEqual([
      { type: 'scene', text: 'INTERCUT - PHONE CALL' },
    ])
    expect(parsed.rejectedHeadings).toEqual([])
  })

  for (const heading of VALID_HEADINGS) {
    it(`${JSON.stringify(heading)} is a Scene`, () => {
      const parsed = parseOrThrow(heading)
      expect(parsed.nodes.map((node) => node.type)).toEqual(['scene'])
      expect(parsed.rejectedHeadings).toEqual([])
    })
  }
})

// ---------------------------------------------------------------------------
// A repaginated export
// ---------------------------------------------------------------------------

describe('a repaginated export imports with no doubled continueds', () => {
  it('produces exactly the node list the writer authored', () => {
    const parsed = parseOrThrow(REPAGINATED_EXCERPT)
    expect(parsed.nodes.map(summarise)).toEqual([
      { type: 'scene', text: 'INT. MEERAS FLAT - NIGHT' },
      { type: 'action', text: 'Rain on the window. MEERA counts notes onto the table.' },
      { type: 'character', text: 'MEERA', modifiers: [] },
      {
        type: 'dialogue',
        // The page split is gone: one speech, not two, and no repeated cue.
        text: 'You said the fifteenth. It is the twenty-first.\nI am not asking for the whole of it.',
      },
      { type: 'action', text: 'The LANDLORD does not sit down.' },
      // A speaker continued after an action line is a *different* case from a
      // page split: the cue is real, only the `(CONT'D)` is generated.
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'Sit down.' },
      { type: 'character', text: 'LANDLORD', modifiers: [] },
      { type: 'paren', text: '(not looking up)' },
      { type: 'dialogue', text: 'I have twelve rooms in this building.' },
      // Authored `(V.O.)` kept, generated `(CONT’D)` removed, from one cue.
      { type: 'character', text: 'MEERA', modifiers: ['V.O.'] },
      { type: 'dialogue', text: 'He had twelve rooms and no time at all.' },
      { type: 'transition', text: 'CUT TO:' },
    ])
  })

  it('counts what it removed', () => {
    const parsed = parseOrThrow(REPAGINATED_EXCERPT)
    expect(parsed.stripped.map((entry) => entry.kind)).toEqual([
      'more',
      'cont-d',
      'cont-d',
      'cont-d',
    ])
    expect(parsed.rejoinedContinuations).toHaveLength(1)
    expect(parsed.rejoinedContinuations[0]?.cue).toBe("MEERA (CONT'D)")
  })

  it('a straight and a curly apostrophe are the same continued', () => {
    const parsed = parseOrThrow(REPAGINATED_EXCERPT)
    const spellings = new Set(parsed.stripped.map((entry) => entry.text))
    expect(spellings.has("(CONT'D)")).toBe(true)
    expect(spellings.has('(CONT’D)')).toBe(true)
  })

  it('re-importing its own output strips nothing, because nothing is left', () => {
    const first = parseOrThrow(REPAGINATED_EXCERPT)
    const second = parseOrThrow(serialiseFountain(first.nodes).text)
    expect(second.stripped).toEqual([])
    expect(second.rejoinedContinuations).toEqual([])
    expect(second.nodes.map(summarise)).toEqual(first.nodes.map(summarise))
  })
})

// ---------------------------------------------------------------------------
// Feature length
// ---------------------------------------------------------------------------

describe('a feature-length script', () => {
  const SCENES = 220
  const source = featureLengthScript(SCENES)
  const parsed = parseOrThrow(source)

  it('imports with zero generated text anywhere in the node stream', () => {
    for (const node of parsed.nodes) {
      expect(textOf(node)).not.toMatch(CONT_D)
      expect(textOf(node)).not.toMatch(MORE)
    }
    const cues = parsed.nodes.filter(
      (node): node is Extract<ScreenplayNode, { type: 'character' }> => node.type === 'character',
    )
    for (const cue of cues) {
      for (const modifier of cue.modifiers) {
        expect(['V.O.', 'O.S.', 'O.C.']).toContain(modifier)
      }
    }
  })

  it('actually contains the artefacts it is claiming to strip', () => {
    expect(source).toMatch(MORE)
    expect(source).toMatch(CONT_D)
    expect(parsed.stripped.filter((entry) => entry.kind === 'more').length).toBeGreaterThan(0)
    expect(parsed.stripped.filter((entry) => entry.kind === 'cont-d').length).toBeGreaterThan(0)
    expect(parsed.rejoinedContinuations.length).toBeGreaterThan(0)
  })

  it('has no silent scene: every rejected heading became something else', () => {
    expect(parsed.rejectedHeadings.length).toBeGreaterThan(0)
    for (const rejected of parsed.rejectedHeadings) {
      const node = parsed.nodes.find((candidate) => candidate.id === rejected.id)
      expect(node?.type).not.toBe('scene')
    }
    // And every Scene node came from a line that really is a heading.
    const scenes = parsed.nodes.filter((node) => node.type === 'scene')
    expect(scenes.length).toBe(SCENES)
  })

  it('a second import pass is identical to the first', () => {
    const written = serialiseFountain(parsed.nodes)
    expect(written.unrepresentable).toEqual([])
    const second = parseOrThrow(written.text)
    expect(second.stripped).toEqual([])
    expect(second.rejoinedContinuations).toEqual([])
    expect(second.nodes.map(summarise)).toEqual(parsed.nodes.map(summarise))
    // ...and a third, so "run it twice" is a fixed point and not a coincidence.
    const third = parseOrThrow(serialiseFountain(second.nodes).text)
    expect(serialiseFountain(third.nodes).text).toBe(written.text)
  })

  it('the counts', () => {
    const counts = countByType(parsed.nodes)
    const rows: string[] = [
      '',
      '  feature-length import - counts',
      '  ------------------------------------------',
      `  source lines                ${source.split('\n').length}`,
      `  nodes                       ${parsed.nodes.length}`,
      ...SCREENPLAY_NODE_TYPES.map(
        (type) => `    ${type.padEnd(24)}${counts[type]}`,
      ),
      `  scenes found                ${counts.scene}`,
      `  headings rejected           ${parsed.rejectedHeadings.length}`,
      `  continueds stripped         ${
        parsed.stripped.filter((entry) => entry.kind === 'cont-d').length
      }`,
      `  (MORE) stripped             ${
        parsed.stripped.filter((entry) => entry.kind === 'more').length
      }`,
      `  page splits rejoined        ${parsed.rejoinedContinuations.length}`,
      `  unsupported elements        ${parsed.unsupported.length}`,
      `  doubled continueds          0`,
      `  silent scenes               0`,
      '',
    ]
    // The brief asks for these counts, so the suite prints them.
    console.log(rows.join('\n'))
    expect(parsed.nodes.length).toBeGreaterThan(2500)
  })
})
