// @vitest-environment node
import type { StoredNodeRow } from '@folio/db'
import { between, planNodeWrite, spread } from '@folio/db'
import type { ScreenplayNode } from '@folio/script'
import { nodeId, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

/**
 * `planNodeWrite` - the pure half of the Script route's save.
 *
 * What is proved: an unchanged list plans no row; a keystroke plans one
 * update and no re-key; an insert lands between its neighbours and is
 * reported as introduced; a move re-keys the mover and nobody else; and -
 * the property the one-statement write depends on - no key a plan assigns
 * is a key any stored row holds, including the rows the same plan deletes.
 */

const node = (id: string, body: string): ScreenplayNode => ({
  type: 'action',
  id: nodeId(id),
  provenance: typed(),
  content: [text(body)],
})

const row = (n: ScreenplayNode, orderKey: string): StoredNodeRow => ({
  id: n.id,
  type: n.type,
  orderKey,
  content: n.content,
  modifiers: [],
  provenanceSource: 'typed',
  provenanceRunId: null,
})

const ids = ['a1', 'b2', 'c3', 'd4', 'e5'].map((stem) => `00000000-0000-4000-8000-0000000000${stem}`)
const A = node(ids[0] ?? '', 'one')
const B = node(ids[1] ?? '', 'two')
const C = node(ids[2] ?? '', 'three')
const D = node(ids[3] ?? '', 'four')
const keys = spread(null, null, 4)
const stored = [row(A, keys[0] ?? ''), row(B, keys[1] ?? ''), row(C, keys[2] ?? ''), row(D, keys[3] ?? '')]

const inOrder = (a: string, b: string): boolean => a < b

describe('planNodeWrite', () => {
  it('plans nothing for an unchanged list', () => {
    const plan = planNodeWrite(stored, [A, B, C, D])
    expect(plan).toEqual({ inserts: [], updates: [], deletes: [], introduced: [], rekeyed: 0 })
  })

  it('a keystroke is one update, keeping its key', () => {
    const plan = planNodeWrite(stored, [A, { ...B, content: [text('two, edited')] }, C, D])
    expect(plan.updates.map((write) => write.id)).toEqual([B.id])
    expect(plan.updates[0]?.orderKey).toBe(keys[1])
    expect(plan.inserts).toEqual([])
    expect(plan.rekeyed).toBe(0)
  })

  it('an insert lands strictly between its neighbours and is introduced', () => {
    const fresh = node(ids[4] ?? '', 'new')
    const plan = planNodeWrite(stored, [A, B, fresh, C, D])
    expect(plan.introduced).toEqual([fresh.id])
    expect(plan.inserts).toHaveLength(1)
    const key = plan.inserts[0]?.orderKey ?? ''
    expect(inOrder(keys[1] ?? '', key)).toBe(true)
    expect(inOrder(key, keys[2] ?? '')).toBe(true)
    expect(plan.updates).toEqual([])
  })

  it('a move re-keys the mover only', () => {
    const plan = planNodeWrite(stored, [A, C, D, B])
    expect(plan.rekeyed).toBe(1)
    expect(plan.updates.map((write) => write.id)).toEqual([B.id])
    expect(inOrder(keys[3] ?? '', plan.updates[0]?.orderKey ?? '')).toBe(true)
  })

  it('a delete is a delete, and nothing else moves', () => {
    const plan = planNodeWrite(stored, [A, C, D])
    expect(plan.deletes).toEqual([B.id])
    expect(plan.updates).toEqual([])
    expect(plan.rekeyed).toBe(0)
  })

  it('never assigns a key a stored row holds - even one it is deleting', () => {
    // A holds 'V', C holds 'k' - exactly `between('V', 'z')` - and D holds
    // 'z'. C is deleted and a new node takes its place, so `between`'s
    // deterministic answer for the newcomer is the key C's row still holds
    // in the same statement.
    const held = [row(A, 'V'), row(C, 'k'), row(D, 'z')]
    expect(between('V' as never, 'z' as never)).toBe('k')
    const fresh = node(ids[4] ?? '', 'replacement')
    const plan = planNodeWrite(held, [A, fresh, D])
    expect(plan.deletes).toEqual([C.id])
    const key = plan.inserts[0]?.orderKey ?? ''
    expect(key).not.toBe('k')
    expect(held.some((entry) => entry.orderKey === key)).toBe(false)
    expect(inOrder('V', key)).toBe(true)
    expect(inOrder(key, 'z')).toBe(true)
  })

  it('never assigns a key another mover still holds', () => {
    // B and C swap. The naive key for C-between-A-and-B... is B's own, and
    // B's row still holds it in the same statement.
    const plan = planNodeWrite(stored, [A, C, B, D])
    const assigned = plan.updates.map((write) => write.orderKey)
    for (const key of assigned) {
      const holder = stored.find((entry) => entry.orderKey === key)
      const mover = plan.updates.find((write) => write.orderKey === key)
      expect(holder === undefined || holder.id === mover?.id).toBe(true)
    }
    // And the final order sorts as the list.
    const finalKeys = [A, C, B, D].map((n) => plan.updates.find((write) => write.id === n.id)?.orderKey ?? stored.find((entry) => entry.id === n.id)?.orderKey ?? '')
    expect([...finalKeys].sort()).toEqual(finalKeys)
  })
})
