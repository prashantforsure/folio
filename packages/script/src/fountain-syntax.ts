import { readCue } from './generated-text'
import type { CharacterId, LocationId } from './ids'
import { characterId, locationId } from './ids'
import type { InlineContent, InlineRun } from './inline'
import { normaliseContent } from './inline'

/**
 * The Fountain lexicon, written down once.
 *
 * Both halves of the format live off this file. The parser asks "would this
 * line read as a scene heading?"; the serialiser asks the identical question in
 * order to decide whether it has to force one. If those two questions were
 * answered by two different pieces of code they would drift, and the drift
 * would show up as a node quietly changing type on a save-and-reload - which is
 * precisely AGENTS.md's stated failure mode, "some other surface quietly
 * becoming authoritative".
 *
 * So: no recogniser is written twice, and the serialiser never assumes what the
 * parser will do - it calls the parser's own predicate and forces when the
 * answer is no.
 *
 * ## Deviations from the Fountain spec, and why
 *
 * 1. **A cue in a caseless script must be forced with `@`.** Fountain infers a
 *    character cue from "the line is uppercase". Devanagari, Tamil and Arabic
 *    have no case, so `s === s.toUpperCase()` is true of *every* line in them,
 *    and inferring would turn every Hindi action line followed by another line
 *    into a character cue - minting a phantom person per paragraph. AGENTS.md
 *    calls entity identity "the hardest correctness problem in the app", and a
 *    phantom character is a worse failure than an unforced cue being read as
 *    action. So a natural cue must contain at least one **uppercase** letter;
 *    `@मीरा` is how you write the other kind. Escalated in the report.
 *
 * 2. **`> centred text <` maps to the Subtitle node.** Fountain has no subtitle
 *    element and the eight types may not be widened. Centred text is the
 *    closest existing element - a subtitle or super is centred on the sheet -
 *    and it is the only Fountain element left with no home. Flagged as a
 *    mapping decision in the report, not a settled one.
 *
 * 3. **`@{character:<id>}` is a mention.** An `InlineRun` mention carries a
 *    record id and deliberately no label (see `inline.ts`), so there is nothing
 *    a name-shaped `@MEERA` could serialise to that would read back as the same
 *    mention. Resolving a name to a record is the alias table's job, which is
 *    derivation, which is not in this phase. The token carries the id
 *    literally, so the round trip needs no resolver and no entropy.
 *
 * 4. **Inline notes and inline emphasis are literal text.** `InlineRun` has two
 *    kinds, text and mention; there is no mark. `*bold*` therefore survives as
 *    the characters `*bold*`, which round-trips exactly and loses nothing that
 *    the model could have held. A `[[note]]` is a Comment node only when it is
 *    the whole block. Both are schema questions, escalated in the report.
 *
 * 5. **Every line is trimmed.** Fountain's two-trailing-spaces convention for a
 *    deliberate blank line inside dialogue is not implemented, so leading and
 *    trailing whitespace is not part of a node's content.
 */

// ---------------------------------------------------------------------------
// Forcing characters
// ---------------------------------------------------------------------------

export const FORCE_SCENE = '.'
export const FORCE_CHARACTER = '@'
export const FORCE_ACTION = '!'
export const FORCE_TRANSITION = '>'
export const CENTRE_CLOSE = '<'
export const NOTE_OPEN = '[['
export const NOTE_CLOSE = ']]'
export const BONEYARD_OPEN = '/*'
export const BONEYARD_CLOSE = '*/'

// ---------------------------------------------------------------------------
// Lines and blocks
// ---------------------------------------------------------------------------

/** Line endings normalised, every line trimmed. See deviation 5. */
export const toLines = (text: string): readonly string[] =>
  text.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim())

/** A run of non-blank lines. Blank lines separate blocks and are not content. */
export type Block = {
  readonly lines: readonly string[]
  /** 1-based line number of the first line, for reporting. */
  readonly line: number
}

export const toBlocks = (lines: readonly string[]): readonly Block[] => {
  const blocks: Block[] = []
  let current: string[] = []
  let start = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line === '') {
      if (current.length > 0) blocks.push({ lines: current, line: start + 1 })
      current = []
      continue
    }
    if (current.length === 0) start = index
    current.push(line)
  }
  if (current.length > 0) blocks.push({ lines: current, line: start + 1 })
  return blocks
}

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

const LOWERCASE = /\p{Ll}/u
const UPPERCASE = /\p{Lu}/u

export const hasLowercaseLetter = (text: string): boolean => LOWERCASE.test(text)
export const hasUppercaseLetter = (text: string): boolean => UPPERCASE.test(text)
/**
 * Anything that cannot survive a line-based text format. `
` is allowed - it
 * is a line break, and a node's content may hold one.
 *
 * Written as a scan rather than a regex because a regex holding control
 * characters is itself a lint error (`no-control-regex`), and escaping round it
 * would hide what is being tested.
 */
export const hasControlCharacter = (text: string): boolean => {
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code === undefined || code === 0x0a) continue
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Scene headings
// ---------------------------------------------------------------------------

/**
 * `\b` is the whole point of this regex.
 *
 * AGENTS.md, Derivation: "A malformed heading does not silently become a scene.
 * `INTERCUT - PHONE CALL` is not an interior scene at location `ERCUT`." The
 * word boundary after the prefix is what makes that true: in `INTERCUT` the
 * character after `INT` is `E`, so there is no boundary and the alternation
 * fails. `INT.`, `INT ` and `I/E.` all have one.
 *
 * The same list without the boundary is `NEAR_SCENE_PREFIX`, which exists only
 * so the near miss can be *reported* rather than silently demoted to action.
 */
const SCENE_PREFIX = /^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)\b/iu
const NEAR_SCENE_PREFIX = /^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)/iu

export type RejectedHeadingReason =
  /** `INTERCUT`, `EXTREME CLOSE UP`, `ESTABLISHING SHOT`. The named test. */
  | { readonly kind: 'prefix-not-a-word'; readonly looksLike: string }
  /** `INT.` with nothing after it. A heading with no set is not a scene. */
  | { readonly kind: 'no-set'; readonly prefix: string }
  /** A lone `.` forcing character with no heading behind it. */
  | { readonly kind: 'forced-but-empty' }

export type HeadingClass =
  | { readonly kind: 'heading' }
  | { readonly kind: 'rejected'; readonly reason: RejectedHeadingReason }
  | { readonly kind: 'none' }

/**
 * Would this line read as a scene heading, and if not, was it trying to be one?
 *
 * Three outcomes, not two. `none` is an ordinary action line. `rejected` is a
 * line that reached for a heading and missed - it still becomes an Action node,
 * but the importer counts it and can show it, because a script full of
 * `INTERCUT` lines silently demoted to action is a thing the writer needs to
 * know about.
 */
export const classifyHeading = (line: string): HeadingClass => {
  const trimmed = line.trim()
  if (trimmed === '') return { kind: 'none' }
  const match = SCENE_PREFIX.exec(trimmed)
  if (match === null) {
    const near = NEAR_SCENE_PREFIX.exec(trimmed)
    if (near === null) return { kind: 'none' }
    return { kind: 'rejected', reason: { kind: 'prefix-not-a-word', looksLike: near[0] } }
  }
  const prefix = match[0]
  const set = trimmed.slice(prefix.length).replace(/^[.\s\-–—]+/u, '').trim()
  if (set === '') return { kind: 'rejected', reason: { kind: 'no-set', prefix } }
  return { kind: 'heading' }
}

export const isNaturalHeading = (line: string): boolean => classifyHeading(line).kind === 'heading'

// ---------------------------------------------------------------------------
// Transitions, cues, parentheticals
// ---------------------------------------------------------------------------

/** Uppercase and ending in `TO:`, per the spec. `FADE IN:` is action. */
export const isNaturalTransition = (line: string): boolean => {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (hasLowercaseLetter(trimmed)) return false
  if (!hasUppercaseLetter(trimmed)) return false
  return trimmed.endsWith('TO:')
}

/**
 * Would this line be inferred as a character cue?
 *
 * Evaluated on the cue *after* generated text has been taken off it, so
 * `MEERA (cont'd)` - lowercase, and therefore not uppercase - is still a cue.
 * Getting that order wrong is one of the ways the continued survives import.
 *
 * The caller supplies whether a line follows, because Fountain's inference
 * needs it: a lone uppercase line in its own block is a transition or action,
 * not a cue with nothing to say.
 */
export const isNaturalCue = (line: string, followedByLine: boolean): boolean => {
  if (!followedByLine) return false
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (isNaturalTransition(trimmed)) return false
  if (isNaturalHeading(trimmed)) return false
  const { name } = readCue(trimmed)
  if (name === '') return false
  if (hasLowercaseLetter(name)) return false
  // Deviation 1: a caseless script must force. No uppercase letter, no cue.
  if (!hasUppercaseLetter(name)) return false
  return true
}

/** `(beat)` - one balanced group spanning the whole line. `(a) and (b)` is not. */
export const isParentheticalLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (trimmed.length < 2 || !trimmed.startsWith('(') || !trimmed.endsWith(')')) return false
  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth < 0) return false
      if (depth === 0 && index !== trimmed.length - 1) return false
    }
  }
  return depth === 0
}

// ---------------------------------------------------------------------------
// Forcing
// ---------------------------------------------------------------------------

/** A leading `.` forces a heading - but `..` is an authored ellipsis, not a force. */
export const isForcedHeading = (line: string): boolean =>
  line.startsWith(FORCE_SCENE) && !line.startsWith('..')

/** `@` forces a cue, except where it opens a mention token. */
export const isForcedCue = (line: string): boolean =>
  line.startsWith(FORCE_CHARACTER) && !line.startsWith(`${FORCE_CHARACTER}{`)

export const isForcedAction = (line: string): boolean => line.startsWith(FORCE_ACTION)

export const isCentred = (line: string): boolean =>
  line.length >= 2 && line.startsWith(FORCE_TRANSITION) && line.endsWith(CENTRE_CLOSE)

export const isForcedTransition = (line: string): boolean =>
  line.startsWith(FORCE_TRANSITION) && !isCentred(line)

export const isSection = (line: string): boolean => line.startsWith('#')

export const isPageBreak = (line: string): boolean => /^={3,}$/u.test(line)

export const isSynopsis = (line: string): boolean => line.startsWith('=') && !isPageBreak(line)

export const isLyric = (line: string): boolean => line.startsWith('~')

export const isNoteBlock = (lines: readonly string[]): boolean => {
  const joined = lines.join('\n')
  return (
    joined.length >= NOTE_OPEN.length + NOTE_CLOSE.length &&
    joined.startsWith(NOTE_OPEN) &&
    joined.endsWith(NOTE_CLOSE) &&
    !joined.slice(NOTE_OPEN.length, -NOTE_CLOSE.length).includes(NOTE_CLOSE)
  )
}

export const isBoneyardBlock = (lines: readonly string[]): boolean => {
  const joined = lines.join('\n')
  return (
    joined.length >= BONEYARD_OPEN.length + BONEYARD_CLOSE.length &&
    joined.startsWith(BONEYARD_OPEN) &&
    joined.endsWith(BONEYARD_CLOSE)
  )
}

/** The title page keys Fountain names. Anything else at the top is script. */
const TITLE_PAGE_KEYS: readonly string[] = [
  'title',
  'credit',
  'author',
  'authors',
  'source',
  'notes',
  'draft date',
  'date',
  'contact',
  'copyright',
  'revision',
]

/**
 * A title-page block, recognised only as the very first block of the file.
 *
 * Keyed off a closed list rather than "looks like `Key: value`", because
 * `FADE IN:` looks exactly like `Key: value` and opens a great many scripts.
 */
export const isTitlePageBlock = (lines: readonly string[]): boolean => {
  const first = lines[0]
  if (first === undefined) return false
  const colon = first.indexOf(':')
  if (colon <= 0) return false
  return TITLE_PAGE_KEYS.includes(first.slice(0, colon).trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/**
 * `@{character:<id>}` / `@{location:<id>}`.
 *
 * The id may not contain `}` or a newline. The serialiser checks that and
 * reports an id it cannot write rather than emitting a token that would read
 * back as something else.
 */
const MENTION_TOKEN = /@\{(character|location):([^}\n]+)\}/gu

export const mentionToken = (entity: 'character' | 'location', id: string): string =>
  `@{${entity}:${id}}`

export const idIsWritable = (id: string): boolean => !id.includes('}') && !id.includes('\n')

/** Content as the characters that go in the file. */
export const renderContent = (content: InlineContent): string =>
  content
    .map((run) =>
      run.kind === 'text' ? run.text : mentionToken(run.target.entity, run.target.id),
    )
    .join('')

/** The inverse: text back to runs, with mention tokens read as structure. */
export const readInline = (text: string): InlineContent => {
  const runs: InlineRun[] = []
  let cursor = 0
  const pattern = new RegExp(MENTION_TOKEN.source, 'gu')
  for (;;) {
    const match = pattern.exec(text)
    if (match === null) break
    const entity = match[1]
    const id = match[2]
    if (entity === undefined || id === undefined) break
    runs.push({ kind: 'text', text: text.slice(cursor, match.index) })
    if (entity === 'character') {
      const target: CharacterId = characterId(id)
      runs.push({ kind: 'mention', target: { entity: 'character', id: target } })
    } else {
      const target: LocationId = locationId(id)
      runs.push({ kind: 'mention', target: { entity: 'location', id: target } })
    }
    cursor = match.index + match[0].length
  }
  runs.push({ kind: 'text', text: text.slice(cursor) })
  return normaliseContent(runs)
}

/** Does this text already contain something that would read back as a mention? */
export const containsMentionToken = (text: string): boolean =>
  new RegExp(MENTION_TOKEN.source, 'u').test(text)
