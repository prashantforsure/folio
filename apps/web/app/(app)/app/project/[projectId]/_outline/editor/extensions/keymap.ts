import type { OutlineNodeType } from '@folio/script'
import { Extension } from '@tiptap/core'
import { history, redo, undo } from '@tiptap/pm/history'

import { typeForDigit, typeForShiftLetter } from '../../../../../../../../lib/outline/keyboard'
import { caretBlock, demoteAtStart, moveBlock, outlineEnter, setBlockTypeAt } from './commands'

/**
 * The keyboard, from `lib/outline/keyboard.ts`'s tables.
 *
 *   ⌘0..⌘3           body and the three headings
 *   ⌘⇧Q / ⌘⇧R / ⌘⇧B  quote, rule, beat
 *   ⌥↑ / ⌥↓          move the caret block
 *   Enter            `outlineEnter`: a transition at the end, a split inside,
 *                    an empty beat ends the list, a rule opens body below
 *   ⇧Enter           swallowed; the union has no soft break
 *   Backspace        at the start of a heading, quote or beat: demote to body
 *   ⌘Z / ⇧⌘Z / ⌘Y    ProseMirror's history, bundled in `@tiptap/pm`
 *
 * Priority 1000 puts these bindings before Tiptap's core keymap (Enter and
 * Backspace defaults); the slash menu sits above this at 1100 so an open
 * menu owns Enter, Tab and the arrows first. Tab is not bound: the outline
 * has no type cycle, and the browser's focus move is left alone.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    outline: {
      setOutlineType: (type: OutlineNodeType) => ReturnType
      outlineEnter: () => ReturnType
      demoteOutlineBlock: () => ReturnType
      moveOutlineBlock: (direction: -1 | 1) => ReturnType
      outlineUndo: () => ReturnType
      outlineRedo: () => ReturnType
    }
  }
}

export const OUTLINE_KEYMAP_PRIORITY = 1000

export const OutlineKeymap = Extension.create({
  name: 'outlineKeymap',
  priority: OUTLINE_KEYMAP_PRIORITY,
  addCommands() {
    return {
      setOutlineType:
        (type) =>
        ({ tr, dispatch }) => {
          const block = caretBlock(tr)
          if (block === null) return false
          return dispatch === undefined ? true : setBlockTypeAt(tr, block.pos, type)
        },
      outlineEnter:
        () =>
        ({ tr, dispatch }) =>
          dispatch === undefined ? caretBlock(tr) !== null : outlineEnter(tr),
      demoteOutlineBlock:
        () =>
        ({ tr, dispatch }) =>
          dispatch === undefined ? caretBlock(tr) !== null : demoteAtStart(tr),
      moveOutlineBlock:
        (direction) =>
        ({ tr, dispatch }) =>
          dispatch === undefined ? caretBlock(tr) !== null : moveBlock(tr, direction),
      outlineUndo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),
      outlineRedo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
    }
  },
  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {
      Enter: () => this.editor.commands.outlineEnter(),
      'Shift-Enter': () => true,
      Backspace: () => this.editor.commands.demoteOutlineBlock(),
      'Alt-ArrowUp': () => this.editor.commands.moveOutlineBlock(-1),
      'Alt-ArrowDown': () => this.editor.commands.moveOutlineBlock(1),
      'Mod-z': () => this.editor.commands.outlineUndo(),
      'Shift-Mod-z': () => this.editor.commands.outlineRedo(),
      'Mod-y': () => this.editor.commands.outlineRedo(),
    }
    for (let digit = 0; digit <= 3; digit += 1) {
      const type = typeForDigit(String(digit))
      if (type !== null) bindings[`Mod-${String(digit)}`] = () => this.editor.commands.setOutlineType(type)
    }
    for (const letter of ['q', 'r', 'b']) {
      const type = typeForShiftLetter(letter)
      if (type !== null) bindings[`Mod-Shift-${letter}`] = () => this.editor.commands.setOutlineType(type)
    }
    return bindings
  },
  addProseMirrorPlugins() {
    return [history()]
  },
})
