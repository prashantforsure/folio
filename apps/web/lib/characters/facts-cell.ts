import { createCell } from '../workspace/open-cell'
import type { CharacterFacts } from './facts'

/**
 * The Characters workspace's facts, published for the assistant panel -
 * the cell half of `./facts.ts`, split off on 2026-09-23 (roadmap task 2.4)
 * because a cell reaches for a React hook and the predicates beside it are
 * read by the server too. The types and the predicates are `./facts.ts`'s;
 * this file is only the channel from the page to the panel.
 */
const cell = createCell<CharacterFacts | null>(null)

export const publishCharacterFacts = cell.set

/** The published cell, or `null` when no Characters workspace is mounted. */
export const useCharacterFacts = cell.use
