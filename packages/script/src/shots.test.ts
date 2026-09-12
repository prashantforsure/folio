import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { canonicalKey } from './alias'
import { characterId, locationId, nodeId } from './ids'
import { mention, text } from './inline'
import type { InlineContent } from './inline'
import type { ScreenplayNode } from './node'
import { typed } from './provenance'
import { readSlugline } from './slugline'
import { boundCueMap, excerpt, proposeShots, shotLabel } from './shots'
import type { ShotSpec } from './shots'

/**
 * The proposer: a first shot list read off a scene, deterministic, and
 * every person in it a mention to a record the alias table already binds.
 */

let counter = 0
const node = (type: ScreenplayNode['type'], value: string): ScreenplayNode => {
  const id = nodeId(`n${String((counter += 1))}`)
  if (type === 'character') {
    return { type, id, provenance: typed(), content: [text(value)], modifiers: [] }
  }
  return { type, id, provenance: typed(), content: [text(value)] } as ScreenplayNode
}

const reading = (heading: string) => {
  const result = readSlugline(heading)
  if (!result.ok) throw new Error(`test heading did not read: ${heading}`)
  return result.value
}

const MEERA = characterId('c-meera')
const RAVI = characterId('c-ravi')
const FLAT = locationId('l-flat')

const bound = boundCueMap([
  { cue: 'MEERA', characterId: MEERA },
  { cue: 'RAVI', characterId: RAVI },
])

const plain = (content: InlineContent): string =>
  content.map((run) => (run.kind === 'text' ? run.text : `@${run.target.id}`)).join('')

const scene = (): readonly ScreenplayNode[] => [
  node('scene', "INT. MEERA'S FLAT - NIGHT"),
  node('action', 'A kettle on the hob. MEERA, 30s, watches it not boil.'),
  node('character', 'MEERA'),
  node('dialogue', 'Come on. Come on.'),
  node('character', 'RAVI (O.S.)'),
  node('dialogue', "It's business, not charity."),
  node('character', 'MEERA'),
  node('paren', '(not turning)'),
  node('dialogue', 'Then send an invoice.'),
  node('action', 'The kettle clicks off. She does not move.'),
]

describe('proposeShots', () => {
  it('opens on an establishing wide that mentions the location and quotes the first action', () => {
    const shots = proposeShots({
      reading: reading("INT. MEERA'S FLAT - NIGHT"),
      nodes: scene(),
      boundCues: bound,
      locationId: FLAT,
    })
    const first = shots[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(first.size).toBe('ws')
    expect(first.lensMm).toBe(24)
    expect(first.description).toContainEqual(mention({ entity: 'location', id: FLAT }))
    expect(plain(first.description)).toBe(
      'Establishing wide of @l-flat · NIGHT. A kettle on the hob. MEERA, 30s, watches it not boil.',
    )
  })

  it('names the set as text when the heading resolved to no location', () => {
    const [first] = proposeShots({
      reading: reading("INT. MEERA'S FLAT - NIGHT"),
      nodes: scene(),
      boundCues: bound,
      locationId: null,
    })
    expect(first?.description.every((run) => run.kind === 'text' || run.target.entity === 'character')).toBe(true)
    expect(plain(first?.description ?? [])).toContain("Establishing wide of MEERA'S FLAT · NIGHT.")
  })

  it('gives two speakers a two-shot and a medium close-up each, in first-appearance order, then a closing wide', () => {
    const shots = proposeShots({ reading: reading("INT. MEERA'S FLAT - NIGHT"), nodes: scene(), boundCues: bound, locationId: FLAT })
    expect(shots.map((shot) => shot.size)).toEqual(['ws', 'ms', 'mcu', 'mcu', 'ws'])
    const [, two, meera, ravi, closing] = shots
    expect(plain(two?.description ?? [])).toBe(`Two-shot: @${MEERA} and @${RAVI}.`)
    expect(plain(meera?.description ?? [])).toBe(`Medium close-up on @${MEERA} — “Come on. Come on.”`)
    // `(O.S.)` is a delivery modifier: parsed off before lookup, never a second person.
    expect(plain(ravi?.description ?? [])).toBe(`Medium close-up on @${RAVI} — “It's business, not charity.”`)
    expect(plain(closing?.description ?? [])).toBe('Closing wide. The kettle clicks off. She does not move.')
  })

  it('never invents a person: an unbound cue is text, not a mention', () => {
    const nodes = [node('scene', 'EXT. STAIRWELL - DAY'), node('character', 'STRANGER'), node('dialogue', 'Who are you?')]
    const shots = proposeShots({ reading: reading('EXT. STAIRWELL - DAY'), nodes, boundCues: bound, locationId: null })
    const mcu = shots.find((shot) => shot.size === 'mcu')
    expect(mcu).toBeDefined()
    expect(mcu?.description.some((run) => run.kind === 'mention')).toBe(false)
    expect(plain(mcu?.description ?? [])).toBe('Medium close-up on STRANGER — “Who are you?”')
  })

  it('proposes one establishing shot for a scene with nothing under its heading', () => {
    const shots = proposeShots({ reading: reading('INT. OFFICE - DAY'), nodes: [node('scene', 'INT. OFFICE - DAY')], boundCues: bound, locationId: null })
    expect(shots).toHaveLength(1)
    expect(plain(shots[0]?.description ?? [])).toBe('Establishing wide of OFFICE · DAY.')
  })

  it('caps the medium close-ups at four speakers and counts the rest on the two-shot', () => {
    const nodes: ScreenplayNode[] = [node('scene', 'INT. HALL - DAY')]
    const cues = ['A', 'B', 'C', 'D', 'E', 'F']
    for (const cue of cues) {
      nodes.push(node('character', cue), node('dialogue', `${cue} speaks.`))
    }
    const shots = proposeShots({ reading: reading('INT. HALL - DAY'), nodes, boundCues: new Map(), locationId: null })
    expect(shots.filter((shot) => shot.size === 'mcu')).toHaveLength(4)
    expect(plain(shots[1]?.description ?? [])).toBe('Two-shot: A and B, 4 more in the scene.')
  })

  it('skips comments and treats a demoted heading as action', () => {
    const nodes = [
      node('scene', 'INT. OFFICE - DAY'),
      node('comment', 'note to self'),
      node('scene', 'INTERCUT - PHONE CALL'),
    ]
    const shots = proposeShots({ reading: reading('INT. OFFICE - DAY'), nodes, boundCues: bound, locationId: null })
    expect(shots).toHaveLength(1)
    expect(plain(shots[0]?.description ?? [])).toBe('Establishing wide of OFFICE · DAY. INTERCUT - PHONE CALL')
  })

  it('is deterministic: the same scene proposes the same list', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('action', 'character', 'dialogue', 'paren'), fc.string({ maxLength: 40 })), { maxLength: 30 }),
        (body) => {
          const build = (): readonly ScreenplayNode[] => [
            node('scene', 'INT. ROOM - DAY'),
            ...body.map(([type, value]) => node(type as ScreenplayNode['type'], value)),
          ]
          const input = { reading: reading('INT. ROOM - DAY'), boundCues: bound, locationId: null }
          const a = proposeShots({ ...input, nodes: build() })
          const b = proposeShots({ ...input, nodes: build() })
          expect(a).toEqual(b)
          expect(a.length).toBeGreaterThanOrEqual(1)
          expect(a.length).toBeLessThanOrEqual(1 + 1 + 4 + 1)
        },
      ),
    )
  })

  it('every proposed shot has a lens and no duration', () => {
    const shots = proposeShots({ reading: reading("INT. MEERA'S FLAT - NIGHT"), nodes: scene(), boundCues: bound, locationId: FLAT })
    for (const shot of shots satisfies readonly ShotSpec[]) {
      expect(shot.lensMm).not.toBeNull()
      expect(shot.durationSeconds).toBeNull()
      expect(shot.movement).toBe('static')
      expect(shot.angle).toBe('eye_level')
    }
  })
})

describe('boundCueMap', () => {
  it('keys by the canonical cue and keeps the first binding for a key', () => {
    const map = boundCueMap([
      { cue: 'Meera ', characterId: MEERA },
      { cue: 'MEERA', characterId: RAVI },
      { cue: '', characterId: RAVI },
    ])
    expect(map.get(canonicalKey('MEERA'))).toBe(MEERA)
    expect(map.size).toBe(1)
  })
})

describe('shotLabel', () => {
  it('zero-pads both halves to two', () => {
    expect(shotLabel(1, 3)).toBe('01-03')
    expect(shotLabel(12, 10)).toBe('12-10')
    expect(shotLabel(220, 1)).toBe('220-01')
  })
})

describe('excerpt', () => {
  it('returns a short line whole and cuts a long one at a word with an ellipsis', () => {
    expect(excerpt('A kettle on the hob.')).toBe('A kettle on the hob.')
    const long = 'word '.repeat(40).trim()
    const cut = excerpt(long, 50)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(51)
    expect(cut.slice(0, -1).endsWith(' ')).toBe(false)
  })

  it('collapses runs of whitespace', () => {
    expect(excerpt('a   b\n\tc')).toBe('a b c')
  })
})
