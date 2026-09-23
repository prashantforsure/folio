import { createCell } from '../workspace/open-cell'
import type { LocationFacts } from './facts'

/**
 * The Locations workspace's facts, published for the assistant panel -
 * the cell half of `./facts.ts`, split off on 2026-09-23 (roadmap task 2.4)
 * because a cell reaches for a React hook and the predicates beside it are
 * read by the server too. The types and the predicates are `./facts.ts`'s;
 * this file is only the channel from the page to the panel.
 */
const cell = createCell<LocationFacts | null>(null)

export const publishLocationFacts = cell.set

/** The published cell, or `null` when no Locations workspace is mounted. */
export const useLocationFacts = cell.use
