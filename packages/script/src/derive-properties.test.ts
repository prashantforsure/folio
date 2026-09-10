import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { canonicalKey } from './alias'
import type { Derivation, DeriveError } from './derive'
import { derive } from './derive'
import type { DerivedEntities, ProposalDecision } from './entities'
import { NO_ENTITIES } from './entities'
import type { CharacterId } from './ids'
import { characterId } from './ids'
import type { ScreenplayNode } from './node'
import type { Result } from './result'
import {
  NAMES,
  authoredNotesArb,
  linesOfScenes,
  scriptArb,
} from './testing/derive-arbitraries'
import { characterAuthored, characterRecord, nodesOf } from './testing/derive-corpus'

/**
 * The four properties derivation is worth having.
 *
 * AGENTS.md, Development philosophy 8 puts derivation and entity identity in the
 * short list of places where correctness is load-bearing. Each property here is
 * a sentence from the contract that an example test can only illustrate:
 *
 *   1. Re-deriving an unchanged script is the identity on every authored field.
 *      Not "on the fields we remembered to copy" - on every one, asserted by
 *      reference, so a rebuilt-but-equal object fails.
 *   2. Alias resolution does not depend on the order of the node list or on
 *      which delivery modifier a cue happened to carry.
 *   3. A rejected proposal never comes back, however many passes run.
 *   4. Derivation is pure: same input, same output, and the input is unchanged
 *      when it returns. This is the property the whole speculative-derivation
 *      story rests on, and it is the reason `packages/script` may not touch the
 *      clock or the entropy source.
 */

const ids = (count: number, prefix: string): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

const must = (result: Result<Derivation, DeriveError>): Derivation => {
  if (!result.ok) throw new Error(`derive failed: ${JSON.stringify(result.error)}`)
  return result.value
}

const derived = (
  nodes: readonly ScreenplayNode[],
  previous: DerivedEntities,
  prefix: string,
): Derivation => must(derive(nodes, previous, { freshIds: ids(64, prefix) }))

/** A record per name, every cue bound, so nothing has to be minted or guessed. */
const boundCast = (): DerivedEntities => ({
  ...NO_ENTITIES,
  characters: NAMES.map((name, index) =>
    characterRecord(`cast${String(index)}`, characterAuthored({ name, boundCues: [name] })),
  ),
})

const snapshot = (value: unknown): string => JSON.stringify(value)

const REJECT_NEW: readonly ProposalDecision[] = [
  { verdict: 'rejected', target: { kind: 'new-record' } },
]

const characterMints = (derivation: Derivation): readonly string[] =>
  derivation.minted.flatMap((mint) => (mint.kind === 'character' ? [String(mint.id)] : []))

describe('re-deriving is a no-op on authored data', () => {
  it('carries every authored sub-object across by reference', () => {
    fc.assert(
      fc.property(
        scriptArb,
        authoredNotesArb,
        fc.string({ maxLength: 20 }),
        (scenes, notes, synopsis) => {
          const nodes = nodesOf(linesOfScenes(scenes))
          const first = derived(nodes, NO_ENTITIES, 'a')

          // The writer authors on top of what was derived: bios, relationships,
          // synopses, story time, beats, threads, descriptions, scheduled days,
          // and the opaque notes blob the routes own.
          const authored: DerivedEntities = {
            characters: first.entities.characters.map((record, index) => ({
              ...record,
              authored: {
                ...record.authored,
                bio: `bio ${String(index)}`,
                relationships: [{ other: characterId('other'), what: 'owes rent to' }],
                notes,
              },
            })),
            locations: first.entities.locations.map((record, index) => ({
              ...record,
              authored: {
                ...record.authored,
                description: `desc ${String(index)}`,
                scheduledDays: index + 1,
                notes,
              },
            })),
            scenes: first.entities.scenes.map((scene) => ({
              ...scene,
              authored: {
                ...scene.authored,
                synopsis,
                storyTime: 'Day 3, morning',
                beats: ['b1', 'b2'],
                threads: ['the tank'],
                notes,
              },
            })),
            queue: first.entities.queue.map((row) => ({ ...row, decisions: REJECT_NEW })),
          }

          const second = derived(nodes, authored, 'b')

          expect(second.minted).toStrictEqual([])
          expect(second.entities.characters).toHaveLength(authored.characters.length)
          expect(second.entities.locations).toHaveLength(authored.locations.length)
          expect(second.entities.scenes).toHaveLength(authored.scenes.length)
          expect(second.entities.queue).toHaveLength(authored.queue.length)

          for (let index = 0; index < authored.characters.length; index += 1) {
            expect(second.entities.characters[index]?.authored).toBe(
              authored.characters[index]?.authored,
            )
          }
          for (let index = 0; index < authored.locations.length; index += 1) {
            expect(second.entities.locations[index]?.authored).toBe(
              authored.locations[index]?.authored,
            )
          }
          for (let index = 0; index < authored.scenes.length; index += 1) {
            expect(second.entities.scenes[index]?.authored).toBe(authored.scenes[index]?.authored)
          }
          for (let index = 0; index < authored.queue.length; index += 1) {
            expect(second.entities.queue[index]?.decisions).toBe(authored.queue[index]?.decisions)
          }
        },
      ),
      { numRuns: 60 },
    )
  })

  it('reaches a fixed point: the third pass equals the second, field for field', () => {
    fc.assert(
      fc.property(scriptArb, (scenes) => {
        const nodes = nodesOf(linesOfScenes(scenes))
        const first = derived(nodes, NO_ENTITIES, 'a')
        const second = derived(nodes, first.entities, 'b')
        const third = derived(nodes, second.entities, 'c')
        expect(snapshot(third.entities)).toBe(snapshot(second.entities))
      }),
      { numRuns: 60 },
    )
  })
})

describe('alias resolution', () => {
  it('is the same partition however the scenes are ordered', () => {
    fc.assert(
      fc.property(scriptArb, (scenes) => {
        const forwards = derived(nodesOf(linesOfScenes(scenes)), boundCast(), 'a')
        const backwards = derived(nodesOf(linesOfScenes([...scenes].reverse())), boundCast(), 'b')

        const cast = (derivation: Derivation): readonly (readonly [string, number])[] =>
          derivation.entities.characters
            .map((record): readonly [string, number] => [String(record.id), record.lines])
            .filter(([, lines]) => lines > 0)
            .slice()
            .sort((left, right) => left[0].localeCompare(right[0]))

        expect(cast(backwards)).toStrictEqual(cast(forwards))
        // No character was minted either way: every cue was already bound, so
        // the answer cannot have come from mint order. (Sets are unbound here
        // and do mint - locations have their own properties.)
        expect(characterMints(forwards)).toStrictEqual([])
        expect(characterMints(backwards)).toStrictEqual([])
      }),
      { numRuns: 60 },
    )
  })

  it('puts every modifier variation of a name on one id', () => {
    fc.assert(
      fc.property(scriptArb, (scenes) => {
        const derivation = derived(nodesOf(linesOfScenes(scenes)), boundCast(), 'a')

        // Every cue spelling in the script resolves to the record whose bound
        // cue is the name with the modifiers taken off, and to no other.
        const idsByName = new Map<string, Set<string>>()
        for (const record of derivation.entities.characters) {
          for (const cue of record.cues) {
            const names = idsByName.get(cue.key) ?? new Set<string>()
            names.add(String(record.id))
            idsByName.set(cue.key, names)
          }
        }
        for (const [key, holders] of idsByName) {
          expect(holders.size).toBe(1)
          expect(NAMES.map(canonicalKey)).toContain(key)
        }
        const openCues = derivation.entities.queue.filter(
          (row) => row.state === 'open' && row.subject.kind === 'cue',
        )
        expect(openCues).toStrictEqual([])
      }),
      { numRuns: 60 },
    )
  })
})

describe('a rejected proposal', () => {
  it('does not reappear, on this pass or any later one', () => {
    const similar = fc.constantFrom(
      ['MEERA', 'Meera Pawar'] as const,
      ['SURESH', 'Suresh Kadam'] as const,
      ['ARJUN', 'Arjun'] as const,
      ['THE LANDLOR', 'The Landlord'] as const,
    )

    fc.assert(
      fc.property(similar, fc.integer({ min: 1, max: 4 }), ([cue, name], passes) => {
        const nodes = nodesOf([
          'scene:INT. THE MILL - FLOOR - DAY',
          `cue:${cue}`,
          'dialogue:One shift more.',
        ])
        const target: CharacterId = characterId('existing')
        const previous: DerivedEntities = {
          ...NO_ENTITIES,
          characters: [
            characterRecord('existing', characterAuthored({ name, boundCues: [`${name} X`] })),
          ],
        }

        const first = derived(nodes, previous, 'a')
        const row = first.entities.queue.find((candidate) => candidate.subject.kind === 'cue')
        // The premise: without a decision, this cue is proposed at that record.
        expect(row?.proposal?.target).toStrictEqual({ kind: 'character', id: target })

        const rejection: ProposalDecision = {
          verdict: 'rejected',
          target: { kind: 'character', id: target },
        }
        let entities: DerivedEntities = {
          ...first.entities,
          queue: first.entities.queue.map((candidate) =>
            candidate.subject.kind === 'cue' ? { ...candidate, decisions: [rejection] } : candidate,
          ),
        }

        for (let pass = 0; pass < passes; pass += 1) {
          const next = derived(nodes, entities, `p${String(pass)}`)
          for (const candidate of next.entities.queue) {
            expect(candidate.proposal?.target).not.toStrictEqual({ kind: 'character', id: target })
          }
          // Nor is it bound behind the writer's back.
          const existing = next.entities.characters.find(
            (record) => record.id === target,
          )
          expect(existing?.cues).toStrictEqual([])
          entities = next.entities
        }
      }),
      { numRuns: 60 },
    )
  })
})

describe('purity', () => {
  it('gives the same answer twice and leaves its inputs alone', () => {
    fc.assert(
      fc.property(scriptArb, (scenes) => {
        const nodes = nodesOf(linesOfScenes(scenes))
        const previous = boundCast()
        const nodesBefore = snapshot(nodes)
        const previousBefore = snapshot(previous)
        const options = { freshIds: ids(64, 'a') }

        const once = must(derive(nodes, previous, options))
        const twice = must(derive(nodes, previous, options))

        expect(snapshot(twice)).toBe(snapshot(once))
        expect(snapshot(nodes)).toBe(nodesBefore)
        expect(snapshot(previous)).toBe(previousBefore)
        expect(options.freshIds).toHaveLength(64)
      }),
      { numRuns: 60 },
    )
  })

  it('refuses to mutate a frozen node list or a frozen previous set', () => {
    fc.assert(
      fc.property(scriptArb, (scenes) => {
        const nodes = deepFreeze(nodesOf(linesOfScenes(scenes)))
        const previous = deepFreeze(boundCast())
        expect(() => derive(nodes, previous, { freshIds: ids(64, 'a') })).not.toThrow()
      }),
      { numRuns: 30 },
    )
  })
})

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const child: unknown = (value as Record<string, unknown>)[key]
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}
