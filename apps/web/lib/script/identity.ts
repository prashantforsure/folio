import type { NodeId } from '@folio/script'
import { nodeId, typed } from '@folio/script'
import type { Descendant, Editor, Operation } from 'platejs'

/**
 * Node identity in the editor, enforced at the one door every change uses.
 *
 * ADR 0001 rules how ids behave: the **head keeps its id on a split**, the
 * **first node wins a merge**, a **deleted id is retired and never reused**,
 * and a paste **keeps an id that is absent from this document and mints one
 * otherwise**. `@folio/script` implements those rules as pure operations over
 * a node list. Slate does not call them - it applies its own operations - so
 * the rules are re-stated here, once, on `editor.apply`, which every Slate
 * transform, undo, redo, paste and IME path goes through.
 *
 * ## Why `apply` and not the keyboard handler
 *
 * A keyboard handler sees Enter. It does not see a paste that splits a block,
 * a drag that moves one, a `deleteFragment` across three blocks that merges
 * the outer two, or an undo. Every one of those is an `insert_node`,
 * `split_node`, `merge_node` or `remove_node` at the block level, and every
 * one arrives here. Wrapping the outermost `apply` - after Plate has built
 * the editor - also means the *history* records the operation as amended, so
 * undo and redo replay the same ids rather than reinventing them.
 *
 * ## What each operation does to identity
 *
 *   split_node   Slate copies the block's props onto the new second half. The
 *                second half is the *tail*, so its copied `id` - present in
 *                the document - is replaced with a fresh one. The head keeps
 *                `id`. (Rule: head wins.) A redo replays the split with the
 *                tail's minted id, which is then absent, and it is kept.
 *   merge_node   The block at `path` is folded into the one before it and
 *                the block before keeps its props. The loser's id is logged
 *                as merged into the survivor. (Rule: first wins.)
 *   remove_node  The id is logged as retired.
 *   insert_node  An id that is missing, or that is already present in the
 *                document, is replaced with a fresh one - that is the
 *                "copy here, paste here" case. An id that is absent is kept:
 *                that is "cut here, paste here", and it is a move.
 *   set_node     May never touch `id`. The property is stripped.
 *   move_node    Every id survives. Nothing to do.
 *
 * Cross-document paste is settled before it reaches here: `plate-editor.tsx`'s
 * `setFragmentData`
 * stamps the source document onto the clipboard, and `insertData` strips
 * every id from a fragment that came from elsewhere, so the insert branch
 * mints. That is `pasteNodes`' `Clipboard.origin` rule, in DOM terms.
 *
 * ## The log
 *
 * The save path needs to know, for each id that has left the document since
 * the last save, whether it was merged (and into what) or deleted. Slate's
 * history does not say. So the merges are logged as they happen, keyed by
 * the losing id, and `retirementsSince` reads the log when the save is built.
 * The log is per editor instance and is never persisted - the tombstone row
 * is the persistent record, and `retireNodes` writes it.
 *
 * Nothing here is typed `any`, and nothing asserts through `unknown`. Slate's
 * `TElement` is `{ type; children } & UnknownObject`, so an element's `id` is
 * `unknown` until it is checked to be a string - which is done, every time.
 */

export type IdentityLog = {
  /** Losing id -> surviving id, latest merge wins. */
  readonly mergedInto: Map<string, string>
  /** Every id minted by this editor since it was created. */
  readonly minted: Set<string>
}

export const newIdentityLog = (): IdentityLog => ({ mergedInto: new Map(), minted: new Set() })

const idOf = (node: unknown): string | null => {
  if (typeof node !== 'object' || node === null) return null
  const id = (node as { readonly id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : null
}

const isBlockPath = (path: readonly number[]): boolean => path.length === 1

/** The legacy Slate method, which `TElement`'s index signature otherwise types as `unknown`. */
type LegacyApply = { apply: (operation: Operation<Descendant>) => void }

/**
 * Wrap the editor's `apply`. Idempotent: a second call returns the editor
 * untouched, so a React re-render cannot stack two wrappers.
 */
export const withScriptIdentity = <E extends Editor>(
  editor: E,
  mint: () => NodeId,
  log: IdentityLog,
): E => {
  const marker = editor as E & { readonly __folioIdentity?: true }
  if (marker.__folioIdentity === true) return editor

  const present = new Set<string>()
  for (const child of editor.children) {
    const id = idOf(child)
    if (id !== null) present.add(id)
  }

  const fresh = (): NodeId => {
    const id = mint()
    log.minted.add(id)
    return id
  }

  // Slate's transforms call the legacy `editor.apply`; Plate exposes the same
  // function as `editor.tf.apply` and keeps the two in step at creation. Both
  // are replaced so that whichever a caller reaches, it reaches this.
  const legacy = editor as E & LegacyApply
  const apply = legacy.apply
  const applyWithIdentity = (operation: Operation<Descendant>): void => {
    switch (operation.type) {
      case 'split_node': {
        if (!isBlockPath(operation.path)) break
        // Slate copies the head's props onto the tail, so on a fresh split the
        // copied id is present and a new one is minted. On a redo the tail's
        // minted id comes back on the operation and is absent from the
        // document, and it is kept - the same rule as a cut-and-paste.
        const copied = idOf(operation.properties)
        if (copied !== null && !present.has(copied)) {
          present.add(copied)
          break
        }
        const tail = fresh()
        operation.properties = { ...operation.properties, id: tail, provenance: typed() }
        present.add(tail)
        break
      }
      case 'merge_node': {
        if (!isBlockPath(operation.path)) break
        const index = operation.path[0] ?? 0
        const loser = idOf(editor.children[index])
        const survivor = idOf(editor.children[index - 1])
        if (loser !== null) {
          present.delete(loser)
          if (survivor !== null) log.mergedInto.set(loser, survivor)
        }
        break
      }
      case 'remove_node': {
        if (!isBlockPath(operation.path)) break
        const id = idOf(operation.node)
        if (id !== null) present.delete(id)
        break
      }
      case 'insert_node': {
        if (!isBlockPath(operation.path)) break
        const id = idOf(operation.node)
        if (id === null || present.has(id)) {
          const minted = fresh()
          operation.node = { ...operation.node, id: minted }
          present.add(minted)
        } else {
          present.add(id)
        }
        break
      }
      case 'set_node': {
        if (!isBlockPath(operation.path)) break
        if (!('id' in operation.newProperties) && !('id' in operation.properties)) break
        const current = idOf(editor.children[operation.path[0] ?? 0])
        if (current === null) {
          // A block with no id yet (normalisation repairing a foreign shape)
          // may be given one. It may never be given a different one.
          const granted = idOf(operation.newProperties)
          if (granted !== null) present.add(granted)
          break
        }
        const { id: _newId, ...newProperties } = operation.newProperties as { id?: unknown }
        const { id: _oldId, ...properties } = operation.properties as { id?: unknown }
        void _newId
        void _oldId
        operation.newProperties = newProperties
        operation.properties = properties
        break
      }
      default:
        break
    }
    apply(operation)
  }

  legacy.apply = applyWithIdentity
  editor.tf.apply = applyWithIdentity
  editor.transforms.apply = applyWithIdentity
  Object.defineProperty(marker, '__folioIdentity', { value: true, enumerable: false })
  return editor
}

export type Retirement = {
  readonly nodeId: NodeId
  /** The id the text now lives under, when the node lost a merge. */
  readonly mergedInto: NodeId | null
}

/**
 * Which ids from `baseline` are gone from `current`, and where their text
 * went. A merge chain is followed to an id that still exists; a chain that
 * ends nowhere is a delete.
 */
export const retirementsSince = (
  baseline: readonly NodeId[],
  current: readonly NodeId[],
  log: IdentityLog,
): readonly Retirement[] => {
  const alive = new Set<string>(current)
  return baseline
    .filter((id) => !alive.has(id))
    .map((id) => {
      let cursor: string | undefined = log.mergedInto.get(id)
      const seen = new Set<string>([id])
      while (cursor !== undefined && !alive.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor)
        cursor = log.mergedInto.get(cursor)
      }
      return {
        nodeId: id,
        mergedInto: cursor !== undefined && alive.has(cursor) ? nodeId(cursor) : null,
      }
    })
}

/** A v4 UUID from the platform, the same shape `gen_random_uuid()` mints. */
export const mintNodeId = (): NodeId => nodeId(crypto.randomUUID())
