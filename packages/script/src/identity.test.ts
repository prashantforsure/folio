import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { Edit } from './edit'
import type { NodeId } from './ids'
import { documentId, nodeId } from './ids'
import { contentLength, normaliseContent } from './inline'
import type { ScreenplayNode } from './node'
import { SCREENPLAY_NODE_TYPES } from './node'
import {
  changeNodeType,
  deleteNodes,
  insertNodes,
  mergeNodes,
  pasteNodes,
  reorderNode,
  splitNode,
} from './operations'
import type { Result } from './result'
import {
  contentArb,
  screenplayDocumentArb,
  screenplayNodeArb,
  screenplayNodesArb,
} from './testing/arbitraries'

/**
 * Node identity under split, merge, reorder and paste.
 *
 * AGENTS.md, Development philosophy 8 puts node identity in the short list of
 * places where correctness is load-bearing, and Feature workflow step 5 asks
 * for exactly this: "Property-test node identity under paste, split, merge and
 * reorder." The behaviour being asserted is the ruling in
 * `docs/adr/0001-node-identity.md`.
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

/** Same harness as node-model.test.ts: freeze the input, snapshot it, compare. */
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

const idsOf = (nodes: readonly ScreenplayNode[]): readonly NodeId[] => nodes.map((n) => n.id)

const unwrap = (result: Result<Edit, unknown>): Edit => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('unreachable: guarded by the expect above')
  return result.value
}

/** An id no generated node will collide with. */
const fresh = (n: number): NodeId => nodeId(`fresh-${String(n)}`)

const nonEmptyNodesArb = screenplayNodesArb.filter((nodes) => nodes.length > 0)

describe('split: the head keeps the id, the tail is new', () => {
  it('the head keeps the id and the tail takes the supplied one', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), fc.nat(), (nodes, pick, offset) => {
        const target = nodes[pick % nodes.length]
        if (target === undefined) return
        const run = target.content.length === 0 ? 0 : offset % (target.content.length + 1)
        const result = splitNode(nodes, target.id, { run, offset: 0 }, fresh(1))
        if (!result.ok) return
        const { nodes: after } = result.value

        const index = after.findIndex((n) => n.id === target.id)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(after[index + 1]?.id).toBe(fresh(1))
        expect(after.length).toBe(nodes.length + 1)
      }),
    )
  })

  it('every id that was there before is still there, and none is lost', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), (nodes, pick) => {
        const target = nodes[pick % nodes.length]
        if (target === undefined) return
        const result = splitNode(nodes, target.id, { run: 0, offset: 0 }, fresh(1))
        if (!result.ok) return
        for (const id of idsOf(nodes)) {
          expect(idsOf(result.value.nodes)).toContain(id)
        }
      }),
    )
  })

  it('reports where the split happened so anchors past it can be re-pointed', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), (nodes, pick) => {
        const target = nodes[pick % nodes.length]
        if (target === undefined) return
        const result = splitNode(nodes, target.id, { run: target.content.length, offset: 0 }, fresh(1))
        if (!result.ok) return
        const event = result.value.identity.find((e) => e.kind === 'split')
        expect(event).toBeDefined()
        if (event === undefined || event.kind !== 'split') return
        expect(event.from).toBe(target.id)
        expect(event.to).toBe(fresh(1))
        // Split at the very end: every anchor in the node stays where it is.
        expect(event.atOffset).toBe(contentLength(target.content))
      }),
    )
  })

  it('the split point never lands inside a mention', () => {
    fc.assert(
      fc.property(screenplayNodeArb, fc.nat(), (node, offset) => {
        const result = splitNode([node], node.id, { run: 0, offset: (offset % 4) + 2 }, fresh(1))
        const run = node.content[0]
        if (run !== undefined && run.kind === 'mention') {
          expect(result.ok).toBe(false)
          if (result.ok) return
          expect(result.error.kind).toBe('point-inside-mention')
        }
      }),
    )
  })

  it('refuses a tail id that is already in the document', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, (nodes) => {
        const first = nodes[0]
        if (first === undefined) return
        const result = splitNode(nodes, first.id, { run: 0, offset: 0 }, first.id)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error).toStrictEqual({ kind: 'id-already-present', id: first.id })
      }),
    )
  })
})

describe('merge: the first id wins, the second is tombstoned', () => {
  it('keeps exactly one of the two ids', () => {
    fc.assert(
      fc.property(screenplayNodesArb.filter((n) => n.length >= 2), fc.nat(), (nodes, pick) => {
        const at = pick % (nodes.length - 1)
        const a = nodes[at]
        const b = nodes[at + 1]
        if (a === undefined || b === undefined) return
        const { nodes: after, identity } = unwrap(mergeNodes(nodes, a.id, b.id))

        expect(idsOf(after)).toContain(a.id)
        expect(idsOf(after)).not.toContain(b.id)
        expect(after.length).toBe(nodes.length - 1)
        expect(identity).toContainEqual({ kind: 'retired', id: b.id })
      }),
    )
  })

  it('reports the offset every anchor on the retired node must shift by', () => {
    fc.assert(
      fc.property(screenplayNodesArb.filter((n) => n.length >= 2), (nodes) => {
        const a = nodes[0]
        const b = nodes[1]
        if (a === undefined || b === undefined) return
        const { identity } = unwrap(mergeNodes(nodes, a.id, b.id))
        const event = identity.find((e) => e.kind === 'merged')
        expect(event).toBeDefined()
        if (event === undefined || event.kind !== 'merged') return
        expect(event.into).toBe(a.id)
        expect(event.from).toBe(b.id)
        expect(event.offsetShift).toBe(contentLength(a.content))
      }),
    )
  })

  it('refuses to merge nodes that are not adjacent', () => {
    fc.assert(
      fc.property(screenplayNodesArb.filter((n) => n.length >= 3), (nodes) => {
        const a = nodes[0]
        const c = nodes[2]
        if (a === undefined || c === undefined) return
        const result = mergeNodes(nodes, a.id, c.id)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.kind).toBe('nodes-not-adjacent')
      }),
    )
  })

  it('reports delivery modifiers it could not carry across', () => {
    const cue: ScreenplayNode = {
      type: 'character',
      id: nodeId('b'),
      provenance: { source: 'typed' },
      content: [{ kind: 'text', text: 'MEERA' }],
      modifiers: ['V.O.'],
    }
    const action: ScreenplayNode = {
      type: 'action',
      id: nodeId('a'),
      provenance: { source: 'typed' },
      content: [{ kind: 'text', text: 'Rain.' }],
    }
    const { dropped } = unwrap(mergeNodes([action, cue], action.id, cue.id))
    expect(dropped).toStrictEqual([
      { from: nodeId('b'), attribute: 'modifiers', value: ['V.O.'] },
    ])
  })
})

describe('split then merge is the identity', () => {
  it('restores the original id and content', () => {
    fc.assert(
      fc.property(screenplayNodeArb, fc.nat(), (node, offset) => {
        const run = node.content.length === 0 ? 0 : offset % (node.content.length + 1)
        const split = splitNode([node], node.id, { run, offset: 0 }, fresh(1))
        if (!split.ok) return
        const [head, tail] = split.value.nodes
        if (head === undefined || tail === undefined) return

        const merged = unwrap(mergeNodes(split.value.nodes, head.id, tail.id))
        expect(merged.nodes).toHaveLength(1)
        expect(merged.nodes[0]?.id).toBe(node.id)
        expect(merged.nodes[0]?.content).toStrictEqual(normaliseContent(node.content))
        expect(merged.nodes[0]?.type).toBe(node.type)
      }),
    )
  })
})

describe('reorder: every id survives, nothing is created or retired', () => {
  it('preserves the exact set of ids', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), fc.nat(), (nodes, from, to) => {
        const { nodes: after, identity } = unwrap(
          reorderNode(nodes, from % nodes.length, to % nodes.length),
        )
        expect([...idsOf(after)].sort()).toStrictEqual([...idsOf(nodes)].sort())
        expect(after.length).toBe(nodes.length)
        expect(identity).toStrictEqual([])
      }),
    )
  })

  it('moves the node it was asked to move', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), fc.nat(), (nodes, from, to) => {
        const f = from % nodes.length
        const t = to % nodes.length
        const moving = nodes[f]
        if (moving === undefined) return
        const { nodes: after } = unwrap(reorderNode(nodes, f, t))
        expect(after[t]?.id).toBe(moving.id)
      }),
    )
  })
})

describe('type change: the id survives, lost attributes are reported', () => {
  it('keeps the id and the position', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), fc.nat(), (nodes, pick, typePick) => {
        const index = pick % nodes.length
        const target = nodes[index]
        const type = SCREENPLAY_NODE_TYPES[typePick % SCREENPLAY_NODE_TYPES.length]
        if (target === undefined || type === undefined) return
        const { nodes: after } = unwrap(changeNodeType(nodes, target.id, type))
        expect(after[index]?.id).toBe(target.id)
        expect(after[index]?.type).toBe(type)
        expect([...idsOf(after)]).toStrictEqual([...idsOf(nodes)])
      }),
    )
  })

  it('reports the modifiers a cue loses on the way out', () => {
    fc.assert(
      fc.property(contentArb, (content) => {
        const cue: ScreenplayNode = {
          type: 'character',
          id: nodeId('c'),
          provenance: { source: 'typed' },
          content,
          modifiers: ['O.S.'],
        }
        const { dropped } = unwrap(changeNodeType([cue], cue.id, 'action'))
        expect(dropped).toStrictEqual([
          { from: nodeId('c'), attribute: 'modifiers', value: ['O.S.'] },
        ])
      }),
    )
  })
})

describe('paste: preserved within a document, minted across one', () => {
  it('cut and paste in the same document brings the ids back', () => {
    fc.assert(
      fc.property(screenplayDocumentArb.filter((d) => d.nodes.length > 0), (document) => {
        const cutting = document.nodes.slice(0, 1)
        const first = cutting[0]
        if (first === undefined) return

        const afterCut = unwrap(deleteNodes(document.nodes, [first.id]))
        expect(afterCut.identity).toStrictEqual([{ kind: 'retired', id: first.id }])

        const pasted = unwrap(
          pasteNodes(
            { ...document, nodes: afterCut.nodes },
            { origin: document.id, nodes: cutting },
            0,
            [fresh(1)],
          ),
        )
        // The id came back, so every comment on it follows the text.
        expect(pasted.nodes[0]?.id).toBe(first.id)
        expect(pasted.identity).toStrictEqual([{ kind: 'restored', id: first.id }])
      }),
    )
  })

  it('copy and paste in the same document mints, because the id is still present', () => {
    fc.assert(
      fc.property(screenplayDocumentArb.filter((d) => d.nodes.length > 0), (document) => {
        const copying = document.nodes.slice(0, 1)
        const first = copying[0]
        if (first === undefined) return
        const pasted = unwrap(
          pasteNodes(document, { origin: document.id, nodes: copying }, 0, [fresh(1)]),
        )
        expect(pasted.nodes[0]?.id).toBe(fresh(1))
        expect(pasted.identity).toStrictEqual([{ kind: 'created', id: fresh(1) }])
        // The join key never repeats.
        expect(new Set(idsOf(pasted.nodes)).size).toBe(pasted.nodes.length)
      }),
    )
  })

  it('a paste from another document always mints', () => {
    fc.assert(
      fc.property(screenplayDocumentArb, screenplayNodesArb, (document, incoming) => {
        const ids = incoming.map((_, i) => fresh(i))
        const pasted = unwrap(
          pasteNodes(document, { origin: documentId('another-document'), nodes: incoming }, 0, ids),
        )
        for (const node of incoming) {
          expect(idsOf(pasted.nodes.slice(0, incoming.length))).not.toContain(node.id)
        }
        expect(pasted.identity.every((e) => e.kind === 'created')).toBe(true)
      }),
    )
  })

  it('never produces a duplicate id, whatever the origin', () => {
    fc.assert(
      fc.property(
        screenplayDocumentArb,
        screenplayNodesArb,
        fc.boolean(),
        (document, incoming, sameOrigin) => {
          const ids = incoming.map((_, i) => fresh(i))
          const result = pasteNodes(
            document,
            { origin: sameOrigin ? document.id : documentId('elsewhere'), nodes: incoming },
            0,
            ids,
          )
          if (!result.ok) return
          expect(new Set(idsOf(result.value.nodes)).size).toBe(result.value.nodes.length)
        },
      ),
    )
  })

  it('refuses to run without enough ids to mint from', () => {
    fc.assert(
      fc.property(screenplayDocumentArb, screenplayNodesArb.filter((n) => n.length > 0), (document, incoming) => {
        const result = pasteNodes(document, { origin: documentId('elsewhere'), nodes: incoming }, 0, [])
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.kind).toBe('not-enough-ids')
      }),
    )
  })
})

describe('delete: ids are tombstoned', () => {
  it('retires exactly the ids it removed', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, fc.nat(), (nodes, pick) => {
        const target = nodes[pick % nodes.length]
        if (target === undefined) return
        const { nodes: after, identity } = unwrap(deleteNodes(nodes, [target.id]))
        expect(idsOf(after)).not.toContain(target.id)
        expect(identity).toStrictEqual([{ kind: 'retired', id: target.id }])
      }),
    )
  })

  it('refuses an id that is not there rather than silently doing nothing', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        const result = deleteNodes(nodes, [fresh(99)])
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error).toStrictEqual({ kind: 'node-not-found', id: fresh(99) })
      }),
    )
  })
})

describe('insert: fresh ids only', () => {
  it('creates every incoming id and keeps the rest', () => {
    fc.assert(
      fc.property(screenplayNodesArb, screenplayNodeArb, fc.nat(), (nodes, incoming, at) => {
        const node: ScreenplayNode = { ...incoming, id: fresh(1) }
        const index = at % (nodes.length + 1)
        const { nodes: after, identity } = unwrap(insertNodes(nodes, index, [node]))
        expect(after[index]?.id).toBe(fresh(1))
        expect(after.length).toBe(nodes.length + 1)
        expect(identity).toStrictEqual([{ kind: 'created', id: fresh(1) }])
      }),
    )
  })

  it('refuses to reintroduce an id that is already present', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, (nodes) => {
        const first = nodes[0]
        if (first === undefined) return
        const result = insertNodes(nodes, 0, [first])
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error).toStrictEqual({ kind: 'id-already-present', id: first.id })
      }),
    )
  })
})

describe('every operation is pure', () => {
  it('leaves the input node list byte-identical', () => {
    fc.assert(
      fc.property(
        screenplayDocumentArb.filter((d) => d.nodes.length >= 2),
        fc.nat(),
        (document, pick) => {
          const nodes = document.nodes
          const at = pick % (nodes.length - 1)
          const a = nodes[at]
          const b = nodes[at + 1]
          if (a === undefined || b === undefined) return

          callPurely(splitNode, nodes, a.id, { run: 0, offset: 0 }, fresh(1))
          callPurely(mergeNodes, nodes, a.id, b.id)
          callPurely(insertNodes, nodes, 0, [])
          callPurely(deleteNodes, nodes, [a.id])
          callPurely(reorderNode, nodes, at, 0)
          callPurely(changeNodeType, nodes, a.id, 'action')
          callPurely(pasteNodes, document, { origin: document.id, nodes: [] }, 0, [])
        },
      ),
    )
  })

  it('never returns the input array itself', () => {
    fc.assert(
      fc.property(nonEmptyNodesArb, (nodes) => {
        const result = reorderNode(nodes, 0, 0)
        if (!result.ok) return
        expect(result.value.nodes).not.toBe(nodes)
      }),
    )
  })
})
