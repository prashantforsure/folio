import type { ScreenplayNodeType } from '@folio/script'

/**
 * The keyboard model, as data.
 *
 * The bundle's hint row: "Tab: Action -> Character -> Dialogue -> Parenthetical
 * - @ mention a character or location - INT. on an empty Action line becomes
 * a Scene Heading", and its element bar: `⌘1`..`⌘8` for the eight types in
 * order. Enter's transitions are the screenwriting convention, and one of
 * them is a ruling: **Enter at the end of a Comment creates an Action**, and
 * **Tab never cycles into Comment** (2026-09-11, `docs/build-decisions.md`).
 *
 * Every table here is a `Record<ScreenplayNodeType, ...>`, so a ninth type
 * has to be given a transition before this compiles - the closed set is
 * closed at the keyboard too.
 */

/** What Enter at the end of a block creates below it. */
export const ENTER_TRANSITION: Readonly<Record<ScreenplayNodeType, ScreenplayNodeType>> = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  paren: 'dialogue',
  dialogue: 'character',
  transition: 'scene',
  comment: 'action',
  subtitle: 'action',
}

/**
 * The Tab cycle. Four types, in the bundle's order; Tab from any other type
 * enters the cycle at Action, and Comment is never entered.
 */
export const TAB_CYCLE: readonly ScreenplayNodeType[] = ['action', 'character', 'dialogue', 'paren']

export const nextInTabCycle = (type: ScreenplayNodeType, backwards: boolean): ScreenplayNodeType => {
  const at = TAB_CYCLE.indexOf(type)
  if (at === -1) return backwards ? 'paren' : 'action'
  const step = backwards ? TAB_CYCLE.length - 1 : 1
  return TAB_CYCLE[(at + step) % TAB_CYCLE.length] ?? 'action'
}

/** `⌘1`..`⌘8`, in the order the bundle's element bar lists them. */
export const DIGIT_TYPES: readonly ScreenplayNodeType[] = [
  'scene',
  'action',
  'character',
  'paren',
  'dialogue',
  'transition',
  'comment',
  'subtitle',
]

export const typeForDigit = (digit: string): ScreenplayNodeType | null => {
  const index = Number.parseInt(digit, 10) - 1
  return Number.isInteger(index) ? (DIGIT_TYPES[index] ?? null) : null
}

export const digitForType = (type: ScreenplayNodeType): number => DIGIT_TYPES.indexOf(type) + 1

/**
 * The prefixes that turn an Action line into a Scene heading as they are
 * typed. `INT.`, `EXT.`, `INT./EXT.`, `I/E.` and `EST.` - the openings
 * `slugline.ts` accepts - matched against the whole line so far, so the
 * promotion happens on the keystroke that completes the prefix and not on
 * an `INTERCUT` that merely starts with the same letters.
 */
const HEADING_PREFIX = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|I\/E|EST)\.\s*$/iu

export const promotesToHeading = (lineSoFar: string): boolean => HEADING_PREFIX.test(lineSoFar)
