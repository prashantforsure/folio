import type { OrderKey } from '@folio/contracts'
import type { NodeId, OutlineNode, ScreenplayNode } from '@folio/script'

import { between } from './order'
import type { NodeWrite } from './repositories/mapping'
import { nodeToWrite } from './repositories/mapping'

/**
 * From a stored node list and the list a writer now wants, to the fewest
 * rows that turn one into the other. Pure; `commitNodePlan` in
 * `repositories/documents.ts` writes the result in one statement.
 *
 * ## Why the plan is computed here and not in SQL
 *
 * Order keys are fractional (`order.ts`), and which keys can be *kept* when
 * a list is written back is a longest-increasing-subsequence question over
 * the stored keys in the new order. Postgres could answer it, slowly and
 * unreadably; this is thirty lines and has a unit test. The rows that come
 * out are exactly the ones `replaceNodes` would have written, minus the
 * churn: a node whose content changed is an update, one that moved
 * relative to its neighbours is re-keyed, one that is gone is a delete,
 * one that is new is an insert between its neighbours, and everything else
 * is not mentioned at all.
 *
 * ## Keys never collide with a stored key - by construction
 *
 * The write that applies this plan is one statement, so its deletes and its
 * inserts see the *same* snapshot: a row being deleted is still in the
 * unique index `(document_id, order_key)` when a new row is inserted. And
 * `between` is deterministic, so the key it gives a new node between two
 * kept neighbours is exactly the key it gave the node that used to sit
 * there. Two ways to a unique violation, and the same fix for both: every
 * freshly assigned key is checked against every key the document holds,
 * and nudged upward - still strictly inside its gap - until it matches
 * none. The nudge loop terminates because each step produces a longer key
 * that is strictly greater than the last, and the stored set is finite.
 */

/** The columns of a stored node a plan compares against. */
export type StoredNodeRow = {
  readonly id: string
  readonly type: string
  readonly orderKey: string
  readonly content: unknown
  readonly modifiers: readonly string[]
  readonly provenanceSource: string
  readonly provenanceRunId: string | null
}

export type NodeWritePlan = {
  /** New rows, each with its key. */
  readonly inserts: readonly NodeWrite[]
  /** Stored rows whose content, type, provenance or key changed. Whole rows: the write replaces every column. */
  readonly updates: readonly NodeWrite[]
  readonly deletes: readonly NodeId[]
  /** Ids in the list that no stored row carries. Checked against tombstones and every node in the project before a row is written. */
  readonly introduced: readonly NodeId[]
  /** How many stored rows took a new key. Reporting only. */
  readonly rekeyed: number
}

/**
 * The longest increasing subsequence of `keys`, as a set of indexes.
 *
 * Every node whose stored key already sorts correctly against the ones
 * around it keeps its row's key untouched, and only the rest are re-keyed.
 * Patience sorting, O(n log n), over the keys in *new document order*.
 */
const longestIncreasing = (keys: readonly (string | null)[]): ReadonlySet<number> => {
  const tails: number[] = []
  const previous: number[] = new Array<number>(keys.length).fill(-1)
  const tailKey = (index: number): string => keys[index] ?? ''
  keys.forEach((key, index) => {
    if (key === null) return
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      const at = tails[mid]
      if (at !== undefined && tailKey(at) < key) low = mid + 1
      else high = mid
    }
    const before = tails[low - 1]
    previous[index] = low > 0 && before !== undefined ? before : -1
    tails[low] = index
  })
  const kept = new Set<number>()
  let cursor = tails[tails.length - 1] ?? -1
  while (cursor !== -1) {
    kept.add(cursor)
    cursor = previous[cursor] ?? -1
  }
  return kept
}

/** The columns a save compares. Order is compared separately. */
const sameContent = (row: StoredNodeRow, write: NodeWrite): boolean =>
  row.type === write.type &&
  row.provenanceSource === write.provenanceSource &&
  row.provenanceRunId === write.provenanceRunId &&
  JSON.stringify(row.content) === JSON.stringify(write.content) &&
  JSON.stringify(row.modifiers) === JSON.stringify(write.modifiers)

export const planNodeWrite = (
  existing: readonly StoredNodeRow[],
  list: readonly (ScreenplayNode | OutlineNode)[],
): NodeWritePlan => {
  const held = new Map(existing.map((row) => [row.id, row]))
  const wanted = new Set(list.map((node) => node.id as string))
  const storedKeys = new Set(existing.map((row) => row.orderKey))

  const introduced = list.map((node) => node.id).filter((id) => !held.has(id))
  const deletes = existing.filter((row) => !wanted.has(row.id)).map((row) => row.id as NodeId)

  const currentKeys = list.map((node) => held.get(node.id)?.orderKey ?? null)
  const kept = longestIncreasing(currentKeys)

  // The next kept key after each position, so a re-keyed node lands between
  // the last key written and the next one that is staying put.
  const nextKept: (OrderKey | null)[] = new Array<OrderKey | null>(list.length).fill(null)
  let following: OrderKey | null = null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    nextKept[index] = following
    const key = currentKeys[index]
    if (kept.has(index) && key !== null) following = key as OrderKey
  }

  const inserts: NodeWrite[] = []
  const updates: NodeWrite[] = []
  let rekeyed = 0
  let previousKey: OrderKey | null = null
  for (let index = 0; index < list.length; index += 1) {
    const node = list[index]
    if (node === undefined) continue
    const row = held.get(node.id)
    const heldKey = currentKeys[index]
    const keepKey = row !== undefined && kept.has(index) && heldKey !== null
    let orderKey: OrderKey
    if (keepKey) {
      orderKey = heldKey as OrderKey
    } else {
      const upper = nextKept[index] ?? null
      orderKey = between(previousKey, upper)
      // A key another row holds - kept, moving or being deleted - is not
      // this node's to take in the same statement. See the header.
      while (storedKeys.has(orderKey) && orderKey !== row?.orderKey) {
        orderKey = between(orderKey, upper)
      }
    }
    const write = nodeToWrite(node, orderKey)

    if (row === undefined) {
      inserts.push(write)
    } else {
      const moved = row.orderKey !== orderKey
      if (moved || !sameContent(row, write)) updates.push(write)
      if (moved) rekeyed += 1
    }
    previousKey = orderKey
  }

  return { inserts, updates, deletes, introduced, rekeyed }
}
