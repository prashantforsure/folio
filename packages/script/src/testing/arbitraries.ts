import fc from 'fast-check'

import type { FolioDocument, OutlineDocument, ScreenplayDocument } from '../document'
import { characterId, documentId, locationId, nodeId, runId } from '../ids'
import type { InlineContent, InlineRun, MentionTarget } from '../inline'
import type { CommentNode, DeliveryModifier, ScreenplayNode } from '../node'
import { DELIVERY_MODIFIERS, PAGINATION_FIELDS, SCREENPLAY_NODE_TYPES } from '../node'
import type { OutlineNode } from '../outline'
import { OUTLINE_NODE_TYPES } from '../outline'
import type { Provenance } from '../provenance'

/**
 * fast-check generators for the node model.
 *
 * Not exported from the package barrel - this is test support, and shipping it
 * would put fast-check on the public surface of a package whose whole promise
 * is zero runtime dependencies.
 *
 * Ids are generated as arbitrary non-empty strings on purpose. The id format
 * has not been ruled on (see `ids.ts`), and generating uuids here would quietly
 * bake in an answer and hide any accidental dependence on the shape.
 */

const idText = fc.string({ minLength: 1, maxLength: 12 })

export const provenanceArb: fc.Arbitrary<Provenance> = fc.oneof(
  fc.constant<Provenance>({ source: 'typed' }),
  idText.map<Provenance>((raw) => ({ source: 'agent', runId: runId(raw) })),
)

export const mentionTargetArb: fc.Arbitrary<MentionTarget> = fc.oneof(
  idText.map<MentionTarget>((raw) => ({ entity: 'character', id: characterId(raw) })),
  idText.map<MentionTarget>((raw) => ({ entity: 'location', id: locationId(raw) })),
)

export const inlineRunArb: fc.Arbitrary<InlineRun> = fc.oneof(
  fc.string({ maxLength: 24 }).map<InlineRun>((value) => ({ kind: 'text', text: value })),
  mentionTargetArb.map<InlineRun>((target) => ({ kind: 'mention', target })),
)

export const contentArb: fc.Arbitrary<InlineContent> = fc.array(inlineRunArb, { maxLength: 4 })

const modifiersArb: fc.Arbitrary<readonly DeliveryModifier[]> = fc.array(
  fc.constantFrom(...DELIVERY_MODIFIERS),
  { maxLength: 2 },
)

/** Every screenplay type except `comment`, for lists a comment is inserted into. */
const nonCommentTypes = SCREENPLAY_NODE_TYPES.filter((type) => type !== 'comment')

const screenplayNodeOfType = (type: ScreenplayNode['type']): fc.Arbitrary<ScreenplayNode> =>
  fc.record({ id: idText, provenance: provenanceArb, content: contentArb, modifiers: modifiersArb }).map(
    (parts): ScreenplayNode => {
      const base = { id: nodeId(parts.id), provenance: parts.provenance, content: parts.content }
      switch (type) {
        case 'character':
          return { type: 'character', ...base, modifiers: parts.modifiers }
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
    },
  )

export const screenplayNodeArb: fc.Arbitrary<ScreenplayNode> = fc
  .constantFrom(...SCREENPLAY_NODE_TYPES)
  .chain(screenplayNodeOfType)

export const nonCommentNodeArb: fc.Arbitrary<ScreenplayNode> = fc
  .constantFrom(...nonCommentTypes)
  .chain(screenplayNodeOfType)

export const commentNodeArb: fc.Arbitrary<CommentNode> = fc
  .record({ id: idText, provenance: provenanceArb, content: contentArb })
  .map((parts) => ({
    type: 'comment' as const,
    id: nodeId(parts.id),
    provenance: parts.provenance,
    content: parts.content,
  }))

const uniqueById = <T extends { readonly id: string }>(
  arb: fc.Arbitrary<T>,
  maxLength: number,
): fc.Arbitrary<readonly T[]> =>
  fc.uniqueArray(arb, { maxLength, selector: (node) => node.id, comparator: 'SameValue' })

export const screenplayNodesArb: fc.Arbitrary<readonly ScreenplayNode[]> = uniqueById(
  screenplayNodeArb,
  8,
)

/** A list with no comments in it, so inserting one is a controlled change. */
export const nonCommentNodesArb: fc.Arbitrary<readonly ScreenplayNode[]> = uniqueById(
  nonCommentNodeArb,
  8,
)

const outlineNodeOfType = (type: OutlineNode['type']): fc.Arbitrary<OutlineNode> =>
  fc.record({ id: idText, provenance: provenanceArb, content: contentArb }).map(
    (parts): OutlineNode => {
      const base = { id: nodeId(parts.id), provenance: parts.provenance, content: parts.content }
      switch (type) {
        case 'rule':
          return { type: 'rule', id: nodeId(parts.id), provenance: parts.provenance }
        case 'body':
          return { type: 'body', ...base }
        case 'h1':
          return { type: 'h1', ...base }
        case 'h2':
          return { type: 'h2', ...base }
        case 'h3':
          return { type: 'h3', ...base }
        case 'quote':
          return { type: 'quote', ...base }
        case 'beat':
          return { type: 'beat', ...base }
      }
    },
  )

export const outlineNodeArb: fc.Arbitrary<OutlineNode> = fc
  .constantFrom(...OUTLINE_NODE_TYPES)
  .chain(outlineNodeOfType)

export const screenplayDocumentArb: fc.Arbitrary<ScreenplayDocument> = fc
  .record({ id: idText, nodes: screenplayNodesArb })
  .map((parts) => ({
    kind: 'screenplay' as const,
    id: documentId(parts.id),
    nodes: parts.nodes,
  }))

export const outlineDocumentArb: fc.Arbitrary<OutlineDocument> = fc
  .record({ id: idText, nodes: uniqueById(outlineNodeArb, 8) })
  .map((parts) => ({ kind: 'outline' as const, id: documentId(parts.id), nodes: parts.nodes }))

export const documentArb: fc.Arbitrary<FolioDocument> = fc.oneof(
  screenplayDocumentArb,
  outlineDocumentArb,
)

const RESERVED_TYPE_NAMES: readonly string[] = [...SCREENPLAY_NODE_TYPES, ...OUTLINE_NODE_TYPES]

/** Any string that is not one of the eight screenplay types or seven outline blocks. */
export const foreignTypeNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((value) => !RESERVED_TYPE_NAMES.includes(value))

export const paginationFieldArb: fc.Arbitrary<string> = fc.constantFrom(...PAGINATION_FIELDS)

/**
 * Arbitrary junk. Filtered only to exclude the vanishingly unlikely case of
 * `fc.anything()` producing something shaped like a real node, so a failure
 * here is always a genuine failure to reject.
 */
export const notANodeArb: fc.Arbitrary<unknown> = fc
  .anything()
  .filter((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return true
    const type: unknown = (value as Record<string, unknown>)['type']
    return typeof type !== 'string' || !RESERVED_TYPE_NAMES.includes(type)
  })
