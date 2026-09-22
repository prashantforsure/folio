import type { CharacterId } from './ids'

/**
 * A Production shot's description as runs - the v12 spec's
 * `shot_description_parts` (`docs/production/production.md` §7): plain
 * text, an `@Character` mention, and a spoken line. The card draws each
 * kind its own way (a mention as an accent chip, dialogue italic on the
 * ok tone); the Character field follows the mentions until the writer
 * overrides it (spec rule 5).
 *
 * ## Text is the truth, parts are its reading
 *
 * The writer types one string. `parseDescription` reads it into runs
 * against the project's character names, so a mention is a record id
 * that survives a rename; `partsText` folds the runs back to the string,
 * and the two agree exactly (`partsText(parseDescription(t)) === t`). The
 * repository stores both - the text for editing, the parts for reading -
 * and rewrites the parts whole on every save, so they can never drift.
 *
 * ## What is a mention, what is dialogue
 *
 * A mention is `@` followed by the longest character name that matches at
 * that point, case-insensitively, on a word boundary - so `@Old man` is one
 * mention of *Old man* and not of a character called *Old*. An `@Name` that
 * matches nobody stays a mention with no record (the chip still draws; the
 * Character field ignores it). Dialogue is a run between double quotes -
 * straight or curly - kept with its quotes, as the mockup's `q()` runs are.
 *
 * Deterministic and pure, like every reader in this package.
 */

export type DescriptionPartKind = 'text' | 'mention' | 'dialogue'

export type DescriptionPart = {
  readonly kind: DescriptionPartKind
  readonly text: string
  /** The record a mention resolved to; null on an unmatched `@Name` and on every other kind. */
  readonly characterId: CharacterId | null
}

export type DescriptionName = {
  readonly id: CharacterId
  readonly name: string
}

const OPEN_QUOTES = new Set(['"', '“'])
const CLOSE_QUOTES = new Set(['"', '”'])

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}_'’]/u.test(char)

/** The longest name that starts at `at`, on a word boundary. */
const matchName = (text: string, at: number, names: readonly DescriptionName[]): DescriptionName | null => {
  let best: DescriptionName | null = null
  for (const name of names) {
    const slice = text.slice(at, at + name.name.length)
    if (slice.toLowerCase() !== name.name.toLowerCase()) continue
    if (isWordChar(text[at + name.name.length])) continue
    if (best === null || name.name.length > best.name.length) best = name
  }
  return best
}

/** The unmatched `@Name`: one word - a two-word name can only be matched, never guessed. */
const looseMention = (text: string, at: number): string => {
  const match = /^[\p{L}\p{N}_'’]+/u.exec(text.slice(at))
  return match === null ? '' : match[0]
}

export const parseDescription = (text: string, names: readonly DescriptionName[]): readonly DescriptionPart[] => {
  const parts: DescriptionPart[] = []
  let plain = ''
  const flush = (): void => {
    if (plain.length > 0) parts.push({ kind: 'text', text: plain, characterId: null })
    plain = ''
  }
  let i = 0
  while (i < text.length) {
    const char = text[i] ?? ''
    if (char === '@' && !isWordChar(text[i - 1])) {
      const named = matchName(text, i + 1, names)
      if (named !== null) {
        flush()
        parts.push({ kind: 'mention', text: `@${text.slice(i + 1, i + 1 + named.name.length)}`, characterId: named.id })
        i += 1 + named.name.length
        continue
      }
      const loose = looseMention(text, i + 1)
      if (loose.length > 0) {
        flush()
        parts.push({ kind: 'mention', text: `@${loose}`, characterId: null })
        i += 1 + loose.length
        continue
      }
    }
    if (OPEN_QUOTES.has(char)) {
      const rest = text.slice(i + 1)
      let close = -1
      for (let j = 0; j < rest.length; j += 1) {
        if (CLOSE_QUOTES.has(rest[j] ?? '')) {
          close = j
          break
        }
      }
      if (close >= 0) {
        flush()
        parts.push({ kind: 'dialogue', text: text.slice(i, i + close + 2), characterId: null })
        i += close + 2
        continue
      }
    }
    plain += char
    i += 1
  }
  flush()
  return parts
}

export const partsText = (parts: readonly DescriptionPart[]): string => parts.map((part) => part.text).join('')

/** The characters the description mentions, in first-mention order, no repeats. */
export const mentionedCharacters = (parts: readonly DescriptionPart[]): readonly CharacterId[] => {
  const seen = new Set<CharacterId>()
  const out: CharacterId[] = []
  for (const part of parts) {
    if (part.kind !== 'mention' || part.characterId === null || seen.has(part.characterId)) continue
    seen.add(part.characterId)
    out.push(part.characterId)
  }
  return out
}

/** The spoken lines, joined - the drawer's Dialogue row when the shot has no `dialogue` of its own. */
export const dialogueOf = (parts: readonly DescriptionPart[]): string | null => {
  const lines = parts.filter((part) => part.kind === 'dialogue').map((part) => part.text)
  return lines.length === 0 ? null : lines.join(' ')
}
