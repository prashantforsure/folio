import type { MentionEntity, MentionLabel } from '@folio/script'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { SuggestionMatch, SuggestionProps, Trigger } from '@tiptap/suggestion'
import { Suggestion } from '@tiptap/suggestion'

import { MENTION_TYPE } from '../../../../../../../../lib/script/inline'
import type { EditorStore, MentionChoice, MentionView } from '../editor-store'
import { caretBlock } from './commands'
import { SLASH_PRIORITY } from './slash'

/**
 * The `@` combobox, on the same Suggestion plugin as the slash menu.
 *
 * Existing records first, filtered by the query; then "New character" and
 * "New location" for a name that matches nothing, which is how a person who
 * is discussed but never speaks gets a record. Creation is a server action
 * the workspace provides; the mention is inserted only once the id exists.
 * What is inserted is the `mention` atom - `{ entity, id }`, the edge
 * `derive` reads - and the label is the record's name at render time.
 *
 * Not in a Comment: a note is prose about the script, not part of it. A
 * query that runs past two spaces has left the combobox behind.
 */

export const mentionKey = new PluginKey('screenplayMention')

/** The last `@` before the caret, at the start of the block or after whitespace; closed after two spaces. */
export const findMentionMatch = ({ $position }: Pick<Trigger, '$position'>): SuggestionMatch => {
  if ($position.depth < 1) return null
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼')
  const at = textBefore.lastIndexOf('@')
  if (at === -1) return null
  const before = textBefore.slice(0, at)
  if (before !== '' && !/\s$/u.test(before)) return null
  const query = textBefore.slice(at + 1)
  if (/\s{2,}/u.test(query)) return null
  return { range: { from: $position.start() + at, to: $position.pos }, query, text: textBefore.slice(at) }
}

const choicesFor = (labels: readonly MentionLabel[], query: string): readonly MentionChoice[] => {
  const needle = query.trim().toLowerCase()
  const matching = labels
    .filter((label) => needle === '' || label.label.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((label): MentionChoice => ({ kind: 'label', label }))
  const exact = labels.some((label) => label.label.toLowerCase() === needle)
  const name = query.trim()
  const creates: MentionChoice[] =
    name === '' || exact
      ? []
      : [
          { kind: 'create', entity: 'character', name },
          { kind: 'create', entity: 'location', name },
        ]
  return [...matching, ...creates]
}

export const insertMention = (editor: Editor, range: Range, label: MentionLabel): void => {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const type = tr.doc.type.schema.nodes[MENTION_TYPE]
      if (type === undefined) return false
      tr.replaceWith(range.from, range.to, type.create({ entity: label.entity, id: label.id }))
      return true
    })
    .run()
}

export type MentionSuggestionOptions = {
  readonly store: EditorStore | null
  /** The label book as the workspace currently holds it. Read on every update, never copied. */
  readonly labels: () => readonly MentionLabel[]
  readonly onCreate: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
}

export const ScreenplayMentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: 'screenplayMentionSuggestion',
  priority: SLASH_PRIORITY,
  addOptions() {
    return { store: null, labels: () => [], onCreate: () => Promise.resolve(null) }
  },
  addProseMirrorPlugins() {
    const { store, labels, onCreate } = this.options
    const { editor } = this
    if (store === null) return []

    let choices: readonly MentionChoice[] = []
    let active = 0
    let busy = false
    let query = ''
    let current: SuggestionProps<MentionChoice, MentionChoice> | null = null

    const exit = (): void => {
      editor.view.dispatch(editor.view.state.tr.setMeta(mentionKey, { exit: true }))
    }

    const choose = (choice: MentionChoice): void => {
      if (current === null) return
      const { range } = current
      if (choice.kind === 'label') {
        insertMention(editor, range, choice.label)
        return
      }
      busy = true
      publish()
      void onCreate(choice.entity, choice.name)
        .then((created) => {
          if (created !== null && current !== null) insertMention(editor, current.range, created)
        })
        .finally(() => {
          busy = false
          publish()
        })
    }

    const publish = (): void => {
      if (current === null) {
        store.mention.set(null)
        return
      }
      const props = current
      const view: MentionView = {
        query,
        choices,
        active,
        busy,
        anchor: () => props.clientRect?.() ?? null,
        onHover: (index) => {
          active = index
          publish()
        },
        onPick: choose,
        onClose: exit,
      }
      store.mention.set(view)
    }

    return [
      Suggestion<MentionChoice, MentionChoice>({
        pluginKey: mentionKey,
        editor,
        char: '@',
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: findMentionMatch,
        allow: ({ editor: at }) => !at.view.composing && caretBlock(at.state)?.type !== 'comment',
        decorationTag: 'span',
        decorationClass: 'folio-mention-query',
        items: ({ query: q }) => [...choicesFor(labels(), q)],
        command: ({ props: choice }) => {
          choose(choice)
        },
        render: () => ({
          onStart: (props) => {
            current = props
            query = props.query
            choices = choicesFor(labels(), props.query)
            active = 0
            publish()
          },
          onUpdate: (props) => {
            current = props
            if (props.query !== query) active = 0
            query = props.query
            choices = choicesFor(labels(), props.query)
            publish()
          },
          onExit: () => {
            current = null
            publish()
          },
          onKeyDown: ({ event }) => {
            if (current === null) return false
            const count = choices.length
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (count === 0) return true
              active = (active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
              publish()
              return true
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const choice = choices[active]
              if (choice === undefined) return true
              choose(choice)
              return true
            }
            return false
          },
        }),
      }),
    ]
  },
})
