import type { CharacterId, LocationId } from './ids'

/**
 * Inline content.
 *
 * A node's text is a list of runs, not a string, because an `@mention` is a
 * **structural reference to a record id, not text**. That is what lets a
 * character who is discussed in action but never speaks still get a record:
 * derivation reads the mention edge directly rather than running a regex over
 * rendered prose.
 *
 * A mention deliberately carries no display label. The label is the record's
 * `name` at render time. Storing it here would duplicate the record and drift
 * on rename, which AGENTS.md, Development philosophy 1 forbids: "Derive, never
 * duplicate."
 */
export type MentionTarget =
  | { readonly entity: 'character'; readonly id: CharacterId }
  | { readonly entity: 'location'; readonly id: LocationId }

export const MENTION_ENTITIES = ['character', 'location'] as const

export type MentionEntity = (typeof MENTION_ENTITIES)[number]

export type InlineRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly target: MentionTarget }

export const INLINE_KINDS = ['text', 'mention'] as const

export type InlineKind = (typeof INLINE_KINDS)[number]

export type InlineContent = readonly InlineRun[]

export const text = (value: string): InlineRun => ({ kind: 'text', text: value })

export const mention = (target: MentionTarget): InlineRun => ({ kind: 'mention', target })

/**
 * Every record this content links to, in document order, duplicates included.
 *
 * This is a projection of the node's own content, not entity derivation - it
 * reports the edges, it does not resolve them, count them or build a record.
 * Derivation (`packages/script`, later) consumes this.
 */
export const mentionTargets = (content: InlineContent): readonly MentionTarget[] =>
  content.flatMap((run) => (run.kind === 'mention' ? [run.target] : []))

/**
 * The anchor length of a run of content.
 *
 * A text run counts its characters; a mention counts as one, because it is an
 * atom - a cursor can sit either side of it and never inside it. This is the
 * unit comment and proposal anchors are expressed in, so it is also the unit
 * the identity remap reports offsets in (see `edit.ts`).
 */
export const contentLength = (content: InlineContent): number =>
  content.reduce((total, run) => total + (run.kind === 'text' ? run.text.length : 1), 0)

/**
 * Canonical form: adjacent text runs joined, empty text runs dropped.
 *
 * Without this, splitting a node and merging it straight back would leave two
 * text runs where there was one - equal content, different shape - and the
 * round trip would not be an identity. Operations normalise; reading does not,
 * so a stored node comes back exactly as it was written.
 */
export const normaliseContent = (content: InlineContent): InlineContent => {
  const out: InlineRun[] = []
  for (const run of content) {
    if (run.kind === 'text') {
      if (run.text === '') continue
      const previous = out[out.length - 1]
      if (previous !== undefined && previous.kind === 'text') {
        out[out.length - 1] = { kind: 'text', text: previous.text + run.text }
        continue
      }
    }
    out.push(run)
  }
  return out
}
