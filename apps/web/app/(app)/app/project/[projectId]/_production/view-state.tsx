'use client'

import { createCell } from '../../../../../../lib/workspace/open-cell'

/**
 * What the header's settings chip and the route body share, outside either
 * tree - the Storyboard's cell shape (`_storyboard/view-state.tsx`). The
 * chip (in the header the layout renders) reads the current art style's
 * name and opens the modal; the workspace (the page) publishes the name
 * and draws the modal. Both are client state by nature: the modal is not
 * an address, and the URL stays `/production` (AGENTS.md's exception
 * table). Reset when the workspace unmounts so another episode's page
 * does not open on a stale name.
 *
 * `setupOpen` starts `false` on the server; the workspace opens it on
 * mount for a fresh episode (the spec's `setupOpen: true` first-run state).
 */
export const setupOpenCell = createCell<boolean>(false)

export const artStyleNameCell = createCell<string | null>(null)

export const openSetup = (): void => {
  setupOpenCell.set(true)
}

export const closeSetup = (): void => {
  setupOpenCell.set(false)
}

export const resetProductionState = (): void => {
  setupOpenCell.set(false)
  artStyleNameCell.set(null)
}
