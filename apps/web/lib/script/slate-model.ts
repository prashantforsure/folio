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
import {
  MENTION_ENTITIES,
  SCREENPLAY_NODE_TYPES,
  isScreenplayNodeType,
  readScreenplayNode,
} from '@folio/script'

/**
 * Where Slate's node shape meets `@folio/script`'s union - and the only place.
 *
 * Plate edits a tree of `{ type, children }` objects. `@folio/script` owns a
 * closed union of eight typed nodes with inline runs. The two must never be
 * confused, and this file is the whole of their contact:
 *
 *   `toSlateValue`    ScreenplayNode[]  ->  ScriptValue        (on load)
 *   `fromSlateValue`  unknown           ->  ScreenplayNode[]   (on save)
 *
 * ## What stops them drifting
 *
 * 1. **`ScriptElement.type` is `ScreenplayNodeType`.** Not a string. The
 *    element components, the keyboard model and the type bar are all keyed by
 *    the union's own discriminant, so a ninth type cannot be named in the
 *    editor without first being added to the union - where it would be a
 *    change to the node schema, which needs an ADR.
 *
 * 2. **`fromSlateValue` goes through `readScreenplayNode`**, the strict wire
 *    reader in `@folio/script`. It rejects an unknown `type`, an unknown
 *    field, a pagination field, an empty or duplicate id. So a shape Plate
 *    introduced - a `p` paragraph from a core plugin, a mark, an `indent`
 *    prop - cannot be *saved*. It is a `ModelDefect` and the save refuses.
 *    The editor cannot become authoritative by accident because the wire
 *    will not carry what it made up.
 *
 * 3. **The mapping is exhaustive both ways** and the compiler checks it:
 *    `ELEMENT_TYPE_COVERAGE` is a `Record<ScreenplayNodeType, ...>` so a type
 *    added to the union without a rendering entry stops compiling, and
 *    `mentionRun` / `mentionElement` are typed on `MentionEntity` so an
 *    inline kind added to `InlineRun` breaks `fromInlineChildren`.
 *
 * 4. **Plate mints nothing.** `nodeId: false` in `plate-editor.tsx` disables
 *    the core NodeIdPlugin, so no Plate code ever writes an `id`. Every id on
 *    a Slate element is one `@folio/script` gave it at load or one
 *    `identity.ts` minted on an operation, under ADR 0001's rules.
 *
 * What Slate keeps that the model does not: nothing. What the model keeps
 * that Slate does not: nothing either - `provenance` rides on the element as
 * an opaque prop so a typed node stays typed and an agent node stays the
 * agent's, and it goes back out through the same reader.
 */

// ---------------------------------------------------------------------------
// Slate-side shapes
// ---------------------------------------------------------------------------

/** The inline mention. Not one of the eight - it lives *inside* one. */
export const MENTION_TYPE = 'mention' as const

export type ScriptText = { readonly text: string }

export type ScriptMentionElement = {
  readonly type: typeof MENTION_TYPE
  readonly entity: MentionEntity
  readonly id: string
  /** Slate requires a void to carry one empty text. Mutable, as Slate's tree is. */
  children: [ScriptText]
}

export type ScriptInline = ScriptText | ScriptMentionElement

/** One block. Its `type` *is* the union's discriminant. */
export type ScriptElement = {
  readonly type: ScreenplayNodeType
  readonly id: NodeId
  readonly modifiers: readonly DeliveryModifier[]
  readonly provenance: Provenance
  /** Mutable, because Slate's `TElement` is; the model side is `readonly`. */
  children: ScriptInline[]
}

export type ScriptValue = readonly ScriptElement[]

/**
 * The compile-time proof that the editor knows every type and no other.
 * Add a ninth node type to `@folio/script` and this record stops compiling.
 */
export const ELEMENT_TYPE_COVERAGE: Readonly<Record<ScreenplayNodeType, ScreenplayNodeType>> = {
  scene: 'scene',
  action: 'action',
  character: 'character',
  paren: 'paren',
  dialogue: 'dialogue',
  transition: 'transition',
  comment: 'comment',
  subtitle: 'subtitle',
}

/**
 * `'mention'` is not a block type. Asserted at the type level so the two
 * namespaces stay apart: if `mention` ever joined the union this alias would
 * become `never` and the constant below would stop compiling.
 */
type MentionIsNotABlockType = typeof MENTION_TYPE extends ScreenplayNodeType ? never : true
const MENTION_IS_NOT_A_BLOCK_TYPE: MentionIsNotABlockType = true
void MENTION_IS_NOT_A_BLOCK_TYPE

export const isMentionElement = (value: unknown): value is ScriptMentionElement =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === MENTION_TYPE

export const isScriptElement = (value: unknown): value is ScriptElement =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  isScreenplayNodeType((value as { type: string }).type) &&
  Array.isArray((value as { children?: unknown }).children)

// ---------------------------------------------------------------------------
// Model -> Slate
// ---------------------------------------------------------------------------

const mentionElement = (run: Extract<InlineRun, { kind: 'mention' }>): ScriptMentionElement => ({
  type: MENTION_TYPE,
  entity: run.target.entity,
  id: run.target.id,
  children: [{ text: '' }],
})

/**
 * Inline runs to Slate children. Slate needs a text node between and around
 * inline voids, so an empty text is inserted wherever two mentions touch or a
 * mention starts or ends the block - Slate's own normaliser would add them
 * anyway; doing it here keeps the loaded value already normal.
 */
const toInlineChildren = (content: readonly InlineRun[]): ScriptInline[] => {
  const out: ScriptInline[] = []
  for (const run of content) {
    if (run.kind === 'text') {
      out.push({ text: run.text })
      continue
    }
    const last = out[out.length - 1]
    if (last === undefined || isMentionElement(last)) out.push({ text: '' })
    out.push(mentionElement(run))
  }
  const last = out[out.length - 1]
  if (last === undefined || isMentionElement(last)) out.push({ text: '' })
  return out
}

export const toSlateElement = (node: ScreenplayNode): ScriptElement => ({
  type: node.type,
  id: node.id,
  modifiers: node.type === 'character' ? node.modifiers : [],
  provenance: node.provenance,
  children: toInlineChildren(node.content),
})

export const toSlateValue = (nodes: readonly ScreenplayNode[]): ScriptValue =>
  nodes.map(toSlateElement)

// ---------------------------------------------------------------------------
// Slate -> model
// ---------------------------------------------------------------------------

export type SlateDefect =
  | { readonly kind: 'not-an-element'; readonly index: number }
  | { readonly kind: 'not-a-block-type'; readonly index: number; readonly type: string }
  | { readonly kind: 'bad-inline'; readonly index: number; readonly child: number }
  | { readonly kind: 'model'; readonly index: number; readonly defect: ModelDefect }

const isText = (value: unknown): value is ScriptText =>
  typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string'

/**
 * Slate children to the wire shape of inline runs.
 *
 * Deliberately produces the *wire* shape (`{ kind, text }`, `{ kind, target }`)
 * as plain objects and lets `readScreenplayNode` validate it, rather than
 * constructing model values directly. A mark Plate might have added to a
 * text node (`bold: true`) is an unexpected field here and would fail the
 * strict reader downstream - which is the point.
 */
const fromInlineChildren = (
  children: readonly unknown[],
  index: number,
): Result<readonly unknown[], SlateDefect> => {
  const runs: unknown[] = []
  for (let child = 0; child < children.length; child += 1) {
    const value = children[child]
    if (isText(value)) {
      const keys = Object.keys(value)
      if (keys.length !== 1) return { ok: false, error: { kind: 'bad-inline', index, child } }
      if (value.text !== '') runs.push({ kind: 'text', text: value.text })
      continue
    }
    if (isMentionElement(value)) {
      if (!(MENTION_ENTITIES as readonly string[]).includes(value.entity)) {
        return { ok: false, error: { kind: 'bad-inline', index, child } }
      }
      runs.push({ kind: 'mention', target: { entity: value.entity, id: value.id } })
      continue
    }
    return { ok: false, error: { kind: 'bad-inline', index, child } }
  }
  return { ok: true, value: runs }
}

export const fromSlateElement = (
  value: unknown,
  index: number,
): Result<ScreenplayNode, SlateDefect> => {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: { kind: 'not-an-element', index } }
  }
  const element = value as {
    readonly type?: unknown
    readonly id?: unknown
    readonly modifiers?: unknown
    readonly provenance?: unknown
    readonly children?: unknown
  }
  if (typeof element.type !== 'string' || !isScreenplayNodeType(element.type)) {
    return {
      ok: false,
      error: { kind: 'not-a-block-type', index, type: String(element.type) },
    }
  }
  if (!Array.isArray(element.children)) return { ok: false, error: { kind: 'not-an-element', index } }
  const content = fromInlineChildren(element.children, index)
  if (!content.ok) return content

  const wire: Record<string, unknown> = {
    type: element.type,
    id: element.id,
    provenance: element.provenance,
    content: content.value,
  }
  if (element.type === 'character') wire['modifiers'] = element.modifiers ?? []

  const node = readScreenplayNode(wire)
  if (!node.ok) return { ok: false, error: { kind: 'model', index, defect: node.error } }
  return node
}

/**
 * The whole editor value, read strictly. First defect wins, as the reader does.
 *
 * Duplicate ids are refused here rather than trusted to `identity.ts`: that
 * module prevents them, this one proves they were prevented.
 */
export const fromSlateValue = (value: unknown): Result<readonly ScreenplayNode[], SlateDefect> => {
  if (!Array.isArray(value)) return { ok: false, error: { kind: 'not-an-element', index: -1 } }
  const nodes: ScreenplayNode[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const node = fromSlateElement(value[index], index)
    if (!node.ok) return node
    if (seen.has(node.value.id)) {
      return {
        ok: false,
        error: {
          kind: 'model',
          index,
          defect: { at: 'id', reason: { kind: 'duplicate-node-id', id: node.value.id } },
        },
      }
    }
    seen.add(node.value.id)
    nodes.push(node.value)
  }
  return { ok: true, value: nodes }
}

/** The eight, in the order the type bar shows them and the digits address them. */
export const TYPE_BAR_ORDER: readonly ScreenplayNodeType[] = SCREENPLAY_NODE_TYPES

/** The plain text of a block, mentions rendered by the label book the caller holds. */
export const elementText = (
  element: ScriptElement,
  labelFor: (entity: MentionEntity, id: string) => string | undefined,
): string =>
  element.children
    .map((child) => (isMentionElement(child) ? (labelFor(child.entity, child.id) ?? 'x') : child.text))
    .join('')
