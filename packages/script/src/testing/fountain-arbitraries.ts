import fc from 'fast-check'

import { characterId, locationId, nodeId } from '../ids'
import type { InlineContent, InlineRun } from '../inline'
import { normaliseContent } from '../inline'
import type { DeliveryModifier, ScreenplayNode } from '../node'
import { DELIVERY_MODIFIERS, makeScreenplayNode } from '../node'
import { typed } from '../provenance'

/**
 * Generators for Fountain round-tripping.
 *
 * Separate from `arbitraries.ts` because the two want opposite things. That
 * file generates ids and text as arbitrary strings on purpose, to prove the
 * model does not secretly depend on their shape. This file generates node lists
 * that are **screenplay-shaped and writable as Fountain**, because the property
 * under test is that the round trip is an identity, and a node list with a
 * Parenthetical floating outside a speech, or a `\t` in a cue, is not something
 * Fountain can express - the serialiser reports it, and a property that spends
 * its whole budget on reported inputs tests nothing.
 *
 * The unrepresentable cases are not skipped, they are moved: they are example
 * tests in `fountain-serialise.test.ts`, one per reason, where the assertion is
 * that the reason is reported rather than silently repaired.
 *
 * What is deliberately still adversarial here:
 *   - cues that need forcing (lowercase, Devanagari, a leading `.`),
 *   - headings that are not headings (`INTERCUT WITH THE CHAWL`),
 *   - transitions that do not end in `TO:`,
 *   - `@mentions` in action and dialogue,
 *   - comments inside a speech as well as between them.
 * Every one of those exercises a forcing path in the serialiser.
 */

const WORDS = [
  'Meera',
  'crosses',
  'the',
  'yard',
  'chawl',
  'rain',
  'does',
  'not',
  'look',
  'back',
  'a',
  'door',
  'closes',
  'somewhere',
  '1997',
  'quiet',
]

const wordsArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...WORDS), { minLength: min, maxLength: max }).map((w) => w.join(' '))

const SETS = ['MEERAS FLAT', 'THE CHAWL - STAIRWELL', 'A TAXI', 'RAILWAY PLATFORM 4']
const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER']
const PREFIXES = ['INT.', 'EXT.', 'INT./EXT.', 'I/E.', 'EST.']

/** Real headings, and headings that only look like one. Both must survive. */
const sceneTextArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .record({
      prefix: fc.constantFrom(...PREFIXES),
      set: fc.constantFrom(...SETS),
      time: fc.constantFrom(...TIMES),
    })
    .map(({ prefix, set, time }) => `${prefix} ${set} - ${time}`),
  fc.constantFrom(
    'INTERCUT WITH THE CHAWL',
    'BACK TO SCENE',
    'MONTAGE - THE MONSOON',
    'EXTREME CLOSE UP - THE LETTER',
  ),
)

const CUES = ['MEERA', 'ARJUN', 'THE LANDLORD', 'VOICE ON THE PHONE', 'MEERA 2']
/** Forcing paths: a caseless script, a lowercase cue, a leading dot. */
const AWKWARD_CUES = ['मीरा', 'meera', '.MEERA', 'ARJUN 3']

const cueArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...CUES) },
  { weight: 1, arbitrary: fc.constantFrom(...AWKWARD_CUES) },
)

const modifiersArb: fc.Arbitrary<readonly DeliveryModifier[]> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<readonly DeliveryModifier[]>([]) },
  { weight: 1, arbitrary: fc.constantFrom(...DELIVERY_MODIFIERS).map((m) => [m] as const) },
)

const transitionArb: fc.Arbitrary<string> = fc.constantFrom(
  'CUT TO:',
  'DISSOLVE TO:',
  'SMASH CUT',
  'FADE OUT.',
)

const parenArb: fc.Arbitrary<string> = fc
  .constantFrom('beat', 'quietly', 'in Hindi', 'not looking up')
  .map((inner) => `(${inner})`)

const mentionIdArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), {
    minLength: 1,
    maxLength: 8,
  })
  .map((characters) => characters.join(''))

/** Text with the occasional `@mention`, which is structure and not text. */
const proseContentArb = (min: number, max: number): fc.Arbitrary<InlineContent> =>
  fc
    .tuple(
      wordsArb(min, max),
      fc.option(
        fc.tuple(fc.constantFrom('character' as const, 'location' as const), mentionIdArb),
        { nil: undefined },
      ),
      wordsArb(0, 3),
    )
    .map(([before, target, after]): InlineContent => {
      const runs: InlineRun[] = [{ kind: 'text', text: before }]
      if (target !== undefined) {
        const [entity, id] = target
        runs.push({ kind: 'text', text: ' ' })
        runs.push(
          entity === 'character'
            ? { kind: 'mention', target: { entity: 'character', id: characterId(id) } }
            : { kind: 'mention', target: { entity: 'location', id: locationId(id) } },
        )
        runs.push({ kind: 'text', text: after === '' ? '' : ` ${after}` })
      }
      return normaliseContent(runs)
    })

const plain = (text: string): InlineContent => normaliseContent([{ kind: 'text', text }])

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

type Draft = {
  readonly type: ScreenplayNode['type']
  readonly content: InlineContent
  readonly modifiers: readonly DeliveryModifier[]
}

const draft = (
  type: ScreenplayNode['type'],
  content: InlineContent,
  modifiers: readonly DeliveryModifier[] = [],
): Draft => ({ type, content, modifiers })

const commentArb: fc.Arbitrary<Draft> = wordsArb(1, 5).map((text) => draft('comment', plain(text)))

/**
 * A speech: the cue, then alternating dialogue and interruptions.
 *
 * Two Dialogue nodes never end up adjacent, because Fountain cannot tell them
 * apart on the way back - consecutive lines in a speech are one element. The
 * serialiser reports that case; the generator does not produce it.
 */
const speechArb: fc.Arbitrary<readonly Draft[]> = fc
  .record({
    cue: cueArb,
    modifiers: modifiersArb,
    opening: fc.option(parenArb, { nil: undefined }),
    first: proseContentArb(1, 8),
    rest: fc.array(
      fc.tuple(fc.oneof(parenArb.map((p) => draft('paren', plain(p))), commentArb), proseContentArb(1, 6)),
      { maxLength: 2 },
    ),
    trailingNote: fc.option(commentArb, { nil: undefined }),
  })
  .map(({ cue, modifiers, opening, first, rest, trailingNote }) => {
    const drafts: Draft[] = [draft('character', plain(cue), modifiers)]
    if (opening !== undefined) drafts.push(draft('paren', plain(opening)))
    drafts.push(draft('dialogue', first))
    for (const [interruption, more] of rest) {
      drafts.push(interruption)
      drafts.push(draft('dialogue', more))
    }
    if (trailingNote !== undefined) drafts.push(trailingNote)
    return drafts
  })

const unitArb: fc.Arbitrary<readonly Draft[]> = fc.oneof(
  { weight: 3, arbitrary: sceneTextArb.map((text) => [draft('scene', plain(text))]) },
  { weight: 4, arbitrary: proseContentArb(1, 10).map((content) => [draft('action', content)]) },
  { weight: 5, arbitrary: speechArb },
  { weight: 1, arbitrary: transitionArb.map((text) => [draft('transition', plain(text))]) },
  {
    weight: 1,
    arbitrary: wordsArb(1, 4).map((text) => [draft('subtitle', plain(`SUBTITLE ${text}`))]),
  },
  { weight: 1, arbitrary: commentArb.map((node) => [node]) },
)

/**
 * Ids are assigned by position, which is all this file needs them for. It is
 * not a format claim - AGENTS.md open decision 1 and the `SCENE_xxx` casing
 * question are both still open, and nothing in `packages/script` writes an id
 * shape down. See `ids.ts`.
 */
export const fountainNodesArb: fc.Arbitrary<readonly ScreenplayNode[]> = fc
  .array(unitArb, { minLength: 1, maxLength: 8 })
  .map((units) =>
    units
      .flat()
      .map((part, index) =>
        makeScreenplayNode(part.type, {
          id: nodeId(`n${index}`),
          provenance: typed(),
          content: part.content,
          modifiers: part.modifiers,
        }),
      ),
  )

// ---------------------------------------------------------------------------
// Adversarial text
// ---------------------------------------------------------------------------

/**
 * Lines drawn from everything the format can throw at the parser, including the
 * generated text that must never survive it and the elements that have no node
 * type at all.
 */
const LINES = [
  '',
  '',
  'INT. THE CHAWL - NIGHT',
  'EXT. RAILWAY PLATFORM 4 - DAY',
  'INTERCUT - PHONE CALL',
  'EXTREME CLOSE UP',
  'ESTABLISHING SHOT',
  'INT.',
  '.',
  '.FORCED HEADING',
  'MEERA',
  "MEERA (CONT'D)",
  'MEERA (V.O.)',
  'MEERA (V.O.) (CONT’D)',
  '(MORE)',
  "(CONT'D)",
  '(beat)',
  'She does not look back.',
  'The rain stops.',
  'CUT TO:',
  '> SMASH CUT <',
  '>FADE OUT.',
  '[[a note]]',
  '# Act One',
  '= a synopsis',
  '~ a lyric',
  '===',
  '!forced action',
  '@meera',
  'मीरा',
  'वह पीछे मुड़कर नहीं देखती।',
  'Title: The Chawl',
  '/* boneyard */',
  '@{character:c1} waits.',
]

export const fountainTextArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...LINES), { minLength: 1, maxLength: 40 })
  .map((lines) => lines.join('\n'))
