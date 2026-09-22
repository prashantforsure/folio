import { createOpenCell } from '../workspace/open-cell'

/**
 * Whether the `New prop` drawer is open - the sidebar's `+`, the toolbar's
 * `＋ New`, the grid's dashed tile and the empty card's `＋ By hand` all
 * open the one drawer the layout mounts.
 * `lib/workspace/open-cell.ts` says why it is a cell rather than context:
 * the openers are in the layout and in the page, which are different
 * subtrees, so there is no provider both sit under.
 */
const cell = createOpenCell()

export const setNewPropOpen = cell.set
export const useNewPropOpen = cell.use
