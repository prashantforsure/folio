import type { ScreenplayNodeType } from '@folio/script'
import { Extension, InputRule } from '@tiptap/core'
import { history, redo, undo } from '@tiptap/pm/history'

import { nextInTabCycle, promotesToHeading, typeForDigit } from '../../../../../../../../lib/script/keyboard'
import { caretBlock, screenplayEnter, setBlockTypeAt } from './commands'

/**
 * The keyboard, from `lib/script/keyboard.ts`'s tables.
 *
 *   ⌘1..⌘8       the eight types, in the bundle's order
 *   Tab / ⇧Tab   the type cycle - Action, Character, Dialogue, Paren; never Comment
 *   Enter        `screenplayEnter`: a transition at the end, a split inside
 *   ⇧Enter       swallowed; the union has no soft break
 *   `INT.` &c.   an Action line that has just become a heading prefix is a Scene
 *   `(`          on an empty Dialogue line opens a Parenthetical
 *   ⌘Z / ⇧⌘Z     ProseMirror's history, bundled in `@tiptap/pm`
 *
 * The two promotions are input rules, which run on text input and not on
 * `keydown`: they see the character as typed, after composition, and never
 * inside an IME sequence. A rule that fires must insert the character
 * itself - Tiptap consumes the input when a rule handles it.
 *
 * Priority 1000 puts these bindings before Tiptap's core keymap (Enter and
 * Backspace defaults); the slash and the selectors sit above this at 1100
 * so an open menu owns Enter, Tab and the arrows first.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplay: {
      setScreenplayType: (type: ScreenplayNodeType) => ReturnType
      cycleScreenplayType: (backwards: boolean) => ReturnType
      screenplayEnter: () => ReturnType
      undo: () => ReturnType
      redo: () => ReturnType
    }
  }
}

export const KEYMAP_PRIORITY = 1000

export const ScreenplayKeymap = Extension.create({
  name: 'screenplayKeymap',
  priority: KEYMAP_PRIORITY,
  addCommands() {
    return {
      setScreenplayType:
        (type) =>
        ({ tr, dispatch }) => {
          const block = caretBlock(tr)
          if (block === null) return false
          return dispatch === undefined ? true : setBlockTypeAt(tr, block.pos, type)
        },
      cycleScreenplayType:
        (backwards) =>
        ({ tr, dispatch }) => {
          const block = caretBlock(tr)
          if (block === null) return false
          return dispatch === undefined ? true : setBlockTypeAt(tr, block.pos, nextInTabCycle(block.type, backwards))
        },
      screenplayEnter:
        () =>
        ({ tr, dispatch }) =>
          dispatch === undefined ? caretBlock(tr) !== null : screenplayEnter(tr),
      undo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),
      redo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
    }
  },
  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {
      Tab: () => this.editor.commands.cycleScreenplayType(false),
      'Shift-Tab': () => this.editor.commands.cycleScreenplayType(true),
      Enter: () => this.editor.commands.screenplayEnter(),
      'Shift-Enter': () => true,
      'Mod-z': () => this.editor.commands.undo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
      'Mod-y': () => this.editor.commands.redo(),
    }
    for (let digit = 1; digit <= 8; digit += 1) {
      const type = typeForDigit(String(digit))
      if (type !== null) bindings[`Mod-${String(digit)}`] = () => this.editor.commands.setScreenplayType(type)
    }
    return bindings
  },
  addInputRules() {
    return [
      // `INT.` typed on an Action line: the `.` is inserted and the block is a Scene.
      new InputRule({
        find: (text) => (promotesToHeading(text) ? { index: 0, text } : null),
        handler: ({ state, match, chain }) => {
          const block = caretBlock(state)
          if (block === null || block.type !== 'action') return null
          const typedCharacter = match[0].slice(-1)
          chain()
            .insertContent(typedCharacter)
            .command(({ tr }) => setBlockTypeAt(tr, block.pos, 'scene'))
            .run()
          return undefined
        },
      }),
      // `(` where a line was due is a parenthetical, as Final Draft reads it.
      new InputRule({
        find: /^\($/u,
        handler: ({ state, chain }) => {
          const block = caretBlock(state)
          if (block === null || block.type !== 'dialogue' || block.node.content.size !== 0) return null
          chain()
            .command(({ tr }) => setBlockTypeAt(tr, block.pos, 'paren'))
            .run()
          return undefined
        },
      }),
    ]
  },
  addProseMirrorPlugins() {
    return [history()]
  },
})
