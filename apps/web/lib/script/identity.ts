import type { NodeId } from '@folio/script'
import { nodeId } from '@folio/script'

/**
 * Node identity, the editor's side of it.
 *
 * ADR 0001 rules how ids behave: the **head keeps its id on a split**, the
 * **first node wins a merge**, a **deleted id is retired and never reused**,
 * and a paste **keeps an id that is absent from this document and mints one
 * otherwise**. `@folio/script` implements those rules as pure operations
 * over a node list. The editor does not call them - ProseMirror applies its
 * own steps - so the rules are re-stated once, in
 * `_script/editor/extensions/identity.ts`, as a plugin that appends to every
 * transaction that changed the document. What lives here is what that
 * plugin and the save path share: the log, the retirement reader, and the
 * one minter.
 *
 * ## The log
 *
 * The save path needs to know, for each id that has left the document since
 * the last save, whether it was merged (and into what) or deleted.
 * ProseMirror's history does not say. So the merges are logged as they
 * happen, keyed by the losing id, and `retirementsSince` reads the log when
 * the save is built. The log is per editor instance and is never persisted -
 * the tombstone row is the persistent record, and `retireNodes` writes it.
 */

export type IdentityLog = {
  /** Losing id -> surviving id, latest merge wins. */
  readonly mergedInto: Map<string, string>
  /** Every id minted by this editor since it was created. */
  readonly minted: Set<string>
}

export const newIdentityLog = (): IdentityLog => ({ mergedInto: new Map(), minted: new Set() })

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
