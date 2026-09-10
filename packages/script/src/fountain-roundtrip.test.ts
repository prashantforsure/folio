import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { FountainParse } from './fountain-parse'
import { countFountainNodes, parseFountain } from './fountain-parse'
import { serialiseFountain } from './fountain-serialise'
import type { NodeId } from './ids'
import { nodeId } from './ids'
import type { ScreenplayNode } from './node'
import { commentCount, renderableCount, renderableOrder } from './stream'
import { fountainNodesArb, fountainTextArb } from './testing/fountain-arbitraries'

/**
 * The round-trip properties.
 *
 * AGENTS.md, Development philosophy 8 puts the parser in the short list of
 * places where correctness is load-bearing. These are the four claims the
 * parser and serialiser make together, and the one thing they must never do -
 * grow a `(CONT'D)` on a second pass.
 *
 * Ids are supplied to the parse, never minted: `packages/script` has no
 * entropy. "parse(serialise(nodes)) preserves ids" therefore means the parse is
 * count-, order- and type-preserving, so handing back the original ids
 * reproduces the original list. That is the strongest form the claim can take
 * in a text format with nowhere to write an id down.
 */

const idsFor = (text: string): readonly NodeId[] =>
  Array.from({ length: countFountainNodes(text) }, (_, index) => nodeId(`p${index}`))

const parseOrThrow = (text: string, ids: readonly NodeId[]): FountainParse => {
  const parsed = parseFountain(text, { freshIds: ids })
  if (!parsed.ok) {
    throw new Error(`parse failed: ${JSON.stringify(parsed.error)}\n---\n${text}`)
  }
  return parsed.value
}

const reparse = (text: string): FountainParse => parseOrThrow(text, idsFor(text))

const shape = (nodes: readonly ScreenplayNode[]): readonly unknown[] =>
  nodes.map((node) => ({
    id: node.id,
    type: node.type,
    content: node.content,
    modifiers: node.type === 'character' ? node.modifiers : [],
  }))

describe('parse(serialise(nodes)) preserves ids and types', () => {
  it('is an identity on every node list Fountain can express', () => {
    fc.assert(
      fc.property(fountainNodesArb, (nodes) => {
        const written = serialiseFountain(nodes)
        // The generator only produces writable lists, so a report here is a bug
        // in one of the two - and the message names it rather than failing on a
        // node comparison twenty lines later.
        expect(written.unrepresentable).toEqual([])
        const back = parseOrThrow(written.text, nodes.map((node) => node.id))
        expect(shape(back.nodes)).toEqual(shape(nodes))
      }),
      { numRuns: 400 },
    )
  })

  it('never invents a scene, and never strips anything from its own output', () => {
    fc.assert(
      fc.property(fountainNodesArb, (nodes) => {
        const back = reparse(serialiseFountain(nodes).text)
        expect(back.stripped).toEqual([])
        expect(back.rejoinedContinuations).toEqual([])
        expect(back.unsupported).toEqual([])
        // A node list holding `INTERCUT WITH THE CHAWL` as a Scene keeps it as
        // a Scene, because the serialiser forced it. Nothing is rejected.
        expect(back.rejectedHeadings).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})

describe('serialise(parse(text)) is stable under a second pass', () => {
  it('reaches a fixed point after one pass, for any text', () => {
    fc.assert(
      fc.property(fountainTextArb, (text) => {
        const once = serialiseFountain(reparse(text).nodes).text
        const twice = serialiseFountain(reparse(once).nodes).text
        expect(twice).toBe(once)
      }),
      { numRuns: 400 },
    )
  })

  it('the node list is identical on the second pass too', () => {
    fc.assert(
      fc.property(fountainTextArb, (text) => {
        const first = reparse(text).nodes
        const second = reparse(serialiseFountain(first).text).nodes
        expect(second.map((node) => node.type)).toEqual(first.map((node) => node.type))
        expect(second.map((node) => node.content)).toEqual(first.map((node) => node.content))
      }),
      { numRuns: 300 },
    )
  })
})

describe('import doubles nothing', () => {
  /**
   * The property the brief states as "FDX -> nodes -> FDX doubles nothing. Run
   * it twice - a second pass must be identical to the first."
   *
   * FDX *export* is explicitly out of scope, so there is no FDX -> FDX path to
   * run. Fountain is the interchange format that exists in both directions
   * today, so the same claim is made over it: whatever generated text came in,
   * writing the node stream back out and re-reading it strips nothing, because
   * there is nothing left to strip. Stated in the report as a substitution.
   */
  it('a second pass strips nothing, because the first pass left nothing', () => {
    fc.assert(
      fc.property(fountainTextArb, (text) => {
        const first = reparse(text)
        const second = reparse(serialiseFountain(first.nodes).text)
        expect(second.stripped).toEqual([])
        expect(second.rejoinedContinuations).toEqual([])
      }),
      { numRuns: 400 },
    )
  })

  it('no node ever carries a generated modifier or a generated line', () => {
    fc.assert(
      fc.property(fountainTextArb, (text) => {
        for (const node of reparse(text).nodes) {
          const rendered = node.content
            .map((run) => (run.kind === 'text' ? run.text : ''))
            .join('')
          expect(rendered).not.toMatch(/\(\s*MORE\s*\)/iu)
          expect(rendered).not.toMatch(/\(\s*CONT['’]?D\.?\s*\)/iu)
          if (node.type === 'character') {
            expect(node.modifiers.every((m) => m === 'V.O.' || m === 'O.S.' || m === 'O.C.')).toBe(
              true,
            )
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('a Comment node survives the round trip and affects nothing', () => {
  it('adding a comment at a block boundary moves no renderable node', () => {
    fc.assert(
      fc.property(fountainNodesArb, fc.nat(), (nodes, seed) => {
        // Block boundaries only: a note inside a speech is legal too, but this
        // property is about the metric in `stream.ts`, not about placement.
        const boundaries = nodes
          .map((node, index) => ({ node, index }))
          .filter(({ node }) => node.type === 'scene' || node.type === 'action')
          .map(({ index }) => index)
        const at = boundaries.length === 0 ? 0 : (boundaries[seed % boundaries.length] ?? 0)
        const comment: ScreenplayNode = {
          type: 'comment',
          id: nodeId('note'),
          provenance: { source: 'typed' },
          content: [{ kind: 'text', text: 'a note that changes nothing' }],
        }
        const withNote = [...nodes.slice(0, at), comment, ...nodes.slice(at)]

        const written = serialiseFountain(withNote)
        expect(written.unrepresentable).toEqual([])
        const back = parseOrThrow(written.text, withNote.map((node) => node.id))

        expect(shape(back.nodes)).toEqual(shape(withNote))
        expect(renderableOrder(back.nodes)).toEqual(renderableOrder(nodes))
        expect(renderableCount(back.nodes)).toBe(renderableCount(nodes))
        expect(commentCount(back.nodes)).toBe(commentCount(nodes) + 1)
      }),
      { numRuns: 300 },
    )
  })
})
