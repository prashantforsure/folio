import type { OutlineNode, OutlineNodeType } from '@folio/script'

import type { OutlineShape } from '../../../../../../../lib/outline/pm-model'
import { sameShape } from '../../../../../../../lib/outline/pm-model'
import type { SlashEntry, SlashMenu } from '../../../../../../../lib/outline/slash'
import type { Anchor, Slice } from '../../_script/editor/editor-store'
import { slice } from '../../_script/editor/editor-store'

/**
 * What React is told about the outline editor - and the only thing it is
 * told. The Script route's `editor-store.ts`, over what this route's chrome
 * draws.
 *
 * The document lives in the Tiptap editor, not in React state: a keystroke
 * is a ProseMirror transaction and a DOM patch, and no component renders
 * for it. Each piece the chrome needs is its own slice so a component
 * subscribes to exactly what it draws: the status bar to the caret block
 * and the shape, the panel to the shape, the slash menu to its own view.
 * A set that does not change the value is not a notification.
 */

export type OutlineCaret = {
  readonly blockId: string | null
  readonly type: OutlineNodeType | null
}

export type OutlineSlashView = {
  readonly menu: SlashMenu
  readonly query: string
  readonly active: number
  readonly anchor: Anchor
  readonly onHover: (index: number) => void
  readonly onPick: (entry: SlashEntry) => void
  readonly onClose: () => void
}

export type OutlineStore = {
  readonly caret: Slice<OutlineCaret>
  /** Block ids in document order; a new array only when the structure changed. */
  readonly ids: Slice<readonly string[]>
  /** The counts the status bar and the panel print; a new value only when a count moved. */
  readonly shape: Slice<OutlineShape>
  /** Bumped on every document change; the workspace's autosave listens to this. */
  readonly version: Slice<number>
  readonly slash: Slice<OutlineSlashView | null>
}

const sameCaret = (a: OutlineCaret, b: OutlineCaret): boolean => a.blockId === b.blockId && a.type === b.type

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a === b || (a.length === b.length && a.every((id, index) => id === b[index]))

/** The shape as the server sent it: what the chrome draws until the editor exists and counts for itself. */
export const initialShape = (nodes: readonly OutlineNode[], words: number): OutlineShape => ({
  blockCount: nodes.length,
  acts: nodes.filter((node) => node.type === 'h1').length,
  beats: nodes.filter((node) => node.type === 'beat').length,
  words,
})

export const createOutlineStore = (nodes: readonly OutlineNode[], shape: OutlineShape): OutlineStore => ({
  caret: slice<OutlineCaret>({ blockId: null, type: null }, sameCaret),
  ids: slice<readonly string[]>(
    nodes.map((node) => node.id as string),
    sameIds,
  ),
  shape: slice(shape, sameShape),
  version: slice(0),
  slash: slice<OutlineSlashView | null>(null),
})

export { useSlice } from '../../_script/editor/editor-store'
