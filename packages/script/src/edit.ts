import type { NodeId } from './ids'
import type { DeliveryModifier, ScreenplayNode } from './node'

/**
 * What an edit did to identity.
 *
 * This module exists because of the ruling in `docs/adr/0001-node-identity.md`.
 * An operation cannot be `(nodes) => nodes`: when a node splits, comments and
 * proposals anchored past the split point have to move to the new node, and
 * `packages/script` cannot reach those rows itself. So every operation returns
 * the new node list **and a record of what happened to the ids**, and the
 * caller - a project-scoped repository in `packages/db` - replays it.
 *
 * Offsets are in anchor units: a character in a text run, one per mention.
 * See `contentLength` in `inline.ts`.
 */
export type IdentityEvent =
  /** A node entered the document with an id that has never been used before. */
  | { readonly kind: 'created'; readonly id: NodeId }
  /**
   * A node left the document. The id is tombstoned, never reused. Anchors on it
   * detach rather than delete - the analogue of AGENTS.md's
   * "0 appearances · record kept" for a derived record.
   */
  | { readonly kind: 'retired'; readonly id: NodeId }
  /** A previously retired id came back, e.g. cut and pasted in the same document. */
  | { readonly kind: 'restored'; readonly id: NodeId }
  /**
   * `from` split. The head kept `from`; everything at or after `atOffset` is now
   * in `to` at `offset - atOffset`. Anchors starting before `atOffset` stay put.
   */
  | {
      readonly kind: 'split'
      readonly from: NodeId
      readonly to: NodeId
      readonly atOffset: number
    }
  /**
   * `from` merged into `into` and was retired. Every anchor on `from` moves to
   * `into` at `offset + offsetShift`.
   */
  | {
      readonly kind: 'merged'
      readonly from: NodeId
      readonly into: NodeId
      readonly offsetShift: number
    }

/**
 * An attribute an operation could not carry across.
 *
 * Turning a cue into Action has nowhere to put its delivery modifiers. The
 * ruling was that a lossy operation reports what it dropped rather than
 * discarding it silently, so the UI can warn before the writer loses `(V.O.)`.
 */
export type DroppedAttribute = {
  readonly from: NodeId
  readonly attribute: 'modifiers'
  readonly value: readonly DeliveryModifier[]
}

/** Every operation returns this. Never a bare node list. */
export type Edit = {
  readonly nodes: readonly ScreenplayNode[]
  readonly identity: readonly IdentityEvent[]
  readonly dropped: readonly DroppedAttribute[]
}

/** A position inside a node's content: which run, and how far into it. */
export type ContentPoint = {
  readonly run: number
  readonly offset: number
}

export type OperationError =
  | { readonly kind: 'node-not-found'; readonly id: NodeId }
  | { readonly kind: 'index-out-of-range'; readonly index: number; readonly length: number }
  | { readonly kind: 'point-out-of-range'; readonly point: ContentPoint }
  /** A mention is an atom. A cursor sits either side of it, never inside it. */
  | { readonly kind: 'point-inside-mention'; readonly point: ContentPoint }
  | { readonly kind: 'nodes-not-adjacent'; readonly first: NodeId; readonly second: NodeId }
  /** An id the caller supplied is already in the document. Ids are never reused. */
  | { readonly kind: 'id-already-present'; readonly id: NodeId }
  /**
   * `packages/script` has no `Math.random()` and no `crypto`, so it cannot mint
   * an id. Operations that create nodes take the ids they need from the caller,
   * which is also what keeps them deterministic enough to run speculatively.
   */
  | { readonly kind: 'not-enough-ids'; readonly needed: number; readonly supplied: number }

export const edit = (
  nodes: readonly ScreenplayNode[],
  identity: readonly IdentityEvent[] = [],
  dropped: readonly DroppedAttribute[] = [],
): Edit => ({ nodes, identity, dropped })
