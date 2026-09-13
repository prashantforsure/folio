import type { InlineRun, ModelDefect, NodeId, OutlineNode, OutlineNodeType, Provenance, Result } from '@folio/script'
import { isOutlineNodeType, readOutlineNode, typed } from '@folio/script'
import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import type { LabelFor } from '../script/inline'
import { MENTION_TYPE, inlineText } from '../script/inline'
import { blockAttrsOf as screenplayBlockAttrsOf, inlineChildrenOf, mentionAttrsOf } from '../script/pm-model'

/**
 * Where ProseMirror's node shape meets `@folio/script`'s **outline** union -
 * and the only place. The twin of `lib/script/pm-model.ts`, over the other
 * closed set, and deliberately not a generalisation of it.
 *
 * AGENTS.md, The node model: the Outline is "a **different document kind in
 * the same table** with a different, tiny, closed block set (Body, H1, H2,
 * H3, Quote, Rule, numbered beats). Do not widen the screenplay schema to
 * hold an `H2`." Two files, two unions, no shared block node - so an `h2`
 * cannot reach the Script editor through a shared mapping any more than it
 * can reach its table through a shared enum. What *is* shared is what is
 * not a block: the text node, the `@mention` atom (`_script/editor/
 * extensions/mention.ts`) and the attribute readers, which are the same
 * arithmetic over `id` / `provenance` / `origin` on either document.
 *
 *   `toDoc`    OutlineNode[]     ->  JSONContent       (on load)
 *   `fromDoc`  ProseMirrorNode   ->  OutlineNode[]     (on save)
 *
 * **The wire shape is the node list, never ProseMirror JSON.** What goes to
 * the server is what `fromDoc` reads back through `readOutlineNode`, the
 * strict wire reader, which rejects an unknown type, an unknown field, a
 * pagination field, an empty or a duplicate id. A shape the editor made up
 * cannot be saved, so the editor cannot become authoritative by accident.
 *
 * ## The rule
 *
 * A `rule` carries no content in the model - not an empty list, no field.
 * On this side it is a **leaf** block (`atom`, no content expression), so
 * ProseMirror never puts text in one, and `fromBlock` writes no `content`
 * key for it rather than sending `content: []` to a reader that would
 * refuse it.
 *
 * ## Marks
 *
 * `InlineRun` has no mark. The six textblocks are declared `marks: ''`, so
 * the schema will not build a bold or an italic, and `fromInline` treats a
 * marked text node as the defect it would be. Adding a mark to the inline
 * model is a node-schema change (AGENTS.md, When to ask first); flagged
 * since the first Outline phase and still open.
 */

export const BLOCK_TYPE_COVERAGE: Readonly<Record<OutlineNodeType, OutlineNodeType>> = {
  body: 'body',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  quote: 'quote',
  rule: 'rule',
  beat: 'beat',
}

type MentionIsNotABlockType = typeof MENTION_TYPE extends OutlineNodeType ? never : true
const MENTION_IS_NOT_A_BLOCK_TYPE: MentionIsNotABlockType = true
void MENTION_IS_NOT_A_BLOCK_TYPE

/** The attributes every outline block carries. `id` is `null` only between a split and the identity plugin's appended transaction. */
export type OutlineBlockAttrs = {
  readonly id: NodeId | null
  readonly provenance: Provenance
  /** Transient: the document a pasted block came from, read off `data-doc`; never saved. */
  readonly origin: string | null
}

export const DEFAULT_BLOCK_ATTRS: OutlineBlockAttrs = { id: null, provenance: typed(), origin: null }

/** A block's attributes, read strictly; malformed ones fall back to the defaults. */
export const blockAttrsOf = (node: ProseMirrorNode): OutlineBlockAttrs => {
  const { id, provenance, origin } = screenplayBlockAttrsOf(node)
  return { id, provenance, origin }
}

export const blockTypeOf = (node: ProseMirrorNode): OutlineNodeType | null =>
  isOutlineNodeType(node.type.name) ? node.type.name : null

export { idsOf, mentionAttrsOf } from '../script/pm-model'

// ---------------------------------------------------------------------------
// Model -> ProseMirror JSON
// ---------------------------------------------------------------------------

const toInlineJson = (run: InlineRun): JSONContent =>
  run.kind === 'text'
    ? { type: 'text', text: run.text }
    : { type: MENTION_TYPE, attrs: { entity: run.target.entity, id: run.target.id } }

/** One block. A rule has no `content`; empty text runs are dropped, as ProseMirror cannot hold one. */
export const toBlock = (node: OutlineNode): JSONContent => {
  const attrs = { id: node.id, provenance: node.provenance, origin: null }
  if (node.type === 'rule') return { type: node.type, attrs }
  return {
    type: node.type,
    attrs,
    content: node.content.filter((run) => run.kind !== 'text' || run.text !== '').map(toInlineJson),
  }
}

export const toDoc = (nodes: readonly OutlineNode[]): JSONContent => ({
  type: 'doc',
  content: nodes.map(toBlock),
})

// ---------------------------------------------------------------------------
// ProseMirror -> model
// ---------------------------------------------------------------------------

export type OutlinePmDefect =
  | { readonly kind: 'not-a-block-type'; readonly index: number; readonly type: string }
  | { readonly kind: 'bad-inline'; readonly index: number; readonly child: number }
  | { readonly kind: 'model'; readonly index: number; readonly defect: ModelDefect }

const fromInline = (block: ProseMirrorNode, index: number): Result<readonly unknown[], OutlinePmDefect> => {
  const runs: unknown[] = []
  let failed: OutlinePmDefect | null = null
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

export const fromBlock = (block: ProseMirrorNode, index: number): Result<OutlineNode, OutlinePmDefect> => {
  const type = block.type.name
  if (!isOutlineNodeType(type)) return { ok: false, error: { kind: 'not-a-block-type', index, type } }
  const attrs = blockAttrsOf(block)
  const wire: Record<string, unknown> = { type, id: attrs.id ?? '', provenance: attrs.provenance }
  if (type !== 'rule') {
    const content = fromInline(block, index)
    if (!content.ok) return content
    wire['content'] = content.value
  }
  const node = readOutlineNode(wire)
  if (!node.ok) return { ok: false, error: { kind: 'model', index, defect: node.error } }
  return node
}

/** The whole document, read strictly. First defect wins; duplicate ids refused here so the identity plugin is proved, not trusted. */
export const fromDoc = (doc: ProseMirrorNode): Result<readonly OutlineNode[], OutlinePmDefect> => {
  const nodes: OutlineNode[] = []
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

// ---------------------------------------------------------------------------
// Per-block reads the chrome needs
// ---------------------------------------------------------------------------

/** A block's rendered text, mentions by their label; `''` for a rule. */
export const blockText = (block: ProseMirrorNode, labelFor: LabelFor): string =>
  block.isLeaf ? '' : inlineText(inlineChildrenOf(block), labelFor)

const wordCounts = new WeakMap<ProseMirrorNode, { readonly labelFor: LabelFor; readonly count: number }>()

/**
 * A block's word count, remembered on the block node. ProseMirror keeps
 * every block a transaction did not touch as the same object, so a keystroke
 * counts one block and looks the rest up. A new label book recounts, since
 * a mention counts as its label's words.
 */
export const wordCountOf = (block: ProseMirrorNode, labelFor: LabelFor): number => {
  const hit = wordCounts.get(block)
  if (hit !== undefined && hit.labelFor === labelFor) return hit.count
  const text = blockText(block, labelFor).trim()
  const count = text === '' ? 0 : text.split(/\s+/u).length
  wordCounts.set(block, { labelFor, count })
  return count
}

export type OutlineShape = {
  readonly blockCount: number
  /** H1 blocks: what the nav's `N acts` counts. */
  readonly acts: number
  readonly beats: number
  readonly words: number
}

export const shapeOf = (doc: ProseMirrorNode, labelFor: LabelFor): OutlineShape => {
  let acts = 0
  let beats = 0
  let words = 0
  doc.forEach((block) => {
    if (block.type.name === 'h1') acts += 1
    if (block.type.name === 'beat') beats += 1
    words += wordCountOf(block, labelFor)
  })
  return { blockCount: doc.childCount, acts, beats, words }
}

export const sameShape = (a: OutlineShape, b: OutlineShape): boolean =>
  a.blockCount === b.blockCount && a.acts === b.acts && a.beats === b.beats && a.words === b.words
