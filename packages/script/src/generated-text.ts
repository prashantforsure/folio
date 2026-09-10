import type { DeliveryModifier } from './node'
import { DELIVERY_MODIFIERS } from './node'

/**
 * Telling authored text from generated text.
 *
 * AGENTS.md, The node model: "**Generated text never enters the node stream.**
 * `(MORE)`, `CHARACTER (CONT'D)` at a page split, and speaker `(CONT'D)` are
 * computed at render and stripped on import. Authored `(V.O.)`, `(O.S.)` and
 * `(O.C.)` *are* stored, as node attributes. Conflate the two and every `.fdx`
 * round-trip doubles the continueds."
 *
 * That is one rule with two halves, and the halves look identical on the page -
 * both are an uppercase token in parentheses hanging off the end of a cue. So
 * the discrimination lives here, in one module, rather than once in the
 * Fountain parser and again in the FDX mapping. Two implementations of this
 * rule is how the doubling bug gets in: they will agree on `(V.O.)`, and then
 * one of them will not know about `(CONT’D)` with a curly apostrophe.
 *
 * Nothing in here is Fountain-specific or FDX-specific. It takes cue text and
 * returns what the cue actually says.
 *
 * ## What counts as a `(CONT'D)`
 *
 * Every spelling that has been seen in the wild, because the file that breaks
 * this is the one exported by a tool that is not Final Draft:
 * `(CONT'D)` `(CONT’D)` `(CONTD)` `(CONT D)` `(cont'd)` `(CONT'D.)`.
 * The apostrophe is optional and may be any of six code points; the case is
 * ignored; a trailing full stop is allowed.
 *
 * Being liberal here is the safe direction. A false positive costs an authored
 * `(CONT'D)` the writer typed by hand - which AGENTS.md says is a layout
 * artefact regardless of who typed it, so there is nothing to lose. A false
 * negative puts generated text in the node stream permanently.
 *
 * ## What counts as a delivery modifier
 *
 * The three in `DELIVERY_MODIFIERS` and nothing else, matched with dots and
 * spaces ignored so `(VO)`, `(V.O)` and `(V. O.)` all resolve to the one
 * canonical `V.O.`. The lookup is built *from* the tuple, so adding a fourth
 * modifier to `node.ts` cannot leave this file behind.
 *
 * Anything else in parentheses on a cue - `(17)`, `(on phone)`, `(in Hindi)` -
 * is neither, and stops the scan: it is part of the name as far as this module
 * is concerned, and resolving it is the alias table's job, not ours.
 */

// ---------------------------------------------------------------------------
// The two vocabularies
// ---------------------------------------------------------------------------

/** Straight, curly, modifier-letter, prime and acute. All seen in real files. */
const APOSTROPHES = "'‘’ʹʼ´`′"

/** `(MORE)`, allowing an ellipsis some tools append. */
const MORE_LINE = /^\(\s*more\s*(?:\.{1,3}|…)?\s*\)$/iu

/** The inside of a `(CONT'D)`, apostrophe optional and of any flavour. */
const CONT_D_INNER = new RegExp(`^cont[\\s.${APOSTROPHES}]*d\\.?$`, 'iu')

/** Canonical form keyed by the modifier with dots and spaces removed. */
const MODIFIER_BY_KEY: ReadonlyMap<string, DeliveryModifier> = new Map(
  DELIVERY_MODIFIERS.map((modifier): readonly [string, DeliveryModifier] => [
    modifier.replace(/[.\s]/gu, '').toUpperCase(),
    modifier,
  ]),
)

/** A parenthesised group at the very end of a line, with no nesting. */
const TRAILING_GROUP = /\s*\(([^()]*)\)\s*$/u

// ---------------------------------------------------------------------------
// What was removed
// ---------------------------------------------------------------------------

export const GENERATED_ARTEFACT_KINDS = ['more', 'cont-d'] as const

export type GeneratedArtefactKind = (typeof GENERATED_ARTEFACT_KINDS)[number]

/**
 * One piece of generated text that was removed on import.
 *
 * Reported rather than discarded silently: "continueds stripped" is a number
 * the importer has to be able to show, and a strip count that is unexpectedly
 * zero on a repaginated file is the first sign this module has stopped
 * matching a spelling.
 */
export type GeneratedArtefact = {
  readonly kind: GeneratedArtefactKind
  /** Verbatim, including the parentheses, exactly as it appeared. */
  readonly text: string
}

/**
 * What a cue line actually says, once layout has been taken back off it.
 *
 * `name` is what goes in the node's content. `modifiers` are authored and go on
 * the node. `artefacts` are generated and go nowhere - they are returned only
 * so the caller can count them.
 */
export type CueReading = {
  readonly name: string
  readonly modifiers: readonly DeliveryModifier[]
  readonly artefacts: readonly GeneratedArtefact[]
  /**
   * The cue carried a `^` dual-dialogue marker.
   *
   * The node model has nowhere to put this - it would be a ninth attribute on
   * `CharacterNode`, and AGENTS.md, When to ask first puts a node schema change
   * behind an ADR. So it is stripped and reported, never invented. See the
   * report for the escalation.
   */
  readonly dual: boolean
}

// ---------------------------------------------------------------------------
// Recognisers
// ---------------------------------------------------------------------------

/** A whole line that is nothing but a `(MORE)`. */
export const isMoreLine = (line: string): boolean => MORE_LINE.test(line.trim())

/** A whole line that is nothing but a `(CONT'D)` - a continued as a parenthetical. */
export const isContinuedLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return false
  return CONT_D_INNER.test(trimmed.slice(1, -1).trim())
}

/**
 * Does this text carry generated text anywhere a cue reading would strip it?
 *
 * The serialiser needs this: a `CharacterNode` whose *name* contains a
 * `(CONT'D)` cannot be written out, because reading it back would strip it and
 * the round trip would lose a character. That is the doubling bug seen from the
 * other end, and it is reported rather than silently repaired.
 */
export const carriesGeneratedText = (text: string): boolean =>
  readCue(text).artefacts.length > 0 || isMoreLine(text) || isContinuedLine(text)

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

type Group =
  | { readonly kind: 'modifier'; readonly modifier: DeliveryModifier }
  | { readonly kind: 'artefact'; readonly artefact: GeneratedArtefact }
  | { readonly kind: 'other' }

const readGroup = (inner: string, verbatim: string): Group => {
  const trimmed = inner.trim()
  const modifier = MODIFIER_BY_KEY.get(trimmed.replace(/[.\s]/gu, '').toUpperCase())
  if (modifier !== undefined) return { kind: 'modifier', modifier }
  if (CONT_D_INNER.test(trimmed)) {
    return { kind: 'artefact', artefact: { kind: 'cont-d', text: verbatim } }
  }
  if (MORE_LINE.test(`(${trimmed})`)) {
    return { kind: 'artefact', artefact: { kind: 'more', text: verbatim } }
  }
  return { kind: 'other' }
}

/**
 * Read a cue line into name, authored modifiers and generated artefacts.
 *
 * Groups are pulled off the **end**, right to left, and the scan stops at the
 * first group that is neither a modifier nor an artefact. So `MEERA (17)
 * (V.O.)` yields the modifier and the name `MEERA (17)`, and a cue that simply
 * ends in a parenthesis keeps it.
 *
 * `modifiers` come back in authored (left-to-right) order, deduplicated: Final
 * Draft will happily emit `(V.O.) (V.O.)` after a merge, and two of the same
 * modifier on one cue is not a thing the model should have to represent.
 */
export const readCue = (raw: string): CueReading => {
  let rest = raw.trim()
  let dual = false

  // The dual-dialogue caret sits outside the modifiers: `MEERA (V.O.) ^`.
  const withoutCaret = rest.replace(/\s*\^\s*$/u, '')
  if (withoutCaret !== rest) {
    dual = true
    rest = withoutCaret
  }

  const modifiers: DeliveryModifier[] = []
  const artefacts: GeneratedArtefact[] = []

  for (;;) {
    const match = TRAILING_GROUP.exec(rest)
    if (match === null) break
    const inner = match[1]
    if (inner === undefined) break
    const group = readGroup(inner, match[0].trim())
    if (group.kind === 'other') break
    if (group.kind === 'modifier') modifiers.push(group.modifier)
    else artefacts.push(group.artefact)
    rest = rest.slice(0, match.index).trimEnd()
    // A caret can also sit inside, after the last group: `MEERA ^ (V.O.)`.
    const inner2 = rest.replace(/\s*\^\s*$/u, '')
    if (inner2 !== rest) {
      dual = true
      rest = inner2
    }
  }

  modifiers.reverse()
  artefacts.reverse()

  const seen = new Set<DeliveryModifier>()
  const unique = modifiers.filter((modifier) => {
    if (seen.has(modifier)) return false
    seen.add(modifier)
    return true
  })

  return { name: rest.trim(), modifiers: unique, artefacts, dual }
}

// ---------------------------------------------------------------------------
// Page splits
// ---------------------------------------------------------------------------

/** Who is speaking, as far as a cue can say. Not a character record. */
export type Speaker = {
  readonly name: string
  readonly modifiers: readonly DeliveryModifier[]
}

export const sameSpeaker = (a: Speaker, b: Speaker): boolean =>
  a.name === b.name &&
  a.modifiers.length === b.modifiers.length &&
  a.modifiers.every((modifier, index) => modifier === b.modifiers[index])

/** Everything an importer knows about the position a cue turned up in. */
export type ContinuationContext = {
  /** The cue itself carried a `(CONT'D)`. */
  readonly cueCarriesContinued: boolean
  /** A `(MORE)` was the last thing seen before it. */
  readonly afterMore: boolean
  /** The node immediately before it is dialogue - so nothing intervened. */
  readonly previousIsDialogue: boolean
  /** The cue that opened that dialogue. */
  readonly previousSpeaker: Speaker | undefined
}

/**
 * Is this cue the second half of a speech a paginator cut in two?
 *
 * The rule both importers ask, so there is one answer rather than two. Getting
 * it wrong in one direction leaves the cue duplicated in the node stream, which
 * is what a doubled continued *is*; getting it wrong in the other silently
 * merges two real speeches by the same character.
 *
 * All four conditions are required. In particular `previousIsDialogue` is what
 * separates a page split from AGENTS.md's other case, speaker `(CONT'D)`: when
 * the same character speaks again after an action line, the cue is real and
 * only the `(CONT'D)` on it is generated.
 */
export const isPageSplitContinuation = (
  cue: Speaker,
  context: ContinuationContext,
): boolean =>
  (context.cueCarriesContinued || context.afterMore) &&
  context.previousIsDialogue &&
  context.previousSpeaker !== undefined &&
  sameSpeaker(context.previousSpeaker, cue)

export type StrippedLine = {
  /** The line with generated text removed. `''` when that was all it held. */
  readonly text: string
  readonly artefacts: readonly GeneratedArtefact[]
}

/**
 * Take generated text off a line that is not a cue.
 *
 * `MEERA (V.O.) (CONT'D)` with nothing after it is not a cue - Fountain infers
 * a cue only when a line follows - so it becomes Action, and without this it
 * would carry the continued into the node stream forever. AGENTS.md does not
 * qualify the rule by element type: generated text never enters the node
 * stream, whatever the line turned out to be.
 *
 * This is safe to run over any line because `readCue` only removes trailing
 * parenthesised groups it *recognises*. `INT. HOUSE (KITCHEN)` keeps its
 * kitchen; `She waits (beat)` keeps its beat. Only the two generated spellings
 * are removed, and an authored `(V.O.)` is put back where it was.
 *
 * A property test drove this out (`fountain-roundtrip.test.ts`, "no node ever
 * carries a generated modifier or a generated line"); the example is preserved
 * in `generated-text.test.ts`.
 */
export const stripGeneratedFromLine = (line: string): StrippedLine => {
  const reading = readCue(line)
  if (reading.artefacts.length === 0) return { text: line, artefacts: [] }
  return { text: writeCue(reading.name, reading.modifiers), artefacts: reading.artefacts }
}

/**
 * Write a cue back out: name plus authored modifiers, never an artefact.
 *
 * The inverse of `readCue` on everything `readCue` keeps. There is deliberately
 * no way to ask this function for a `(CONT'D)` - the type it takes has no
 * member that could carry one.
 */
export const writeCue = (name: string, modifiers: readonly DeliveryModifier[]): string =>
  modifiers.length === 0 ? name : `${name} ${modifiers.map((m) => `(${m})`).join(' ')}`

// ---------------------------------------------------------------------------
// The layout artefacts, written at render and nowhere else
// ---------------------------------------------------------------------------

/**
 * The two strings the paginator draws at a page split.
 *
 * They live here, beside the recognisers that strip them on import, because
 * this module is the one place that tells generated text from authored text.
 * Written anywhere else they would be a second spelling, and the file that
 * breaks the round trip is the one where the writer and the reader disagree
 * about an apostrophe.
 *
 * Nothing in this file can put either of them on a node. `paginate.ts` receives
 * them as page artefacts on the measurement record - AGENTS.md, exception table
 * "Generated text is never in the node stream - except": `(MORE)` and
 * `(CONT'D)` at a split are layout artefacts, computed at render.
 */
export const MORE_TEXT = '(MORE)'

export const CONTINUED_TEXT = "(CONT'D)"

/**
 * The cue as it is redrawn at the top of a continuation page.
 *
 * Authored modifiers stay - a speech that was `MEERA (V.O.)` is still `(V.O.)`
 * after the break - and the continued is appended, in that order.
 * `readCue(writeContinuedCue(name, modifiers))` returns the name and the
 * modifiers and reports the continued as an artefact, which is asserted in
 * `generated-text.test.ts`.
 */
export const writeContinuedCue = (
  name: string,
  modifiers: readonly DeliveryModifier[],
): string => `${writeCue(name, modifiers)} ${CONTINUED_TEXT}`
