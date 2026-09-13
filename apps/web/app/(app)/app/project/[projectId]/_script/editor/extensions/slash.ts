import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { SuggestionMatch, SuggestionProps, Trigger } from '@tiptap/suggestion'
import { Suggestion } from '@tiptap/suggestion'

import type { SlashEntry, SlashMenu } from '../../../../../../../../lib/script/slash'
import { slashMenuFor, slashOpensAt, slashQueryClosed } from '../../../../../../../../lib/script/slash'
import type { EditorStore, SlashView } from '../editor-store'
import { caretBlock, freshBlock, insertBlockAfter, setBlockTypeAt } from './commands'

/**
 * The slash menu, on Tiptap's Suggestion plugin.
 *
 * The plugin owns what the hand-rolled version owned in state: where the
 * `/` is, the query after it (read live from the text), whether Escape
 * dismissed it (a dismissed slash stays dismissed until the caret leaves
 * it), and the caret rectangle every floating surface is anchored to.
 * What this file adds is the model and the rules:
 *
 *   - `findSlashMatch` is `lib/script/slash.ts`'s two predicates over the
 *     text before the caret: a slash is a command only at the start of a
 *     block or after whitespace (`INT./EXT.`, `I/E.`, `24/7` are
 *     punctuation), and a query that has run past the menu - two spaces, or
 *     a space with nothing matching - closes it and leaves the text alone.
 *   - `items` is `slashMenuFor`'s rows, suggested first.
 *   - `command` is the old `applySlash`: the `/` and the query are deleted
 *     (they were a question, not text); an otherwise blank block *becomes*
 *     the type, a block with prose opens one of the type below.
 *
 * Keys: ArrowUp / ArrowDown move the highlight, Enter and Tab pick, and all
 * four are consumed inside ProseMirror's `handleKeyDown` - before the
 * screenplay keymap (priority 1000, this is 1100) and before the browser -
 * so an open menu never splits a block or cycles a type. Escape is the
 * plugin's own. Every other key types, and typing narrows the list. The
 * React menu (`floating/slash-menu.tsx`) has no key listeners at all.
 */

export const slashKey = new PluginKey('screenplaySlash')

export const SLASH_PRIORITY = 1100

/** `slashOpensAt` and `slashQueryClosed`, applied to the last `/` before the caret. */
export const findSlashMatch = ({ $position }: Pick<Trigger, '$position'>): SuggestionMatch => {
  if ($position.depth < 1) return null
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼')
  const at = textBefore.lastIndexOf('/')
  if (at === -1) return null
  if (!slashOpensAt(textBefore.slice(0, at))) return null
  const query = textBefore.slice(at + 1)
  if (slashQueryClosed(query)) return null
  const from = $position.start() + at
  return { range: { from, to: $position.pos }, query, text: textBefore.slice(at) }
}

/** The old `applySlash`, as a transaction: delete the question, then retype in place or open below. */
export const applySlashPick = (editor: Editor, range: Range, entry: SlashEntry): void => {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.delete(range.from, range.to)
      const block = caretBlock(tr)
      if (block === null) return false
      if (block.node.textContent.trim() === '') {
        if (block.node.content.size > 0) tr.delete(block.pos + 1, block.pos + 1 + block.node.content.size)
        return setBlockTypeAt(tr, block.pos, entry.type)
      }
      const below = freshBlock(tr.doc.type.schema, entry.type)
      return below === null ? false : insertBlockAfter(tr, block.pos, below)
    })
    .run()
}

export type SlashOptions = {
  readonly store: EditorStore | null
}

export const ScreenplaySlash = Extension.create<SlashOptions>({
  name: 'screenplaySlash',
  priority: SLASH_PRIORITY,
  addOptions() {
    return { store: null }
  },
  addProseMirrorPlugins() {
    const { store } = this.options
    const { editor } = this
    if (store === null) return []

    let menu: SlashMenu = { sections: [], rows: [] }
    let active = 0
    let query = ''
    let current: SuggestionProps<SlashEntry, SlashEntry> | null = null

    const publish = (): void => {
      if (current === null) {
        store.slash.set(null)
        return
      }
      const props = current
      const view: SlashView = {
        menu,
        query,
        active,
        anchor: () => props.clientRect?.() ?? null,
        onHover: (index) => {
          active = index
          publish()
        },
        onPick: (entry) => {
          props.command(entry)
        },
        onClose: () => {
          editor.view.dispatch(editor.view.state.tr.setMeta(slashKey, { exit: true }))
        },
      }
      store.slash.set(view)
    }

    return [
      Suggestion<SlashEntry, SlashEntry>({
        pluginKey: slashKey,
        editor,
        char: '/',
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: findSlashMatch,
        allow: ({ editor: current_ }) => !current_.view.composing,
        decorationTag: 'span',
        decorationClass: 'folio-slash-query',
        decorationEmptyClass: 'folio-slash-query-empty',
        items: ({ query: q, editor: at }) => [...slashMenuFor(q, caretBlock(at.state)?.type ?? null).rows],
        command: ({ editor: on, range, props: entry }) => {
          applySlashPick(on, range, entry)
        },
        render: () => ({
          onStart: (props) => {
            current = props
            query = props.query
            menu = slashMenuFor(props.query, caretBlock(props.editor.state)?.type ?? null)
            active = 0
            publish()
          },
          onUpdate: (props) => {
            current = props
            if (props.query !== query) active = 0
            query = props.query
            menu = slashMenuFor(props.query, caretBlock(props.editor.state)?.type ?? null)
            publish()
          },
          onExit: () => {
            current = null
            publish()
          },
          onKeyDown: ({ event }) => {
            if (current === null) return false
            const count = menu.rows.length
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (count === 0) return true
              active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
              publish()
              return true
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const entry = menu.rows[active]
              if (entry === undefined) {
                // Nothing matches: the menu closes and the key is the key it always was.
                editor.view.dispatch(editor.view.state.tr.setMeta(slashKey, { exit: true }))
                return false
              }
              current.command(entry)
              return true
            }
            return false
          },
        }),
      }),
    ]
  },
})
