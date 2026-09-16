import type { MentionEntity, MentionLabel, ScreenplayNodeType } from '@folio/script'
import { useSyncExternalStore } from 'react'

import type { PickerChoice, PickerModel } from '../../../../../../../lib/script/pickers'
import type { SlashEntry, SlashMenu } from '../../../../../../../lib/script/slash'

/**
 * What React is told about the editor - and the only thing it is told.
 *
 * The document lives in the Tiptap editor, not in React state: a keystroke
 * is a ProseMirror transaction and a DOM patch, and no component renders
 * for it. What the chrome needs is small and changes rarely, and each piece
 * is its own slice here so a component subscribes to exactly what it draws:
 * the toolbar to the caret block, the thread cards to their hosts, a menu to
 * its own view. `useSlice` is `useSyncExternalStore` over one slice; a set
 * that does not change the value is not a notification.
 *
 * The floating surfaces - slash menu, `@` combobox, block selector - are
 * views the extensions publish (`extensions/slash.ts`, `mention-suggestion.ts`,
 * `pickers.ts`) and React components draw (`floating/`). The keys that move
 * through them are handled inside ProseMirror; the components only report
 * a hover or a click back through the callbacks each view carries.
 */

export type Slice<T> = {
  readonly get: () => T
  readonly set: (next: T) => void
  readonly subscribe: (listener: () => void) => () => void
}

/** One slice. Exported so the Outline editor's store (`_outline/editor/outline-store.ts`) is built from the same cell. */
export const slice = <T>(initial: T, same: (a: T, b: T) => boolean = Object.is): Slice<T> => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (same(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type CaretInfo = {
  readonly blockId: string | null
  readonly type: ScreenplayNodeType | null
}

/**
 * Where the thread cards and the new-thread composer are drawn: elements the
 * decorations plugin creates inside the editor's DOM, keyed by thread id (or
 * `composer`), that React portals into. A new map on every change, so a
 * subscriber sees it.
 */
export type HostMap = ReadonlyMap<string, HTMLElement>

/** The `+` handle's menu: which block it was pressed on, and where. */
export type HandleMenuView = {
  readonly nodeId: string
  readonly pos: number
  readonly anchor: Anchor
}

/** Where a floating surface is anchored: the rect of the query, the segment, the caret - in viewport pixels. */
export type Anchor = () => DOMRect | null

export type SlashView = {
  readonly menu: SlashMenu
  readonly query: string
  readonly active: number
  readonly anchor: Anchor
  readonly onHover: (index: number) => void
  readonly onPick: (entry: SlashEntry) => void
  readonly onClose: () => void
}

export type MentionChoice =
  | { readonly kind: 'label'; readonly label: MentionLabel }
  | { readonly kind: 'create'; readonly entity: MentionEntity; readonly name: string }

export type MentionView = {
  readonly query: string
  readonly choices: readonly MentionChoice[]
  readonly active: number
  readonly busy: boolean
  readonly anchor: Anchor
  readonly onHover: (index: number) => void
  readonly onPick: (choice: MentionChoice) => void
  readonly onClose: () => void
}

export type PickerView = {
  readonly model: PickerModel
  readonly active: number
  readonly anchor: Anchor
  readonly onHover: (index: number) => void
  readonly onPick: (choice: PickerChoice) => void
  readonly onClose: () => void
}

export type EditorStore = {
  readonly caret: Slice<CaretInfo>
  /** Block ids in document order; a new array only when the structure changed. */
  readonly ids: Slice<readonly string[]>
  readonly hosts: Slice<HostMap>
  readonly handleMenu: Slice<HandleMenuView | null>
  /** Bumped on every document change; the workspace's autosave listens to this. */
  readonly version: Slice<number>
  readonly slash: Slice<SlashView | null>
  readonly mention: Slice<MentionView | null>
  readonly picker: Slice<PickerView | null>
}

const sameCaret = (a: CaretInfo, b: CaretInfo): boolean => a.blockId === b.blockId && a.type === b.type

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a === b || (a.length === b.length && a.every((id, index) => id === b[index]))

export const createEditorStore = (ids: readonly string[]): EditorStore => ({
  caret: slice<CaretInfo>({ blockId: null, type: null }, sameCaret),
  ids: slice(ids, sameIds),
  hosts: slice<HostMap>(new Map()),
  handleMenu: slice<HandleMenuView | null>(null),
  version: slice(0),
  slash: slice<SlashView | null>(null),
  mention: slice<MentionView | null>(null),
  picker: slice<PickerView | null>(null),
})

export const useSlice = <T>(target: Slice<T>): T => useSyncExternalStore(target.subscribe, target.get, target.get)
