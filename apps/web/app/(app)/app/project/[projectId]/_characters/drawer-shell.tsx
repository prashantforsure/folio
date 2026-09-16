'use client'

import type { ComponentProps } from 'react'

import { DrawerShell as SharedDrawerShell } from '../_chrome/drawer-shell'

/**
 * The Characters drawer's frame is the shared one - `_chrome/drawer-shell.tsx`,
 * moved there when the Research pass needed the same frame (2026-09-16) -
 * bound to this route's slot (`#characters-drawer`, `_chrome/characters-layout.tsx`).
 * `Field` and `Section` are re-exported unchanged, so this route's drawers
 * import what they always did.
 */
export const DrawerShell = (props: Omit<ComponentProps<typeof SharedDrawerShell>, 'route'>) => (
  <SharedDrawerShell route="characters" {...props} />
)

export { Field, Section } from '../_chrome/drawer-shell'
