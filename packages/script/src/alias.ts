import type { Confidence } from './entities'

/**
 * The alias table's matching half.
 *
 * AGENTS.md, Entity identity: "Matching goes through an **alias table** ...
 * never by hashing the string." Every function in this file obeys the second
 * half of that sentence: none of them produces an identifier, and none of them
 * is ever used to *decide* who someone is. They do two jobs and no others.
 *
 *   1. `canonicalKey` reduces a cue or a slugline to the form the table is keyed
 *      by, so that `MEERA`, `Meera` and `MEERA  ` are one row rather than three.
 *   2. `compare` scores a *proposal* - a guess that reaches the writer as a
 *      resolve-queue row with a confidence on it, and that the writer accepts or
 *      rejects. It never binds anything by itself.
 *
 * The distinction is the whole design. A matcher that binds is one bad edit
 * distance away from merging two people; a matcher that proposes is a suggestion
 * with an Undo built into the workflow.
 *
 * ## Why there is no diacritic folding
 *
 * The obvious next step for `canonicalKey` is NFD plus stripping combining
 * marks, so that a mis-typed accent collapses onto the plain letter. It is not
 * here, and must not be added: Devanagari vowel signs *are* combining marks, so
 * that step turns the Devanagari spelling of a name into a different, broken
 * word - it would mangle every Hindi cue in the script in order to tidy up a
 * Latin one. Which is the same point AGENTS.md is making by naming the alias
 * table as the mechanism: the way two spellings become one person is a row a
 * human put there, not a normalisation clever enough to guess.
 *
 * ## Why apostrophes go and other punctuation becomes a space
 *
 * `MEERA'S ROOM` and `MEERAS ROOM` are the same set, and the apostrophe is the
 * single most common typing difference in a slugline. Removing it joins the word
 * back up; turning it into a space instead would give `MEERA S ROOM`, a
 * three-token key that then scores as a near-miss against `MEERA`. Every other
 * punctuation mark separates words, so it becomes a space.
 */

/** Straight, curly, modifier-letter, prime and acute. Same set as `generated-text.ts`. */
const APOSTROPHES = /['‘’ʹʼ´`′]/gu

const NOT_WORD = /[^\p{L}\p{N}]+/gu

/**
 * The form the alias table is keyed by.
 *
 * Uppercased with the invariant mapping (`toUpperCase`, not a locale one: a
 * locale-sensitive fold would make derivation depend on ambient state, which is
 * exactly the kind of impurity that stops a speculative pass being trustworthy).
 * Scripts with no case - Devanagari, Tamil, Arabic - pass through unchanged,
 * which is correct and is why they need the authored alias rows.
 */
export const canonicalKey = (text: string): string =>
  text.replace(APOSTROPHES, '').replace(NOT_WORD, ' ').trim().toUpperCase()

export const keyTokens = (key: string): readonly string[] =>
  key === '' ? [] : key.split(' ').filter((token) => token !== '')

const startsWithTokens = (
  longer: readonly string[],
  shorter: readonly string[],
): boolean => {
  if (shorter.length === 0 || shorter.length >= longer.length) return false
  for (let index = 0; index < shorter.length; index += 1) {
    if (longer[index] !== shorter[index]) return false
  }
  return true
}

const containsAllTokens = (
  outer: readonly string[],
  inner: readonly string[],
): boolean => {
  if (inner.length === 0 || inner.length >= outer.length) return false
  return inner.every((token) => outer.includes(token))
}

/**
 * Levenshtein distance, abandoned once it exceeds `limit`.
 *
 * Two rows rather than a full matrix, and an early exit, because this runs
 * subject-by-candidate over every unmatched cue in a feature-length script and
 * the answer is only ever consulted against a threshold of 2.
 */
export const editDistance = (a: string, b: string, limit: number): number => {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const source = [...a]
  const target = [...b]
  let previous: number[] = target.map((_, index) => index)
  let current: number[] = new Array<number>(target.length + 1).fill(0)
  for (let row = 1; row <= source.length; row += 1) {
    current[0] = row
    let best = row
    for (let column = 1; column <= target.length; column += 1) {
      const deletion = (previous[column] ?? 0) + 1
      const insertion = (current[column - 1] ?? 0) + 1
      const substitution =
        (previous[column - 1] ?? 0) + (source[row - 1] === target[column - 1] ? 0 : 1)
      const cell = Math.min(deletion, insertion, substitution)
      current[column] = cell
      if (cell < best) best = cell
    }
    if (best > limit) return limit + 1
    const swap = previous
    previous = current
    current = swap
  }
  return previous[target.length] ?? limit + 1
}

/** Below this, an edit distance of 2 is most of the word. `ANI` vs `ANU` is not a typo. */
const MINIMUM_FUZZY_LENGTH = 5

const MAXIMUM_EDITS = 2

/**
 * How confident a proposal that `subject` means `candidate` would be.
 *
 * `null` means there is no proposal to make - which is the important return
 * value, because it is what lets `derive.ts` tell "this cue might be a
 * misspelling of someone who already exists" from "this cue is a person nobody
 * has ever written down", and mint a record only in the second case.
 *
 * The three levels are the ones the Characters and Locations bundles show, and
 * each is one rule:
 *
 *   - `certain`  - the keys are equal. The subject is that record under a
 *                  spelling nobody has bound yet: `MEERA PAWAR` against a record
 *                  named `Meera Pawar`.
 *   - `likely`   - one key's tokens are a leading run of the other's:
 *                  `SURESH` against `Suresh Kadam`.
 *   - `possible` - one key's tokens are all present in the other but not as a
 *                  leading run (`YOUNG MEERA` against `MEERA`), or the keys are
 *                  within two edits of each other.
 *
 * Deliberately not implemented: soundex, metaphone, transliteration, or any
 * other phonetic pass. They are all wrong across the scripts this product is
 * for, and a wrong guess here is not a cosmetic failure - it is a row that
 * proposes merging two people.
 */
export const compare = (subject: string, candidate: string): Confidence | null => {
  if (subject === '' || candidate === '') return null
  if (subject === candidate) return 'certain'

  const subjectTokens = keyTokens(subject)
  const candidateTokens = keyTokens(candidate)

  if (
    startsWithTokens(subjectTokens, candidateTokens) ||
    startsWithTokens(candidateTokens, subjectTokens)
  ) {
    return 'likely'
  }

  if (
    containsAllTokens(subjectTokens, candidateTokens) ||
    containsAllTokens(candidateTokens, subjectTokens)
  ) {
    return 'possible'
  }

  const longest = Math.max(subject.length, candidate.length)
  if (longest < MINIMUM_FUZZY_LENGTH) return null
  const distance = editDistance(subject, candidate, MAXIMUM_EDITS)
  if (distance <= MAXIMUM_EDITS && distance * 3 <= longest) return 'possible'

  return null
}

const RANK: Readonly<Record<Confidence, number>> = { certain: 0, likely: 1, possible: 2 }

/** Ordering for candidate selection. Lower is better. */
export const confidenceRank = (confidence: Confidence): number => RANK[confidence]
