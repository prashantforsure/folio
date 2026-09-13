import type { MentionEntity } from '@folio/script'

/**
 * A block's inline children as the sheet's arithmetic sees them: text, or a
 * mention that renders as its record's label. Editor-neutral - `lines.ts`
 * wraps this shape and `pm-model.ts` produces it from a ProseMirror node -
 * so the wrap cache and the page map do not know which editor is drawing.
 *
 * `MENTION_TYPE` is not one of the eight block types, asserted at the type
 * level below: if `mention` ever joined the union the alias would become
 * `never` and the constant would stop compiling.
 */

export const MENTION_TYPE = 'mention' as const

export type ScriptText = { readonly text: string }

export type ScriptMentionElement = {
  readonly type: typeof MENTION_TYPE
  readonly entity: MentionEntity
  readonly id: string
}

export type ScriptInline = ScriptText | ScriptMentionElement

export const isMentionElement = (value: unknown): value is ScriptMentionElement =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === MENTION_TYPE

export type LabelFor = (entity: MentionEntity, id: string) => string | undefined

/** The block's rendered text: mentions by their label, an unresolved one as the engine's one-character placeholder. */
export const inlineText = (children: readonly ScriptInline[], labelFor: LabelFor): string =>
  children.map((child) => (isMentionElement(child) ? (labelFor(child.entity, child.id) ?? 'x') : child.text)).join('')

/** The block's text children only, which is what the selectors and the pills index. */
export const textOnly = (children: readonly ScriptInline[]): string =>
  children.map((child) => (isMentionElement(child) ? '' : child.text)).join('')
