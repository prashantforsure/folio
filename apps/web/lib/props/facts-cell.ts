import { createCell } from '../workspace/open-cell'
import type { PropFacts } from './facts'

/**
 * The Props workspace's facts, published for the assistant panel -
 * the cell half of `./facts.ts`, split off on 2026-09-23 (roadmap task 2.4)
 * because a cell reaches for a React hook and the predicates beside it are
 * read by the server too. The types and the predicates are `./facts.ts`'s;
 * this file is only the channel from the page to the panel.
 */
const cell = createCell<PropFacts | null>(null)

export const publishPropFacts = cell.set

/** The published cell, or `null` when no Props workspace is mounted. */
export const usePropFacts = cell.use
