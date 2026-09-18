import { describe, expect, it } from 'vitest'

import { derive } from './derive'
import { NO_ENTITIES } from './entities'
import { nodeId } from './ids'
import { ageOnThePage, findIntroductions, namedInText } from './introductions'
import { characterAuthored, characterRecord, idAt, nodesOf } from './testing/derive-corpus'

/**
 * Where the action introduces a character. Evidence the drawer quotes,
 * never a binding: nothing in here touches who a cue resolves to.
 */

const headings = (lines: readonly string[]) =>
  new Set(lines.flatMap((line, index) => (line.startsWith('scene:') ? [idAt(index)] : [])))

describe('namedInText', () => {
  it('matches whole tokens, in order, not inside a longer word', () => {
    expect(namedInText('MEERA PAWAR (38), rain-soaked.', ['MEERA'])?.index).toBe(0)
    expect(namedInText("She takes MEERA'S bag.", ['MEERA'])?.index).toBe(10)
    expect(namedInText('The MEERAS arrive.', ['MEERA'])).toBeNull()
    expect(namedInText('MEERA and PAWAR argue.', ['MEERA PAWAR'])).toBeNull()
  })

  it('is case-exact: a caps intro matches, a lower-case name in prose does not', () => {
    expect(namedInText('meera counts the buckets.', ['MEERA'])).toBeNull()
    expect(namedInText('मीरा गिनती करती है।', ['मीरा'])?.index).toBe(0)
  })

  it('the earliest match wins, the longest key on a tie', () => {
    const match = namedInText('MEERA PAWAR (38) glares at KADAM.', ['KADAM', 'MEERA', 'MEERA PAWAR'])
    expect(match).toEqual({ key: 'MEERA PAWAR', index: 0, end: 11 })
  })

  it('accepts the false positive a common word bound as a name brings', () => {
    // `DAY` bound as a name matches an action line that uses the word. The
    // cost is a wrong quote the writer can see, never a wrong binding.
    expect(namedInText('The DAY is long.', ['DAY'])?.index).toBe(4)
  })
})

describe('ageOnThePage', () => {
  it('reads the bracketed number straight after the name, and nothing else', () => {
    expect(ageOnThePage('MEERA PAWAR (38), rain-soaked.', ['MEERA PAWAR', 'MEERA'])).toBe(38)
    expect(ageOnThePage('MEERA (late 30s) counts.', ['MEERA'])).toBeNull()
    expect(ageOnThePage('MEERA, (38).', ['MEERA'])).toBeNull()
    expect(ageOnThePage('Nobody here.', ['MEERA'])).toBeNull()
  })
})

describe('findIntroductions', () => {
  const SCRIPT = [
    'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
    'cue:MEERA',
    'dialogue:Two buckets.',
    'action:MEERA PAWAR (38), rain-soaked, counts the buckets again.',
    'scene:EXT. STANDPIPE - DAY',
    'action:MEERA waits. KADAM arrives.',
    'comment:MEERA should be angrier here.',
  ] as const

  it('finds the first action line naming the record, with its scene, and counts every one', () => {
    const found = findIntroductions(nodesOf(SCRIPT), [{ id: 'm', keys: ['MEERA'] }, { id: 'k', keys: ['KADAM'] }], headings(SCRIPT))
    expect(found.get('m')).toEqual({ introducedAt: { nodeId: idAt(3), scene: idAt(0) }, namedIn: 2 })
    expect(found.get('k')).toEqual({ introducedAt: { nodeId: idAt(5), scene: idAt(4) }, namedIn: 1 })
  })

  it('never reads a cue, a comment or a heading', () => {
    const lines = ['scene:INT. MEERA HOUSE - DAY', 'cue:MEERA', 'dialogue:Hello.', 'comment:MEERA note.'] as const
    expect(findIntroductions(nodesOf(lines), [{ id: 'm', keys: ['MEERA'] }], headings(lines)).get('m')).toBeUndefined()
  })

  it('a line before the first accepted heading has no scene; a rejected heading ends no scene', () => {
    const lines = ['action:MEERA arrives.', 'scene:INTERCUT - PHONE', 'action:KADAM waits.'] as const
    const found = findIntroductions(nodesOf(lines), [{ id: 'm', keys: ['MEERA'] }, { id: 'k', keys: ['KADAM'] }], new Set())
    expect(found.get('m')?.introducedAt).toEqual({ nodeId: idAt(0), scene: null })
    expect(found.get('k')?.introducedAt).toEqual({ nodeId: idAt(2), scene: null })
  })

  it('two records claiming one line are each introduced by it', () => {
    const lines = ['scene:INT. A - DAY', 'action:MEERA and KADAM enter.'] as const
    const found = findIntroductions(nodesOf(lines), [{ id: 'm', keys: ['MEERA'] }, { id: 'k', keys: ['KADAM'] }], headings(lines))
    expect(found.get('m')?.introducedAt?.nodeId).toBe(idAt(1))
    expect(found.get('k')?.introducedAt?.nodeId).toBe(idAt(1))
  })

  it('a Fountain-typed caps intro is a cue, so it lands in the queue and never here', () => {
    // `MEERA PAWAR (38)` on its own line parses as a cue. Derivation
    // proposes the record for it (a leading run of MEERA) rather than
    // reading it as an introduction.
    const lines = ['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:Hi.', 'cue:MEERA PAWAR', 'dialogue:(38)'] as const
    const pass = derive(nodesOf(lines), NO_ENTITIES, { freshIds: ['x1', 'x2'] })
    if (!pass.ok) throw new Error('derive failed')
    const meera = pass.value.entities.characters.find((record) => record.authored.name === 'MEERA')
    expect(meera?.introducedAt).toBeNull()
    expect(pass.value.entities.queue.some((row) => row.subject.kind === 'cue' && row.subject.key === 'MEERA PAWAR' && row.proposal?.confidence === 'likely')).toBe(true)
  })
})

describe('through derive', () => {
  it('a record is introduced by the action naming its bound spelling, and namedIn counts the action lines', () => {
    const lines = [
      'scene:INT. A - DAY',
      'action:MEERA PAWAR (38) counts.',
      'cue:MEERA',
      'dialogue:Two.',
      'action:MEERA turns.',
    ] as const
    const pass = derive(nodesOf(lines), { ...NO_ENTITIES, characters: [characterRecord('m', characterAuthored({ name: 'Meera Pawar', boundCues: ['MEERA PAWAR', 'MEERA'] }))] }, { freshIds: ['x1'] })
    if (!pass.ok) throw new Error('derive failed')
    const meera = pass.value.entities.characters[0]
    expect(meera?.introducedAt).toEqual({ nodeId: nodeId('n2'), scene: nodeId('n1') })
    expect(meera?.namedIn).toBe(2)
  })
})
