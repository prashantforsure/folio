import { describe, expect, it } from 'vitest'

import { DOCUMENT_KINDS, isDocumentKind } from './document'
import { edit } from './edit'
import { characterId, documentId, locationId, nodeId, runId } from './ids'
import { contentLength, mention, mentionTargets, normaliseContent, text } from './inline'
import type { InlineContent, ScreenplayNode } from './index'
import {
  SCREENPLAY_NODE_TYPES,
  isDeliveryModifier,
  isScreenplayNodeType,
  makeScreenplayNode,
  modifiersOf,
} from './node'
import { isOutlineNodeType } from './outline'
import {
  changeNodeType,
  deleteNodes,
  insertNodes,
  mergeNodes,
  pasteNodes,
  reorderNode,
  splitContent,
  splitNode,
} from './operations'
import { byAgent, isAgentAuthored, typed } from './provenance'
import { readOutlineDocument, readOutlineNode, readScreenplayDocument } from './read'
import { err, isErr, isOk, ok } from './result'
import { commentCount, isCommentNode, renderableNodes } from './stream'

/**
 * The exported surface that the property tests do not reach, and the error
 * paths behind it.
 *
 * AGENTS.md, Conventions > Errors: a malformed input "is *data*, not an
 * exception, and it must be representable in the return type". That is only
 * worth anything if the representations are exercised, so every
 * `OperationError` and the document-level `ModelDefect`s are asserted here.
 */

const action = (id: string, content: InlineContent = []): ScreenplayNode => ({
  type: 'action',
  id: nodeId(id),
  provenance: typed(),
  content,
})

describe('Result', () => {
  it('narrows both ways', () => {
    const good = ok(1)
    const bad = err('nope')
    expect(isOk(good)).toBe(true)
    expect(isErr(good)).toBe(false)
    expect(isOk(bad)).toBe(false)
    expect(isErr(bad)).toBe(true)
    if (isOk(good)) expect(good.value).toBe(1)
    if (isErr(bad)) expect(bad.error).toBe('nope')
  })
})

describe('ids are branded but not validated', () => {
  it('brands without imposing a shape, because the shape is not ruled on', () => {
    expect(nodeId('SCENE_a1')).toBe('SCENE_a1')
    expect(documentId('d')).toBe('d')
    expect(runId('r')).toBe('r')
    expect(characterId('c')).toBe('c')
    expect(locationId('l')).toBe('l')
  })
})

describe('provenance constructors', () => {
  it('builds both sources and tells them apart', () => {
    expect(typed()).toStrictEqual({ source: 'typed' })
    expect(byAgent(runId('run-1'))).toStrictEqual({ source: 'agent', runId: 'run-1' })
    expect(isAgentAuthored(typed())).toBe(false)
    expect(isAgentAuthored(byAgent(runId('run-1')))).toBe(true)
  })
})

describe('inline content', () => {
  it('builds runs and reports mention edges', () => {
    const content = [text('MEERA meets '), mention({ entity: 'character', id: characterId('c1') })]
    expect(mentionTargets(content)).toStrictEqual([{ entity: 'character', id: 'c1' }])
    expect(mentionTargets([text('no edges here')])).toStrictEqual([])
  })

  it('counts a mention as one anchor unit', () => {
    expect(contentLength([])).toBe(0)
    expect(contentLength([text('abc')])).toBe(3)
    expect(contentLength([text('ab'), mention({ entity: 'location', id: locationId('l1') })])).toBe(3)
  })

  it('joins adjacent text runs and drops empty ones', () => {
    const m = mention({ entity: 'location', id: locationId('l1') })
    expect(normaliseContent([text('ab'), text(''), text('cd')])).toStrictEqual([
      { kind: 'text', text: 'abcd' },
    ])
    expect(normaliseContent([text('a'), m, text('b')])).toStrictEqual([
      { kind: 'text', text: 'a' },
      m,
      { kind: 'text', text: 'b' },
    ])
    expect(normaliseContent([text('')])).toStrictEqual([])
  })
})

describe('type guards', () => {
  it('accept only their own closed set', () => {
    expect(isScreenplayNodeType('dialogue')).toBe(true)
    expect(isScreenplayNodeType('h2')).toBe(false)
    expect(isOutlineNodeType('h2')).toBe(true)
    expect(isOutlineNodeType('dialogue')).toBe(false)
    expect(isDeliveryModifier('V.O.')).toBe(true)
    expect(isDeliveryModifier("CONT'D")).toBe(false)
    expect(isDocumentKind('outline')).toBe(true)
    expect(isDocumentKind('screenplay')).toBe(true)
    expect(isDocumentKind('storyboard')).toBe(false)
    expect(DOCUMENT_KINDS).toStrictEqual(['screenplay', 'outline'])
  })

  it('are not fooled by inherited properties', () => {
    expect(isScreenplayNodeType('toString')).toBe(false)
    expect(isScreenplayNodeType('constructor')).toBe(false)
    expect(isOutlineNodeType('hasOwnProperty')).toBe(false)
  })
})

describe('makeScreenplayNode', () => {
  it('builds each of the eight, and only a cue carries modifiers', () => {
    for (const type of SCREENPLAY_NODE_TYPES) {
      const node = makeScreenplayNode(type, {
        id: nodeId('n'),
        provenance: typed(),
        content: [text('x')],
        modifiers: ['V.O.'],
      })
      expect(node.type).toBe(type)
      expect(modifiersOf(node)).toStrictEqual(type === 'character' ? ['V.O.'] : [])
    }
  })
})

describe('stream helpers', () => {
  it('counts and filters comments', () => {
    const nodes: readonly ScreenplayNode[] = [
      action('a'),
      { type: 'comment', id: nodeId('c'), provenance: typed(), content: [] },
      action('b'),
    ]
    expect(commentCount(nodes)).toBe(1)
    expect(renderableNodes(nodes).map((n) => n.id)).toStrictEqual(['a', 'b'])
    expect(nodes.filter(isCommentNode).map((n) => n.id)).toStrictEqual(['c'])
  })
})

describe('edit()', () => {
  it('defaults to no identity change and nothing dropped', () => {
    expect(edit([])).toStrictEqual({ nodes: [], identity: [], dropped: [] })
  })
})

describe('splitContent refuses impossible points as data', () => {
  const content = [text('abc'), mention({ entity: 'character', id: characterId('c1') })]

  it('splits inside a text run', () => {
    const result = splitContent(content, { run: 0, offset: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.head).toStrictEqual([{ kind: 'text', text: 'ab' }])
    expect(result.value.atOffset).toBe(2)
  })

  it('splits either side of a mention but never inside it', () => {
    const before = splitContent(content, { run: 1, offset: 0 })
    expect(before.ok).toBe(true)
    if (before.ok) expect(before.value.atOffset).toBe(3)

    const after = splitContent(content, { run: 1, offset: 1 })
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.value.tail).toStrictEqual([])

    const inside = splitContent(content, { run: 1, offset: 2 })
    expect(inside.ok).toBe(false)
    if (!inside.ok) expect(inside.error.kind).toBe('point-inside-mention')
  })

  it('refuses a negative run, a run past the end, and an offset past the text', () => {
    for (const point of [
      { run: -1, offset: 0 },
      { run: 9, offset: 0 },
      { run: 2, offset: 1 },
      { run: 0, offset: 99 },
      { run: 0, offset: -1 },
    ]) {
      const result = splitContent(content, point)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('point-out-of-range')
    }
  })

  it('splits at the very end without producing a tail', () => {
    const result = splitContent(content, { run: 2, offset: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tail).toStrictEqual([])
    expect(result.value.atOffset).toBe(4)
  })
})

describe('operations refuse impossible inputs as data, never by throwing', () => {
  const nodes = [action('a'), action('b'), action('c')]

  it('splitNode: unknown node', () => {
    const result = splitNode(nodes, nodeId('zz'), { run: 0, offset: 0 }, nodeId('new'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toStrictEqual({ kind: 'node-not-found', id: 'zz' })
  })

  it('mergeNodes: unknown first and unknown second', () => {
    const first = mergeNodes(nodes, nodeId('zz'), nodeId('b'))
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.error).toStrictEqual({ kind: 'node-not-found', id: 'zz' })

    const second = mergeNodes(nodes, nodeId('a'), nodeId('zz'))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toStrictEqual({ kind: 'node-not-found', id: 'zz' })
  })

  it('mergeNodes: backwards is not adjacent', () => {
    const result = mergeNodes(nodes, nodeId('b'), nodeId('a'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('nodes-not-adjacent')
  })

  it('insertNodes: index out of range, and a duplicate inside the incoming batch', () => {
    const low = insertNodes(nodes, -1, [])
    expect(low.ok).toBe(false)
    if (!low.ok) expect(low.error).toStrictEqual({ kind: 'index-out-of-range', index: -1, length: 3 })

    const high = insertNodes(nodes, 4, [])
    expect(high.ok).toBe(false)
    if (!high.ok) expect(high.error.kind).toBe('index-out-of-range')

    const twice = insertNodes(nodes, 0, [action('x'), action('x')])
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.error).toStrictEqual({ kind: 'id-already-present', id: 'x' })
  })

  it('deleteNodes: removes several at once and keeps order', () => {
    const result = deleteNodes(nodes, [nodeId('a'), nodeId('c')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.nodes.map((n) => n.id)).toStrictEqual(['b'])
    expect(result.value.identity).toHaveLength(2)
  })

  it('reorderNode: both indices are range-checked', () => {
    const from = reorderNode(nodes, 5, 0)
    expect(from.ok).toBe(false)
    if (!from.ok) expect(from.error).toStrictEqual({ kind: 'index-out-of-range', index: 5, length: 3 })

    const to = reorderNode(nodes, 0, 5)
    expect(to.ok).toBe(false)
    if (!to.ok) expect(to.error).toStrictEqual({ kind: 'index-out-of-range', index: 5, length: 3 })
  })

  it('changeNodeType: unknown node, and a bare cue when coming from another type', () => {
    const missing = changeNodeType(nodes, nodeId('zz'), 'action')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.kind).toBe('node-not-found')

    const toCue = changeNodeType(nodes, nodeId('a'), 'character')
    expect(toCue.ok).toBe(true)
    if (!toCue.ok) return
    expect(modifiersOf(toCue.value.nodes[0] ?? action('x'))).toStrictEqual([])
    expect(toCue.value.dropped).toStrictEqual([])
  })

  it('pasteNodes: index out of range', () => {
    const document = { kind: 'screenplay' as const, id: documentId('d'), nodes }
    const result = pasteNodes(document, { origin: documentId('d'), nodes: [] }, 9, [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toStrictEqual({ kind: 'index-out-of-range', index: 9, length: 3 })
  })
})

describe('document readers refuse malformed input as data', () => {
  it('rejects a non-object and a missing or wrong-typed field', () => {
    for (const input of [null, 42, 'x', []]) {
      expect(readScreenplayDocument(input).ok).toBe(false)
    }
    expect(readScreenplayDocument({ id: 'd', nodes: [] }).ok).toBe(false)
    expect(readScreenplayDocument({ kind: 7, id: 'd', nodes: [] }).ok).toBe(false)
    expect(readScreenplayDocument({ kind: 'screenplay', id: 'd' }).ok).toBe(false)
  })

  it('rejects a nodes field that is not an array', () => {
    const result = readScreenplayDocument({ kind: 'screenplay', id: 'd', nodes: {} })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toStrictEqual({ at: 'nodes', reason: { kind: 'not-an-array', received: 'object' } })
  })

  it('rejects a stray field on the document itself', () => {
    const result = readScreenplayDocument({ kind: 'screenplay', id: 'd', nodes: [], draft: 5 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toStrictEqual({ kind: 'unexpected-field', field: 'draft' })
  })

  it('will not read a screenplay as an outline', () => {
    const result = readOutlineDocument({ kind: 'screenplay', id: 'd', nodes: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.at).toBe('kind')
  })

  it('reads a rule block, which carries no content', () => {
    const result = readOutlineNode({ type: 'rule', id: 'r', provenance: { source: 'typed' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toStrictEqual({ type: 'rule', id: 'r', provenance: { source: 'typed' } })
    // ...and refuses one that tries to.
    expect(
      readOutlineNode({ type: 'rule', id: 'r', provenance: { source: 'typed' }, content: [] }).ok,
    ).toBe(false)
  })

  it('reads an outline document end to end', () => {
    const result = readOutlineDocument({
      kind: 'outline',
      id: 'd',
      nodes: [
        { type: 'h1', id: 'h', provenance: { source: 'typed' }, content: [] },
        { type: 'rule', id: 'r', provenance: { source: 'agent', runId: 'run-1' } },
        { type: 'beat', id: 'b', provenance: { source: 'typed' }, content: [] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.nodes.map((n) => n.type)).toStrictEqual(['h1', 'rule', 'beat'])
    // A beat carries no number: its ordinal is computed at render.
    expect(result.value.nodes.every((n) => !Object.hasOwn(n, 'number'))).toBe(true)
  })

  it('refuses a duplicate id in an outline document too', () => {
    const block = (id: string): unknown => ({
      type: 'body',
      id,
      provenance: { source: 'typed' },
      content: [],
    })
    const result = readOutlineDocument({
      kind: 'outline',
      id: 'd',
      nodes: [block('x'), block('x')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toStrictEqual({ kind: 'duplicate-node-id', id: 'x' })
  })
})
