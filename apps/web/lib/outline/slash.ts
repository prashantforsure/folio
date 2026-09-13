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
 * ## The rows are named for the story, the blocks stay the seven
 *
 * The rows read as structure - *Act heading*, *Sequence*, *Scene heading*,
 * *Scene beat*, *Research note* - because that is what a writer reaches for
 * on an outline. Each row **is** one of the seven blocks AGENTS.md names and
 * nothing else: an act heading is an `h1` (the nav's `N acts` counts `h1`
 * blocks, so the two agree by construction), a sequence an `h2`, a scene
 * heading an `h3`, a scene beat the numbered `beat`, a research note the
 * `quote`. The row's detail line prints the block's own name so the status
 * bar (`Heading 1 ⌘1`) and the menu never disagree about what was made. A
 * new block type is a node-schema change (AGENTS.md, When to ask first),
 * and none is introduced here; `ENTRY` is a `Record` over the union so a
 * type without a row does not compile.
 */

export type SlashEntry = {
  readonly type: OutlineNodeType
  /** The row's title, in the writer's terms. */
  readonly label: string
  /** The row's second line: the block it makes, and what it is for. */
  readonly detail: string
  /** A text glyph - never an icon. */
  readonly glyph: string
  /** What the writer may type after the slash to reach it, besides the label. */
  readonly keywords: readonly string[]
  /** `⌘N`, as the row prints it. */
  readonly shortcut: string
}

const ENTRY: Readonly<Record<OutlineNodeType, Omit<SlashEntry, 'type' | 'shortcut'>>> = {
  h1: {
    label: 'Act heading',
    detail: 'Heading 1 · counts as an act',
    glyph: 'H1',
    keywords: ['act', 'heading', 'heading 1', 'h1', 'title', 't1'],
  },
  h2: {
    label: 'Sequence',
    detail: 'Heading 2',
    glyph: 'H2',
    keywords: ['sequence', 'seq', 'heading 2', 'h2', 't2', 'sub'],
  },
  h3: {
    label: 'Scene heading',
    detail: 'Heading 3',
    glyph: 'H3',
    keywords: ['scene', 'heading 3', 'h3', 't3'],
  },
  beat: {
    label: 'Scene beat',
    detail: 'Numbered · the lead runs to the first colon',
    glyph: '1.',
    keywords: ['beat', 'scene beat', 'number', 'numbered', 'list', '1'],
  },
  body: {
    label: 'Body',
    detail: 'Prose',
    glyph: '¶',
    keywords: ['body', 'text', 'p', 'paragraph', 'prose'],
  },
  quote: {
    label: 'Research note',
    detail: 'Quote · a source, a reference, a line to keep',
    glyph: '❝',
    keywords: ['research', 'note', 'quote', 'q', 'source', 'reference'],
  },
  rule: {
    label: 'Rule',
    detail: 'A horizontal divider',
    glyph: '—',
    keywords: ['rule', 'hr', 'divider', 'line', 'break'],
  },
}

/** The two sections as drawn with no query: what shapes the story, then what fills it. */
const STRUCTURE: readonly OutlineNodeType[] = ['h1', 'h2', 'h3', 'beat']
const PROSE: readonly OutlineNodeType[] = ['body', 'quote', 'rule']

export const slashEntry = (type: OutlineNodeType): SlashEntry => ({ type, ...ENTRY[type], shortcut: BLOCK_SHORTCUT[type] })

export const SLASH_ENTRIES: readonly SlashEntry[] = [...STRUCTURE, ...PROSE].map(slashEntry)

const fold = (text: string): string => text.trim().toLowerCase()

/**
 * The entries a query reaches: the label's prefix matches first, then a
 * keyword's, then anything the label or a keyword contains - so `/act` is
 * Act heading, `/be` is Scene beat and `/note` is Research note.
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

/** The menu for a query: two sections for a bare slash, one ranked list once the writer types. */
export const slashMenuFor = (query: string): SlashMenu => {
  if (fold(query) !== '') {
    const matched = filterSlash(query)
    return { sections: matched.length === 0 ? [] : [{ title: 'Blocks', entries: matched }], rows: matched }
  }
  const sections: SlashSection[] = [
    { title: 'Structure', entries: STRUCTURE.map(slashEntry) },
    { title: 'Prose', entries: PROSE.map(slashEntry) },
  ]
  return { sections, rows: sections.flatMap((section) => section.entries) }
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
 * (`/scene b`) keeps it open.
 */
export const slashQueryClosed = (query: string): boolean =>
  /\s{2,}/u.test(query) || (/\s/u.test(query) && filterSlash(query).length === 0)
