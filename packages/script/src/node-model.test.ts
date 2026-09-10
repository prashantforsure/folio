import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { mentionTargets } from './inline'
import { readScreenplayDocument, readScreenplayNode } from './read'
import {
  commentCount,
  isCommentNode,
  renderableCount,
  renderableNodes,
  renderableOrder,
} from './stream'
import {
  commentNodeArb,
  nonCommentNodesArb,
  outlineNodeArb,
  screenplayDocumentArb,
  screenplayNodeArb,
  screenplayNodesArb,
} from './testing/arbitraries'

/**
 * Deep-freeze a value so a mutation throws rather than silently succeeding.
 * Module code is strict mode, so writing to a frozen object is a TypeError.
 */
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

/**
 * Call `fn` and prove it did not touch its arguments.
 *
 * Two independent checks, because each catches what the other misses: the
 * freeze catches a mutation that happens to restore the same JSON, and the
 * snapshot catches a mutation of something the freeze could not reach.
 */
const callPurely = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
  ...args: Args
): R => {
  const before = JSON.stringify(args)
  deepFreeze(args)
  const result = fn(...args)
  expect(JSON.stringify(args)).toBe(before)
  return result
}

describe('comment nodes are invisible to every metric but the node list', () => {
  it('inserting a comment at any position moves no length, count or ordering metric', () => {
    fc.assert(
      fc.property(nonCommentNodesArb, commentNodeArb, fc.nat(), (nodes, comment, offset) => {
        const index = offset % (nodes.length + 1)
        const withComment = [...nodes.slice(0, index), comment, ...nodes.slice(index)]

        expect(renderableNodes(withComment)).toStrictEqual(renderableNodes(nodes))
        expect(renderableCount(withComment)).toBe(renderableCount(nodes))
        expect(renderableOrder(withComment)).toStrictEqual(renderableOrder(nodes))

        // The one thing that does see it: the node list itself.
        expect(withComment.length).toBe(nodes.length + 1)
        expect(commentCount(withComment)).toBe(commentCount(nodes) + 1)
      }),
    )
  })

  it('inserting any number of comments anywhere is still invisible', () => {
    fc.assert(
      fc.property(
        nonCommentNodesArb,
        fc.array(fc.tuple(commentNodeArb, fc.nat()), { maxLength: 5 }),
        (nodes, insertions) => {
          const withComments = insertions.reduce<readonly (typeof nodes)[number][]>(
            (current, [comment, offset]) => {
              const index = offset % (current.length + 1)
              return [...current.slice(0, index), comment, ...current.slice(index)]
            },
            nodes,
          )

          expect(renderableNodes(withComments)).toStrictEqual(renderableNodes(nodes))
          expect(renderableCount(withComments)).toBe(nodes.length)
          expect(renderableOrder(withComments)).toStrictEqual(renderableOrder(nodes))
        },
      ),
    )
  })

  it('no comment ever reaches the renderable stream', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        expect(renderableNodes(nodes).some(isCommentNode)).toBe(false)
      }),
    )
  })

  it('dropping comments is idempotent', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        const once = renderableNodes(nodes)
        expect(renderableNodes(once)).toStrictEqual(once)
      }),
    )
  })
})

describe('every function that takes a node list leaves it unchanged', () => {
  /**
   * The model surface. The seven operations get the same treatment in
   * `identity.test.ts`, through the same harness.
   */
  it('holds for the model surface', () => {
    fc.assert(
      fc.property(screenplayNodesArb, screenplayDocumentArb, (nodes, document) => {
        callPurely(renderableNodes, nodes)
        callPurely(renderableCount, nodes)
        callPurely(renderableOrder, nodes)
        callPurely(commentCount, nodes)
        callPurely(readScreenplayDocument, document)
        for (const node of nodes) {
          callPurely(readScreenplayNode, node)
          callPurely(mentionTargets, node.content)
        }
      }),
    )
  })

  it('returns a new list rather than the input list', () => {
    fc.assert(
      fc.property(nonCommentNodesArb, (nodes) => {
        // Same members, different array: nothing downstream can alias the input.
        expect(renderableNodes(nodes)).not.toBe(nodes)
      }),
    )
  })
})

describe('the outline is a second kind, not a widened screenplay', () => {
  it('no outline block is readable as a screenplay node', () => {
    fc.assert(
      fc.property(outlineNodeArb, (node) => {
        expect(readScreenplayNode(node).ok).toBe(false)
      }),
    )
  })

  it('a rule block carries no content field at all', () => {
    fc.assert(
      fc.property(outlineNodeArb, (node) => {
        if (node.type !== 'rule') return
        expect(Object.prototype.hasOwnProperty.call(node, 'content')).toBe(false)
      }),
    )
  })
})

describe('mentions are structural, not text', () => {
  it('every mention run appears as an edge, in document order', () => {
    fc.assert(
      fc.property(screenplayNodeArb, (node) => {
        const edges = mentionTargets(node.content)
        const runs = node.content.filter((run) => run.kind === 'mention')
        expect(edges.length).toBe(runs.length)
        expect(edges).toStrictEqual(runs.map((run) => run.target))
      }),
    )
  })
})
