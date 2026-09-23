// @vitest-environment node
import { ASK_SELECTION_MAX } from '@folio/contracts'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { sameSelection, selectedNodeIds } from '../lib/assistant/selection'

/**
 * The editor selection as the assistant is told it (roadmap task 2.6).
 *
 * Both editors carry a node's id as its block's `id` attribute, so the reader
 * is tested over a schema of just that: a doc of id-carrying blocks.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    block: { content: 'text*', group: 'block', attrs: { id: { default: '' } }, toDOM: () => ['p', 0] },
    text: {},
  },
})

const docOf = (count: number) =>
  schema.node(
    'doc',
    null,
    Array.from({ length: count }, (_, at) => schema.node('block', { id: `n${String(at)}` }, [schema.text(`Line ${String(at)}.`)])),
  )

/** The position inside block `at`, `offset` characters in. Each block is 1 open + 8 characters + 1 close. */
const inside = (at: number, offset = 1): number => at * 10 + 1 + offset

describe('selectedNodeIds', () => {
  it('names the caret`s own block when nothing is selected', () => {
    const doc = docOf(4)
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, inside(2)) })
    expect(selectedNodeIds(state)).toEqual(['n2'])
  })

  it('names every block a selection touches, in document order', () => {
    const doc = docOf(5)
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, inside(1, 3), inside(3, 2)) })
    expect(selectedNodeIds(state)).toEqual(['n1', 'n2', 'n3'])
  })

  it(`stops at ${String(ASK_SELECTION_MAX)} ids`, () => {
    const doc = docOf(ASK_SELECTION_MAX + 20)
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, inside(0), inside(ASK_SELECTION_MAX + 19)) })
    expect(selectedNodeIds(state)).toHaveLength(ASK_SELECTION_MAX)
  })
})

describe('sameSelection', () => {
  it('is what keeps a keystroke inside one block from publishing again', () => {
    expect(sameSelection(['n1'], ['n1'])).toBe(true)
    expect(sameSelection(['n1'], ['n1', 'n2'])).toBe(false)
    expect(sameSelection(null, ['n1'])).toBe(false)
  })
})
