import { countFdxNodes, importFinalDraft } from '../fdx'
import type { NodeId } from '../ids'
import { nodeId } from '../ids'
import { text } from '../inline'
import type { DeliveryModifier, ScreenplayNode, ScreenplayNodeType } from '../node'
import { typed } from '../provenance'
import { featureLengthFdx } from './fdx-corpus'
import { readFdxXml } from './fdx-reader'

/**
 * Node lists for the pagination tests.
 *
 * Two kinds. Hand-built lists, where a test needs a speech of exactly nine
 * lines to put a break in a known place; and the feature-length Final Draft
 * file, imported through the real `importFinalDraft` path, which is what the
 * golden page maps are generated from.
 *
 * Ids are positional and deterministic - `n0`, `n1` - because `packages/script`
 * cannot mint one and because a golden map keyed off node ids is only stable if
 * the ids are. That is the measurement record's join key showing up in the test
 * support: see the report on AGENTS.md open decision 1.
 */

let counter = 0

/** Deterministic, and reset per corpus so a map does not depend on test order. */
export const resetIds = (): void => {
  counter = 0
}

export const nextId = (): NodeId => {
  const id = nodeId(`n${counter}`)
  counter += 1
  return id
}

export const node = (
  type: ScreenplayNodeType,
  content: string,
  modifiers: readonly DeliveryModifier[] = [],
): ScreenplayNode => {
  const base = { id: nextId(), provenance: typed(), content: [text(content)] }
  switch (type) {
    case 'character':
      return { type: 'character', ...base, modifiers }
    case 'scene':
      return { type: 'scene', ...base }
    case 'action':
      return { type: 'action', ...base }
    case 'paren':
      return { type: 'paren', ...base }
    case 'dialogue':
      return { type: 'dialogue', ...base }
    case 'transition':
      return { type: 'transition', ...base }
    case 'comment':
      return { type: 'comment', ...base }
    case 'subtitle':
      return { type: 'subtitle', ...base }
  }
}

/** `words(n)` renders as exactly `n` five-character words: "aaaa bbbb ...". */
export const words = (count: number): string =>
  Array.from({ length: count }, (_, index) =>
    String.fromCharCode(97 + (index % 26)).repeat(4),
  ).join(' ')

/**
 * Text that measures exactly `lines` lines at `charsPerLine`.
 *
 * Five characters per word including the space divides 35 (dialogue) and 60
 * (action) evenly enough that the count is exact rather than approximate.
 */
export const linesOfText = (lines: number, charsPerLine: number): string => {
  const perLine = Math.floor((charsPerLine + 1) / 5)
  return words(perLine * lines)
}

export type FeatureLength = {
  readonly nodes: readonly ScreenplayNode[]
  readonly scenes: number
}

/**
 * The feature-length Final Draft file, imported the way the app imports one.
 *
 * Through `importFinalDraft`, so the node list the golden maps are measured
 * from is a real import: continueds stripped, `(MORE)` lines gone, script notes
 * as Comment nodes, `<SceneProperties Page>` discarded at the door because
 * AGENTS.md forbids a node from carrying one.
 */
export const featureLengthNodes = (scenes = 220): FeatureLength => {
  const root = readFdxXml(featureLengthFdx(scenes))
  const wanted = countFdxNodes(root)
  const imported = importFinalDraft(root, {
    freshIds: Array.from({ length: wanted }, (_, index) => nodeId(`f${index}`)),
  })
  if (!imported.ok) {
    throw new Error(`the feature-length corpus failed to import: ${JSON.stringify(imported.error)}`)
  }
  return { nodes: imported.value.nodes, scenes }
}
