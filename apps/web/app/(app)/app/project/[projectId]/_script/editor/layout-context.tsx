'use client'

import type { MentionEntity, SheetSpec } from '@folio/script'
import { createContext, useContext } from 'react'

import type { SheetLayout } from '../../../../../../../lib/script/layout'

/**
 * What every block on the sheet needs to draw itself, handed down once.
 *
 * `layout` is the record turned into margins and gaps (`lib/script/layout.ts`);
 * `sheet` is the geometry the engine resolved; `labelFor` is the mention
 * label book, because a mention stores no label. A block reads its own row
 * out of `layout.blocks` by id. Nothing here is a colour.
 */
export type SheetContextValue = {
  readonly layout: SheetLayout
  readonly sheet: SheetSpec
  readonly labelFor: (entity: MentionEntity, id: string) => string | undefined
  /** The block the caret is in, for the element chip. */
  readonly caretBlockId: string | null
}

export const SheetContext = createContext<SheetContextValue | null>(null)

export const useSheet = (): SheetContextValue => {
  const value = useContext(SheetContext)
  if (value === null) throw new Error('Folio: a sheet block rendered outside SheetContext.')
  return value
}
