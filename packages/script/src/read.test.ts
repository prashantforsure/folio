import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { PAGINATION_FIELDS, SCREENPLAY_NODE_TYPES } from './node'
import { OUTLINE_NODE_TYPES } from './outline'
import {
  readOutlineDocument,
  readOutlineNode,
  readScreenplayDocument,
  readScreenplayNode,
} from './read'
import {
  foreignTypeNameArb,
  notANodeArb,
  outlineDocumentArb,
  outlineNodeArb,
  paginationFieldArb,
  screenplayDocumentArb,
  screenplayNodeArb,
} from './testing/arbitraries'

const NODE_FIELDS: readonly string[] = ['type', 'id', 'provenance', 'content', 'modifiers']

const strayFieldArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter(
    (field) =>
      !NODE_FIELDS.includes(field) && !(PAGINATION_FIELDS as readonly string[]).includes(field),
  )

describe('the union rejects everything outside the eight types', () => {
  it('rejects arbitrary values', () => {
    fc.assert(
      fc.property(notANodeArb, (value) => {
        expect(readScreenplayNode(value).ok).toBe(false)
      }),
      { numRuns: 500 },
    )
  })

  it('rejects a well-formed node whose type is any other name', () => {
    fc.assert(
      fc.property(screenplayNodeArb, foreignTypeNameArb, (node, type) => {
        const result = readScreenplayNode({ ...node, type })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.at).toBe('type')
        expect(result.error.reason.kind).toBe('unknown-value')
      }),
    )
  })

  it('accepts every node the model can produce, and returns it unchanged', () => {
    fc.assert(
      fc.property(screenplayNodeArb, (node) => {
        const result = readScreenplayNode(node)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value).toStrictEqual(node)
      }),
    )
  })

  it('rejects an outline block, and the outline reader rejects a screenplay node', () => {
    fc.assert(
      fc.property(outlineNodeArb, (node) => {
        expect(readScreenplayNode(node).ok).toBe(false)
      }),
    )
    fc.assert(
      fc.property(screenplayNodeArb, (node) => {
        expect(readOutlineNode(node).ok).toBe(false)
      }),
    )
  })

  it('names the eight types it will accept when it rejects one', () => {
    const result = readScreenplayNode({ type: 'h2', id: 'a', provenance: { source: 'typed' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toStrictEqual({
      kind: 'unknown-value',
      received: 'h2',
      allowed: SCREENPLAY_NODE_TYPES,
    })
    expect(SCREENPLAY_NODE_TYPES).toStrictEqual([
      'scene',
      'action',
      'character',
      'paren',
      'dialogue',
      'transition',
      'comment',
      'subtitle',
    ])
    expect(OUTLINE_NODE_TYPES).toStrictEqual(['body', 'h1', 'h2', 'h3', 'quote', 'rule', 'beat'])
  })

  it('rejects a stray field rather than ignoring it', () => {
    fc.assert(
      fc.property(screenplayNodeArb, strayFieldArb, (node, field) => {
        const result = readScreenplayNode({ ...node, [field]: 'anything' })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.reason).toStrictEqual({ kind: 'unexpected-field', field })
      }),
    )
  })
})

describe('a page number cannot reach a node, at runtime either', () => {
  it('rejects any node carrying any pagination field', () => {
    fc.assert(
      fc.property(screenplayNodeArb, paginationFieldArb, fc.integer(), (node, field, value) => {
        const result = readScreenplayNode({ ...node, [field]: value })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.reason).toStrictEqual({ kind: 'pagination-on-node', field })
      }),
    )
  })

  it('reports the page ahead of any other stray field', () => {
    const result = readScreenplayNode({
      type: 'action',
      id: 'a',
      provenance: { source: 'typed' },
      content: [],
      aardvark: 1,
      page: 3,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toStrictEqual({ kind: 'pagination-on-node', field: 'page' })
  })
})

describe('generated text has no representation', () => {
  const cue = (modifiers: readonly string[]): unknown => ({
    type: 'character',
    id: 'c1',
    provenance: { source: 'typed' },
    content: [{ kind: 'text', text: 'MEERA' }],
    modifiers,
  })

  it('stores the authored delivery modifiers', () => {
    const result = readScreenplayNode(cue(['V.O.']))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe('character')
  })

  it('refuses a continued marker as a modifier', () => {
    const result = readScreenplayNode(cue(["CONT'D"]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.at).toBe('modifiers[0]')
    expect(result.error.reason).toStrictEqual({
      kind: 'unknown-value',
      received: "CONT'D",
      allowed: ['V.O.', 'O.S.', 'O.C.'],
    })
  })

  it('refuses a MORE marker as a modifier', () => {
    expect(readScreenplayNode(cue(['MORE'])).ok).toBe(false)
  })
})

describe('ids', () => {
  it('refuses an empty id', () => {
    const result = readScreenplayNode({
      type: 'action',
      id: '',
      provenance: { source: 'typed' },
      content: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toStrictEqual({ kind: 'empty-id' })
  })

  it('accepts any non-empty id shape, because the format is not ruled on', () => {
    for (const id of ['SCENE_a1', 'scene_a1', 'ep_001', '018f-3c2a-7b11', 'x']) {
      const result = readScreenplayNode({
        type: 'scene',
        id,
        provenance: { source: 'typed' },
        content: [],
      })
      expect(result.ok).toBe(true)
    }
  })

  it('refuses two nodes with the same id in one document', () => {
    const node = (id: string): unknown => ({
      type: 'action',
      id,
      provenance: { source: 'typed' },
      content: [],
    })
    const result = readScreenplayDocument({
      kind: 'screenplay',
      id: 'd1',
      nodes: [node('a'), node('b'), node('a')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toStrictEqual({
      at: 'nodes[2].id',
      reason: { kind: 'duplicate-node-id', id: 'a' },
    })
  })
})

describe('provenance', () => {
  it('refuses an agent node with no run', () => {
    const result = readScreenplayNode({
      type: 'action',
      id: 'a',
      provenance: { source: 'agent' },
      content: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toStrictEqual({
      at: 'provenance',
      reason: { kind: 'missing-field', field: 'runId' },
    })
  })

  it('refuses a third source', () => {
    const result = readScreenplayNode({
      type: 'action',
      id: 'a',
      provenance: { source: 'imported' },
      content: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.at).toBe('provenance.source')
  })
})

describe('documents', () => {
  it('round-trips a screenplay document unchanged', () => {
    fc.assert(
      fc.property(screenplayDocumentArb, (document) => {
        const result = readScreenplayDocument(document)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value).toStrictEqual(document)
      }),
    )
  })

  it('round-trips an outline document unchanged', () => {
    fc.assert(
      fc.property(outlineDocumentArb, (document) => {
        const result = readOutlineDocument(document)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value).toStrictEqual(document)
      }),
    )
  })

  it('will not read an outline document as a screenplay', () => {
    fc.assert(
      fc.property(outlineDocumentArb, (document) => {
        expect(readScreenplayDocument(document).ok).toBe(false)
      }),
    )
  })

  it('reports the path of a defect inside a node', () => {
    const result = readScreenplayDocument({
      kind: 'screenplay',
      id: 'd1',
      nodes: [
        { type: 'action', id: 'a', provenance: { source: 'typed' }, content: [] },
        {
          type: 'action',
          id: 'b',
          provenance: { source: 'typed' },
          content: [{ kind: 'text', text: 'ok' }, { kind: 'sparkle' }],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.at).toBe('nodes[1].content[1].kind')
  })
})
