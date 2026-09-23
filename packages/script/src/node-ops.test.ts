import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { nodeId, runId } from './ids'
import type { NodeId } from './ids'
import { text } from './inline'
import type { ScreenplayNode } from './node'
import { makeScreenplayNode } from './node'
import { applyOutlineOps, applyScriptOps, describeNodeOpError, insertedIds, makeOutlineNode, restoreOutlineOps, restoreScriptOps } from './node-ops'
import type { ScriptOp } from './node-ops'
import { diffOutlines } from './outline-diff'
import type { OutlineNode } from './outline'
import { byAgent, typed } from './provenance'
import { screenplayNodesArb } from './testing/arbitraries'

/**
 * The agent's node operations - roadmap task 3.4, ADR 0003 D10 and D11.
 *
 * Held here: each of the five does what it says and nothing else; what the
 * agent writes carries its run, and a retype keeps the writer's attribution;
 * the first operation that cannot apply stops the list and says which; and
 * `restoreOps` takes back exactly the agent's changes - all of them when the
 * document is as the agent left it, and none of the writer's since when it
 * is not.
 */

const RUN = runId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')
const AGENT = byAgent(RUN)
const id = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const node = (n: number, type: ScreenplayNode['type'], words: string): ScreenplayNode =>
  makeScreenplayNode(type, { id: id(n), provenance: typed(), content: [text(words)], modifiers: [] })

const SCENE: readonly ScreenplayNode[] = [
  node(1, 'scene', 'INT. WARD - NIGHT'),
  node(2, 'action', 'The ward is quiet.'),
  node(3, 'character', 'MEERA'),
  node(4, 'dialogue', 'You came back.'),
]

const run = (ops: readonly ScriptOp[], nodes = SCENE) => {
  const result = applyScriptOps(nodes, ops, AGENT)
  if (!result.ok) throw new Error(describeNodeOpError(result.error))
  return result.value
}

const words = (nodes: readonly ScreenplayNode[]): string[] => nodes.map((entry) => entry.content.map((part) => (part.kind === 'text' ? part.text : '@')).join(''))

describe('applyScriptOps', () => {
  it('inserts after an anchor, and at the start, stamping what it writes with the run (D11)', () => {
    const next = run([
      { op: 'insert_after', anchor: id(2), nodes: [{ id: id(10), type: 'action', content: [text('A monitor beeps.')], modifiers: [] }] },
      { op: 'insert_after', anchor: 'start', nodes: [{ id: id(11), type: 'transition', content: [text('FADE IN:')], modifiers: [] }] },
    ])
    expect(words(next)).toEqual(['FADE IN:', 'INT. WARD - NIGHT', 'The ward is quiet.', 'A monitor beeps.', 'MEERA', 'You came back.'])
    expect(next.find((entry) => entry.id === id(10))?.provenance).toEqual(AGENT)
    expect(next.find((entry) => entry.id === id(1))?.provenance).toEqual(typed())
  })

  it("replaces a node's content in place, keeping its id and a cue's modifiers unless told", () => {
    const withVo = run([{ op: 'replace_content', id: id(3), content: [text('MEERA')], modifiers: ['V.O.'] }])
    const cue = withVo.find((entry) => entry.id === id(3))
    expect(cue?.type === 'character' ? cue.modifiers : null).toEqual(['V.O.'])
    const kept = run([{ op: 'replace_content', id: id(3), content: [text('OLD MEERA')], modifiers: null }], withVo)
    const again = kept.find((entry) => entry.id === id(3))
    expect(again?.type === 'character' ? again.modifiers : null).toEqual(['V.O.'])
    expect(again?.provenance).toEqual(AGENT)
  })

  it('retypes without changing the id or the attribution - the words did not change hands', () => {
    const next = run([{ op: 'change_type', id: id(2), type: 'transition' }])
    expect(next[1]?.type).toBe('transition')
    expect(next[1]?.id).toBe(id(2))
    expect(next[1]?.provenance).toEqual(typed())
  })

  it('deletes by id and moves after an anchor or to the start', () => {
    expect(words(run([{ op: 'delete', ids: [id(2), id(4)] }]))).toEqual(['INT. WARD - NIGHT', 'MEERA'])
    expect(words(run([{ op: 'move', id: id(4), after: id(1) }]))).toEqual(['INT. WARD - NIGHT', 'You came back.', 'The ward is quiet.', 'MEERA'])
    expect(words(run([{ op: 'move', id: id(4), after: 'start' }]))[0]).toBe('You came back.')
  })

  it('stops at the first operation that cannot apply and says which, leaving the input untouched', () => {
    const result = applyScriptOps(
      SCENE,
      [
        { op: 'delete', ids: [id(2)] },
        { op: 'replace_content', id: id(2), content: [text('gone')], modifiers: null },
      ],
      AGENT,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ at: 1, error: { kind: 'node-not-found', id: id(2) } })
    expect(describeNodeOpError(result.error)).toBe(`Operation 2: there is no node ${id(2)} in the document.`)
    expect(words(SCENE)).toHaveLength(4)
  })

  it('refuses an id already in the document, modifiers off a cue, an unknown anchor and an empty list', () => {
    const failure = (ops: readonly ScriptOp[]) => {
      const result = applyScriptOps(SCENE, ops, AGENT)
      return result.ok ? null : result.error.error.kind
    }
    expect(failure([{ op: 'insert_after', anchor: 'start', nodes: [{ id: id(1), type: 'action', content: [], modifiers: [] }] }])).toBe('id-already-present')
    expect(failure([{ op: 'insert_after', anchor: 'start', nodes: [{ id: id(20), type: 'action', content: [], modifiers: ['O.S.'] }] }])).toBe('modifiers-not-on-cue')
    expect(failure([{ op: 'insert_after', anchor: id(99), nodes: [{ id: id(20), type: 'action', content: [], modifiers: [] }] }])).toBe('node-not-found')
    expect(failure([{ op: 'delete', ids: [] }])).toBe('empty')
    expect(failure([{ op: 'move', id: id(2), after: id(2) }])).toBe('move-after-itself')
  })

  it('lists the ids an operation list inserts', () => {
    expect(insertedIds([{ op: 'insert_after', anchor: 'start', nodes: [{ id: id(7), type: 'action', content: [], modifiers: [] }] }, { op: 'delete', ids: [id(1)] }])).toEqual([id(7)])
  })
})

describe('restoreScriptOps', () => {
  const edit: readonly ScriptOp[] = [
    { op: 'insert_after', anchor: id(2), nodes: [{ id: id(10), type: 'action', content: [text('A monitor beeps.')], modifiers: [] }] },
    { op: 'replace_content', id: id(4), content: [text('You came back for me.')], modifiers: null },
    { op: 'delete', ids: [id(2)] },
    { op: 'change_type', id: id(3), type: 'action' },
  ]

  it('puts the document back exactly when nothing changed since the agent', () => {
    const after = run(edit)
    const restored = applyScriptOps(after, restoreScriptOps(after, SCENE, after), typed())
    expect(restored.ok && restored.value).toEqual(SCENE)
  })

  it('never reverses the writer: a node they rewrote after the agent keeps their words', () => {
    const after = run(edit)
    const writer = after.map((entry) => (entry.id === id(4) ? makeScreenplayNode('dialogue', { id: id(4), provenance: typed(), content: [text('You came.')], modifiers: [] }) : entry))
    const ops = restoreScriptOps(writer, SCENE, after)
    const restored = applyScriptOps(writer, ops, typed())
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(words(restored.value)).toContain('You came.')
    expect(words(restored.value)).toContain('The ward is quiet.')
    expect(words(restored.value)).not.toContain('A monitor beeps.')
  })

  it('leaves alone a node the agent inserted that the writer has since deleted', () => {
    const after = run(edit)
    const writer = after.filter((entry) => entry.id !== id(10))
    expect(restoreScriptOps(writer, SCENE, after).some((op) => op.op === 'delete')).toBe(false)
  })

  it('restores any script the agent could have produced, by property', () => {
    fc.assert(
      fc.property(screenplayNodesArb, fc.nat(), (before, seed) => {
        if (before.length === 0) return
        const target = before[seed % before.length]
        if (target === undefined) return
        const ops: ScriptOp[] = [
          { op: 'insert_after', anchor: target.id, nodes: [{ id: nodeId(`ffffffff-0000-4000-8000-${String(seed % 1_000_000).padStart(12, '0')}`), type: 'action', content: [text('new')], modifiers: [] }] },
          { op: 'replace_content', id: target.id, content: [text('rewritten')], modifiers: null },
        ]
        const after = applyScriptOps(before, ops, AGENT)
        if (!after.ok) return
        const back = applyScriptOps(after.value, restoreScriptOps(after.value, before, after.value), typed())
        expect(back.ok).toBe(true)
        if (back.ok) expect(back.value.map((entry) => [entry.id, entry.type])).toEqual(before.map((entry) => [entry.id, entry.type]))
      }),
      { numRuns: 60 },
    )
  })
})

describe('the outline', () => {
  const block = (n: number, type: OutlineNode['type'], words: string): OutlineNode => makeOutlineNode(type, { id: id(n), provenance: typed(), content: type === 'rule' ? [] : [text(words)] })
  const OUTLINE: readonly OutlineNode[] = [block(1, 'h1', 'Act One'), block(2, 'beat', 'Meera comes back'), block(3, 'rule', ''), block(4, 'h1', 'Act Two'), block(5, 'beat', 'The ward floods')]

  it('applies the same five operations, and a rule holds no text', () => {
    const next = applyOutlineOps(
      OUTLINE,
      [
        { op: 'insert_after', anchor: id(2), nodes: [{ id: id(9), type: 'beat', content: [text('She finds the letter')], modifiers: [] }] },
        { op: 'change_type', id: id(5), type: 'h2' },
        { op: 'move', id: id(3), after: id(5) },
      ],
      AGENT,
    )
    expect(next.ok && next.value.map((entry) => entry.type)).toEqual(['h1', 'beat', 'beat', 'h1', 'h2', 'rule'])
    const rule = applyOutlineOps(OUTLINE, [{ op: 'insert_after', anchor: 'start', nodes: [{ id: id(9), type: 'rule', content: [text('no')], modifiers: [] }] }], AGENT)
    expect(rule.ok ? null : rule.error.error.kind).toBe('rule-has-no-content')
  })

  it('restores an outline exactly', () => {
    const after = applyOutlineOps(OUTLINE, [{ op: 'replace_content', id: id(2), content: [text('Meera returns')], modifiers: null }, { op: 'delete', ids: [id(5)] }], AGENT)
    if (!after.ok) throw new Error('expected an edit')
    const back = applyOutlineOps(after.value, restoreOutlineOps(after.value, OUTLINE, after.value), typed())
    expect(back.ok && back.value).toEqual(OUTLINE)
  })

  it('diffs block by block, with each entry in its act', () => {
    const after = applyOutlineOps(
      OUTLINE,
      [
        { op: 'replace_content', id: id(5), content: [text('The ward floods at dawn')], modifiers: null },
        { op: 'insert_after', anchor: id(2), nodes: [{ id: id(9), type: 'beat', content: [text('She finds the letter')], modifiers: [] }] },
        { op: 'delete', ids: [id(3)] },
      ],
      AGENT,
    )
    if (!after.ok) throw new Error('expected an edit')
    const diff = diffOutlines(OUTLINE, after.value)
    expect(diff.entries.map((entry) => [entry.kind, entry.section])).toEqual([
      ['same', 1],
      ['same', 1],
      ['added', 1],
      ['deleted', 1],
      ['same', 2],
      ['changed', 2],
    ])
    expect([diff.added, diff.deleted, diff.changed]).toEqual([1, 1, 1])
    expect(diff.entries[5]?.lines).toEqual([
      { kind: 'deleted', text: 'The ward floods' },
      { kind: 'added', text: 'The ward floods at dawn' },
    ])
  })

  it('marks a block that moved, and counts it once', () => {
    const after = applyOutlineOps(OUTLINE, [{ op: 'move', id: id(2), after: id(5) }], AGENT)
    if (!after.ok) throw new Error('expected a move')
    const diff = diffOutlines(OUTLINE, after.value)
    expect(diff.entries.filter((entry) => entry.moved).map((entry) => entry.kind)).toEqual(['deleted', 'added'])
    expect([diff.added, diff.deleted, diff.changed]).toEqual([0, 0, 1])
  })
})
