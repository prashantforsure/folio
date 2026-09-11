import type {
  InlineRun,
  MentionEntity,
  ModelDefect,
  NodeId,
  OutlineNode,
  OutlineNodeType,
  Provenance,
  Result,
} from '@folio/script'
import { MENTION_ENTITIES, OUTLINE_NODE_TYPES, isOutlineNodeType, readOutlineNode } from '@folio/script'

import type { ScriptMentionElement, ScriptText } from '../script/slate-model'
import { MENTION_TYPE, isMentionElement } from '../script/slate-model'

/**
 * Where Slate's node shape meets `@folio/script`'s **outline** union - and the
 * only place. The twin of `lib/script/slate-model.ts`, over the other closed
 * set, and deliberately not a generalisation of it.
 *
 * AGENTS.md, The node model: the Outline is "a **different document kind in
 * the same table** with a different, tiny, closed block set (Body, H1, H2,
 * H3, Quote, Rule, numbered beats). Do not widen the screenplay schema to hold
 * an `H2`." Two files, two unions, no shared element type - so an `h2` cannot
 * reach the Script editor through a shared mapping any more than it can
 * reach its table through a shared enum.
 *
 * The same four guards hold here:
 *
 *   1. `OutlineElement.type` is `OutlineNodeType`, not a string.
 *   2. `fromSlateValue` goes through `readOutlineNode`, the strict reader -
 *      a Plate paragraph, a mark, an `indent` cannot be saved.
 *   3. `ELEMENT_TYPE_COVERAGE` is a `Record` over the union.
 *   4. Plate mints nothing; `lib/script/identity.ts` on `apply` does.
 *
 * ## The rule
 *
 * A `rule` carries no content in the model - not an empty list, no field.
 * Slate requires every element to have children, so on this side a rule is a
 * **void** block with one empty text, and `fromSlateElement` drops the
 * children on the way back rather than sending `content: []` to a reader
 * that would refuse it as an unexpected field.
 *
 * ## Marks
 *
 * The outline bundle draws Bold and Italic in its toolbar. `InlineRun` has
 * no mark - a run is text or a mention - so a `bold: true` a plugin might
 * put on a text node is an unexpected field here and the save refuses it.
 * Adding a mark to the inline model is a node-schema change (AGENTS.md, When
 * to ask first), so the toolbar's mark buttons are not built; flagged.
 */

export type OutlineInline = ScriptText | ScriptMentionElement

export type OutlineElement = {
  readonly type: OutlineNodeType
  readonly id: NodeId
  readonly provenance: Provenance
  children: OutlineInline[]
}

export type OutlineValue = readonly OutlineElement[]

export const ELEMENT_TYPE_COVERAGE: Readonly<Record<OutlineNodeType, OutlineNodeType>> = {
  body: 'body',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  quote: 'quote',
  rule: 'rule',
  beat: 'beat',
}

export const isOutlineElement = (value: unknown): value is OutlineElement =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  isOutlineNodeType((value as { type: string }).type) &&
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

const toInlineChildren = (content: readonly InlineRun[]): OutlineInline[] => {
  const out: OutlineInline[] = []
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

export const toSlateElement = (node: OutlineNode): OutlineElement => ({
  type: node.type,
  id: node.id,
  provenance: node.provenance,
  children: node.type === 'rule' ? [{ text: '' }] : toInlineChildren(node.content),
})

export const toSlateValue = (nodes: readonly OutlineNode[]): OutlineValue => nodes.map(toSlateElement)

// ---------------------------------------------------------------------------
// Slate -> model
// ---------------------------------------------------------------------------

export type OutlineSlateDefect =
  | { readonly kind: 'not-an-element'; readonly index: number }
  | { readonly kind: 'not-a-block-type'; readonly index: number; readonly type: string }
  | { readonly kind: 'bad-inline'; readonly index: number; readonly child: number }
  | { readonly kind: 'model'; readonly index: number; readonly defect: ModelDefect }

const isText = (value: unknown): value is ScriptText =>
  typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string'

const fromInlineChildren = (
  children: readonly unknown[],
  index: number,
): Result<readonly unknown[], OutlineSlateDefect> => {
  const runs: unknown[] = []
  for (let child = 0; child < children.length; child += 1) {
    const value = children[child]
    if (isText(value)) {
      if (Object.keys(value).length !== 1) return { ok: false, error: { kind: 'bad-inline', index, child } }
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
): Result<OutlineNode, OutlineSlateDefect> => {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: { kind: 'not-an-element', index } }
  }
  const element = value as {
    readonly type?: unknown
    readonly id?: unknown
    readonly provenance?: unknown
    readonly children?: unknown
  }
  if (typeof element.type !== 'string' || !isOutlineNodeType(element.type)) {
    return { ok: false, error: { kind: 'not-a-block-type', index, type: String(element.type) } }
  }
  if (!Array.isArray(element.children)) return { ok: false, error: { kind: 'not-an-element', index } }

  const wire: Record<string, unknown> = {
    type: element.type,
    id: element.id,
    provenance: element.provenance,
  }
  if (element.type !== 'rule') {
    const content = fromInlineChildren(element.children, index)
    if (!content.ok) return content
    wire['content'] = content.value
  }
  const node = readOutlineNode(wire)
  if (!node.ok) return { ok: false, error: { kind: 'model', index, defect: node.error } }
  return node
}

/** The whole editor value, read strictly. First defect wins; duplicate ids refused. */
export const fromSlateValue = (value: unknown): Result<readonly OutlineNode[], OutlineSlateDefect> => {
  if (!Array.isArray(value)) return { ok: false, error: { kind: 'not-an-element', index: -1 } }
  const nodes: OutlineNode[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const node = fromSlateElement(value[index], index)
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

/** The seven, in the order the block toolbar shows them. `rule` is a void. */
export const BLOCK_TOOL_ORDER: readonly OutlineNodeType[] = OUTLINE_NODE_TYPES

/** The plain text of a block, mentions rendered by the label book the caller holds. */
export const elementText = (
  element: OutlineElement,
  labelFor: (entity: MentionEntity, id: string) => string | undefined,
): string =>
  element.type === 'rule'
    ? ''
    : element.children
        .map((child) => (isMentionElement(child) ? (labelFor(child.entity, child.id) ?? 'x') : child.text))
        .join('')
