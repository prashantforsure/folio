import { describe, expect, it } from 'vitest'

import type { Derivation, DeriveError } from './derive'
import { countDerivationIds, derive } from './derive'
import type { DerivedEntities, ProposalDecision, ResolveRow } from './entities'
import { NO_ENTITIES, resolveRowKey } from './entities'
import { characterId, locationId } from './ids'
import { mention, text } from './inline'
import type { Result } from './result'
import {
  characterAuthored,
  characterRecord,
  idAt,
  locationAuthored,
  locationRecord,
  nodesOf,
} from './testing/derive-corpus'

/**
 * Derivation.
 *
 * AGENTS.md, Entity identity: "The hardest correctness problem in the app. Get
 * this wrong and the product is worthless." Every test in this file is one
 * sentence from that section or from Derivation, asserted directly:
 *
 *   - a character is a stable id with a name, never its cue text;
 *   - delivery modifiers never create a second person;
 *   - two spellings become one person through the alias table and nothing else;
 *   - a record removed from the script keeps its record;
 *   - a location is a tree, and days roll up through it;
 *   - a rejected proposal does not come back;
 *   - a malformed heading does not become a scene.
 *
 * The property-level versions of these live in `derive-properties.test.ts`; this
 * file is the worked examples, because a property that passes on generated data
 * is not much use to a reviewer trying to see what the shapes are.
 */

const ids = (count: number, prefix = 'x'): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

const must = (result: Result<Derivation, DeriveError>): Derivation => {
  if (!result.ok) throw new Error(`derive failed: ${JSON.stringify(result.error)}`)
  return result.value
}

/**
 * Derive, with a fresh id prefix per pass.
 *
 * Ids are never reused (`derive` rejects one that an existing record holds), so
 * a test that derives twice supplies `x` and then `y`. That is the caller's
 * contract, not an artefact of the harness.
 */
const run = (
  lines: readonly string[],
  previous: DerivedEntities = NO_ENTITIES,
  prefix = 'x',
  supply = 32,
): Derivation => {
  const nodes = nodesOf(lines)
  return must(derive(nodes, previous, { freshIds: ids(supply, prefix) }))
}

const charactersMinted = (derivation: Derivation): readonly string[] =>
  derivation.minted.flatMap((mint) => (mint.kind === 'character' ? [String(mint.id)] : []))

const rowFor = (entities: DerivedEntities, kind: string, key: string): ResolveRow | undefined =>
  entities.queue.find((row) => resolveRowKey(row.subject) === `${kind}:${key}`)

const CHAWL = [
  'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
  'action:The tap coughs twice and gives up.',
  'cue:MEERA',
  'dialogue:You said the fifteenth.',
  'dialogue:It is the twenty-first.',
  'cue:LANDLORD',
  'paren:(not looking up)',
  'dialogue:I have twelve rooms in this building.',
  'scene:EXT. KAMATHI CHAWL - COURTYARD - DAY',
  'cue:MEERA (V.O.)',
  'dialogue:He had twelve rooms and no time at all.',
]

describe('scenes', () => {
  it('derives a scene per heading, with cast, line and character counts', () => {
    const { entities } = run(CHAWL)

    expect(entities.scenes).toHaveLength(2)
    const [first, second] = entities.scenes
    if (first === undefined || second === undefined) throw new Error('missing scene')

    expect(first.id).toBe(idAt(0))
    expect(first.number).toBe(1)
    expect(first.heading).toBe('INT. KAMATHI CHAWL - CORRIDOR - NIGHT')
    expect(first.reading.ie).toBe('INT')
    expect(first.reading.set).toBe('KAMATHI CHAWL - CORRIDOR')
    expect(first.reading.timeOfDay).toBe('NIGHT')
    expect(first.reading.light).toBe('night')
    expect(first.lines).toBe(3)
    expect(first.castSize).toBe(2)
    expect(first.speaking).toHaveLength(2)

    expect(second.number).toBe(2)
    expect(second.reading.light).toBe('day')
    expect(second.lines).toBe(1)
    expect(second.castSize).toBe(1)
  })

  it('does not make a scene out of a malformed heading, and says so', () => {
    const derivation = run([
      'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
      'action:Rain.',
      'scene:INTERCUT - PHONE CALL',
      'cue:MEERA',
      'dialogue:Where are you.',
    ])

    expect(derivation.entities.scenes).toHaveLength(1)
    expect(derivation.rejectedHeadings).toHaveLength(1)
    const [rejected] = derivation.rejectedHeadings
    if (rejected === undefined) throw new Error('missing rejection')
    expect(rejected.node).toBe(idAt(2))
    expect(rejected.rejection.kind).toBe('rejected')
    // The dialogue after it belongs to the scene it was already in.
    const [scene] = derivation.entities.scenes
    expect(scene?.lines).toBe(1)
    expect(scene?.castSize).toBe(1)
  })

  it('keeps a scene record when its heading node is deleted', () => {
    const first = run(CHAWL)
    const withSynopsis: DerivedEntities = {
      ...first.entities,
      scenes: first.entities.scenes.map((scene) =>
        scene.number === 2
          ? { ...scene, authored: { ...scene.authored, synopsis: 'The courtyard floods.' } }
          : scene,
      ),
    }
    const second = run(CHAWL.slice(0, 8), withSynopsis, 'y')
    const kept = second.entities.scenes.find((scene) => scene.id === idAt(8))
    expect(kept?.presence).toBe('absent')
    expect(kept?.number).toBe(0)
    expect(kept?.authored.synopsis).toBe('The courtyard floods.')
  })
})

describe('characters', () => {
  it('mints one record per new cue and binds the cue to it', () => {
    const derivation = run(CHAWL)

    expect(derivation.entities.characters).toHaveLength(2)
    expect(derivation.minted.filter((mint) => mint.kind === 'character')).toHaveLength(2)
    const meera = derivation.entities.characters.find(
      (record) => record.authored.name === 'MEERA',
    )
    expect(meera?.id).toBe(characterId('x1'))
    expect(meera?.authored.boundCues).toStrictEqual(['MEERA'])
    expect(meera?.appearances).toBe(2)
    expect(meera?.lines).toBe(3)
    expect(meera?.presence).toBe('present')
  })

  it('never lets a delivery modifier create a second person', () => {
    const derivation = run([
      'scene:INT. A TAXI - NIGHT',
      'cue:MEERA',
      'dialogue:One.',
      'cue:MEERA (V.O.)',
      'dialogue:Two.',
      'cue:MEERA (O.S.)',
      'dialogue:Three.',
      'rawCue:MEERA (CONT’D)',
      'dialogue:Four.',
    ])

    expect(derivation.entities.characters).toHaveLength(1)
    const [meera] = derivation.entities.characters
    if (meera === undefined) throw new Error('missing record')
    expect(meera.lines).toBe(4)
    // The alias table shows the spellings; the person is one record.
    expect(meera.cues.map((cue) => cue.cue)).toStrictEqual([
      'MEERA',
      'MEERA (V.O.)',
      'MEERA (O.S.)',
    ])
    expect(meera.cues.map((cue) => cue.occurrences)).toStrictEqual([2, 1, 1])
  })

  it('makes the Devanagari and Latin spellings one person through the alias table', () => {
    const script = [
      'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
      'cue:MEERA',
      'dialogue:You said the fifteenth.',
      'cue:मीरा',
      'dialogue:यह इक्कीस तारीख़ है।',
    ]

    // Without a binding they are two records - which is correct, and is why the
    // queue exists. Nothing in derivation can know they are the same word.
    const cold = run(script)
    expect(cold.entities.characters).toHaveLength(2)

    // The binding is the writer's, and it is the only thing that unifies them.
    const bound: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'meera',
          characterAuthored({ name: 'Meera', boundCues: ['MEERA', 'मीरा'] }),
        ),
      ],
    }
    const warm = run(script, bound, 'y')
    expect(warm.entities.characters).toHaveLength(1)
    const [meera] = warm.entities.characters
    expect(meera?.id).toBe(characterId('meera'))
    expect(meera?.lines).toBe(2)
    expect(meera?.appearances).toBe(1)
    expect(meera?.cues.map((cue) => cue.cue)).toStrictEqual(['MEERA', 'मीरा'])
    expect(charactersMinted(warm)).toStrictEqual([])
  })

  it('keeps the record, the bio and the relationships when every cue is deleted', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'meera',
          characterAuthored({
            name: 'Meera',
            boundCues: ['MEERA'],
            bio: 'Counts the notes twice.',
            relationships: [{ other: characterId('anil'), what: 'owes rent to' }],
            notes: { portrait: 'meera.png', arc: ['E1 dry', 'E2 queue'] },
          }),
        ),
      ],
    }
    const before = run(CHAWL, previous)
    const kept = before.entities.characters.find((record) => record.id === characterId('meera'))
    expect(kept?.presence).toBe('present')

    const after = run(
      ['scene:INT. A TEA STALL - DAY', 'action:Nobody speaks.'],
      before.entities,
      'y',
    )
    const record = after.entities.characters.find(
      (candidate) => candidate.id === characterId('meera'),
    )
    if (record === undefined) throw new Error('the record did not survive')

    expect(record.presence).toBe('absent')
    expect(record.appearances).toBe(0)
    expect(record.lines).toBe(0)
    expect(record.cues).toStrictEqual([])
    expect(record.authored.bio).toBe('Counts the notes twice.')
    expect(record.authored.relationships).toStrictEqual([
      { other: characterId('anil'), what: 'owes rent to' },
    ])
    expect(record.authored.notes).toStrictEqual({
      portrait: 'meera.png',
      arc: ['E1 dry', 'E2 queue'],
    })
  })

  it('gives a mentioned character an appearance without a line', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [characterRecord('rao', characterAuthored({ name: 'Inspector Rao' }))],
    }
    const nodes = nodesOf([
      'scene:INT. THE MILL - OFFICE - DAY',
      { type: 'action', runs: [text('Nobody has seen '), mention({ entity: 'character', id: characterId('rao') }), text(' since Tuesday.')] },
      'cue:MEERA',
      'dialogue:He signed for it.',
    ])
    const derivation = must(derive(nodes, previous, { freshIds: ids(8) }))

    const rao = derivation.entities.characters.find(
      (record) => record.id === characterId('rao'),
    )
    expect(rao?.presence).toBe('present')
    expect(rao?.mentions).toBe(1)
    expect(rao?.lines).toBe(0)
    expect(rao?.appearances).toBe(1)
    expect(rao?.cues).toStrictEqual([])

    const [scene] = derivation.entities.scenes
    expect(scene?.mentioned).toStrictEqual([characterId('rao')])
    expect(scene?.castSize).toBe(2)
    expect(derivation.danglingMentions).toStrictEqual([])
  })

  it('reports a mention that points at no record instead of inventing one', () => {
    const nodes = nodesOf([
      'scene:INT. THE MILL - OFFICE - DAY',
      { type: 'action', runs: [mention({ entity: 'character', id: characterId('ghost') })] },
    ])
    const derivation = must(derive(nodes, NO_ENTITIES, { freshIds: ids(4) }))

    expect(derivation.entities.characters).toStrictEqual([])
    expect(derivation.danglingMentions).toHaveLength(1)
    expect(derivation.danglingMentions[0]?.node).toBe(idAt(1))
  })

  it('does not let a comment node put a character in a scene', () => {
    const nodes = nodesOf([
      'scene:INT. A TEA STALL - DAY',
      { type: 'comment', runs: [text('check '), mention({ entity: 'character', id: characterId('rao') }), text(' here')] },
      'comment:MEERA',
    ])
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [characterRecord('rao', characterAuthored({ name: 'Inspector Rao' }))],
    }
    const derivation = must(derive(nodes, previous, { freshIds: ids(4) }))

    expect(derivation.entities.characters).toHaveLength(1)
    expect(derivation.entities.characters[0]?.mentions).toBe(0)
    expect(derivation.entities.characters[0]?.presence).toBe('absent')
    expect(derivation.entities.scenes[0]?.castSize).toBe(0)
  })
})

describe('the resolve queue', () => {
  it('proposes rather than binds when a cue resembles a record', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'suresh',
          characterAuthored({ name: 'Suresh Kadam', boundCues: ['SURESH KADAM'] }),
        ),
      ],
    }
    const derivation = run(
      ['scene:INT. THE MILL - FLOOR - DAY', 'cue:SURESH', 'dialogue:One shift more.'],
      previous,
    )

    // No character record was minted and nothing was bound: the guess went to
    // the queue. (The slugline is new, so a location record was.)
    expect(charactersMinted(derivation)).toStrictEqual([])
    expect(derivation.entities.characters).toHaveLength(1)
    expect(derivation.entities.characters[0]?.lines).toBe(0)

    const row = rowFor(derivation.entities, 'cue', 'SURESH')
    expect(row?.state).toBe('open')
    expect(row?.occurrences).toBe(1)
    expect(row?.proposal).toStrictEqual({
      target: { kind: 'character', id: characterId('suresh') },
      confidence: 'likely',
    })
    expect(derivation.entities.scenes[0]?.unresolvedCues).toStrictEqual(['SURESH'])
  })

  it('scores an exact name as certain and a contained name as possible', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'meera',
          characterAuthored({ name: 'Meera Pawar', boundCues: ['MEERA'] }),
        ),
      ],
    }
    const derivation = run(
      [
        'scene:INT. A TAXI - NIGHT',
        'cue:MEERA PAWAR',
        'dialogue:One.',
        'cue:YOUNG MEERA',
        'dialogue:Two.',
      ],
      previous,
    )

    expect(rowFor(derivation.entities, 'cue', 'MEERA PAWAR')?.proposal?.confidence).toBe('certain')
    expect(rowFor(derivation.entities, 'cue', 'YOUNG MEERA')?.proposal?.confidence).toBe('possible')
  })

  it('does not bring a rejected proposal back on the next pass', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'suresh',
          characterAuthored({ name: 'Suresh Kadam', boundCues: ['SURESH KADAM'] }),
        ),
      ],
    }
    const script = ['scene:INT. THE MILL - FLOOR - DAY', 'cue:SURESH', 'dialogue:One shift more.']
    const first = run(script, previous)

    const rejection: ProposalDecision = {
      verdict: 'rejected',
      target: { kind: 'character', id: characterId('suresh') },
    }
    const decided: DerivedEntities = {
      ...first.entities,
      queue: first.entities.queue.map((row) =>
        row.subject.kind === 'cue' ? { ...row, decisions: [rejection] } : row,
      ),
    }

    const second = run(script, decided, 'y')
    const row = rowFor(second.entities, 'cue', 'SURESH')
    expect(row?.proposal).toStrictEqual({ target: { kind: 'new-record' }, confidence: 'possible' })
    expect(row?.suppressed).toStrictEqual([
      { target: { kind: 'character', id: characterId('suresh') }, confidence: 'likely' },
    ])

    // And a third pass does not quietly re-propose it either.
    const third = run(script, second.entities, 'z')
    expect(rowFor(third.entities, 'cue', 'SURESH')?.proposal).toStrictEqual({
      target: { kind: 'new-record' },
      confidence: 'possible',
    })
  })

  it('mints on an accepted new-record and stops proposing anything on a rejected one', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'suresh',
          characterAuthored({ name: 'Suresh Kadam', boundCues: ['SURESH KADAM'] }),
        ),
      ],
    }
    const script = ['scene:INT. THE MILL - FLOOR - DAY', 'cue:SURESH', 'dialogue:One shift more.']
    const seed = run(script, previous)

    const withDecision = (decisions: readonly ProposalDecision[]): DerivedEntities => ({
      ...seed.entities,
      queue: seed.entities.queue.map((row) =>
        row.subject.kind === 'cue' ? { ...row, decisions } : row,
      ),
    })

    const accepted = run(
      script,
      withDecision([{ verdict: 'accepted', target: { kind: 'new-record' } }]),
      'y',
    )
    expect(charactersMinted(accepted)).toHaveLength(1)
    expect(accepted.entities.characters).toHaveLength(2)
    expect(rowFor(accepted.entities, 'cue', 'SURESH')?.state).toBe('settled')

    // Walk-on: not that record, and not a record at all.
    const walkOn = run(
      script,
      withDecision([
        { verdict: 'rejected', target: { kind: 'character', id: characterId('suresh') } },
        { verdict: 'rejected', target: { kind: 'new-record' } },
      ]),
      'z',
    )
    expect(charactersMinted(walkOn)).toStrictEqual([])
    expect(walkOn.entities.characters).toHaveLength(1)
    expect(rowFor(walkOn.entities, 'cue', 'SURESH')?.proposal).toBeNull()
    expect(rowFor(walkOn.entities, 'cue', 'SURESH')?.state).toBe('open')
  })

  it('keeps a row and its decisions after the cue leaves the script', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord(
          'suresh',
          characterAuthored({ name: 'Suresh Kadam', boundCues: ['SURESH KADAM'] }),
        ),
      ],
    }
    const script = ['scene:INT. THE MILL - FLOOR - DAY', 'cue:SURESH', 'dialogue:One shift more.']
    const first = run(script, previous)
    const decisions: readonly ProposalDecision[] = [
      { verdict: 'rejected', target: { kind: 'character', id: characterId('suresh') } },
    ]
    const decided: DerivedEntities = {
      ...first.entities,
      queue: first.entities.queue.map((row) =>
        row.subject.kind === 'cue' ? { ...row, decisions } : row,
      ),
    }

    const gone = run(
      ['scene:INT. THE MILL - FLOOR - DAY', 'action:Nobody speaks.'],
      decided,
      'y',
    )
    const row = rowFor(gone.entities, 'cue', 'SURESH')
    expect(row?.state).toBe('gone')
    expect(row?.occurrences).toBe(0)
    expect(row?.decisions).toStrictEqual(decisions)
  })
})

describe('locations', () => {
  it('mints a primary set per unmatched slugline and never an edge', () => {
    const derivation = run(CHAWL)

    expect(derivation.entities.locations).toHaveLength(2)
    for (const record of derivation.entities.locations) {
      expect(record.authored.parent).toBeNull()
      expect(record.depth).toBe(0)
      expect(record.children).toStrictEqual([])
    }
    const corridor = derivation.entities.locations[0]
    expect(corridor?.authored.name).toBe('KAMATHI CHAWL - CORRIDOR')
    expect(corridor?.own.scenes).toBe(1)
    expect(corridor?.own.nightScenes).toBe(1)
  })

  it('proposes a parent for sets that share a head, and creates none', () => {
    const derivation = run(CHAWL)
    const rows = derivation.entities.queue.filter((row) => row.subject.kind === 'structure')

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.proposal).toStrictEqual({
        target: { kind: 'new-parent', name: 'KAMATHI CHAWL' },
        confidence: 'likely',
      })
    }
    expect(derivation.entities.locations.every((record) => record.authored.parent === null)).toBe(
      true,
    )
  })

  it('proposes attaching to a primary set that already exists', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      locations: [
        locationRecord(
          'chawl',
          locationAuthored({ name: 'Kamathi Chawl', boundSluglines: ['KAMATHI CHAWL'] }),
        ),
        locationRecord(
          'corridor',
          locationAuthored({
            name: 'Kamathi Chawl - Corridor',
            boundSluglines: ['KAMATHI CHAWL - CORRIDOR'],
          }),
        ),
      ],
    }
    const derivation = run(CHAWL, previous)
    const row = derivation.entities.queue.find(
      (candidate) => candidate.subject.kind === 'structure' && candidate.subject.key === 'corridor',
    )
    expect(row?.proposal).toStrictEqual({
      target: { kind: 'attach', parent: locationId('chawl') },
      confidence: 'likely',
    })
    expect(
      derivation.entities.locations.find((record) => record.id === locationId('corridor'))?.authored
        .parent,
    ).toBeNull()
  })

  it('rolls shooting days and scene counts up through the tree', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      locations: [
        locationRecord(
          'chawl',
          locationAuthored({
            name: 'Kamathi Chawl',
            boundSluglines: ['KAMATHI CHAWL'],
            scheduledDays: 2,
          }),
        ),
        locationRecord(
          'corridor',
          locationAuthored({
            name: 'Corridor',
            parent: locationId('chawl'),
            boundSluglines: ['KAMATHI CHAWL - CORRIDOR'],
            scheduledDays: 3,
          }),
        ),
        locationRecord(
          'courtyard',
          locationAuthored({
            name: 'Courtyard',
            parent: locationId('chawl'),
            boundSluglines: ['KAMATHI CHAWL - COURTYARD'],
            scheduledDays: 4,
          }),
        ),
        locationRecord(
          'tap',
          locationAuthored({
            name: 'The shared tap',
            parent: locationId('courtyard'),
            boundSluglines: ['KAMATHI CHAWL - COURTYARD - THE TAP'],
            scheduledDays: 1,
          }),
        ),
      ],
    }
    const derivation = run(
      [
        ...CHAWL,
        'scene:EXT. KAMATHI CHAWL - COURTYARD - THE TAP - DAY',
        'action:A bucket holds a place in the queue.',
        'scene:INT. KAMATHI CHAWL - NIGHT',
        'action:The building listens.',
      ],
      previous,
    )

    const byId = new Map(derivation.entities.locations.map((record) => [String(record.id), record]))
    const chawl = byId.get('chawl')
    const courtyard = byId.get('courtyard')
    const tap = byId.get('tap')

    expect(chawl?.depth).toBe(0)
    expect(courtyard?.depth).toBe(1)
    expect(tap?.depth).toBe(2)
    expect(chawl?.children).toStrictEqual([locationId('corridor'), locationId('courtyard')])
    expect(courtyard?.children).toStrictEqual([locationId('tap')])

    expect(chawl?.own.shootingDays).toBe(2)
    expect(chawl?.rollup.shootingDays).toBe(2 + 3 + 4 + 1)
    expect(courtyard?.rollup.shootingDays).toBe(4 + 1)
    expect(tap?.rollup.shootingDays).toBe(1)

    expect(chawl?.own.scenes).toBe(1)
    expect(chawl?.rollup.scenes).toBe(4)
    expect(chawl?.rollup.dayScenes).toBe(2)
    expect(chawl?.rollup.nightScenes).toBe(2)
    expect(derivation.brokenEdges).toStrictEqual([])
  })

  it('reports a parent that does not exist and a cycle, and rolls up anyway', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      locations: [
        locationRecord(
          'a',
          locationAuthored({
            name: 'A',
            parent: locationId('nowhere'),
            boundSluglines: ['KAMATHI CHAWL - CORRIDOR'],
            scheduledDays: 1,
          }),
        ),
        locationRecord(
          'b',
          locationAuthored({ name: 'B', parent: locationId('c'), boundSluglines: ['B'] }),
        ),
        locationRecord(
          'c',
          locationAuthored({ name: 'C', parent: locationId('b'), boundSluglines: ['C'] }),
        ),
      ],
    }
    const derivation = run(CHAWL, previous)

    expect(derivation.brokenEdges).toStrictEqual([
      { location: locationId('a'), parent: locationId('nowhere'), reason: 'unknown-parent' },
      { location: locationId('b'), parent: locationId('c'), reason: 'cycle' },
      { location: locationId('c'), parent: locationId('b'), reason: 'cycle' },
    ])
    const a = derivation.entities.locations.find((record) => record.id === locationId('a'))
    expect(a?.depth).toBe(0)
    expect(a?.rollup.shootingDays).toBe(1)
  })
})

describe('ids', () => {
  it('says how many it needs before any is spent', () => {
    const nodes = nodesOf(CHAWL)
    expect(countDerivationIds(nodes, NO_ENTITIES)).toBe(4)

    const short = derive(nodes, NO_ENTITIES, { freshIds: ['a', 'b'] })
    expect(short).toStrictEqual({
      ok: false,
      error: { kind: 'not-enough-ids', needed: 4, supplied: 2 },
    })
  })

  it('needs none to re-derive an unchanged script', () => {
    const nodes = nodesOf(CHAWL)
    const first = must(derive(nodes, NO_ENTITIES, { freshIds: ids(4) }))
    expect(countDerivationIds(nodes, first.entities)).toBe(0)
    const second = derive(nodes, first.entities, { freshIds: [] })
    expect(second.ok).toBe(true)
  })

  it('refuses an empty, a duplicated, or an already-used id', () => {
    const nodes = nodesOf(CHAWL)
    expect(derive(nodes, NO_ENTITIES, { freshIds: ['a', '', 'c', 'd'] })).toStrictEqual({
      ok: false,
      error: { kind: 'empty-id', index: 1 },
    })
    expect(derive(nodes, NO_ENTITIES, { freshIds: ['a', 'b', 'a', 'd'] })).toStrictEqual({
      ok: false,
      error: { kind: 'duplicate-id', id: 'a' },
    })
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [characterRecord('a', characterAuthored({ name: 'Someone', boundCues: [] }))],
    }
    expect(derive(nodes, previous, { freshIds: ['a', 'b', 'c', 'd'] })).toStrictEqual({
      ok: false,
      error: { kind: 'id-already-in-use', id: 'a' },
    })
  })

  it('hands back the ids it did not spend', () => {
    const derivation = run(CHAWL, NO_ENTITIES, 'x', 6)
    expect(derivation.minted.map((mint) => String(mint.id))).toStrictEqual(['x1', 'x2', 'x3', 'x4'])
    expect(derivation.unusedIds).toStrictEqual(['x5', 'x6'])
  })

  it('reports two records claiming one cue instead of guessing', () => {
    const previous: DerivedEntities = {
      ...NO_ENTITIES,
      characters: [
        characterRecord('one', characterAuthored({ name: 'Meera', boundCues: ['MEERA'] })),
        characterRecord('two', characterAuthored({ name: 'Meera again', boundCues: ['MEERA'] })),
      ],
    }
    const derivation = run(CHAWL, previous)
    expect(derivation.ambiguousBindings).toStrictEqual([
      { kind: 'cue', key: 'MEERA', records: ['one', 'two'] },
    ])
    // The first record in record order wins, deterministically.
    expect(
      derivation.entities.characters.find((record) => record.id === characterId('one'))?.lines,
    ).toBe(3)
  })
})
