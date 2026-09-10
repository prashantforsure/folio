import fc from 'fast-check'

import type { AuthoredNotes, AuthoredValue } from '../entities'

/**
 * Generators for derivation.
 *
 * A generated *script* rather than a generated node list. Random nodes in random
 * order would spend the whole run on lists no writer could produce - a dialogue
 * node with no cue above it, three headings in a row - and would never generate
 * the thing the properties are about, which is the same person under several
 * spellings across several scenes. So the shape is fixed and the content varies:
 * scenes, each with a set and a time, each with speeches by names drawn from a
 * small pool, each speech with or without a delivery modifier.
 *
 * The pool is small on purpose. Collisions are the point: a property about alias
 * resolution over a hundred unique names never tests anything.
 */

export const NAMES = ['MEERA', 'ARJUN', 'THE LANDLORD', 'KAMLA'] as const

export const SETS = [
  'KAMATHI CHAWL - CORRIDOR',
  'KAMATHI CHAWL - COURTYARD',
  'THE MILL - FLOOR',
  'A TAXI',
] as const

const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'DAWN'] as const

const PREFIXES = ['INT.', 'EXT.', 'INT./EXT.'] as const

/** Every spelling of a cue that must not create a second person. */
const CUE_SUFFIXES = ['', ' (V.O.)', ' (O.S.)', " (CONT'D)", ' (CONT’D)', ' (O.C.)'] as const

export type Speech = {
  readonly name: (typeof NAMES)[number]
  readonly suffix: (typeof CUE_SUFFIXES)[number]
  readonly lines: number
}

export type SceneSpec = {
  readonly prefix: (typeof PREFIXES)[number]
  readonly set: (typeof SETS)[number]
  readonly time: (typeof TIMES)[number]
  readonly speeches: readonly Speech[]
}

export const sceneSpecArb: fc.Arbitrary<SceneSpec> = fc.record({
  prefix: fc.constantFrom(...PREFIXES),
  set: fc.constantFrom(...SETS),
  time: fc.constantFrom(...TIMES),
  speeches: fc.array(
    fc.record({
      name: fc.constantFrom(...NAMES),
      suffix: fc.constantFrom(...CUE_SUFFIXES),
      lines: fc.integer({ min: 1, max: 3 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
})

export const scriptArb: fc.Arbitrary<readonly SceneSpec[]> = fc.array(sceneSpecArb, {
  minLength: 1,
  maxLength: 6,
})

/**
 * A script spec as corpus lines.
 *
 * `rawCue:` rather than `cue:`, so the modifier is still in the cue text when
 * derivation sees it. That is the harder half of "modifiers are parsed off
 * before lookup": a cue that arrives with `(CONT'D)` still attached must resolve
 * to the same person as one that does not.
 */
export const linesOfScenes = (scenes: readonly SceneSpec[]): readonly string[] =>
  scenes.flatMap((scene) => [
    `scene:${scene.prefix} ${scene.set} - ${scene.time}`,
    'action:Nobody says anything for a moment.',
    ...scene.speeches.flatMap((speech) => [
      `rawCue:${speech.name}${speech.suffix}`,
      ...Array.from({ length: speech.lines }, (_, index) => `dialogue:Line ${String(index + 1)}.`),
    ]),
  ])

const authoredValueArb: fc.Arbitrary<AuthoredValue> = fc.letrec<{ value: AuthoredValue }>(
  (tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.string({ maxLength: 12 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie('value'), { maxLength: 3 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), { maxKeys: 3 }),
    ),
  }),
).value

/** Whatever the routes hang off a record. Derivation must not read or touch it. */
export const authoredNotesArb: fc.Arbitrary<AuthoredNotes> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  authoredValueArb,
  { maxKeys: 4 },
)
