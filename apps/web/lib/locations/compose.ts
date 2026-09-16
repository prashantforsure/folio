import { createOpenCell } from '../workspace/open-cell'

/**
 * Whether the `New location` drawer is open - the sidebar's `+`, the
 * toolbar's `＋ New` and the grid's dashed tile all open the one drawer the
 * layout mounts. `lib/workspace/open-cell.ts` says why it is a cell.
 */
const cell = createOpenCell()

export const setNewLocationOpen = cell.set
export const useNewLocationOpen = cell.use
