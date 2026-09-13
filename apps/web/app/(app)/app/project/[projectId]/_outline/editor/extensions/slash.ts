import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { SuggestionMatch, SuggestionProps, Trigger } from '@tiptap/suggestion'
import { Suggestion } from '@tiptap/suggestion'

import type { SlashEntry, SlashMenu } from '../../../../../../../../lib/outline/slash'
import { slashMenuFor, slashOpensAt, slashQueryClosed } from '../../../../../../../../lib/outline/slash'
import type { OutlineSlashView, OutlineStore } from '../outline-store'
import { caretBlock, freshBlock, insertBlockAfter, setBlockTypeAt } from './commands'

/**
 * The slash menu, on Tiptap's Suggestion plugin - the Script route's
 * `slash.ts` over `lib/outline/slash.ts`.
 *
 * The plugin owns where the `/` is, the query after it (read live from the
 * text), whether Escape dismissed it, and the caret rectangle the floating
 * menu is anchored to. This file adds the model and the rules:
 *
 *   - `findOutlineSlashMatch`: a slash is a command only at the start of a
 *     block or after whitespace, and a query that has run past the menu
 *     closes it and leaves the text alone. A rule has no text, so no slash
 *     can be typed on one.
 *   - `items` is `slashMenuFor`'s rows.
 *   - `command`: the `/` and the query are deleted; an otherwise blank block
 *     *becomes* the type, a block with prose opens one of the type below.
 *
 * Keys: ArrowUp / ArrowDown move the highlight, Enter and Tab pick, and all
 * four are consumed inside ProseMirror's `handleKeyDown` before the outline
 * keymap (priority 1000, this is 1100) and before the browser. Escape is
 * the plugin's own. The React menu has no key listeners at all.
 */

export const outlineSlashKey = new PluginKey('outlineSlash')

export const OUTLINE_SLASH_PRIORITY = 1100

/** `slashOpensAt` and `slashQueryClosed`, applied to the last `/` before the caret. */
export const findOutlineSlashMatch = ({ $position }: Pick<Trigger, '$position'>): SuggestionMatch => {
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

/** Delete the question, then retype in place or open below. */
export const applyOutlineSlashPick = (editor: Editor, range: Range, entry: SlashEntry): void => {
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

export type OutlineSlashOptions = {
  readonly store: OutlineStore | null
}

export const OutlineSlash = Extension.create<OutlineSlashOptions>({
  name: 'outlineSlash',
  priority: OUTLINE_SLASH_PRIORITY,
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
      const view: OutlineSlashView = {
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
          editor.view.dispatch(editor.view.state.tr.setMeta(outlineSlashKey, { exit: true }))
        },
      }
      store.slash.set(view)
    }

    return [
      Suggestion<SlashEntry, SlashEntry>({
        pluginKey: outlineSlashKey,
        editor,
        char: '/',
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: findOutlineSlashMatch,
        allow: ({ editor: current_ }) => !current_.view.composing,
        decorationTag: 'span',
        decorationClass: 'folio-slash-query',
        decorationEmptyClass: 'folio-slash-query-empty',
        items: ({ query: q }) => [...slashMenuFor(q).rows],
        command: ({ editor: on, range, props: entry }) => {
          applyOutlineSlashPick(on, range, entry)
        },
        render: () => ({
          onStart: (props) => {
            current = props
            query = props.query
            menu = slashMenuFor(props.query)
            active = 0
            publish()
          },
          onUpdate: (props) => {
            current = props
            if (props.query !== query) active = 0
            query = props.query
            menu = slashMenuFor(props.query)
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
                editor.view.dispatch(editor.view.state.tr.setMeta(outlineSlashKey, { exit: true }))
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
