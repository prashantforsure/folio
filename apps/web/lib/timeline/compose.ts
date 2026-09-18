import { createOpenCell } from '../workspace/open-cell'

/**
 * Whether the sidebar's `New thread` editor is open. Two doors open it -
 * the sidebar's `+` in the title row and the empty group's line - and the
 * title row and the group are two components in the layout's card with no
 * channel between them, so the flag is one cell both reach
 * (`lib/workspace/open-cell.ts`, Locations' shape).
 */
const newThread = createOpenCell()

export const setNewThreadOpen = newThread.set
export const useNewThreadOpen = newThread.use
