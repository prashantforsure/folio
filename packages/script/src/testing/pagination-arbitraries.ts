import fc from 'fast-check'

import { nodeId } from '../ids'
import { text } from '../inline'
import type { ScreenplayNode, ScreenplayNodeType } from '../node'
import { typed } from '../provenance'
import { linesOfText } from './pagination-corpus'

/**
 * Generators for pagination properties.
 *
 * Volume matters here in a way it does not for the node-model properties: a
 * script that fits on one page proves nothing about a page break. So a
 * generated script is twenty to ninety elements of one to twelve lines each,
 * which is several pages at 108 lines to the page, and the element mix is
 * weighted towards dialogue because that is where the rules are.
 *
 * Ids are positional and carry a prefix, so a test can insert a second
 * generated script into the first without either of them colliding - which is
 * what "arbitrary upstream edits" needs.
 *
 * Not exported from the package barrel: this is test support, and fast-check
 * must not appear on the surface of a package whose promise is zero runtime
 * dependencies.
 */

export type ElementSpec = {
  readonly type: ScreenplayNodeType
  readonly lines: number
}

const TYPE_WEIGHTS: readonly ScreenplayNodeType[] = [
  'scene',
  'action',
  'action',
  'character',
  'dialogue',
  'dialogue',
  'dialogue',
  'paren',
  'transition',
  'subtitle',
]

export const elementSpecArb: fc.Arbitrary<ElementSpec> = fc.record({
  type: fc.constantFrom(...TYPE_WEIGHTS),
  lines: fc.integer({ min: 1, max: 12 }),
})

export const scriptSpecsArb: fc.Arbitrary<readonly ElementSpec[]> = fc.array(elementSpecArb, {
  minLength: 20,
  maxLength: 90,
})

/** A short run, for the edits that get inserted into a locked script. */
export const editSpecsArb: fc.Arbitrary<readonly ElementSpec[]> = fc.array(elementSpecArb, {
  minLength: 1,
  maxLength: 12,
})

const MEASURE: Readonly<Record<ScreenplayNodeType, number>> = {
  scene: 60,
  action: 60,
  character: 38,
  paren: 25,
  dialogue: 35,
  transition: 15,
  subtitle: 35,
  comment: 60,
}

const contentFor = (spec: ElementSpec, index: number): string => {
  switch (spec.type) {
    case 'scene':
      return `INT. SET ${index} - DAY`
    case 'character':
      return `SPEAKER ${index % 7}`
    case 'transition':
      return 'CUT TO:'
    default:
      return linesOfText(spec.lines, MEASURE[spec.type])
  }
}

/** Build a node list from specs. `prefix` keeps two generated scripts apart. */
export const buildScript = (
  specs: readonly ElementSpec[],
  prefix: string,
): readonly ScreenplayNode[] =>
  specs.map((spec, index): ScreenplayNode => {
    const base = {
      id: nodeId(`${prefix}${index}`),
      provenance: typed(),
      content: [text(contentFor(spec, index))],
    }
    switch (spec.type) {
      case 'character':
        return { type: 'character', ...base, modifiers: [] }
      case 'scene':
        return { type: 'scene', ...base }
      case 'action':
        return { type: 'action', ...base }
      case 'paren':
        return { type: 'paren', ...base }
      case 'dialogue':
        return { type: 'dialogue', ...base }
      case 'transition':
        return { type: 'transition', ...base }
      case 'comment':
        return { type: 'comment', ...base }
      case 'subtitle':
        return { type: 'subtitle', ...base }
    }
  })
