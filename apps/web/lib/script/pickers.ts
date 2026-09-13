import type { ScreenplayNodeType } from '@folio/script'
import { TIMES_OF_DAY } from '@folio/script'

import { ENTER_TRANSITION, nextInTabCycle } from './keyboard'

/**
 * The block selectors, as data.
 *
 * Three of the eight types open a selector under the caret while the block is
 * being written: a Scene heading is composed in three stages (`INT./EXT.` ->
 * location -> time of day), a Character cue picks from the cast, a
 * Transition picks from the conventional cuts. Everything the selector shows
 * is computed here from the block's text and the caret; the editor only
 * applies the plan a choice returns. **Nothing new is stored**: a heading
 * composed through the stages is the same plain-text Scene node the Fountain
 * parser reads, a cue picked from the list is the same cue typed by hand.
 * The selector is a way of typing, not a second model.
 *
 * ## What the vocabularies are, and where they come from
 *
 * - The prefixes are the four `fountain-syntax.ts` accepts as a heading
 *   opening (`SCENE_PREFIX`): `INT.`, `EXT.`, `INT./EXT.`, `I/E.`, plus
 *   `EST.`. Offering `EXT./INT.` would compose a heading the parser reads as
 *   `EXT.` with the set `/INT. ...`, so it is not offered.
 * - The times of day are `@folio/script`'s own `TIMES_OF_DAY` - the list
 *   `readSlugline` takes the time off the set with. A time the selector
 *   offers is therefore always one derivation recognises.
 * - The transitions are the screenwriting conventions. `FADE IN:` and
 *   `FADE OUT.` are here because the writer asks for them by that name; a
 *   Transition *node* is one by type, so the serialiser forces the ones that
 *   do not end in `TO:` and the round-trip holds.
 *
 * ## The two rules the editor relies on
 *
 * 1. A selector with no highlighted choice passes every key through, so
 *    Enter on an empty Character cue still becomes an Action, as it always
 *    did. The one stage that opens without a highlight is the empty cue.
 * 2. A selector is derived, never opened: `pickerFor` is a function of the
 *    caret block, so it is on screen exactly while the text is in a state it
 *    can help with, and gone the moment the heading or cue is complete.
 *
 * ## The pills, and the edit mode
 *
 * Once a heading, cue or transition is complete its segments are drawn as
 * pills (`pillsFor`), and a click on one *reopens* the selector for that
 * segment in `edit` mode: the list is shown whole with the current value
 * highlighted, a pick replaces that segment alone (`segmentStart` to
 * `segmentEnd`, never to the block's end), and nothing opens below. The
 * edit is the editor's one piece of selector state - the pill clicked - and
 * everything else is still derived from the text.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export type PickerChoice = {
  /** What is inserted. */
  readonly text: string
  /** The second line under it. */
  readonly detail: string
  /** `known` is a listed value or an existing record; `new` is the writer's own text. */
  readonly kind: 'known' | 'new'
}

export const SCENE_PREFIX_CHOICES: readonly PickerChoice[] = [
  { text: 'INT.', detail: 'Interior', kind: 'known' },
  { text: 'EXT.', detail: 'Exterior', kind: 'known' },
  { text: 'INT./EXT.', detail: 'Interior and exterior', kind: 'known' },
  { text: 'I/E.', detail: 'Interior and exterior, short form', kind: 'known' },
  { text: 'EST.', detail: 'Establishing shot', kind: 'known' },
]

/** The order the time list opens in: the everyday ones first, then the rest as the engine lists them. */
const TIME_ORDER: readonly string[] = [
  'DAY',
  'NIGHT',
  'CONTINUOUS',
  'LATER',
  'MOMENTS LATER',
  'SAME TIME',
  'MORNING',
  'AFTERNOON',
  'EVENING',
  'DAWN',
  'DUSK',
  'NOON',
  'MIDNIGHT',
]

const LIGHT_DETAIL = { day: 'Day light', night: 'Night light', unspecified: 'Light unspecified' } as const

export const TIME_CHOICES: readonly PickerChoice[] = [
  ...TIME_ORDER.flatMap((time) => {
    const entry = TIMES_OF_DAY.find((candidate) => candidate.time === time)
    return entry === undefined ? [] : [{ text: entry.time, detail: LIGHT_DETAIL[entry.light], kind: 'known' as const }]
  }),
  ...TIMES_OF_DAY.filter((entry) => !TIME_ORDER.includes(entry.time)).map((entry) => ({
    text: entry.time,
    detail: LIGHT_DETAIL[entry.light],
    kind: 'known' as const,
  })),
]

export const TRANSITION_CHOICES: readonly PickerChoice[] = [
  { text: 'CUT TO:', detail: 'Cut to', kind: 'known' },
  { text: 'FADE TO:', detail: 'Fade to', kind: 'known' },
  { text: 'DISSOLVE TO:', detail: 'Dissolve to', kind: 'known' },
  { text: 'SMASH CUT TO:', detail: 'Smash cut to', kind: 'known' },
  { text: 'MATCH CUT TO:', detail: 'Match cut to', kind: 'known' },
  { text: 'JUMP CUT TO:', detail: 'Jump cut to', kind: 'known' },
  { text: 'FADE IN:', detail: 'Fade in', kind: 'known' },
  { text: 'FADE OUT.', detail: 'Fade out', kind: 'known' },
  { text: 'FADE TO BLACK.', detail: 'Fade to black', kind: 'known' },
  { text: 'WIPE TO:', detail: 'Wipe to', kind: 'known' },
  { text: 'TIME CUT:', detail: 'Time cut', kind: 'known' },
  { text: 'INTERCUT WITH:', detail: 'Intercut with', kind: 'known' },
  { text: 'BACK TO:', detail: 'Back to', kind: 'known' },
]

// ---------------------------------------------------------------------------
// The scene heading's three stages
// ---------------------------------------------------------------------------

export type SceneStage = 'prefix' | 'location' | 'time'

export type SceneReading = {
  readonly stage: SceneStage
  /** Offset in the block's text where the stage's segment starts. */
  readonly segmentStart: number
  /** The text of the stage's segment so far. */
  readonly query: string
}

/** A prefix the parser accepts, followed by at least one space: the location stage has begun. */
const PAST_PREFIX = /^(?:INT\.?\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+/iu

/** The last ` - ` (or dash variant) in the set: the time stage has begun. Mirrors `slugline.ts`. */
const SEGMENT_SEPARATOR = /\s+[-–—]{1,2}\s+|\s*--\s*/gu

export const readSceneStage = (text: string): SceneReading => {
  const past = PAST_PREFIX.exec(text)
  if (past === null) return { stage: 'prefix', segmentStart: 0, query: text }
  const restStart = past[0].length
  const rest = text.slice(restStart)
  let lastSeparatorEnd = -1
  for (const match of rest.matchAll(SEGMENT_SEPARATOR)) {
    if (match.index !== undefined) lastSeparatorEnd = match.index + match[0].length
  }
  if (lastSeparatorEnd === -1) return { stage: 'location', segmentStart: restStart, query: rest }
  return { stage: 'time', segmentStart: restStart + lastSeparatorEnd, query: rest.slice(lastSeparatorEnd) }
}

/** A span of the block's text: `[start, end)`. */
export type Segment = { readonly start: number; readonly end: number }

/**
 * The three segments of a heading as written, whitespace trimmed off each,
 * so a click on `ROOFTOP COURT` or on `NIGHT` can name what it is on. Null
 * for a segment the text has not reached: no prefix until `PREFIX `, no time
 * until the last ` - `. This is `readSceneStage` read for every stage at
 * once rather than for the one the caret is in.
 */
export type SceneSegments = {
  readonly prefix: Segment | null
  readonly location: Segment | null
  readonly time: Segment | null
}

const trimmed = (text: string, start: number, end: number): Segment => {
  let from = start
  let to = end
  while (from < to && /\s/u.test(text.charAt(from))) from += 1
  while (to > from && /\s/u.test(text.charAt(to - 1))) to -= 1
  return { start: from, end: to }
}

export const readSceneSegments = (text: string): SceneSegments => {
  const past = PAST_PREFIX.exec(text)
  if (past === null) return { prefix: null, location: null, time: null }
  const prefix = { start: 0, end: past[0].trimEnd().length }
  const restStart = past[0].length
  const rest = text.slice(restStart)
  let separatorStart = -1
  let separatorEnd = -1
  for (const match of rest.matchAll(SEGMENT_SEPARATOR)) {
    if (match.index === undefined) continue
    separatorStart = match.index
    separatorEnd = match.index + match[0].length
  }
  if (separatorStart === -1) return { prefix, location: trimmed(text, restStart, text.length), time: null }
  return {
    prefix,
    location: trimmed(text, restStart, restStart + separatorStart),
    time: trimmed(text, restStart + separatorEnd, text.length),
  }
}

/**
 * The pills: the spans of a finished block a click reopens a selector on.
 * A heading's three segments, a cue's name (its written modifier left
 * plain), a transition's whole text. Presentation only - the editor draws
 * them as decorations and nothing about them is stored.
 */
export type Pill = Segment & { readonly kind: PickerKind }

/** A cue as typed, without a modifier the writer wrote into the text (`MEERA (V.O.)`). */
export const bareCue = (text: string): string => text.replace(/\s*\([^)]*\)\s*$/u, '').trim()

export const pillsFor = (type: ScreenplayNodeType, text: string): readonly Pill[] => {
  if (type === 'scene') {
    const segments = readSceneSegments(text)
    const pills: Pill[] = []
    if (segments.prefix !== null && segments.prefix.end > segments.prefix.start) pills.push({ ...segments.prefix, kind: 'scene-prefix' })
    if (segments.location !== null && segments.location.end > segments.location.start) pills.push({ ...segments.location, kind: 'scene-location' })
    if (segments.time !== null && segments.time.end > segments.time.start) pills.push({ ...segments.time, kind: 'scene-time' })
    return pills
  }
  if (type === 'character') {
    // The bare cue is a substring: the text less its leading space and its trailing `(V.O.)`.
    const start = text.length - text.trimStart().length
    const end = start + bareCue(text).length
    return end > start ? [{ start, end, kind: 'character' }] : []
  }
  if (type === 'transition') {
    const whole = trimmed(text, 0, text.length)
    return whole.end > whole.start ? [{ ...whole, kind: 'transition' }] : []
  }
  return []
}

// ---------------------------------------------------------------------------
// The selector for a caret block
// ---------------------------------------------------------------------------

export type PickerKind = 'scene-prefix' | 'scene-location' | 'scene-time' | 'character' | 'transition'

const PICKER_KINDS: readonly PickerKind[] = ['scene-prefix', 'scene-location', 'scene-time', 'character', 'transition']

/** A `data-pill` value read back off the DOM. */
export const isPickerKind = (value: string): value is PickerKind => (PICKER_KINDS as readonly string[]).includes(value)

export type PickerModel = {
  readonly kind: PickerKind
  /**
   * `compose` is the selector under the caret while the block is being
   * written; `edit` is the same selector reopened by a click on a pill of a
   * finished block, replacing that segment alone and never opening the next
   * block.
   */
  readonly mode: 'compose' | 'edit'
  readonly query: string
  readonly segmentStart: number
  /** Where the segment ends: the block's end while composing, the pill's end while editing. */
  readonly segmentEnd: number
  readonly choices: readonly PickerChoice[]
  /** The choice highlighted when the selector opens, or `-1` for none. */
  readonly defaultActive: number
  /** `tab` is null when Tab has nothing to switch to. */
  readonly hints: { readonly tab: string | null; readonly enter: string }
  /** The one-line prompt above the list. */
  readonly prompt: string
  /**
   * Editing a heading: the segment Tab moves the edit to, and what joins
   * this segment to it when the text has not reached it yet (` - ` before a
   * time that is not written). Null everywhere else.
   */
  readonly next: { readonly kind: PickerKind; readonly join: string } | null
}

/** What the selector may draw its names from. */
export type PickerNames = {
  readonly characters: readonly string[]
  readonly locations: readonly string[]
}

const fold = (text: string): string => text.trim().toUpperCase()

const filterChoices = (choices: readonly PickerChoice[], query: string): readonly PickerChoice[] => {
  const needle = fold(query)
  if (needle === '') return choices
  const starts = choices.filter((choice) => fold(choice.text).startsWith(needle))
  const contains = choices.filter((choice) => !fold(choice.text).startsWith(needle) && fold(choice.text).includes(needle))
  return [...starts, ...contains]
}

/** Names as choices, deduplicated on the folded form, the writer's spelling kept. */
const nameChoices = (names: readonly string[], detail: string): readonly PickerChoice[] => {
  const seen = new Set<string>()
  const out: PickerChoice[] = []
  for (const name of names) {
    const key = fold(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push({ text: name, detail, kind: 'known' })
  }
  return out
}

const hasExact = (choices: readonly PickerChoice[], query: string): boolean =>
  choices.some((choice) => fold(choice.text) === fold(query))

const LIST_CAP = 8

const TYPE_WORD: Readonly<Record<ScreenplayNodeType, string>> = {
  scene: 'scene heading',
  action: 'action',
  character: 'character',
  paren: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
  comment: 'comment',
  subtitle: 'subtitle',
}

/**
 * The selector for the caret block, or `null` when there is nothing to offer.
 * `caretAtEnd` is the editor's; a selector only helps while the writer is
 * extending the block, never while editing inside it - unless `reopen`
 * names a segment, which is a click on a pill asking for that segment's
 * selector wherever the caret is.
 */
export const pickerFor = (
  block: { readonly type: ScreenplayNodeType; readonly text: string; readonly caretAtEnd: boolean },
  names: PickerNames,
  reopen?: PickerKind,
): PickerModel | null => {
  if (reopen !== undefined) return editPickerFor(block, names, reopen)
  if (!block.caretAtEnd) return null
  const compose = { mode: 'compose' as const, segmentEnd: block.text.length, next: null }

  if (block.type === 'scene') {
    const reading = readSceneStage(block.text)
    if (reading.stage === 'prefix') {
      const choices = filterChoices(SCENE_PREFIX_CHOICES, reading.query)
      if (choices.length === 0) return null
      return {
        ...compose,
        kind: 'scene-prefix',
        query: reading.query,
        segmentStart: 0,
        choices,
        defaultActive: 0,
        hints: { tab: 'Switch to location', enter: 'Select' },
        prompt: 'Interior or exterior',
      }
    }
    if (reading.stage === 'location') {
      const sets = nameChoices(names.locations, 'Location')
      const query = reading.query.trim()
      const known = filterChoices(sets, query).slice(0, LIST_CAP)
      const exists = query === '' || hasExact(sets, query)
      const choices = exists ? known : [...known, { text: query.toUpperCase(), detail: 'New location', kind: 'new' as const }]
      if (choices.length === 0) return null
      return {
        ...compose,
        kind: 'scene-location',
        query: reading.query,
        segmentStart: reading.segmentStart,
        choices,
        defaultActive: 0,
        hints: { tab: 'Switch to time', enter: exists ? 'Select' : 'Select / create' },
        prompt: sets.length === 0 ? 'Type a location' : 'Search or type a location',
      }
    }
    if (hasExact(TIME_CHOICES, reading.query)) return null
    const choices = filterChoices(TIME_CHOICES, reading.query)
    if (choices.length === 0) return null
    return {
      ...compose,
      kind: 'scene-time',
      query: reading.query,
      segmentStart: reading.segmentStart,
      choices,
      defaultActive: 0,
      hints: { tab: `Switch to ${TYPE_WORD[ENTER_TRANSITION.scene]}`, enter: 'Select' },
      prompt: 'Time of day',
    }
  }

  if (block.type === 'character') {
    const cast = nameChoices(names.characters, 'Character')
    const query = block.text.trim()
    if (query !== '' && hasExact(cast, query)) return null
    const known = filterChoices(cast, query).slice(0, LIST_CAP)
    const choices = query === '' ? known : [...known, { text: query.toUpperCase(), detail: 'New character', kind: 'new' as const }]
    if (choices.length === 0) return null
    return {
      ...compose,
      kind: 'character',
      query: block.text,
      segmentStart: 0,
      choices,
      // An empty cue keeps its keys: Enter on it is still "nothing to say, make it Action".
      defaultActive: query === '' ? -1 : 0,
      hints: {
        tab: `Switch to ${TYPE_WORD[nextInTabCycle('character', false)]}`,
        enter: query !== '' && known.length === 0 ? 'New character' : 'Select',
      },
      prompt: cast.length === 0 ? 'Type a name' : 'Search characters',
    }
  }

  if (block.type === 'transition') {
    if (hasExact(TRANSITION_CHOICES, block.text)) return null
    const choices = filterChoices(TRANSITION_CHOICES, block.text)
    if (choices.length === 0) return null
    return {
      ...compose,
      kind: 'transition',
      query: block.text,
      segmentStart: 0,
      choices,
      defaultActive: 0,
      hints: { tab: `Switch to ${TYPE_WORD[nextInTabCycle('transition', false)]}`, enter: 'Select' },
      prompt: 'Transition',
    }
  }

  return null
}

/**
 * A listed vocabulary, reopened: when the segment already *is* one of the
 * choices the whole list is shown with it highlighted - the writer clicked
 * to change their mind, and the list is the choice - and otherwise the list
 * narrows on what is typed, as it does while composing.
 */
const editList = (
  choices: readonly PickerChoice[],
  query: string,
): { readonly choices: readonly PickerChoice[]; readonly defaultActive: number } => {
  const exact = choices.findIndex((choice) => fold(choice.text) === fold(query))
  if (exact >= 0) return { choices, defaultActive: exact }
  return { choices: filterChoices(choices, query), defaultActive: 0 }
}

/** The pill's own type, so a reopened selector on a block retyped underneath it closes. */
const PILL_TYPE: Readonly<Record<PickerKind, ScreenplayNodeType>> = {
  'scene-prefix': 'scene',
  'scene-location': 'scene',
  'scene-time': 'scene',
  character: 'character',
  transition: 'transition',
}

const editPickerFor = (
  block: { readonly type: ScreenplayNodeType; readonly text: string },
  names: PickerNames,
  kind: PickerKind,
): PickerModel | null => {
  if (PILL_TYPE[kind] !== block.type) return null
  const { text } = block

  if (kind === 'scene-prefix' || kind === 'scene-location' || kind === 'scene-time') {
    const segments = readSceneSegments(text)
    const segment = kind === 'scene-prefix' ? segments.prefix : kind === 'scene-location' ? segments.location : segments.time
    if (segment === null) return null
    const query = text.slice(segment.start, segment.end)
    const base = { mode: 'edit' as const, kind, query, segmentStart: segment.start, segmentEnd: segment.end }
    if (kind === 'scene-prefix') {
      const list = editList(SCENE_PREFIX_CHOICES, query)
      if (list.choices.length === 0) return null
      return {
        ...base,
        ...list,
        hints: { tab: 'Switch to location', enter: 'Select' },
        prompt: 'Interior or exterior',
        next: { kind: 'scene-location', join: '' },
      }
    }
    if (kind === 'scene-location') {
      const sets = nameChoices(names.locations, 'Location')
      const own = query.trim()
      const list = editList(sets, own)
      const exists = own === '' || hasExact(sets, own)
      const known = list.choices.slice(0, LIST_CAP)
      const choices = exists ? known : [...known, { text: own.toUpperCase(), detail: 'New location', kind: 'new' as const }]
      if (choices.length === 0) return null
      return {
        ...base,
        choices,
        defaultActive: list.defaultActive,
        hints: { tab: 'Switch to time', enter: exists ? 'Select' : 'Select / create' },
        prompt: sets.length === 0 ? 'Type a location' : 'Search or type a location',
        next: { kind: 'scene-time', join: segments.time === null ? ' - ' : '' },
      }
    }
    const list = editList(TIME_CHOICES, query)
    if (list.choices.length === 0) return null
    return { ...base, ...list, hints: { tab: null, enter: 'Select' }, prompt: 'Time of day', next: null }
  }

  if (kind === 'character') {
    const start = text.length - text.trimStart().length
    const query = bareCue(text)
    const cast = nameChoices(names.characters, 'Character')
    const list = editList(cast, query)
    const exists = query === '' || hasExact(cast, query)
    const known = list.choices.slice(0, LIST_CAP)
    const choices = exists ? known : [...known, { text: query.toUpperCase(), detail: 'New character', kind: 'new' as const }]
    if (choices.length === 0) return null
    return {
      mode: 'edit',
      kind,
      query,
      segmentStart: start,
      segmentEnd: start + query.length,
      choices,
      defaultActive: list.defaultActive,
      hints: { tab: null, enter: exists ? 'Select' : 'New character' },
      prompt: cast.length === 0 ? 'Type a name' : 'Search characters',
      next: null,
    }
  }

  const start = text.length - text.trimStart().length
  const query = text.trim()
  const list = editList(TRANSITION_CHOICES, query)
  if (list.choices.length === 0) return null
  return {
    mode: 'edit',
    kind,
    query,
    segmentStart: start,
    segmentEnd: start + query.length,
    ...list,
    hints: { tab: null, enter: 'Select' },
    prompt: 'Transition',
    next: null,
  }
}

// ---------------------------------------------------------------------------
// What a choice does
// ---------------------------------------------------------------------------

export type CommitPlan = {
  /** Replace the block's text from `segmentStart` to `segmentEnd` with this. */
  readonly text: string
  /**
   * After the replacement: stay in the block; open the next block Enter
   * would; or move the edit to the model's `next` segment.
   */
  readonly then: 'stay' | 'next-block' | 'next-segment'
}

export const planCommit = (model: PickerModel, choice: PickerChoice): CommitPlan => {
  if (model.mode === 'edit') {
    // The segment alone is replaced: no trailing ` - `, no next block.
    const upper = model.kind === 'scene-location' || model.kind === 'character'
    return { text: upper ? choice.text.toUpperCase() : choice.text, then: 'stay' }
  }
  switch (model.kind) {
    case 'scene-prefix':
      return { text: `${choice.text} `, then: 'stay' }
    case 'scene-location':
      return { text: `${choice.text.toUpperCase()} - `, then: 'stay' }
    case 'scene-time':
      return { text: choice.text, then: 'next-block' }
    case 'character':
      return { text: choice.text.toUpperCase(), then: 'next-block' }
    case 'transition':
      return { text: choice.text, then: 'next-block' }
  }
}

/**
 * Tab in a scene stage advances with whatever is there: the highlighted
 * choice, or the writer's own text when nothing is highlighted. Outside the
 * scene stages Tab commits only a highlighted choice, and otherwise stays the
 * type cycle it always was. Editing, Tab commits and moves the edit to the
 * next segment of the heading when there is one.
 */
export const planTab = (model: PickerModel, active: PickerChoice | undefined): CommitPlan | null => {
  const isScene = model.kind === 'scene-prefix' || model.kind === 'scene-location' || model.kind === 'scene-time'
  const own = model.query.trim()
  const choice = active ?? (isScene && own !== '' ? { text: own, detail: '', kind: 'new' as const } : undefined)
  if (choice === undefined) return null
  const plan = planCommit(model, choice)
  if (model.mode === 'edit' && model.next !== null) return { text: `${plan.text}${model.next.join}`, then: 'next-segment' }
  return plan
}

// ---------------------------------------------------------------------------
// The ghost: what an unfinished block promises
// ---------------------------------------------------------------------------

export type Ghost = {
  /** The active segment, drawn in the accent. */
  readonly lead: string
  /** The rest of the promise, dimmed. */
  readonly rest: string
  /**
   * Where it sits: `null` flows after the block's text; a number places it
   * at the block's inset plus that many character cells, over the text.
   */
  readonly insetCh: number | null
}

/** A parenthetical the writer has opened and not yet filled. */
export const EMPTY_PAREN = '()'

export const ghostFor = (type: ScreenplayNodeType, text: string): Ghost | null => {
  switch (type) {
    case 'scene': {
      const reading = readSceneStage(text)
      if (reading.stage === 'prefix') {
        return text === '' ? { lead: 'INT./EXT.', rest: ' LOCATION - DAY/NIGHT', insetCh: 0 } : null
      }
      if (reading.stage === 'location') {
        return reading.query === '' ? { lead: 'LOCATION', rest: ' - DAY/NIGHT', insetCh: null } : null
      }
      return reading.query === '' ? { lead: 'DAY/NIGHT', rest: '', insetCh: null } : null
    }
    case 'character':
      return text === '' ? { lead: 'CHARACTER', rest: '', insetCh: 0 } : null
    case 'transition':
      return text === '' ? { lead: 'CUT TO:', rest: '', insetCh: 0 } : null
    case 'paren':
      return text === EMPTY_PAREN ? { lead: '', rest: 'emotion or action cue… e.g. softly', insetCh: 1 } : null
    case 'action':
    case 'dialogue':
    case 'comment':
    case 'subtitle':
      return null
  }
}
