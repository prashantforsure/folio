// @vitest-environment node
import { nodeId, typed } from '@folio/script'
import { redo, undo } from '@tiptap/pm/history'
import { describe, expect, it } from 'vitest'

import { isStructural } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/identity'
import { retirementsSince } from '../lib/script/identity'
import { fromDoc } from '../lib/script/pm-model'
import { block, counterMint, harness } from './helpers/screenplay-state'

/**
 * ADR 0001, applied to a ProseMirror state through the identity plugin's
 * `appendTransaction`.
 *
 * No editor, no DOM: a state, the plugin, and the same steps the keyboard
 * produces. What is asserted is what a writer can observe: which id a
 * split's head keeps, which id a merge keeps, that a cut-and-paste is a
 * move, that a copy-and-paste mints, that a rewritten id is put back, and
 * that the document still reads through the strict reader afterwards.
 */

const make = () =>
  harness(
    [block('a', 'scene', 'INT. CHAWL - DAY'), block('b', 'action', 'She does not look back.'), block('c', 'action', 'A tap coughs.')],
    counterMint(),
  )

describe('split', () => {
  it('the head keeps its id and the tail is minted', () => {
    const h = make()
    h.run((tr) => {
      tr.split(h.at(1, 8))
    })
    expect(h.ids()).toEqual(['a', 'b', 'm1', 'c'])
    const read = fromDoc(h.state.doc)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value[1]?.content).toEqual([{ kind: 'text', text: 'She does' }])
    expect(read.value[2]?.content).toEqual([{ kind: 'text', text: ' not look back.' }])
    expect(read.value[2]?.provenance).toEqual(typed())
  })

  it('a split that nulls the tail (keepOnSplit: false) is minted the same way', () => {
    const h = make()
    h.run((tr) => {
      const node = tr.doc.child(1)
      tr.split(h.at(1, 8), 1, [{ type: node.type, attrs: { ...node.attrs, id: null } }])
    })
    expect(h.ids()).toEqual(['a', 'b', 'm1', 'c'])
  })

  it('at the start of a block, the (now empty) head still keeps the id', () => {
    const h = make()
    h.run((tr) => {
      tr.split(h.at(1, 0))
    })
    expect(h.ids()).toEqual(['a', 'b', 'm1', 'c'])
    expect(h.state.doc.child(1).textContent).toBe('')
  })
})

describe('merge', () => {
  it('first wins: the earlier block keeps its id, the later one is logged as merged into it', () => {
    const h = make()
    h.run((tr) => {
      tr.join(h.before(2))
    })
    expect(h.ids()).toEqual(['a', 'b'])
    expect(h.log.mergedInto.get('c')).toBe('b')
    const read = fromDoc(h.state.doc)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value[1]?.content).toEqual([{ kind: 'text', text: 'She does not look back.A tap coughs.' }])
  })

  it('a delete across the boundary is a merge too', () => {
    const h = make()
    h.run((tr) => {
      tr.delete(h.at(1, 8), h.at(2, 2))
    })
    expect(h.ids()).toEqual(['a', 'b'])
    expect(h.log.mergedInto.get('c')).toBe('b')
    expect(h.state.doc.child(1).textContent).toBe('She doestap coughs.')
  })

  it('split then merge is the identity on ids', () => {
    const h = make()
    h.run((tr) => {
      tr.split(h.at(1, 8))
    })
    h.run((tr) => {
      tr.join(h.before(2))
    })
    expect(h.ids()).toEqual(['a', 'b', 'c'])
  })
})

describe('delete and undo', () => {
  it('a removed id is retired and comes back as itself on undo', () => {
    const h = make()
    h.run((tr) => {
      tr.delete(h.before(2), h.before(3))
    })
    expect(h.ids()).toEqual(['a', 'b'])
    expect(retirementsSince([nodeId('a'), nodeId('b'), nodeId('c')], h.ids().map(nodeId), h.log)).toEqual([
      { nodeId: 'c', mergedInto: null },
    ])
    undo(h.state, (tr) => {
      h.state = h.state.apply(tr)
    })
    expect(h.ids()).toEqual(['a', 'b', 'c'])
  })

  it('undoing a split retires the minted tail; redoing restores the same id', () => {
    const h = make()
    h.run((tr) => {
      tr.split(h.at(1, 8))
    })
    expect(h.ids()).toEqual(['a', 'b', 'm1', 'c'])
    undo(h.state, (tr) => {
      h.state = h.state.apply(tr)
    })
    expect(h.ids()).toEqual(['a', 'b', 'c'])
    redo(h.state, (tr) => {
      h.state = h.state.apply(tr)
    })
    expect(h.ids()).toEqual(['a', 'b', 'm1', 'c'])
  })
})

describe('paste', () => {
  it('an absent id is kept: cut here, paste here is a move', () => {
    const h = make()
    h.run((tr) => {
      tr.delete(h.before(2), h.before(3))
    })
    h.run((tr) => {
      const moved = h.schema.nodeFromJSON({
        type: 'action',
        attrs: { id: 'c', provenance: typed(), modifiers: [], origin: null },
        content: [{ type: 'text', text: 'A tap coughs.' }],
      })
      tr.insert(h.before(1), moved)
    })
    expect(h.ids()).toEqual(['a', 'c', 'b'])
  })

  it('a present id is minted: copy here, paste here cannot repeat a join key', () => {
    const h = make()
    h.run((tr) => {
      const copy = h.schema.nodeFromJSON({
        type: 'action',
        attrs: { id: 'b', provenance: typed(), modifiers: [], origin: null },
        content: [{ type: 'text', text: 'She does not look back.' }],
      })
      tr.insert(h.before(3), copy)
    })
    expect(h.ids()).toEqual(['a', 'b', 'c', 'm1'])
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('a block with no id is minted', () => {
    const h = make()
    h.run((tr) => {
      const fresh = h.schema.nodeFromJSON({
        type: 'action',
        attrs: { id: null, provenance: typed(), modifiers: [], origin: null },
        content: [{ type: 'text', text: 'x' }],
      })
      tr.insert(h.before(3), fresh)
    })
    expect(h.ids()).toEqual(['a', 'b', 'c', 'm1'])
  })
})

describe('rewrite', () => {
  it('a type change keeps the id and may not rewrite it', () => {
    const h = make()
    h.run((tr) => {
      const node = tr.doc.child(1)
      const character = h.schema.nodes['character']
      if (character === undefined) throw new Error('schema')
      tr.setNodeMarkup(h.before(1), character, { ...node.attrs, id: 'hijack' })
    })
    expect(h.ids()).toEqual(['a', 'b', 'c'])
    expect(h.state.doc.child(1).type.name).toBe('character')
  })

  it('an attribute step on `id` is put back', () => {
    const h = make()
    h.run((tr) => {
      tr.setNodeAttribute(h.before(1), 'id', 'hijack')
    })
    expect(h.ids()).toEqual(['a', 'b', 'c'])
  })
})

describe('isStructural', () => {
  it('typing inside a block is not structural; a split is', () => {
    const h = make()
    const typing = h.state.tr.insertText('x', h.at(1, 3))
    expect(isStructural(typing)).toBe(false)
    const split = h.state.tr.split(h.at(1, 3))
    expect(isStructural(split)).toBe(true)
  })
})

describe('retirementsSince', () => {
  it('follows a merge chain to the surviving id', () => {
    const h = make()
    h.log.mergedInto.set('c', 'b')
    h.log.mergedInto.set('b', 'a')
    expect(retirementsSince([nodeId('a'), nodeId('b'), nodeId('c')], [nodeId('a')], h.log)).toEqual([
      { nodeId: 'b', mergedInto: 'a' },
      { nodeId: 'c', mergedInto: 'a' },
    ])
  })
})
