import type { ScreenplayDocument } from './document'
import type { ContentPoint, DroppedAttribute, Edit, IdentityEvent, OperationError } from './edit'
import { edit } from './edit'
import type { NodeId } from './ids'
import type { InlineContent, InlineRun } from './inline'
import { contentLength, normaliseContent } from './inline'
import type { ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode, modifiersOf } from './node'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * The seven operations.
 *
 * Every one of them is pure: node list in, `Edit` out, input untouched. None of
 * them throws - a bad index or a cursor inside a mention is an `OperationError`
 * in the return type (AGENTS.md, Conventions > Errors).
 *
 * The identity rules they implement are ruled on in
 * `docs/adr/0001-node-identity.md`:
 *
 *   - **split**  the head keeps the id; anchors past the split point are
 *     re-pointed at the tail via a `split` event.
 *   - **merge**  the first node's id wins; the second is retired with a
 *     `merged` event carrying the offset shift.
 *   - **paste**  an id is preserved when the clipboard came from this document
 *     and the id is currently absent; otherwise a fresh one is used. So cut and
 *     paste is a move that keeps its comments, copy and paste is not, and a
 *     cross-document paste always mints - which is what keeps node ids globally
 *     unique and the comment join a single column.
 *   - **delete**  tombstones. An id is never reused.
 *   - **reorder** and **type change**  preserve every id.
 *
 * None of these mint an id. `packages/script` has no entropy by design, so the
 * caller supplies any id an operation needs.
 */

const indexOfNode = (nodes: readonly ScreenplayNode[], id: NodeId): number =>
  nodes.findIndex((node) => node.id === id)

const idsOf = (nodes: readonly ScreenplayNode[]): ReadonlySet<NodeId> =>
  new Set(nodes.map((node) => node.id))

// ---------------------------------------------------------------------------
// Content splitting
// ---------------------------------------------------------------------------

/**
 * Cut content in two at a point, and report the anchor offset it happened at.
 *
 * A point is `{ run, offset }`. `{ run: content.length, offset: 0 }` is the very
 * end. A point inside a mention is refused: a mention is an atom.
 */
export const splitContent = (
  content: InlineContent,
  point: ContentPoint,
): Result<
  { readonly head: InlineContent; readonly tail: InlineContent; readonly atOffset: number },
  OperationError
> => {
  if (point.run < 0 || point.run > content.length || point.offset < 0) {
    return err({ kind: 'point-out-of-range', point })
  }
  const before = content.slice(0, point.run)
  const atOffsetBefore = contentLength(before)

  if (point.run === content.length) {
    if (point.offset !== 0) return err({ kind: 'point-out-of-range', point })
    return ok({ head: normaliseContent(content), tail: [], atOffset: atOffsetBefore })
  }

  const run = content[point.run]
  if (run === undefined) return err({ kind: 'point-out-of-range', point })
  const after = content.slice(point.run + 1)

  if (run.kind === 'mention') {
    // Either side of it, never inside it.
    if (point.offset === 0) {
      return ok({
        head: normaliseContent(before),
        tail: normaliseContent([run, ...after]),
        atOffset: atOffsetBefore,
      })
    }
    if (point.offset === 1) {
      return ok({
        head: normaliseContent([...before, run]),
        tail: normaliseContent(after),
        atOffset: atOffsetBefore + 1,
      })
    }
    return err({ kind: 'point-inside-mention', point })
  }

  if (point.offset > run.text.length) return err({ kind: 'point-out-of-range', point })
  const head: InlineRun[] = [...before, { kind: 'text', text: run.text.slice(0, point.offset) }]
  const tail: InlineRun[] = [{ kind: 'text', text: run.text.slice(point.offset) }, ...after]
  return ok({
    head: normaliseContent(head),
    tail: normaliseContent(tail),
    atOffset: atOffsetBefore + point.offset,
  })
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * Split one node in two.
 *
 * The head keeps the id. `tailId` must be fresh - an id is never reused, so
 * reintroducing one already in the document is refused.
 */
export const splitNode = (
  nodes: readonly ScreenplayNode[],
  id: NodeId,
  point: ContentPoint,
  tailId: NodeId,
): Result<Edit, OperationError> => {
  const index = indexOfNode(nodes, id)
  if (index === -1) return err({ kind: 'node-not-found', id })
  if (idsOf(nodes).has(tailId)) return err({ kind: 'id-already-present', id: tailId })
  const node = nodes[index]
  if (node === undefined) return err({ kind: 'node-not-found', id })

  const parts = splitContent(node.content, point)
  if (!parts.ok) return parts

  const head = makeScreenplayNode(node.type, {
    id: node.id,
    provenance: node.provenance,
    content: parts.value.head,
    modifiers: modifiersOf(node),
  })
  const tail = makeScreenplayNode(node.type, {
    id: tailId,
    provenance: node.provenance,
    content: parts.value.tail,
    modifiers: modifiersOf(node),
  })

  return ok(
    edit(
      [...nodes.slice(0, index), head, tail, ...nodes.slice(index + 1)],
      [
        { kind: 'created', id: tailId },
        { kind: 'split', from: id, to: tailId, atOffset: parts.value.atOffset },
      ],
    ),
  )
}

/**
 * Merge a node into the one before it.
 *
 * First-wins: `firstId` keeps its id and its type, `secondId` is retired. The
 * two must be adjacent. Anything the second carried that the first's type
 * cannot hold comes back in `dropped`.
 */
export const mergeNodes = (
  nodes: readonly ScreenplayNode[],
  firstId: NodeId,
  secondId: NodeId,
): Result<Edit, OperationError> => {
  const first = indexOfNode(nodes, firstId)
  if (first === -1) return err({ kind: 'node-not-found', id: firstId })
  const second = indexOfNode(nodes, secondId)
  if (second === -1) return err({ kind: 'node-not-found', id: secondId })
  if (second !== first + 1) return err({ kind: 'nodes-not-adjacent', first: firstId, second: secondId })

  const a = nodes[first]
  const b = nodes[second]
  if (a === undefined || b === undefined) return err({ kind: 'node-not-found', id: firstId })

  const offsetShift = contentLength(a.content)
  const merged = makeScreenplayNode(a.type, {
    id: a.id,
    provenance: a.provenance,
    content: normaliseContent([...a.content, ...b.content]),
    modifiers: modifiersOf(a),
  })

  const lost = modifiersOf(b)
  const dropped: readonly DroppedAttribute[] =
    a.type !== 'character' && lost.length > 0
      ? [{ from: b.id, attribute: 'modifiers', value: lost }]
      : []

  return ok(
    edit(
      [...nodes.slice(0, first), merged, ...nodes.slice(second + 1)],
      [
        { kind: 'merged', from: secondId, into: firstId, offsetShift },
        { kind: 'retired', id: secondId },
      ],
      dropped,
    ),
  )
}

/** Insert already-built nodes at an index. Their ids must be fresh. */
export const insertNodes = (
  nodes: readonly ScreenplayNode[],
  index: number,
  incoming: readonly ScreenplayNode[],
): Result<Edit, OperationError> => {
  if (index < 0 || index > nodes.length) {
    return err({ kind: 'index-out-of-range', index, length: nodes.length })
  }
  const present = idsOf(nodes)
  const seen = new Set<NodeId>()
  for (const node of incoming) {
    if (present.has(node.id) || seen.has(node.id)) {
      return err({ kind: 'id-already-present', id: node.id })
    }
    seen.add(node.id)
  }
  return ok(
    edit(
      [...nodes.slice(0, index), ...incoming, ...nodes.slice(index)],
      incoming.map((node): IdentityEvent => ({ kind: 'created', id: node.id })),
    ),
  )
}

/** Remove nodes. Their ids are tombstoned and never reused. */
export const deleteNodes = (
  nodes: readonly ScreenplayNode[],
  ids: readonly NodeId[],
): Result<Edit, OperationError> => {
  const present = idsOf(nodes)
  for (const id of ids) {
    if (!present.has(id)) return err({ kind: 'node-not-found', id })
  }
  const removing = new Set(ids)
  return ok(
    edit(
      nodes.filter((node) => !removing.has(node.id)),
      [...removing].map((id): IdentityEvent => ({ kind: 'retired', id })),
    ),
  )
}

/** Move one node. Every id survives; nothing is created or retired. */
export const reorderNode = (
  nodes: readonly ScreenplayNode[],
  from: number,
  to: number,
): Result<Edit, OperationError> => {
  if (from < 0 || from >= nodes.length) {
    return err({ kind: 'index-out-of-range', index: from, length: nodes.length })
  }
  if (to < 0 || to >= nodes.length) {
    return err({ kind: 'index-out-of-range', index: to, length: nodes.length })
  }
  const moving = nodes[from]
  if (moving === undefined) return err({ kind: 'index-out-of-range', index: from, length: nodes.length })
  const without = [...nodes.slice(0, from), ...nodes.slice(from + 1)]
  return ok(edit([...without.slice(0, to), moving, ...without.slice(to)]))
}

/**
 * Change a node's type in place.
 *
 * The id survives, as AGENTS.md requires. Delivery modifiers do not survive a
 * change away from a cue, and come back in `dropped`.
 */
export const changeNodeType = (
  nodes: readonly ScreenplayNode[],
  id: NodeId,
  type: ScreenplayNodeType,
): Result<Edit, OperationError> => {
  const index = indexOfNode(nodes, id)
  if (index === -1) return err({ kind: 'node-not-found', id })
  const node = nodes[index]
  if (node === undefined) return err({ kind: 'node-not-found', id })

  const existing = modifiersOf(node)
  const retyped = makeScreenplayNode(type, {
    id: node.id,
    provenance: node.provenance,
    content: node.content,
    modifiers: type === 'character' ? existing : [],
  })
  const dropped: readonly DroppedAttribute[] =
    type !== 'character' && existing.length > 0
      ? [{ from: id, attribute: 'modifiers', value: existing }]
      : []

  return ok(edit([...nodes.slice(0, index), retyped, ...nodes.slice(index + 1)], [], dropped))
}

/**
 * What the clipboard carries.
 *
 * `origin` is the document the nodes were taken from. It is what separates
 * "cut from here" from "copied from another episode" - without it the two are
 * indistinguishable, since both look like an id that is currently absent.
 */
export type Clipboard = {
  readonly origin: ScreenplayDocument['id']
  readonly nodes: readonly ScreenplayNode[]
}

/**
 * Paste into a document.
 *
 * A clipboard node keeps its id when it came from this document and that id is
 * currently absent; otherwise it takes the next of `freshIds`. Supply one fresh
 * id per clipboard node - unused ones are ignored, which keeps the operation
 * deterministic rather than having it reach for a generator.
 */
export const pasteNodes = (
  document: ScreenplayDocument,
  clipboard: Clipboard,
  index: number,
  freshIds: readonly NodeId[],
): Result<Edit, OperationError> => {
  if (index < 0 || index > document.nodes.length) {
    return err({ kind: 'index-out-of-range', index, length: document.nodes.length })
  }
  if (freshIds.length < clipboard.nodes.length) {
    return err({
      kind: 'not-enough-ids',
      needed: clipboard.nodes.length,
      supplied: freshIds.length,
    })
  }

  const sameDocument = clipboard.origin === document.id
  const taken = new Set<NodeId>(idsOf(document.nodes))
  const pasted: ScreenplayNode[] = []
  const identity: IdentityEvent[] = []

  for (let i = 0; i < clipboard.nodes.length; i += 1) {
    const source = clipboard.nodes[i]
    if (source === undefined) continue
    const preserve = sameDocument && !taken.has(source.id)
    const fresh = freshIds[i]
    if (!preserve && fresh === undefined) {
      return err({ kind: 'not-enough-ids', needed: clipboard.nodes.length, supplied: freshIds.length })
    }
    const assigned = preserve ? source.id : fresh
    if (assigned === undefined) {
      return err({ kind: 'not-enough-ids', needed: clipboard.nodes.length, supplied: freshIds.length })
    }
    if (taken.has(assigned)) return err({ kind: 'id-already-present', id: assigned })
    taken.add(assigned)
    pasted.push(
      makeScreenplayNode(source.type, {
        id: assigned,
        provenance: source.provenance,
        content: source.content,
        modifiers: modifiersOf(source),
      }),
    )
    identity.push(preserve ? { kind: 'restored', id: assigned } : { kind: 'created', id: assigned })
  }

  return ok(
    edit(
      [...document.nodes.slice(0, index), ...pasted, ...document.nodes.slice(index)],
      identity,
    ),
  )
}
