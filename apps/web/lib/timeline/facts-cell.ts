import { createCell } from '../workspace/open-cell'
import type { TimelineFacts } from './facts'

/**
 * The Timeline workspace's facts, published for the assistant panel -
 * the cell half of `./facts.ts`, split off on 2026-09-23 (roadmap task 2.4)
 * because a cell reaches for a React hook and the predicates beside it are
 * read by the server too. The types and the predicates are `./facts.ts`'s;
 * this file is only the channel from the page to the panel.
 */
const cell = createCell<TimelineFacts | null>(null)

export const publishTimelineFacts = cell.set

/** The published cell, or `null` when no Timeline workspace is mounted. */
export const useTimelineFacts = cell.use
