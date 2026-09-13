import type { OutlineNodeType } from '@folio/script'

/**
 * The outline's keyboard model, as data. `Route - Outline.dc.html`'s status
 * bar: `Body ⌘0 · Heading 1 ⌘1 · Heading 2 ⌘2 · Heading 3 ⌘3 · Quote ⌘⇧Q ·
 * Rule ⌘⇧R`, the hint row `/ insert a heading, quote or rule · ⌥↑↓ move a
 * block`, and the caret line's "Type, or press / for a block".
 *
 * The block toolbar the bundle drew above the sheet is gone with the Plate
 * editor: as on the Script route, `/` opens the menu (`slash.ts`) and the
 * shortcuts stay. Every table is a `Record<OutlineNodeType, ...>` so an
 * eighth block type has to be given a label, a shortcut and a transition
 * before this compiles.
 */

/** As the status bar prints them. */
export const BLOCK_LABEL: Readonly<Record<OutlineNodeType, string>> = {
  body: 'Body',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  quote: 'Quote',
  rule: 'Rule',
  beat: 'Beat',
}

/** The shortcut as the status bar and the slash menu print it. */
export const BLOCK_SHORTCUT: Readonly<Record<OutlineNodeType, string>> = {
  body: '⌘0',
  h1: '⌘1',
  h2: '⌘2',
  h3: '⌘3',
  quote: '⌘⇧Q',
  rule: '⌘⇧R',
  beat: '⌘⇧B',
}

/** What Enter at the end of a block creates below it. A beat continues the list. */
export const ENTER_TRANSITION: Readonly<Record<OutlineNodeType, OutlineNodeType>> = {
  body: 'body',
  h1: 'body',
  h2: 'body',
  h3: 'body',
  quote: 'body',
  rule: 'body',
  beat: 'beat',
}

/** `⌘0`..`⌘3`. */
export const DIGIT_TYPES: readonly OutlineNodeType[] = ['body', 'h1', 'h2', 'h3']

export const typeForDigit = (digit: string): OutlineNodeType | null => {
  const index = Number.parseInt(digit, 10)
  return Number.isInteger(index) ? (DIGIT_TYPES[index] ?? null) : null
}

/** `⌘⇧Q`, `⌘⇧R`, `⌘⇧B`. */
export const typeForShiftLetter = (letter: string): OutlineNodeType | null => {
  switch (letter.toLowerCase()) {
    case 'q':
      return 'quote'
    case 'r':
      return 'rule'
    case 'b':
      return 'beat'
    default:
      return null
  }
}
