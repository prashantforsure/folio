import type { OperationError } from './edit'
import type { NodeId } from './ids'
import type { InlineContent, InlineRun } from './inline'
import type { DeliveryModifier, ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode, modifiersOf } from './node'
import { changeNodeType, deleteNodes, insertNodes, reorderNode } from './operations'
import type { OutlineNode, OutlineNodeType } from './outline'
import type { Provenance } from './provenance'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Node-level operations the agent proposes - roadmap task 3.4, ADR 0003
 * **D10**.
 *
 * The agent never sends a node list. It sends a short list of operations
 * against node ids, and the same pure function applies them wherever the
 * document is: in the writer's open editor (path A) or on the server under a
 * compare-and-swap (path B). One function, two places, so the editor and the
 * server cannot disagree about what "insert after this heading" means.
 *
 * ## Five operations
 *
 *   - `insert_after` - new nodes after an anchor node, or at the start.
 *   - `replace_content` - a node's text, and a cue's delivery modifiers.
 *   - `change_type` - the same node, another type; the id survives.
 *   - `delete` - nodes by id; the ids are retired.
 *   - `move` - one node to after another, or to the start.
 *
 * Every inserted node arrives with its id already minted - the pure core
 * never mints one (ADR 0001 Ruling 6) - and every node the operations write
 * is stamped with the provenance the caller passes: `byAgent(run)` for the
 * agent (D11). A retype keeps the node's provenance, as `changeNodeType`
 * always has: the words did not change hands.
 *
 * For the script these are the existing operations (`operations.ts`); the
 * outline had none until now, so it gets list operations of its own below,
 * with the same errors.
 *
 * ## Failure is data
 *
 * The first operation that cannot apply stops the list and comes back as
 * `{ at, error }` - which operation, and why - never a throw.
 *
 * ## Undoing an edit
 *
 * `restoreOps(current, before, after)` is what "undo this run" proposes when
 * a document changed after the agent edited it: the operations that take back
 * the agent's changes (`before` -> `after`) **without** touching anything the
 * writer did since. A node the agent inserted is deleted if it is still there;
 * one it deleted is put back after its old neighbour; one it rewrote is put
 * back only if it still reads as the agent left it. The writer's own edits are
 * never the undo's to reverse.
 */

export type Anchor = NodeId | 'start'

/** A node an operation writes. `modifiers` only on a cue, and `[]` everywhere else. */
export type NodeDraft<T extends string> = {
  readonly id: NodeId
  readonly type: T
  readonly content: InlineContent
  readonly modifiers: readonly DeliveryModifier[]
}

export type DocumentOp<T extends string> =
  | { readonly op: 'insert_after'; readonly anchor: Anchor; readonly nodes: readonly NodeDraft<T>[] }
  /** `modifiers: null` keeps the node's own. */
  | { readonly op: 'replace_content'; readonly id: NodeId; readonly content: InlineContent; readonly modifiers: readonly DeliveryModifier[] | null }
  | { readonly op: 'change_type'; readonly id: NodeId; readonly type: T }
  | { readonly op: 'delete'; readonly ids: readonly NodeId[] }
  | { readonly op: 'move'; readonly id: NodeId; readonly after: Anchor }

export type ScriptOp = DocumentOp<ScreenplayNodeType>

export type OutlineOp = DocumentOp<OutlineNodeType>

export type NodeOpError =
  | { readonly kind: 'node-not-found'; readonly id: NodeId }
  | { readonly kind: 'id-already-present'; readonly id: NodeId }
  | { readonly kind: 'modifiers-not-on-cue'; readonly id: NodeId }
  | { readonly kind: 'rule-has-no-content'; readonly id: NodeId }
  | { readonly kind: 'move-after-itself'; readonly id: NodeId }
  | { readonly kind: 'empty'; readonly op: DocumentOp<string>['op'] }
  /** An index an operation computed fell outside the list - a bug here, reported rather than thrown. */
  | { readonly kind: 'out-of-range' }

export type NodeOpFailure = { readonly at: number; readonly error: NodeOpError }

/** The error, in the words the agent and the card read. */
export const describeNodeOpError = (failure: NodeOpFailure): string => {
  const n = `Operation ${String(failure.at + 1)}`
  const { error } = failure
  switch (error.kind) {
    case 'node-not-found':
      return `${n}: there is no node ${error.id} in the document.`
    case 'id-already-present':
      return `${n}: the id ${error.id} is already in the document.`
    case 'modifiers-not-on-cue':
      return `${n}: only a character cue carries (V.O.), (O.S.) or (O.C.).`
    case 'rule-has-no-content':
      return `${n}: a rule has no text.`
    case 'move-after-itself':
      return `${n}: a node cannot move after itself.`
    case 'empty':
      return `${n}: ${error.op} names nothing.`
    case 'out-of-range':
      return `${n} could not be placed.`
  }
}

// ---------------------------------------------------------------------------
// Equality - a node is the same when everything the reader stores is the same
// ---------------------------------------------------------------------------

const sameRun = (a: InlineRun, b: InlineRun): boolean =>
  a.kind === 'text' ? b.kind === 'text' && a.text === b.text : b.kind === 'mention' && a.target.entity === b.target.entity && a.target.id === b.target.id

export const sameContent = (a: InlineContent, b: InlineContent): boolean => a.length === b.length && a.every((run, index) => {
  const other = b[index]
  return other !== undefined && sameRun(run, other)
})

const sameProvenance = (a: Provenance, b: Provenance): boolean =>
  a.source === b.source && (a.source === 'typed' || (b.source === 'agent' && a.runId === b.runId))

const sameModifiers = (a: readonly DeliveryModifier[], b: readonly DeliveryModifier[]): boolean => a.length === b.length && a.every((value, index) => b[index] === value)

// ---------------------------------------------------------------------------
// The engine, over either document kind
// ---------------------------------------------------------------------------

type Kind<N extends { readonly id: NodeId }, T extends string> = {
  readonly build: (draft: NodeDraft<T>, provenance: Provenance) => Result<N, NodeOpError>
  readonly typeOf: (node: N) => T
  readonly contentOf: (node: N) => InlineContent | null
  readonly modifiersOf: (node: N) => readonly DeliveryModifier[]
  readonly provenanceOf: (node: N) => Provenance
  readonly insert: (nodes: readonly N[], index: number, incoming: readonly N[]) => Result<readonly N[], NodeOpError>
  readonly remove: (nodes: readonly N[], ids: readonly NodeId[]) => Result<readonly N[], NodeOpError>
  readonly reorder: (nodes: readonly N[], from: number, to: number) => readonly N[]
  readonly retype: (nodes: readonly N[], id: NodeId, type: T) => Result<readonly N[], NodeOpError>
}

const indexOf = <N extends { readonly id: NodeId }>(nodes: readonly N[], id: NodeId): number => nodes.findIndex((node) => node.id === id)

const applyWith = <N extends { readonly id: NodeId }, T extends string>(
  kind: Kind<N, T>,
  nodes: readonly N[],
  ops: readonly DocumentOp<T>[],
  provenance: Provenance,
): Result<readonly N[], NodeOpFailure> => {
  let list = nodes
  for (const [at, op] of ops.entries()) {
    const fail = (error: NodeOpError): Result<never, NodeOpFailure> => err({ at, error })
    switch (op.op) {
      case 'insert_after': {
        if (op.nodes.length === 0) return fail({ kind: 'empty', op: op.op })
        const index = op.anchor === 'start' ? 0 : indexOf(list, op.anchor) + 1
        if (op.anchor !== 'start' && index === 0) return fail({ kind: 'node-not-found', id: op.anchor })
        const built: N[] = []
        for (const draft of op.nodes) {
          const node = kind.build(draft, provenance)
          if (!node.ok) return fail(node.error)
          built.push(node.value)
        }
        const next = kind.insert(list, index, built)
        if (!next.ok) return fail(next.error)
        list = next.value
        break
      }
      case 'replace_content': {
        const index = indexOf(list, op.id)
        const node = list[index]
        if (node === undefined) return fail({ kind: 'node-not-found', id: op.id })
        const rebuilt = kind.build({ id: node.id, type: kind.typeOf(node), content: op.content, modifiers: op.modifiers ?? kind.modifiersOf(node) }, provenance)
        if (!rebuilt.ok) return fail(rebuilt.error)
        list = [...list.slice(0, index), rebuilt.value, ...list.slice(index + 1)]
        break
      }
      case 'change_type': {
        const next = kind.retype(list, op.id, op.type)
        if (!next.ok) return fail(next.error)
        list = next.value
        break
      }
      case 'delete': {
        if (op.ids.length === 0) return fail({ kind: 'empty', op: op.op })
        const next = kind.remove(list, op.ids)
        if (!next.ok) return fail(next.error)
        list = next.value
        break
      }
      case 'move': {
        if (op.after === op.id) return fail({ kind: 'move-after-itself', id: op.id })
        const from = indexOf(list, op.id)
        if (from === -1) return fail({ kind: 'node-not-found', id: op.id })
        const without = list.filter((node) => node.id !== op.id)
        const to = op.after === 'start' ? 0 : indexOf(without, op.after) + 1
        if (op.after !== 'start' && to === 0) return fail({ kind: 'node-not-found', id: op.after })
        list = kind.reorder(list, from, to)
        break
      }
    }
  }
  return ok(list)
}

/** The ops that take back the agent's changes (`before` -> `after`) on top of `current`. See the header. */
const restoreWith = <N extends { readonly id: NodeId }, T extends string>(
  kind: Kind<N, T>,
  current: readonly N[],
  before: readonly N[],
  after: readonly N[],
): readonly DocumentOp<T>[] => {
  const same = (a: N, b: N): boolean => {
    const contentA = kind.contentOf(a)
    const contentB = kind.contentOf(b)
    return (
      kind.typeOf(a) === kind.typeOf(b) &&
      (contentA === null ? contentB === null : contentB !== null && sameContent(contentA, contentB)) &&
      sameModifiers(kind.modifiersOf(a), kind.modifiersOf(b)) &&
      sameProvenance(kind.provenanceOf(a), kind.provenanceOf(b))
    )
  }
  const beforeById = new Map(before.map((node) => [node.id, node]))
  const afterById = new Map(after.map((node) => [node.id, node]))
  const present = new Set(current.map((node) => node.id))
  const currentById = new Map(current.map((node) => [node.id, node]))
  const ops: DocumentOp<T>[] = []

  // What the agent inserted and is still there goes.
  const inserted = after.filter((node) => !beforeById.has(node.id) && present.has(node.id)).map((node) => node.id)
  if (inserted.length > 0) {
    ops.push({ op: 'delete', ids: inserted })
    for (const id of inserted) present.delete(id)
  }

  // What the agent deleted comes back after its old neighbour, in the old order.
  let previous: Anchor = 'start'
  let run: { anchor: Anchor; nodes: NodeDraft<T>[] } | null = null
  const flush = (): void => {
    if (run !== null && run.nodes.length > 0) ops.push({ op: 'insert_after', anchor: run.anchor, nodes: run.nodes })
    run = null
  }
  for (const node of before) {
    const deletedByAgent = !afterById.has(node.id)
    if (deletedByAgent && !present.has(node.id)) {
      run ??= { anchor: previous, nodes: [] }
      run.nodes.push({ id: node.id, type: kind.typeOf(node), content: kind.contentOf(node) ?? [], modifiers: kind.modifiersOf(node) })
      present.add(node.id)
      previous = node.id
      continue
    }
    flush()
    if (present.has(node.id)) previous = node.id
  }
  flush()

  // What the agent rewrote goes back - only where it still reads as the agent left it.
  for (const node of before) {
    const left = afterById.get(node.id)
    const now = currentById.get(node.id)
    if (left === undefined || now === undefined || same(node, left) || !same(now, left)) continue
    if (kind.typeOf(node) !== kind.typeOf(left)) ops.push({ op: 'change_type', id: node.id, type: kind.typeOf(node) })
    const content = kind.contentOf(node)
    if (content !== null) ops.push({ op: 'replace_content', id: node.id, content, modifiers: kind.modifiersOf(node) })
  }
  return ops
}

// ---------------------------------------------------------------------------
// The script: the seven operations
// ---------------------------------------------------------------------------

/** The operations' errors, as the few this module can meet: an insert, a delete and a retype fail only on an id. */
const opError = (error: OperationError): NodeOpError => {
  switch (error.kind) {
    case 'node-not-found':
    case 'id-already-present':
      return { kind: error.kind, id: error.id }
    default:
      return { kind: 'out-of-range' }
  }
}

const SCRIPT: Kind<ScreenplayNode, ScreenplayNodeType> = {
  build: (draft, provenance) => {
    if (draft.type !== 'character' && draft.modifiers.length > 0) return err({ kind: 'modifiers-not-on-cue', id: draft.id })
    return ok(makeScreenplayNode(draft.type, { id: draft.id, provenance, content: draft.content, modifiers: draft.modifiers }))
  },
  typeOf: (node) => node.type,
  contentOf: (node) => node.content,
  modifiersOf,
  provenanceOf: (node) => node.provenance,
  insert: (nodes, index, incoming) => {
    const result = insertNodes(nodes, index, incoming)
    return result.ok ? ok(result.value.nodes) : err(opError(result.error))
  },
  remove: (nodes, ids) => {
    const result = deleteNodes(nodes, ids)
    return result.ok ? ok(result.value.nodes) : err(opError(result.error))
  },
  reorder: (nodes, from, to) => {
    const result = reorderNode(nodes, from, to)
    return result.ok ? result.value.nodes : nodes
  },
  retype: (nodes, id, type) => {
    const result = changeNodeType(nodes, id, type)
    return result.ok ? ok(result.value.nodes) : err(opError(result.error))
  },
}

/** Apply operations to a script's node list, stamping what they write with `provenance`. */
export const applyScriptOps = (nodes: readonly ScreenplayNode[], ops: readonly ScriptOp[], provenance: Provenance): Result<readonly ScreenplayNode[], NodeOpFailure> =>
  applyWith(SCRIPT, nodes, ops, provenance)

/** The operations that take back the agent's changes to a script without undoing the writer's since. */
export const restoreScriptOps = (current: readonly ScreenplayNode[], before: readonly ScreenplayNode[], after: readonly ScreenplayNode[]): readonly ScriptOp[] =>
  restoreWith(SCRIPT, current, before, after)

// ---------------------------------------------------------------------------
// The outline: list operations of its own
// ---------------------------------------------------------------------------

export const makeOutlineNode = (type: OutlineNodeType, parts: { readonly id: NodeId; readonly provenance: Provenance; readonly content: InlineContent }): OutlineNode => {
  const base = { id: parts.id, provenance: parts.provenance }
  switch (type) {
    case 'rule':
      return { type: 'rule', ...base }
    case 'body':
      return { type: 'body', ...base, content: parts.content }
    case 'h1':
      return { type: 'h1', ...base, content: parts.content }
    case 'h2':
      return { type: 'h2', ...base, content: parts.content }
    case 'h3':
      return { type: 'h3', ...base, content: parts.content }
    case 'quote':
      return { type: 'quote', ...base, content: parts.content }
    case 'beat':
      return { type: 'beat', ...base, content: parts.content }
  }
}

const outlineContent = (node: OutlineNode): InlineContent | null => (node.type === 'rule' ? null : node.content)

const OUTLINE: Kind<OutlineNode, OutlineNodeType> = {
  build: (draft, provenance) => {
    if (draft.modifiers.length > 0) return err({ kind: 'modifiers-not-on-cue', id: draft.id })
    if (draft.type === 'rule' && draft.content.length > 0) return err({ kind: 'rule-has-no-content', id: draft.id })
    return ok(makeOutlineNode(draft.type, { id: draft.id, provenance, content: draft.content }))
  },
  typeOf: (node) => node.type,
  contentOf: outlineContent,
  modifiersOf: () => [],
  provenanceOf: (node) => node.provenance,
  insert: (nodes, index, incoming) => {
    const present = new Set(nodes.map((node) => node.id))
    for (const node of incoming) {
      if (present.has(node.id)) return err({ kind: 'id-already-present', id: node.id })
      present.add(node.id)
    }
    return ok([...nodes.slice(0, index), ...incoming, ...nodes.slice(index)])
  },
  remove: (nodes, ids) => {
    const present = new Set(nodes.map((node) => node.id))
    for (const id of ids) if (!present.has(id)) return err({ kind: 'node-not-found', id })
    const removing = new Set(ids)
    return ok(nodes.filter((node) => !removing.has(node.id)))
  },
  reorder: (nodes, from, to) => {
    const moving = nodes[from]
    if (moving === undefined) return nodes
    const without = [...nodes.slice(0, from), ...nodes.slice(from + 1)]
    return [...without.slice(0, to), moving, ...without.slice(to)]
  },
  retype: (nodes, id, type) => {
    const index = indexOf(nodes, id)
    const node = nodes[index]
    if (node === undefined) return err({ kind: 'node-not-found', id })
    // A retype keeps the node's provenance and its text; a rule has none to keep.
    const retyped = makeOutlineNode(type, { id: node.id, provenance: node.provenance, content: outlineContent(node) ?? [] })
    return ok([...nodes.slice(0, index), retyped, ...nodes.slice(index + 1)])
  },
}

/** Apply operations to an outline's node list. */
export const applyOutlineOps = (nodes: readonly OutlineNode[], ops: readonly OutlineOp[], provenance: Provenance): Result<readonly OutlineNode[], NodeOpFailure> =>
  applyWith(OUTLINE, nodes, ops, provenance)

/** The operations that take back the agent's changes to an outline without undoing the writer's since. */
export const restoreOutlineOps = (current: readonly OutlineNode[], before: readonly OutlineNode[], after: readonly OutlineNode[]): readonly OutlineOp[] =>
  restoreWith(OUTLINE, current, before, after)

/** Every id an operation list inserts - what a caller mints before and checks after. */
export const insertedIds = <T extends string>(ops: readonly DocumentOp<T>[]): readonly NodeId[] =>
  ops.flatMap((op) => (op.op === 'insert_after' ? op.nodes.map((node) => node.id) : []))
