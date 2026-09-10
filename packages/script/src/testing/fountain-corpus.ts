/**
 * The import corpus.
 *
 * Held as strings in a `.ts` file rather than as fixture files on disk,
 * because `packages/script` may not import `node:fs` - the purity boundary in
 * `eslint.config.mjs` is an error, and the test-file override relaxes globals
 * only, not imports. A corpus that has to be read off a disk cannot be tested
 * from inside this package, and moving the tests out of the package to reach a
 * disk would put the parser's tests somewhere the parser is not.
 *
 * ## What is real here and what is not
 *
 * `REPAGINATED_EXCERPT` is hand-written in the shape Final Draft produces after
 * a repagination: `(MORE)` at the foot of the page, the cue repeated with a
 * `(CONT'D)` at the head of the next, and a separate speaker `(CONT'D)` where
 * the same character speaks again after an action line. That is the shape the
 * stripping rules exist for.
 *
 * `featureLengthScript` is **synthetic**. It is assembled deterministically
 * from a handful of scene templates to feature length so that the counts in the
 * report are counts over a real volume of nodes rather than over a toy. It is
 * not a real screenplay and it is not a real `.fdx`, and the report says so.
 * A genuine feature-length Final Draft file is what the brief asks for and is
 * one of the two things still outstanding - see the report.
 */

// ---------------------------------------------------------------------------
// Malformed headings
// ---------------------------------------------------------------------------

/**
 * Lines that reach for a scene heading and miss.
 *
 * AGENTS.md, Derivation: "A malformed heading does not silently become a scene.
 * `INTERCUT - PHONE CALL` is not an interior scene at location `ERCUT`."
 *
 * Each of these must come back as something other than a Scene node, and must
 * be reported rather than silently demoted.
 */
export const MALFORMED_HEADINGS: readonly {
  readonly line: string
  readonly why: string
}[] = [
  { line: 'INTERCUT - PHONE CALL', why: 'INT + ERCUT. The named case.' },
  { line: 'INTERCUT WITH THE CHAWL', why: 'Same prefix, different tail.' },
  { line: 'EXTREME CLOSE UP - THE LETTER', why: 'EXT + REME.' },
  { line: 'ESTABLISHING SHOT - THE CITY', why: 'EST + ABLISHING.' },
  { line: 'INTRO - THE FAMILY', why: 'INT + RO.' },
  { line: 'EXTERIOR OF THE BUILDING', why: 'EXT + ERIOR. Reads like a heading, is not one.' },
  { line: 'INT.', why: 'A prefix with no set. A heading with no location is not a scene.' },
  { line: 'EXT.', why: 'Same.' },
  { line: '.', why: 'The forcing character with nothing behind it.' },
]

/** Headings that are real and must survive as Scene nodes, including forced ones. */
export const VALID_HEADINGS: readonly string[] = [
  'INT. MEERAS FLAT - NIGHT',
  'EXT. THE CHAWL - DAY',
  'EST. MUMBAI - DAWN',
  'INT./EXT. TAXI - MOVING - NIGHT',
  'I/E. RAILWAY PLATFORM 4 - CONTINUOUS',
  'INT MEERAS FLAT - LATER',
  '.INTERCUT - PHONE CALL',
]

// ---------------------------------------------------------------------------
// A repaginated export
// ---------------------------------------------------------------------------

/**
 * The front door, in the shape it actually arrives in.
 *
 * Three separate generated-text cases, deliberately:
 *   1. a page split - `(MORE)` then `MEERA (CONT'D)` then the rest of the speech,
 *   2. a speaker continued - `MEERA (CONT'D)` after an intervening action line,
 *      which is *not* a page split and must not be rejoined,
 *   3. a `(CONT'D)` on a cue that also carries an authored `(V.O.)`, which must
 *      keep the modifier and lose the continued.
 * Plus a curly apostrophe, because Final Draft's smart quotes are on by default.
 */
export const REPAGINATED_EXCERPT = [
  'INT. MEERAS FLAT - NIGHT',
  '',
  'Rain on the window. MEERA counts notes onto the table.',
  '',
  'MEERA',
  'You said the fifteenth. It is the twenty-first.',
  '',
  '(MORE)',
  '',
  "MEERA (CONT'D)",
  'I am not asking for the whole of it.',
  '',
  'The LANDLORD does not sit down.',
  '',
  'MEERA (CONT’D)',
  'Sit down.',
  '',
  'LANDLORD',
  '(not looking up)',
  'I have twelve rooms in this building.',
  '',
  'MEERA (V.O.) (CONT’D)',
  'He had twelve rooms and no time at all.',
  '',
  'CUT TO:',
].join('\n')

// ---------------------------------------------------------------------------
// A feature-length script
// ---------------------------------------------------------------------------

/** Deterministic. `packages/script` has no `Math.random()` and neither does its corpus. */
const stepper = (seed: number): (() => number) => {
  // Lehmer, whose intermediate product stays well inside a double. Nothing in
  // here throws and nothing in here is random.
  let state = seed % 2147483647
  return () => {
    state = (state * 48271) % 2147483647
    return state
  }
}

/** A non-empty pool, so the index lookup has a total fallback and never throws. */
const pick = <T>(items: readonly [T, ...T[]], n: number): T =>
  items[Math.abs(n) % items.length] ?? items[0]

const SETS = [
  'MEERAS FLAT',
  'THE CHAWL - STAIRWELL',
  'THE CHAWL - COURTYARD',
  'RAILWAY PLATFORM 4',
  'A TAXI',
  'THE MILL - FLOOR',
  'THE MILL - OFFICE',
  'ARJUNS ROOM',
  'A TEA STALL',
  'THE MAGISTRATES COURT',
] as const
const PREFIXES = ['INT.', 'EXT.', 'INT./EXT.', 'I/E.', 'EST.'] as const
const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'DAWN', 'DUSK'] as const
const NAMES = ['MEERA', 'ARJUN', 'THE LANDLORD', 'KAMLA', 'INSPECTOR RAO', 'THE CLERK'] as const
const ACTIONS = [
  'She does not look back.',
  'The rain stops as suddenly as it started.',
  'A door closes somewhere below.',
  'He counts the notes twice and puts them away.',
  'The fan turns. Nobody speaks.',
  'Outside, a train.',
] as const
const SPEECHES = [
  'You said the fifteenth. It is the twenty-first.',
  'I am not asking for the whole of it.',
  'There is nothing in this building that is mine.',
  'Sit down. Please.',
  'He wrote it down. I watched him write it down.',
  'Twelve rooms and not one of them warm.',
] as const
const PARENS = ['(beat)', '(quietly)', '(in Hindi)', '(not looking up)'] as const

/**
 * A feature-length script, assembled from templates.
 *
 * Every seventh speech is split across a page the way a repaginated export
 * splits one, and every eleventh scene ends on a speaker `(CONT'D)` after an
 * action line. Every thirteenth scene opens with a heading-shaped line that is
 * not a heading, so the malformed count is non-zero at volume.
 */
export const featureLengthScript = (scenes = 220): string => {
  const next = stepper(20260910)
  const lines: string[] = ['Title: The Chawl', 'Credit: written by', 'Author: A Writer', '']
  let speeches = 0

  for (let scene = 0; scene < scenes; scene += 1) {
    const n = next()
    lines.push(
      `${pick(PREFIXES, n)} ${pick(SETS, n >> 3)} - ${pick(TIMES, n >> 7)}`,
      '',
      pick(ACTIONS, n >> 11),
      '',
      pick(ACTIONS, n >> 13),
      '',
    )

    if (scene % 13 === 0) {
      lines.push(
        pick(['INTERCUT - PHONE CALL', 'EXTREME CLOSE UP', 'ESTABLISHING SHOT'] as const, n),
        '',
      )
    }
    if (scene % 17 === 0) {
      lines.push('[[check this against the bible]]', '')
    }
    if (scene % 19 === 0) {
      lines.push('> SUBTITLE: MUMBAI, 1997 <', '')
    }
    // Outline blocks. They have no member of the eight-type union and must be
    // reported and dropped, never coerced into Action.
    if (scene % 23 === 0) {
      lines.push(`# Act ${1 + (scene % 3)}`, '', '= She finally asks him for the money.', '')
    }
    if (scene % 29 === 0) {
      lines.push('===', '')
    }

    const speakers = 3 + (n >> 5) % 4
    let last = ''
    for (let speech = 0; speech < speakers; speech += 1) {
      const m = next()
      const name = pick(NAMES, m)
      const modifier = m % 11 === 0 ? ' (V.O.)' : ''
      lines.push(`${name}${modifier}`)
      if (m % 5 === 0) lines.push(pick(PARENS, m >> 4))
      lines.push(pick(SPEECHES, m >> 8))
      if (m % 3 === 0) lines.push(pick(SPEECHES, m >> 16))

      // A page split: the speech is cut in two by the paginator.
      if (speeches % 7 === 6) {
        lines.push('', '(MORE)', '', `${name}${modifier} (CONT'D)`, pick(SPEECHES, m >> 12))
      }
      lines.push('')
      last = `${name}${modifier}`
      speeches += 1
    }

    // A speaker continued: the same character again, after an action line.
    if (scene % 11 === 0 && last !== '') {
      lines.push(pick(ACTIONS, n >> 15), '', `${last} (CONT’D)`, pick(SPEECHES, n >> 19), '')
    }

    if (scene % 9 === 0) lines.push('CUT TO:', '')
  }

  lines.push('FADE OUT.', '')
  return lines.join('\n')
}
