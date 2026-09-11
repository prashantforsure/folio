// @vitest-environment node
import { nodeId, typed } from '@folio/script'
import type { NodeId } from '@folio/script'
import { createSlateEditor } from 'platejs'
import { describe, expect, it } from 'vitest'

import { newIdentityLog, retirementsSince, withScriptIdentity } from '../lib/script/identity'
import type { ScriptElement } from '../lib/script/slate-model'
import { fromSlateValue } from '../lib/script/slate-model'

/**
 * ADR 0001, applied to a Slate editor through `editor.apply`.
 *
 * A headless Slate editor, no React, the identity wrapper on top, and the
 * same operations the keyboard produces. What is asserted is what a writer
 * can observe: which id a split's head keeps, which id a merge keeps, that a
 * cut-and-paste is a move, that a copy-and-paste mints, and that the value
 * still reads through the strict reader afterwards.
 */

let counter = 0
const mint = (): NodeId => {
  counter += 1
  return nodeId(`m${String(counter)}`)
}

const block = (id: string, type: ScriptElement['type'], text: string): ScriptElement => ({
  type,
  id: nodeId(id),
  modifiers: [],
  provenance: typed(),
  children: [{ text }],
})

const idsOf = (editor: { children: readonly unknown[] }): readonly string[] =>
  editor.children.map((child) => (child as { id: string }).id)

const make = () => {
  counter = 0
  const log = newIdentityLog()
  const editor = createSlateEditor({
    value: [block('a', 'scene', 'INT. CHAWL - DAY'), block('b', 'action', 'She does not look back.'), block('c', 'action', 'A tap coughs.')],
    nodeId: false,
  })
  return { editor: withScriptIdentity(editor, mint, log), log }
}

describe('split', () => {
  it('the head keeps its id and the tail is minted', () => {
    const { editor } = make()
    editor.tf.splitNodes({ at: { path: [1, 0], offset: 8 }, always: true })
    expect(idsOf(editor)).toEqual(['a', 'b', 'm1', 'c'])
    const read = fromSlateValue(editor.children)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value[1]?.content).toEqual([{ kind: 'text', text: 'She does' }])
    expect(read.value[2]?.content).toEqual([{ kind: 'text', text: ' not look back.' }])
    expect(read.value[2]?.provenance).toEqual(typed())
  })

  it('at the start of a block, the (now empty) head still keeps the id', () => {
    const { editor } = make()
    editor.tf.splitNodes({ at: { path: [1, 0], offset: 0 }, always: true })
    expect(idsOf(editor)).toEqual(['a', 'b', 'm1', 'c'])
  })
})

describe('merge', () => {
  it('first wins: the earlier block keeps its id, the later one is logged as merged into it', () => {
    const { editor, log } = make()
    editor.tf.mergeNodes({ at: [2] })
    expect(idsOf(editor)).toEqual(['a', 'b'])
    expect(log.mergedInto.get('c')).toBe('b')
    const read = fromSlateValue(editor.children)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value[1]?.content).toEqual([{ kind: 'text', text: 'She does not look back.A tap coughs.' }])
  })

  it('split then merge is the identity on ids', () => {
    const { editor } = make()
    editor.tf.splitNodes({ at: { path: [1, 0], offset: 8 }, always: true })
    editor.tf.mergeNodes({ at: [2] })
    expect(idsOf(editor)).toEqual(['a', 'b', 'c'])
  })
})

describe('delete and undo', () => {
  it('a removed id is retired and comes back as itself on undo', () => {
    const { editor, log } = make()
    editor.tf.removeNodes({ at: [2] })
    expect(idsOf(editor)).toEqual(['a', 'b'])
    expect(retirementsSince([nodeId('a'), nodeId('b'), nodeId('c')], idsOf(editor).map(nodeId), log)).toEqual([
      { nodeId: 'c', mergedInto: null },
    ])
    editor.undo()
    expect(idsOf(editor)).toEqual(['a', 'b', 'c'])
  })

  it('undoing a split retires the minted tail; redoing restores the same id', () => {
    const { editor } = make()
    editor.tf.splitNodes({ at: { path: [1, 0], offset: 8 }, always: true })
    editor.undo()
    expect(idsOf(editor)).toEqual(['a', 'b', 'c'])
    editor.redo()
    expect(idsOf(editor)).toEqual(['a', 'b', 'm1', 'c'])
  })
})

describe('paste', () => {
  it('an absent id is kept: cut here, paste here is a move', () => {
    const { editor } = make()
    editor.tf.removeNodes({ at: [2] })
    editor.tf.insertNodes(block('c', 'action', 'A tap coughs.'), { at: [1] })
    expect(idsOf(editor)).toEqual(['a', 'c', 'b'])
  })

  it('a present id is minted: copy here, paste here cannot repeat a join key', () => {
    const { editor } = make()
    editor.tf.insertNodes(block('b', 'action', 'She does not look back.'), { at: [3] })
    expect(idsOf(editor)).toEqual(['a', 'b', 'c', 'm1'])
    expect(fromSlateValue(editor.children).ok).toBe(true)
  })

  it('a block with no id is minted', () => {
    const { editor } = make()
    editor.tf.insertNodes({ type: 'action', modifiers: [], provenance: typed(), children: [{ text: 'x' }] }, { at: [3] })
    expect(idsOf(editor)).toEqual(['a', 'b', 'c', 'm1'])
  })
})

describe('set_node', () => {
  it('a type change keeps the id and may not rewrite it', () => {
    const { editor } = make()
    editor.tf.setNodes({ type: 'character', id: 'hijack' }, { at: [1] })
    expect(idsOf(editor)).toEqual(['a', 'b', 'c'])
    expect((editor.children[1] as { type: string }).type).toBe('character')
  })
})

describe('retirementsSince', () => {
  it('follows a merge chain to the surviving id', () => {
    const log = newIdentityLog()
    log.mergedInto.set('c', 'b')
    log.mergedInto.set('b', 'a')
    expect(retirementsSince([nodeId('a'), nodeId('b'), nodeId('c')], [nodeId('a')], log)).toEqual([
      { nodeId: 'b', mergedInto: 'a' },
      { nodeId: 'c', mergedInto: 'a' },
    ])
  })
})
