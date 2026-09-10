import { describe, expect, it } from 'vitest'

import type { ScreenplayDocument } from './document'
import type { CharacterId, NodeId } from './ids'
import { characterId, nodeId } from './ids'
import type { InlineContent } from './inline'
import type { CommentNode, DialogueNode, SceneNode, ScreenplayNode } from './node'
import type { OutlineNode, RuleNode } from './outline'
import type { Provenance } from './provenance'
import type { RenderableNode } from './stream'
import { typed } from './provenance'

/**
 * The guarantees that are enforced by the compiler rather than at runtime.
 *
 * Every `@ts-expect-error` below is an assertion: `pnpm typecheck` fails with
 * "Unused '@ts-expect-error' directive" the moment one of these starts
 * compiling. That is what makes them tests rather than comments - the
 * guarantee cannot rot silently.
 *
 * Nothing here is called. The runtime `it` at the bottom exists so the file
 * reports in `pnpm test` alongside the properties it belongs with.
 */

const base = {
  id: nodeId('n1'),
  provenance: typed(),
  content: [] as InlineContent,
}

// ---------------------------------------------------------------------------
// There is no page attribute on a node. Ever.
// ---------------------------------------------------------------------------

/** The snippet: assigning a page number to a node is a type error. */
// @ts-expect-error a node cannot carry a page number
export const pagedNode: SceneNode = { type: 'scene', ...base, page: 12 }

// @ts-expect-error nor a page number under any of its other names
export const numberedNode: SceneNode = { type: 'scene', ...base, pageNumber: 12 }

// @ts-expect-error nor eighths, which live on the measurement record
export const eighthsNode: SceneNode = { type: 'scene', ...base, eighths: 3 }

// @ts-expect-error nor the measurement record itself
export const measuredNode: SceneNode = { type: 'scene', ...base, measurement: { page: 1 } }

// @ts-expect-error not even set explicitly to undefined
export const undefinedPageNode: SceneNode = { type: 'scene', ...base, page: undefined }

// @ts-expect-error outline blocks carry the same ban
export const pagedOutlineNode: RuleNode = { type: 'rule', id: base.id, provenance: base.provenance, page: 1 }

/**
 * The excess-property check alone would not catch this one: the object is not a
 * fresh literal at the assignment, so only the optional-`never` field rejects it.
 */
type MeasuredScene = {
  readonly type: 'scene'
  readonly id: NodeId
  readonly provenance: Provenance
  readonly content: InlineContent
  readonly page: number
}

export const widenedNodeIsNotANode = (measured: MeasuredScene): SceneNode => {
  // @ts-expect-error a widened object carrying a page is not assignable to a node
  return measured
}

// ---------------------------------------------------------------------------
// The eight types are closed
// ---------------------------------------------------------------------------

// @ts-expect-error there is no ninth element type
export const ninthType: ScreenplayNode = { type: 'montage', ...base }

// @ts-expect-error an outline heading is not a screenplay node
export const headingInScreenplay: ScreenplayNode = { type: 'h2', ...base }

export const outlineBlockIsNotAScreenplayNode = (block: OutlineNode): ScreenplayNode => {
  // @ts-expect-error the two block sets share no member
  return block
}

export const outlineCannotEnterAScreenplayDocument = (blocks: readonly OutlineNode[]) => {
  // @ts-expect-error a screenplay document holds screenplay nodes only
  const document: ScreenplayDocument = { kind: 'screenplay', id: nodeId('d1'), nodes: blocks }
  return document
}

// @ts-expect-error a scene carries no delivery modifiers - only a cue does
export const modifiersOnScene: SceneNode = { type: 'scene', ...base, modifiers: ['V.O.'] }

// @ts-expect-error a generated continued marker is not a delivery modifier
export const generatedModifier: readonly DeliveryModifierProbe[] = ["CONT'D"]
type DeliveryModifierProbe = 'V.O.' | 'O.S.' | 'O.C.'

// ---------------------------------------------------------------------------
// Comments never reach the renderable stream
// ---------------------------------------------------------------------------

export const commentIsNotRenderable = (comment: CommentNode): RenderableNode => {
  // @ts-expect-error a comment node is excluded from the renderable stream by type
  return comment
}

export const dialogueIsRenderable = (dialogue: DialogueNode): RenderableNode => dialogue

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

// @ts-expect-error an agent-authored node without a run is unrepresentable
export const agentWithoutRun: Provenance = { source: 'agent' }

// @ts-expect-error there is no third provenance source
export const importedProvenance: Provenance = { source: 'imported' }

// ---------------------------------------------------------------------------
// Ids are branded, so the join key cannot be crossed with another id space
// ---------------------------------------------------------------------------

export const characterIdIsNotANodeId = (id: CharacterId): NodeId => {
  // @ts-expect-error a character id is not a node id
  return id
}

export const rawStringIsNotANodeId = (raw: string): NodeId => {
  // @ts-expect-error an unbranded string is not a node id
  return raw
}

export const brandedIdsAreStillStrings = (id: NodeId): string => id

describe('type-level guarantees', () => {
  it('are enforced by pnpm typecheck, not by this assertion', () => {
    // Every @ts-expect-error above is the real test. If one of them starts
    // compiling, tsc reports an unused directive and typecheck fails.
    expect(typeof widenedNodeIsNotANode).toBe('function')
    expect(characterId('c1')).toBe('c1')
  })
})
