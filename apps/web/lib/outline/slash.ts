import type { OutlineNodeType } from '@folio/script'

import { BLOCK_SHORTCUT } from './keyboard'

/**
 * The outline's slash menu, as data. The twin of `lib/script/slash.ts` over
 * the other closed set.
 *
 * `/` typed at the start of a block or after a space opens a menu over the
 * seven types; what is typed after the slash narrows it; a pick retypes the
 * block (when the slash was all it held) or opens a block of that type
 * below (when it was typed mid-sentence). The `/` and the query are deleted
 * either way - the slash is a way of *asking*, and nothing of it is stored.
 *
 * ## The rows are the mockup's, the blocks stay the seven
 *
 * `docs/ui design/Route - Outline v2.dc.html` draws one `Add` list - Text,
 * Heading, Quote, Numbered list, Divider - each a mono glyph and a name.
 * The block set is closed at seven (AGENTS.md, The node model: Body, H1,
 * H2, H3, Quote, Rule, numbered beats), and every one must stay reachable,
 * so the list is the mockup's five with `Heading 2` and `Heading 3` beside
 * `Heading`. Each row **is** one of the seven and nothing else: `Text` is
 * `body`, `Heading` is `h1` (the sidebar's `N acts` counts `h1` blocks, so
 * the two agree by construction), `Numbered list` the `beat`, `Divider` the
 * `rule`. The older story names - act, sequence, scene, research note -
 * stay as keywords so `/act` still finds the heading. A new block type is a
 * node-schema change (AGENTS.md, When to ask first), and none is introduced
 * here; `ENTRY` is a `Record` over the union so a type without a row does
 * not compile.
 */

export type SlashEntry = {
  readonly type: OutlineNodeType
  /** The row's title, as the mockup names it. */
  readonly label: string
  /** What the block is for; kept for the `+` handle's menu and the tests, not drawn on the row. */
  readonly detail: string
  /** A text glyph, drawn in mono - never an icon. */
  readonly glyph: string
  /** What the writer may type after the slash to reach it, besides the label. */
  readonly keywords: readonly string[]
  /** `⌘N`, as the row prints it. */
  readonly shortcut: string
}

const ENTRY: Readonly<Record<OutlineNodeType, Omit<SlashEntry, 'type' | 'shortcut'>>> = {
  body: {
    label: 'Text',
    detail: 'Prose',
    glyph: 'T',
    keywords: ['text', 'body', 'p', 'paragraph', 'prose'],
  },
  h1: {
    label: 'Heading',
    detail: 'Heading 1 · counts as an act',
    glyph: 'H',
    keywords: ['heading', 'heading 1', 'h1', 'act', 'title', 't1'],
  },
  h2: {
    label: 'Heading 2',
    detail: 'A sequence under an act',
    glyph: 'H2',
    keywords: ['heading 2', 'h2', 'sequence', 'seq', 't2', 'sub'],
  },
  h3: {
    label: 'Heading 3',
    detail: 'A scene under a sequence',
    glyph: 'H3',
    keywords: ['heading 3', 'h3', 'scene', 't3'],
  },
  quote: {
    label: 'Quote',
    detail: 'A source, a reference, a line to keep',
    glyph: '❞',
    keywords: ['quote', 'q', 'research', 'note', 'source', 'reference'],
  },
  beat: {
    label: 'Numbered list',
    detail: 'A story beat · the lead runs to the first colon',
    glyph: '1.',
    keywords: ['numbered', 'number', 'list', 'beat', 'scene beat', '1'],
  },
  rule: {
    label: 'Divider',
    detail: 'A horizontal rule',
    glyph: '—',
    keywords: ['divider', 'rule', 'hr', 'line', 'break'],
  },
}

/** The order drawn: the mockup's five, the two extra headings beside the first. */
const ORDER: readonly OutlineNodeType[] = ['body', 'h1', 'h2', 'h3', 'quote', 'beat', 'rule']

export const slashEntry = (type: OutlineNodeType): SlashEntry => ({ type, ...ENTRY[type], shortcut: BLOCK_SHORTCUT[type] })

export const SLASH_ENTRIES: readonly SlashEntry[] = ORDER.map(slashEntry)

const fold = (text: string): string => text.trim().toLowerCase()

/**
 * The entries a query reaches: the label's prefix matches first, then a
 * keyword's, then anything the label or a keyword contains - so `/he` is
 * the headings, `/be` is the numbered list (a beat) and `/act` the first
 * heading.
 */
export const filterSlash = (query: string): readonly SlashEntry[] => {
  const needle = fold(query)
  if (needle === '') return SLASH_ENTRIES
  const rank = (entry: SlashEntry): number => {
    const label = fold(entry.label)
    if (label.startsWith(needle)) return 0
    if (entry.keywords.some((keyword) => keyword.startsWith(needle))) return 1
    if (label.includes(needle) || entry.keywords.some((keyword) => keyword.includes(needle))) return 2
    return -1
  }
  return SLASH_ENTRIES.map((entry) => ({ entry, rank: rank(entry) }))
    .filter((scored) => scored.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((scored) => scored.entry)
}

export type SlashSection = {
  readonly title: string
  readonly entries: readonly SlashEntry[]
}

export type SlashMenu = {
  /** The sections as drawn, top to bottom. Empty when nothing matches. */
  readonly sections: readonly SlashSection[]
  /** The same rows flattened, in drawn order - what the arrow keys walk. */
  readonly rows: readonly SlashEntry[]
}

/** One `Add` section: the seven for a bare slash, the ranked matches once the writer types. */
export const slashMenuFor = (query: string): SlashMenu => {
  const matched = fold(query) === '' ? SLASH_ENTRIES : filterSlash(query)
  return { sections: matched.length === 0 ? [] : [{ title: 'Add', entries: matched }], rows: matched }
}

/**
 * Whether a `/` at this point opens the menu: at the start of the block or
 * after whitespace. A slash inside a word is punctuation - `and/or`,
 * `24/7` - and never a command.
 */
export const slashOpensAt = (textBeforeCaret: string): boolean => textBeforeCaret === '' || /\s$/u.test(textBeforeCaret)

/**
 * Whether the query has left the menu behind: a space followed by nothing
 * that matches is a sentence, not a search. A single space inside a match
 * (`/heading 2`) keeps it open.
 */
export const slashQueryClosed = (query: string): boolean =>
  /\s{2,}/u.test(query) || (/\s/u.test(query) && filterSlash(query).length === 0)
