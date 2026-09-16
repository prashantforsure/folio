import type { ScreenplayNodeType } from '@folio/script'

import { DIGIT_TYPES, ENTER_TRANSITION, digitForType, nextInTabCycle } from './keyboard'

/**
 * The slash menu, as data.
 *
 * `/` typed at the start of a block or after a space opens a menu over the
 * eight types; what is typed after the slash narrows it; a pick retypes the
 * block (when the slash was all it held) or opens a block of that type
 * below (when it was typed mid-sentence). The `/` and the query are deleted
 * either way - the slash is a way of *asking*, and nothing of it is stored.
 *
 * The menu is the same closed set the type bar was and `⌘1`..`⌘8` still is:
 * `DIGIT_TYPES`, in the bundle's order, so a ninth type has to be given an
 * entry here before this compiles. Two sections, as the reference draws it:
 * *Suggested* is what the keyboard would do next from the caret block -
 * Enter's transition and Tab's next type - and *Blocks* is all eight.
 */

export type SlashEntry = {
  readonly type: ScreenplayNodeType
  /** The row's title. */
  readonly label: string
  /** The row's second line: what the block is for, in the writer's terms. */
  readonly detail: string
  /** A text glyph, from the known set or plain punctuation - never an icon. */
  readonly glyph: string
  /** What the writer may type after the slash to reach it, besides the label. */
  readonly keywords: readonly string[]
  /** `⌘N`, as the row prints it. */
  readonly shortcut: string
}

const ENTRY: Readonly<Record<ScreenplayNodeType, Omit<SlashEntry, 'type' | 'shortcut'>>> = {
  scene: {
    label: 'Scene heading',
    detail: 'INT./EXT. LOCATION - DAY',
    glyph: '▤',
    keywords: ['scene', 'heading', 'slug', 'slugline', 'int', 'ext', 'location'],
  },
  action: {
    label: 'Action',
    detail: 'What we see and hear',
    glyph: 'T',
    keywords: ['action', 'description', 'text', 'prose', 'p'],
  },
  character: {
    label: 'Character',
    detail: 'Who speaks next',
    glyph: 'Aa',
    keywords: ['character', 'cue', 'name', 'speaker', 'cast'],
  },
  paren: {
    label: 'Parenthetical',
    detail: '(softly) - how the line is said',
    glyph: '( )',
    keywords: ['parenthetical', 'paren', 'wryly', 'beat', 'direction'],
  },
  dialogue: {
    label: 'Dialogue',
    detail: 'What they say',
    glyph: '❞',
    keywords: ['dialogue', 'dialog', 'line', 'speech', 'say'],
  },
  transition: {
    label: 'Transition',
    detail: 'CUT TO:',
    glyph: '▥',
    keywords: ['transition', 'cut', 'fade', 'dissolve', 'smash', 'match'],
  },
  comment: {
    label: 'Comment',
    detail: 'A note - not exported, not paginated',
    glyph: '//',
    keywords: ['comment', 'note', 'todo', 'remark'],
  },
  subtitle: {
    label: 'Subtitle',
    detail: 'A caption or a translated line',
    glyph: '≡',
    keywords: ['subtitle', 'caption', 'title', 'super', 'translation'],
  },
}

export const SLASH_ENTRIES: readonly SlashEntry[] = DIGIT_TYPES.map((type) => ({
  type,
  ...ENTRY[type],
  shortcut: `⌘${String(digitForType(type))}`,
}))

export const slashEntry = (type: ScreenplayNodeType): SlashEntry =>
  SLASH_ENTRIES.find((entry) => entry.type === type) ?? { type, ...ENTRY[type], shortcut: '' }

const fold = (text: string): string => text.trim().toLowerCase()

/**
 * The entries a query reaches, the label's prefix matches first, then a
 * keyword's, then anything the label contains - so `/sc` is Scene heading,
 * `/cut` is Transition and `/head` is still Scene heading.
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

/**
 * The menu for a query from a caret block of `from`. With no query the
 * keyboard's next moves lead under *Suggested* (Enter's transition first,
 * then Tab's next type) and every type follows under *Blocks*; once the
 * writer types, the match order is the only order and the sections fold
 * into one.
 */
export const slashMenuFor = (query: string, from: ScreenplayNodeType | null): SlashMenu => {
  const matched = filterSlash(query)
  if (fold(query) !== '' || from === null) {
    const sections = matched.length === 0 ? [] : [{ title: 'Blocks', entries: matched }]
    return { sections, rows: matched }
  }
  const suggested: SlashEntry[] = []
  for (const type of [ENTER_TRANSITION[from], nextInTabCycle(from, false)]) {
    if (type === from || suggested.some((entry) => entry.type === type)) continue
    suggested.push(slashEntry(type))
  }
  const sections: SlashSection[] = [
    ...(suggested.length === 0 ? [] : [{ title: 'Suggested', entries: suggested }]),
    { title: 'Blocks', entries: matched },
  ]
  return { sections, rows: sections.flatMap((section) => section.entries) }
}

/**
 * Whether a `/` at this point opens the menu: at the start of the block or
 * after whitespace. A slash inside a word is punctuation - `INT./EXT.`,
 * `I/E.`, `24/7` - and never a command.
 */
export const slashOpensAt = (textBeforeCaret: string): boolean => textBeforeCaret === '' || /\s$/u.test(textBeforeCaret)

/**
 * Whether the query has left the menu behind: a space followed by nothing
 * that matches is a sentence, not a search. A single space inside a match
 * (`/scene h`) keeps it open.
 */
export const slashQueryClosed = (query: string): boolean =>
  /\s{2,}/u.test(query) || (/\s/u.test(query) && filterSlash(query).length === 0)
