import type {
  DeliveryModifier,
  InlineRun,
  MentionEntity,
  ModelDefect,
  NodeId,
  Provenance,
  Result,
  ScreenplayNode,
  ScreenplayNodeType,
} from '@folio/script'
import { DELIVERY_MODIFIERS, MENTION_ENTITIES, isScreenplayNodeType, readScreenplayNode, typed } from '@folio/script'
import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import type { ScriptInline } from './inline'
import { MENTION_TYPE } from './inline'

/**
 * Where ProseMirror's node shape meets `@folio/script`'s union - and the
 * only place.
 *
 * Tiptap edits an immutable ProseMirror document. `@folio/script` owns a
 * closed union of eight typed nodes with inline runs. The two must never be
 * confused, and this file is the whole of their contact:
 *
 *   `toDoc`    ScreenplayNode[]   ->  JSONContent          (on load)
 *   `fromDoc`  ProseMirrorNode    ->  ScreenplayNode[]     (on save, on measure)
 *
 * **The wire shape is the node list, never ProseMirror JSON.** `toDoc` is a
 * load-time projection; nothing persists what it makes. What goes to the
 * server is what `fromDoc` reads back through `readScreenplayNode`, the
 * strict wire reader, which rejects an unknown type, an unknown field, a
 * pagination field, an empty or a duplicate id. So a shape the editor
 * introduced cannot be *saved*; the editor cannot become authoritative by
 * accident because the wire will not carry what it made up.
 *
 * ## What stops them drifting
 *
 * 1. The block node names *are* `ScreenplayNodeType`. `BLOCK_TYPE_COVERAGE`
 *    is a `Record<ScreenplayNodeType, ...>` so a ninth type added to the
 *    union without an extension stops compiling here and in
 *    `editor/extensions/blocks.ts`.
 * 2. The schema is closed: `doc` holds `block+`, the eight blocks hold
 *    `inline*` with no marks, and the only inline nodes are `text` and
 *    `mention`. ProseMirror refuses to build anything else, so there is no
 *    normaliser to keep honest.
 * 3. The editor mints nothing on its own. `id` is `null` on a node the
 *    editor creates and `editor/extensions/identity.ts` mints under ADR
 *    0001's rules before the transaction is applied. `fromDoc` treats a
 *    `null` id as the defect it is.
 *
 * ## Attributes
 *
 *   id          the node id; `null` only between a split and the identity
 *               plugin's appended transaction
 *   provenance  `typed` or `agent` + run, carried as the same object the
 *               model uses
 *   modifiers   the character's delivery modifiers; `[]` on every other type
 *   origin      transient: the document a pasted block came from, read off
 *               `data-doc`, cleared by the clipboard extension; never saved
 */

export const BLOCK_TYPE_COVERAGE: Readonly<Record<ScreenplayNodeType, ScreenplayNodeType>> = {
  scene: 'scene',
  action: 'action',
  character: 'character',
  paren: 'paren',
  dialogue: 'dialogue',
  transition: 'transition',
  comment: 'comment',
  subtitle: 'subtitle',
}

type MentionIsNotABlockType = typeof MENTION_TYPE extends ScreenplayNodeType ? never : true
const MENTION_IS_NOT_A_BLOCK_TYPE: MentionIsNotABlockType = true
void MENTION_IS_NOT_A_BLOCK_TYPE

/** The attributes every block carries. `id` is `null` only transiently; see the header. */
export type BlockAttrs = {
  readonly id: NodeId | null
  readonly provenance: Provenance
  readonly modifiers: readonly DeliveryModifier[]
  readonly origin: string | null
}

export type MentionAttrs = {
  readonly entity: MentionEntity
  readonly id: string
}

export const DEFAULT_BLOCK_ATTRS: BlockAttrs = { id: null, provenance: typed(), modifiers: [], origin: null }

// ---------------------------------------------------------------------------
// Reading attributes off a ProseMirror node, without trusting them
// ---------------------------------------------------------------------------

const isProvenance = (value: unknown): value is Provenance => {
  if (typeof value !== 'object' || value === null) return false
  const source = (value as { source?: unknown }).source
  if (source === 'typed') return true
  return source === 'agent' && typeof (value as { runId?: unknown }).runId === 'string'
}

const isModifiers = (value: unknown): value is readonly DeliveryModifier[] =>
  Array.isArray(value) && value.every((entry) => (DELIVERY_MODIFIERS as readonly unknown[]).includes(entry))

/** A block's attributes, read strictly. Unknown or malformed attributes fall back to the defaults. */
export const blockAttrsOf = (node: ProseMirrorNode): BlockAttrs => {
  const attrs = node.attrs as Record<string, unknown>
  const id = attrs['id']
  const provenance = attrs['provenance']
  const modifiers = attrs['modifiers']
  const origin = attrs['origin']
  return {
    id: typeof id === 'string' && id !== '' ? (id as NodeId) : null,
    provenance: isProvenance(provenance) ? provenance : typed(),
    modifiers: isModifiers(modifiers) ? modifiers : [],
    origin: typeof origin === 'string' ? origin : null,
  }
}

export const blockTypeOf = (node: ProseMirrorNode): ScreenplayNodeType | null =>
  isScreenplayNodeType(node.type.name) ? node.type.name : null

export const mentionAttrsOf = (node: ProseMirrorNode): MentionAttrs | null => {
  if (node.type.name !== MENTION_TYPE) return null
  const attrs = node.attrs as Record<string, unknown>
  const entity = attrs['entity']
  const id = attrs['id']
  if (typeof entity !== 'string' || !(MENTION_ENTITIES as readonly string[]).includes(entity)) return null
  if (typeof id !== 'string') return null
  return { entity: entity as MentionEntity, id }
}

// ---------------------------------------------------------------------------
// Model -> ProseMirror JSON
// ---------------------------------------------------------------------------

const toInlineJson = (run: InlineRun): JSONContent =>
  run.kind === 'text'
    ? { type: 'text', text: run.text }
    : { type: MENTION_TYPE, attrs: { entity: run.target.entity, id: run.target.id } }

/**
 * One block. Empty text runs are dropped: ProseMirror does not represent an
 * empty text node, and `normaliseContent` never produces one anyway.
 */
export const toBlock = (node: ScreenplayNode): JSONContent => ({
  type: node.type,
  attrs: {
    id: node.id,
    provenance: node.provenance,
    modifiers: node.type === 'character' ? node.modifiers : [],
    origin: null,
  },
  content: node.content.filter((run) => run.kind !== 'text' || run.text !== '').map(toInlineJson),
})

export const toDoc = (nodes: readonly ScreenplayNode[]): JSONContent => ({
  type: 'doc',
  content: nodes.map(toBlock),
})

// ---------------------------------------------------------------------------
// ProseMirror -> model
// ---------------------------------------------------------------------------

export type PmDefect =
  | { readonly kind: 'not-a-block-type'; readonly index: number; readonly type: string }
  | { readonly kind: 'bad-inline'; readonly index: number; readonly child: number }
  | { readonly kind: 'model'; readonly index: number; readonly defect: ModelDefect }

const inlineChildren = new WeakMap<ProseMirrorNode, readonly ScriptInline[]>()

/**
 * A block's inline children in the sheet's neutral shape, remembered on the
 * block node. ProseMirror keeps every block a change did not touch as the
 * same object, so a keystroke converts one block and looks the rest up -
 * which is what keeps `lineEndsOfBlock`'s cache keyed on the same node.
 */
export const inlineChildrenOf = (block: ProseMirrorNode): readonly ScriptInline[] => {
  const hit = inlineChildren.get(block)
  if (hit !== undefined) return hit
  const out: ScriptInline[] = []
  block.forEach((child) => {
    if (child.isText) {
      out.push({ text: child.text ?? '' })
      return
    }
    const mention = mentionAttrsOf(child)
    if (mention !== null) out.push({ type: MENTION_TYPE, entity: mention.entity, id: mention.id })
  })
  inlineChildren.set(block, out)
  return out
}

/**
 * Inline children to the wire shape of inline runs, as plain objects for
 * `readScreenplayNode` to validate. A mark or a foreign inline node is a
 * `bad-inline` here; the schema forbids both, so this is the proof rather
 * than the guard.
 */
const fromInline = (block: ProseMirrorNode, index: number): Result<readonly unknown[], PmDefect> => {
  const runs: unknown[] = []
  let failed: PmDefect | null = null
  block.forEach((child, _offset, at) => {
    if (failed !== null) return
    if (child.isText) {
      if (child.marks.length > 0) {
        failed = { kind: 'bad-inline', index, child: at }
        return
      }
      if (child.text !== '') runs.push({ kind: 'text', text: child.text })
      return
    }
    const mention = mentionAttrsOf(child)
    if (mention === null) {
      failed = { kind: 'bad-inline', index, child: at }
      return
    }
    runs.push({ kind: 'mention', target: { entity: mention.entity, id: mention.id } })
  })
  return failed === null ? { ok: true, value: runs } : { ok: false, error: failed }
}

export const fromBlock = (block: ProseMirrorNode, index: number): Result<ScreenplayNode, PmDefect> => {
  const type = block.type.name
  if (!isScreenplayNodeType(type)) return { ok: false, error: { kind: 'not-a-block-type', index, type } }
  const content = fromInline(block, index)
  if (!content.ok) return content
  const attrs = blockAttrsOf(block)
  const wire: Record<string, unknown> = {
    type,
    id: attrs.id ?? '',
    provenance: attrs.provenance,
    content: content.value,
  }
  if (type === 'character') wire['modifiers'] = attrs.modifiers
  const node = readScreenplayNode(wire)
  if (!node.ok) return { ok: false, error: { kind: 'model', index, defect: node.error } }
  return node
}

/**
 * The whole document, read strictly. First defect wins, as the reader does.
 *
 * Duplicate ids are refused here rather than trusted to the identity plugin:
 * that plugin prevents them, this one proves they were prevented.
 */
export const fromDoc = (doc: ProseMirrorNode): Result<readonly ScreenplayNode[], PmDefect> => {
  const nodes: ScreenplayNode[] = []
  const seen = new Set<string>()
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = fromBlock(doc.child(index), index)
    if (!node.ok) return node
    if (seen.has(node.value.id)) {
      return {
        ok: false,
        error: { kind: 'model', index, defect: { at: 'id', reason: { kind: 'duplicate-node-id', id: node.value.id } } },
      }
    }
    seen.add(node.value.id)
    nodes.push(node.value)
  }
  return { ok: true, value: nodes }
}

/** Every block id in document order; `''` for a block still waiting on the identity plugin. */
export const idsOf = (doc: ProseMirrorNode): readonly string[] => {
  const ids: string[] = []
  doc.forEach((block) => {
    ids.push(blockAttrsOf(block).id ?? '')
  })
  return ids
}
