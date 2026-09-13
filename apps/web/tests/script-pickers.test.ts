// @vitest-environment node
import { TIMES_OF_DAY, readSlugline } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { ENTER_TRANSITION } from '../lib/script/keyboard'
import {
  SCENE_PREFIX_CHOICES,
  TIME_CHOICES,
  TRANSITION_CHOICES,
  ghostFor,
  pickerFor,
  pillsFor,
  planCommit,
  planTab,
  readSceneSegments,
  readSceneStage,
} from '../lib/script/pickers'

/**
 * The selectors are a way of typing, not a second model: whatever they
 * compose must be what the parser reads. So the properties here are about
 * the text they produce - every composed heading is a heading to
 * `readSlugline`, every offered time is one it takes off the set - and about
 * the one rule the keyboard relies on: a selector with nothing highlighted
 * passes Enter through.
 */

const NO_NAMES = { characters: [], locations: [] }

/** A bare composing model, for the plans that depend on `kind` alone. */
const COMPOSE = {
  mode: 'compose',
  query: '',
  segmentStart: 0,
  segmentEnd: 0,
  choices: [],
  defaultActive: 0,
  hints: { tab: '', enter: '' },
  prompt: '',
  next: null,
} as const

describe('the scene heading stages', () => {
  it('reads the three stages from the text so far', () => {
    expect(readSceneStage('')).toStrictEqual({ stage: 'prefix', segmentStart: 0, query: '' })
    expect(readSceneStage('IN')).toStrictEqual({ stage: 'prefix', segmentStart: 0, query: 'IN' })
    expect(readSceneStage('INT.')).toStrictEqual({ stage: 'prefix', segmentStart: 0, query: 'INT.' })
    expect(readSceneStage('INT. ')).toStrictEqual({ stage: 'location', segmentStart: 5, query: '' })
    expect(readSceneStage('INT. ROOF')).toStrictEqual({ stage: 'location', segmentStart: 5, query: 'ROOF' })
    expect(readSceneStage('INT. ROOFTOP COURT - ')).toStrictEqual({ stage: 'time', segmentStart: 21, query: '' })
    expect(readSceneStage('INT. ROOFTOP COURT - NI')).toStrictEqual({ stage: 'time', segmentStart: 21, query: 'NI' })
  })

  it('takes the last separator as the time boundary, so a sub-set keeps its dash', () => {
    const reading = readSceneStage('INT. THE MILL - OFFICE - DAY')
    expect(reading.stage).toBe('time')
    expect(reading.query).toBe('DAY')
  })

  it('composes a heading the parser reads, through every prefix and every time', () => {
    for (const prefix of SCENE_PREFIX_CHOICES) {
      for (const time of TIME_CHOICES) {
        const afterPrefix = planCommit({ ...COMPOSE, kind: 'scene-prefix' }, prefix).text
        const afterLocation = planCommit({ ...COMPOSE, kind: 'scene-location' }, { text: 'Rooftop Court', detail: '', kind: 'known' }).text
        const heading = `${afterPrefix}${afterLocation}${time.text}`
        const read = readSlugline(heading)
        expect(read.ok, heading).toBe(true)
        if (!read.ok) continue
        expect(read.value.set).toBe('ROOFTOP COURT')
        expect(read.value.timeOfDay).toBe(time.text)
      }
    }
  })

  it('offers exactly the times the slugline reader knows', () => {
    expect(new Set(TIME_CHOICES.map((choice) => choice.text))).toStrictEqual(new Set(TIMES_OF_DAY.map((entry) => entry.time)))
  })

  it('is gone once the time is one it knows, and back for a new stage', () => {
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP - NIGHT', caretAtEnd: true }, NO_NAMES)).toBeNull()
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP - LATER THAT WEEK', caretAtEnd: true }, NO_NAMES)).toBeNull()
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP - ', caretAtEnd: true }, NO_NAMES)?.kind).toBe('scene-time')
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP - NIGHT', caretAtEnd: false }, NO_NAMES)).toBeNull()
  })

  it('lists known locations and offers the typed one as new', () => {
    const names = { characters: [], locations: ['Rooftop Court', 'Block Stairwell'] }
    const empty = pickerFor({ type: 'scene', text: 'INT. ', caretAtEnd: true }, names)
    expect(empty?.choices.map((choice) => choice.text)).toStrictEqual(['Rooftop Court', 'Block Stairwell'])
    const typed = pickerFor({ type: 'scene', text: 'INT. roof', caretAtEnd: true }, names)
    expect(typed?.choices.map((choice) => [choice.text, choice.kind])).toStrictEqual([
      ['Rooftop Court', 'known'],
      ['ROOF', 'new'],
    ])
    const exact = pickerFor({ type: 'scene', text: 'INT. rooftop court', caretAtEnd: true }, names)
    expect(exact?.choices.map((choice) => choice.kind)).toStrictEqual(['known'])
  })

  it('Tab advances a stage with the writer’s own text when nothing is highlighted', () => {
    const model = pickerFor({ type: 'scene', text: 'INT. the well', caretAtEnd: true }, NO_NAMES)
    expect(model).not.toBeNull()
    if (model === null) return
    expect(planTab(model, undefined)).toStrictEqual({ text: 'THE WELL - ', then: 'stay' })
    const time = pickerFor({ type: 'scene', text: 'INT. THE WELL - D', caretAtEnd: true }, NO_NAMES)
    expect(time).not.toBeNull()
    if (time === null) return
    expect(planTab(time, time.choices[0])).toStrictEqual({ text: 'DAY', then: 'next-block' })
    expect(ENTER_TRANSITION.scene).toBe('action')
  })
})

describe('the character selector', () => {
  const names = { characters: ['Tash', 'Maya'], locations: [] }

  it('opens on an empty cue with nothing highlighted, so Enter still makes it Action', () => {
    const model = pickerFor({ type: 'character', text: '', caretAtEnd: true }, names)
    expect(model?.defaultActive).toBe(-1)
    expect(model?.choices.map((choice) => choice.text)).toStrictEqual(['Tash', 'Maya'])
    expect(pickerFor({ type: 'character', text: '', caretAtEnd: true }, NO_NAMES)).toBeNull()
  })

  it('highlights the first match once typing starts and offers a new name', () => {
    const model = pickerFor({ type: 'character', text: 'ma', caretAtEnd: true }, names)
    expect(model?.defaultActive).toBe(0)
    expect(model?.choices.map((choice) => [choice.text, choice.kind])).toStrictEqual([
      ['Maya', 'known'],
      ['MA', 'new'],
    ])
    const fresh = pickerFor({ type: 'character', text: 'Ravi', caretAtEnd: true }, names)
    expect(fresh?.choices).toStrictEqual([{ text: 'RAVI', detail: 'New character', kind: 'new' }])
    expect(fresh?.hints.enter).toBe('New character')
  })

  it('is gone once the cue is a known name, and a pick uppercases and opens the dialogue', () => {
    expect(pickerFor({ type: 'character', text: 'tash', caretAtEnd: true }, names)).toBeNull()
    const model = pickerFor({ type: 'character', text: 'ma', caretAtEnd: true }, names)
    expect(model).not.toBeNull()
    if (model === null) return
    expect(planCommit(model, model.choices[0] ?? { text: '', detail: '', kind: 'new' })).toStrictEqual({ text: 'MAYA', then: 'next-block' })
    expect(ENTER_TRANSITION.character).toBe('dialogue')
    expect(planTab(model, undefined)).toBeNull()
  })

  it('deduplicates names on their folded form, keeping the first spelling', () => {
    const model = pickerFor({ type: 'character', text: '', caretAtEnd: true }, { characters: ['MEERA', 'Meera', 'meera'], locations: [] })
    expect(model?.choices.map((choice) => choice.text)).toStrictEqual(['MEERA'])
  })
})

describe('the transition selector', () => {
  it('opens on an empty transition with the first cut highlighted and narrows as typed', () => {
    const model = pickerFor({ type: 'transition', text: '', caretAtEnd: true }, NO_NAMES)
    expect(model?.defaultActive).toBe(0)
    expect(model?.choices).toStrictEqual(TRANSITION_CHOICES)
    const typed = pickerFor({ type: 'transition', text: 'fade', caretAtEnd: true }, NO_NAMES)
    expect(typed?.choices.map((choice) => choice.text)).toStrictEqual(['FADE TO:', 'FADE IN:', 'FADE OUT.', 'FADE TO BLACK.'])
    expect(pickerFor({ type: 'transition', text: 'CUT TO:', caretAtEnd: true }, NO_NAMES)).toBeNull()
    expect(pickerFor({ type: 'transition', text: 'ZZZ', caretAtEnd: true }, NO_NAMES)).toBeNull()
  })

  it('a pick opens the heading Enter would', () => {
    const model = pickerFor({ type: 'transition', text: '', caretAtEnd: true }, NO_NAMES)
    expect(model).not.toBeNull()
    if (model === null) return
    expect(planCommit(model, model.choices[0] ?? { text: '', detail: '', kind: 'new' })).toStrictEqual({ text: 'CUT TO:', then: 'next-block' })
    expect(ENTER_TRANSITION.transition).toBe('scene')
  })
})

describe('the segments and the pills', () => {
  it('reads every segment of a heading at once, trimmed, and null for what is not written', () => {
    expect(readSceneSegments('')).toStrictEqual({ prefix: null, location: null, time: null })
    expect(readSceneSegments('INT.')).toStrictEqual({ prefix: null, location: null, time: null })
    expect(readSceneSegments('INT. ')).toStrictEqual({ prefix: { start: 0, end: 4 }, location: { start: 5, end: 5 }, time: null })
    expect(readSceneSegments('INT. ROOFTOP COURT')).toStrictEqual({
      prefix: { start: 0, end: 4 },
      location: { start: 5, end: 18 },
      time: null,
    })
    expect(readSceneSegments('INT. ROOFTOP COURT - NIGHT')).toStrictEqual({
      prefix: { start: 0, end: 4 },
      location: { start: 5, end: 18 },
      time: { start: 21, end: 26 },
    })
    expect(readSceneSegments('INT./EXT. THE MILL - OFFICE - DAY')).toStrictEqual({
      prefix: { start: 0, end: 9 },
      location: { start: 10, end: 27 },
      time: { start: 30, end: 33 },
    })
  })

  it('names the pills of a heading, a cue and a cut, and nothing on the other five', () => {
    expect(pillsFor('scene', 'INT. ROOFTOP COURT - NIGHT').map((pill) => [pill.kind, pill.start, pill.end])).toStrictEqual([
      ['scene-prefix', 0, 4],
      ['scene-location', 5, 18],
      ['scene-time', 21, 26],
    ])
    expect(pillsFor('scene', 'INT. ').map((pill) => pill.kind)).toStrictEqual(['scene-prefix'])
    expect(pillsFor('character', 'MEERA (V.O.)')).toStrictEqual([{ kind: 'character', start: 0, end: 5 }])
    expect(pillsFor('character', '')).toStrictEqual([])
    expect(pillsFor('transition', 'CUT TO:')).toStrictEqual([{ kind: 'transition', start: 0, end: 7 }])
    for (const type of ['action', 'paren', 'dialogue', 'comment', 'subtitle'] as const) {
      expect(pillsFor(type, 'INT. ROOFTOP COURT - NIGHT')).toStrictEqual([])
    }
  })
})

describe('a selector reopened from a pill', () => {
  const names = { characters: ['Tash', 'Maya'], locations: ['Rooftop Court', 'Block Stairwell'] }
  const heading = { type: 'scene' as const, text: 'INT. ROOFTOP COURT - NIGHT', caretAtEnd: false }
  const none = { text: '', detail: '', kind: 'new' as const }

  it('opens over the clicked segment wherever the caret is, the current value lit', () => {
    const time = pickerFor(heading, names, 'scene-time')
    expect(time?.mode).toBe('edit')
    expect([time?.segmentStart, time?.segmentEnd]).toStrictEqual([21, 26])
    expect(time?.choices).toStrictEqual(TIME_CHOICES)
    expect(time?.choices[time.defaultActive]?.text).toBe('NIGHT')
    expect(time?.hints.tab).toBeNull()
    const location = pickerFor(heading, names, 'scene-location')
    expect(location?.choices.map((choice) => choice.text)).toStrictEqual(['Rooftop Court', 'Block Stairwell'])
    expect(location?.defaultActive).toBe(0)
    const cut = pickerFor({ type: 'transition', text: 'FADE TO:', caretAtEnd: true }, NO_NAMES, 'transition')
    expect(cut?.choices).toStrictEqual(TRANSITION_CHOICES)
    expect(cut?.choices[cut.defaultActive]?.text).toBe('FADE TO:')
  })

  it('narrows as the segment is retyped, and offers the writer’s own text as new', () => {
    const model = pickerFor({ ...heading, text: 'INT. BLO - NIGHT' }, names, 'scene-location')
    expect(model?.choices.map((choice) => [choice.text, choice.kind])).toStrictEqual([
      ['Block Stairwell', 'known'],
      ['BLO', 'new'],
    ])
    const cue = pickerFor({ type: 'character', text: 'Ma (V.O.)', caretAtEnd: false }, names, 'character')
    expect(cue?.query).toBe('Ma')
    expect([cue?.segmentStart, cue?.segmentEnd]).toStrictEqual([0, 2])
    expect(cue?.choices.map((choice) => choice.text)).toStrictEqual(['Maya', 'MA'])
  })

  it('a pick replaces the segment alone and stays; Tab moves the edit to the next segment', () => {
    const location = pickerFor(heading, names, 'scene-location')
    expect(location).not.toBeNull()
    if (location === null) return
    expect(planCommit(location, location.choices[1] ?? none)).toStrictEqual({ text: 'BLOCK STAIRWELL', then: 'stay' })
    expect(planTab(location, location.choices[1])).toStrictEqual({ text: 'BLOCK STAIRWELL', then: 'next-segment' })
    expect(location.next).toStrictEqual({ kind: 'scene-time', join: '' })
    const time = pickerFor(heading, names, 'scene-time')
    expect(time).not.toBeNull()
    if (time === null) return
    expect(planCommit(time, time.choices[0] ?? none)).toStrictEqual({ text: 'DAY', then: 'stay' })
    expect(planTab(time, time.choices[0])).toStrictEqual({ text: 'DAY', then: 'stay' })
  })

  it('Tab from a location on a heading with no time writes the separator on its way', () => {
    const model = pickerFor({ type: 'scene', text: 'INT. ROOFTOP COURT', caretAtEnd: true }, names, 'scene-location')
    expect(model?.next).toStrictEqual({ kind: 'scene-time', join: ' - ' })
    expect(model === null ? null : planTab(model, model.choices[0])).toStrictEqual({ text: 'ROOFTOP COURT - ', then: 'next-segment' })
  })

  it('closes on a segment the text has not reached, and on a block of another type', () => {
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP', caretAtEnd: true }, names, 'scene-time')).toBeNull()
    expect(pickerFor({ type: 'action', text: 'INT. ROOFTOP - DAY', caretAtEnd: true }, names, 'scene-time')).toBeNull()
    expect(pickerFor({ type: 'scene', text: 'INT. ROOFTOP - DAY', caretAtEnd: true }, names, 'character')).toBeNull()
  })
})

describe('the other five types', () => {
  it('open no selector', () => {
    for (const type of ['action', 'paren', 'dialogue', 'comment', 'subtitle'] as const) {
      expect(pickerFor({ type, text: '', caretAtEnd: true }, NO_NAMES)).toBeNull()
    }
  })
})

describe('the ghost', () => {
  it('promises the heading segment by segment, then nothing once each is typed', () => {
    expect(ghostFor('scene', '')).toStrictEqual({ lead: 'INT./EXT.', rest: ' LOCATION - DAY/NIGHT', insetCh: 0 })
    expect(ghostFor('scene', 'IN')).toBeNull()
    expect(ghostFor('scene', 'INT. ')).toStrictEqual({ lead: 'LOCATION', rest: ' - DAY/NIGHT', insetCh: null })
    expect(ghostFor('scene', 'INT. ROOF')).toBeNull()
    expect(ghostFor('scene', 'INT. ROOFTOP - ')).toStrictEqual({ lead: 'DAY/NIGHT', rest: '', insetCh: null })
    expect(ghostFor('scene', 'INT. ROOFTOP - DAY')).toBeNull()
  })

  it('names the empty cue and cut, and sits inside an opened parenthetical', () => {
    expect(ghostFor('character', '')?.lead).toBe('CHARACTER')
    expect(ghostFor('transition', '')?.lead).toBe('CUT TO:')
    expect(ghostFor('paren', '()')?.insetCh).toBe(1)
    expect(ghostFor('paren', '(softly)')).toBeNull()
    expect(ghostFor('action', '')).toBeNull()
    expect(ghostFor('dialogue', '')).toBeNull()
  })
})
