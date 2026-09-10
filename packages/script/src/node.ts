import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { Provenance } from './provenance'

/**
 * The screenplay node model.
 *
 * Eight element types, a closed set. AGENTS.md, The node model: "rejecting
 * anything outside the eight types is that schema's entire job."
 */

// ---------------------------------------------------------------------------
// There is no page attribute on a node. Ever.
// ---------------------------------------------------------------------------

/**
 * Field names that describe where a node landed on a sheet.
 *
 * AGENTS.md, The node model: "**There is no `page` attribute on a node.
 * Ever.** Pagination is computed at render." AGENTS.md, exception table
 * "Nothing is stored that can be computed - except": page number and eighths
 * are stored "on a **measurement record**. Never a node attribute."
 *
 * This tuple is the single source for both halves of the ban: `NoPagination`
 * turns it into a compile error, and `read.ts` turns it into a runtime
 * rejection, so a node cannot smuggle a page number in over the wire either.
 */
export const PAGINATION_FIELDS = ['page', 'pageNumber', 'pages', 'eighths', 'measurement'] as const

export type PaginationField = (typeof PAGINATION_FIELDS)[number]

/**
 * Makes a page number structurally unassignable rather than merely absent.
 *
 * Declaring each field optional-`never` is stronger than leaving it off the
 * type. Leaving it off only trips TypeScript's excess-property check, which
 * applies to fresh object literals and nothing else - so a widened object with
 * a `page` on it would assign cleanly. `page?: never` rejects both.
 *
 * See `type-guarantees.test.ts` for the compile-time proof.
 */
export type NoPagination = { readonly [Field in PaginationField]?: never }

// ---------------------------------------------------------------------------
// The closed set
// ---------------------------------------------------------------------------

/**
 * The eight types, as an object so membership is a `hasOwnProperty` lookup at
 * runtime and `keyof` at compile time. `SCREENPLAY_NODE_TYPE_COVERAGE` below
 * proves this stays in step with the union.
 */
const SCREENPLAY_NODE_TYPE_SET = {
  scene: true,
  action: true,
  character: true,
  paren: true,
  dialogue: true,
  transition: true,
  comment: true,
  subtitle: true,
} as const

export type ScreenplayNodeType = keyof typeof SCREENPLAY_NODE_TYPE_SET

export const SCREENPLAY_NODE_TYPES = Object.keys(
  SCREENPLAY_NODE_TYPE_SET,
) as readonly ScreenplayNodeType[]

export const isScreenplayNodeType = (value: string): value is ScreenplayNodeType =>
  Object.prototype.hasOwnProperty.call(SCREENPLAY_NODE_TYPE_SET, value)

/**
 * Authored delivery modifiers.
 *
 * AGENTS.md, exception table "Generated text is never in the node stream -
 * except": `(V.O.)`, `(O.S.)` and `(O.C.)` are authored by the writer and
 * stored as node attributes. `(MORE)`, `(CONT'D)` at a split and speaker
 * `(CONT'D)` are layout artefacts, computed at render and stripped on import -
 * they have no representation anywhere in this file, deliberately. "Conflate
 * the two and every `.fdx` round-trip doubles the continueds."
 */
export const DELIVERY_MODIFIERS = ['V.O.', 'O.S.', 'O.C.'] as const

export type DeliveryModifier = (typeof DELIVERY_MODIFIERS)[number]

export const isDeliveryModifier = (value: string): value is DeliveryModifier =>
  (DELIVERY_MODIFIERS as readonly string[]).includes(value)

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

type NodeBase = NoPagination & {
  /** The join key for comments, proposals, provenance and every derived row. */
  readonly id: NodeId
  readonly provenance: Provenance
}

/**
 * A scene heading, as authored.
 *
 * It holds the heading text and nothing structured. `INT.`/`EXT.`, the set and
 * the time of day are *parser output*, and the scene record they feed is
 * *derived* - putting them here would duplicate the derived row on the node.
 * It is also what keeps AGENTS.md, Derivation honest: "A malformed heading
 * does not silently become a scene." The node is a scene node because the
 * writer typed a heading; whether it resolves to a set is the derived row's
 * problem, not this type's.
 */
export type SceneNode = NodeBase & {
  readonly type: 'scene'
  readonly content: InlineContent
}

export type ActionNode = NodeBase & {
  readonly type: 'action'
  readonly content: InlineContent
}

/**
 * A character cue.
 *
 * `content` is the cue as authored. It carries no `characterId`: resolving a
 * cue to a person goes through the alias table, which is derivation, and which
 * is what makes `MEERA`, `MEERA (V.O.)` and the Devanagari spelling one record
 * (AGENTS.md, Entity identity). A resolved id cached here would be a second
 * authority on who is speaking.
 */
export type CharacterNode = NodeBase & {
  readonly type: 'character'
  readonly content: InlineContent
  /** Authored only. Never `(CONT'D)`. Empty when the cue is bare. */
  readonly modifiers: readonly DeliveryModifier[]
}

export type ParenNode = NodeBase & {
  readonly type: 'paren'
  readonly content: InlineContent
}

export type DialogueNode = NodeBase & {
  readonly type: 'dialogue'
  readonly content: InlineContent
}

export type TransitionNode = NodeBase & {
  readonly type: 'transition'
  readonly content: InlineContent
}

/**
 * A note in the script body - the Fountain `[[ ]]` element.
 *
 * AGENTS.md, The node model: "**Comment nodes occupy zero page space.** Their
 * presence can never change a page count, and they never reach an export."
 * `stream.ts` is where that is enforced and property-tested.
 *
 * Not to be confused with a review comment thread, which is a separate row
 * anchored *to* a node id and is not part of the node stream at all.
 */
export type CommentNode = NodeBase & {
  readonly type: 'comment'
  readonly content: InlineContent
}

export type SubtitleNode = NodeBase & {
  readonly type: 'subtitle'
  readonly content: InlineContent
}

export type ScreenplayNode =
  | SceneNode
  | ActionNode
  | CharacterNode
  | ParenNode
  | DialogueNode
  | TransitionNode
  | CommentNode
  | SubtitleNode

/**
 * Compile-time proof that the union and `SCREENPLAY_NODE_TYPE_SET` name the
 * same eight types.
 *
 * A `Record` keyed by the union's discriminant requires every member to appear;
 * typing the values as `ScreenplayNodeType` requires every one of them to be in
 * the set. Add a ninth node interface without adding its tag - or the reverse -
 * and this line stops compiling.
 */
export const SCREENPLAY_NODE_TYPE_COVERAGE: Record<ScreenplayNode['type'], ScreenplayNodeType> = {
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
 * Build a node of a given type.
 *
 * One place where the eight-way mapping from tag to node lives, so adding a
 * ninth type is a compile error here rather than a silent gap. `modifiers` is
 * carried only by a cue; every other type ignores it, which is what makes a
 * type change lossy in a way the caller can report.
 */
export const makeScreenplayNode = (
  type: ScreenplayNodeType,
  parts: {
    readonly id: NodeId
    readonly provenance: Provenance
    readonly content: InlineContent
    readonly modifiers: readonly DeliveryModifier[]
  },
): ScreenplayNode => {
  const base = { id: parts.id, provenance: parts.provenance, content: parts.content }
  switch (type) {
    case 'scene':
      return { type: 'scene', ...base }
    case 'action':
      return { type: 'action', ...base }
    case 'character':
      return { type: 'character', ...base, modifiers: parts.modifiers }
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

/** A cue carries delivery modifiers; nothing else can. */
export const modifiersOf = (node: ScreenplayNode): readonly DeliveryModifier[] =>
  node.type === 'character' ? node.modifiers : []
