import type { OutlineNodeType } from '@folio/script'

/**
 * The outline's keyboard model, as data. `Route - Outline.dc.html`'s block
 * toolbar and status bar: `Body ⌘0 · Heading 1 ⌘1 · Heading 2 ⌘2 · Heading
 * 3 ⌘3 · Quote ⌘⇧Q · Rule ⌘⇧R`, the hint row `/ insert a heading, quote or
 * rule · ⌥↑↓ move a block`, and the caret line's "Type, or press / for a
 * block".
 *
 * Every table is a `Record<OutlineNodeType, ...>` so an eighth block type
 * has to be given a label, a shortcut and a transition before this compiles.
 */

/** As the toolbar and the status bar print them. */
export const BLOCK_LABEL: Readonly<Record<OutlineNodeType, string>> = {
  body: 'Body',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  quote: 'Quote',
  rule: 'Rule',
  beat: 'Beat',
}

/** The toolbar's two-line button: glyph over a short label. */
export const BLOCK_TOOL: Readonly<Record<OutlineNodeType, { readonly glyph: string; readonly label: string; readonly title: string }>> = {
  body: { glyph: '¶', label: 'Body', title: 'Body text' },
  h1: { glyph: 'H1', label: 'T1', title: 'Heading 1' },
  h2: { glyph: 'H2', label: 'T2', title: 'Heading 2' },
  h3: { glyph: 'H3', label: 'T3', title: 'Heading 3' },
  quote: { glyph: '❝', label: 'Quote', title: 'Block quote' },
  rule: { glyph: '—', label: 'Rule', title: 'Horizontal rule' },
  beat: { glyph: '1.', label: 'Beat', title: 'Numbered beat' },
}

/** The shortcut as the status bar prints it. */
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

/**
 * The slash menu: what `/` on an empty block offers, in toolbar order, and
 * what the writer types after the slash to narrow it. The bundle's hint
 * says "insert a heading, quote or rule"; a beat and body are listed too so
 * the menu is the whole closed set and not a subset of it.
 */
export type SlashEntry = { readonly type: OutlineNodeType; readonly keywords: readonly string[] }

export const SLASH_MENU: readonly SlashEntry[] = [
  { type: 'h1', keywords: ['h1', 'heading', 'heading 1', 'title', 't1'] },
  { type: 'h2', keywords: ['h2', 'heading 2', 't2', 'sub'] },
  { type: 'h3', keywords: ['h3', 'heading 3', 't3'] },
  { type: 'quote', keywords: ['quote', 'q'] },
  { type: 'rule', keywords: ['rule', 'hr', 'divider', 'line'] },
  { type: 'beat', keywords: ['beat', 'number', 'list', '1'] },
  { type: 'body', keywords: ['body', 'text', 'p', 'paragraph'] },
]

export const filterSlashMenu = (query: string): readonly SlashEntry[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return SLASH_MENU
  return SLASH_MENU.filter(
    (entry) =>
      BLOCK_LABEL[entry.type].toLowerCase().startsWith(needle) ||
      entry.keywords.some((keyword) => keyword.startsWith(needle)),
  )
}
