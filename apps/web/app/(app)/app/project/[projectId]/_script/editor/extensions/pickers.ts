import type { MentionLabel, ScreenplayNodeType } from '@folio/script'
import { readSlugline } from '@folio/script'
import { Extension, posToDOMRect } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { ENTER_TRANSITION } from '../../../../../../../../lib/script/keyboard'
import type { CommitPlan, PickerChoice, PickerKind, PickerModel, PickerNames } from '../../../../../../../../lib/script/pickers'
import { bareCue, isPickerKind, pickerFor, planCommit, planTab } from '../../../../../../../../lib/script/pickers'
import { blockAttrsOf, blockTypeOf } from '../../../../../../../../lib/script/pm-model'
import type { EditorStore, PickerView } from '../editor-store'
import { freshBlock, insertBlockAfter } from './commands'
import { mentionKey } from './mention-suggestion'
import { SLASH_PRIORITY, slashKey } from './slash'

/**
 * The block selectors - a Scene heading's three stages, a Character cue, a
 * Transition - as a plugin whose state is *derived* from the caret block.
 *
 * The selector is a function of a snapshot of the caret block - its type,
 * its text, whether the caret is at its end - and three small pieces of
 * state a writer sets: `dismissed` (Escape hid this selector for this block
 * until the caret leaves), `edit` (a click on a pill reopened that segment's
 * selector over its text), and `highlight` (the row the arrows moved to,
 * keyed on the query it was made in so a new query starts from the
 * default). So there is no open/close state to get wrong: it is on screen
 * exactly while the text is in a state it can help with. What a pick
 * inserts is plain text into the block; the node stays the union's.
 *
 * The rules are `lib/script/pickers.ts` (`pickerFor`, `planCommit`,
 * `planTab`), unchanged from the Slate editor. This file resolves offsets
 * to positions, handles the keys inside ProseMirror - after the slash and
 * the `@` combobox, which own the same keys while they are open, and before
 * the screenplay keymap - and publishes the view to the store.
 */

export const pickerKey = new PluginKey<PickerState>('screenplayPickers')

type Named = { readonly blockId: string; readonly kind: PickerKind }
type Highlight = { readonly key: string; readonly index: number }

type Derived = {
  readonly model: PickerModel
  readonly blockId: string
  readonly blockPos: number
  readonly type: ScreenplayNodeType
  /** The segment's start and end, as positions. Composing ends at the block's very end. */
  readonly from: number
  readonly to: number
}

type PickerState = {
  readonly dismissed: Named | null
  readonly edit: Named | null
  readonly highlight: Highlight | null
  readonly derived: Derived | null
}

type PickerMeta = {
  readonly dismissed?: Named | null
  readonly edit?: Named | null
  readonly highlight?: Highlight | null
}

type Snapshot = {
  readonly blockId: string
  readonly pos: number
  readonly index: number
  readonly node: ProseMirrorNode
  readonly type: ScreenplayNodeType
  readonly text: string
  readonly caretAtEnd: boolean
}

const snapshotOf = (state: EditorState): Snapshot | null => {
  const $from = state.selection.$from
  if ($from.depth < 1) return null
  const node = $from.node(1)
  const type = blockTypeOf(node)
  if (type === null) return null
  return {
    blockId: blockAttrsOf(node).id ?? '',
    pos: $from.before(1),
    index: $from.index(0),
    node,
    type,
    text: node.textContent,
    caretAtEnd: state.selection.empty && $from.parentOffset === node.content.size,
  }
}

/** A text-only offset (what the model indexes) to a position; mentions are skipped, as `textContent` skips them. */
const textOffsetToPos = (block: ProseMirrorNode, pos: number, offset: number): number => {
  let remaining = offset
  let last = pos + 1
  let found: number | null = null
  block.forEach((child, childOffset) => {
    if (found !== null || !child.isText) return
    const length = child.text?.length ?? 0
    if (remaining <= length) {
      found = pos + 1 + childOffset + remaining
      return
    }
    remaining -= length
    last = pos + 1 + childOffset + length
  })
  return found ?? last
}

/**
 * The names the selectors draw from: what the script already says, nearest
 * the caret first, then the records. A cue two blocks up is the likeliest
 * next speaker; a location record that has not been used yet is still
 * offered. The current block is left out - its own text is the query.
 */
const namesAround = (
  doc: ProseMirrorNode,
  current: Snapshot,
  labels: readonly MentionLabel[],
  want: 'characters' | 'locations',
): PickerNames => {
  const found: string[] = []
  const visit = (index: number): void => {
    const block = doc.maybeChild(index)
    if (block === null || index === current.index) return
    if (want === 'characters' && block.type.name === 'character') {
      const cue = bareCue(block.textContent)
      if (cue !== '') found.push(cue)
    }
    if (want === 'locations' && block.type.name === 'scene') {
      const read = readSlugline(block.textContent)
      if (read.ok && read.value.set !== '') found.push(read.value.set)
    }
  }
  for (let index = current.index - 1; index >= 0; index -= 1) visit(index)
  for (let index = current.index + 1; index < doc.childCount; index += 1) visit(index)
  const entity = want === 'characters' ? 'character' : 'location'
  for (const label of labels) if (label.entity === entity) found.push(label.label)
  return want === 'characters' ? { characters: found, locations: [] } : { characters: [], locations: found }
}

const deriveFor = (
  state: EditorState,
  edit: Named | null,
  dismissed: Named | null,
  labels: readonly MentionLabel[],
): Derived | null => {
  const snapshot = snapshotOf(state)
  if (snapshot === null) return null
  const reopen = edit !== null && edit.blockId === snapshot.blockId ? edit.kind : undefined
  if (reopen === undefined && !snapshot.caretAtEnd) return null
  const names =
    snapshot.type === 'character'
      ? namesAround(state.doc, snapshot, labels, 'characters')
      : snapshot.type === 'scene'
        ? namesAround(state.doc, snapshot, labels, 'locations')
        : { characters: [], locations: [] }
  const model = pickerFor({ type: snapshot.type, text: snapshot.text, caretAtEnd: snapshot.caretAtEnd }, names, reopen)
  if (model === null) return null
  if (reopen === undefined && dismissed !== null && dismissed.blockId === snapshot.blockId && dismissed.kind === model.kind) return null
  const from = textOffsetToPos(snapshot.node, snapshot.pos, model.segmentStart)
  const to = model.mode === 'compose' ? snapshot.pos + 1 + snapshot.node.content.size : textOffsetToPos(snapshot.node, snapshot.pos, model.segmentEnd)
  return { model, blockId: snapshot.blockId, blockPos: snapshot.pos, type: snapshot.type, from, to }
}

const sameDerived = (a: Derived | null, b: Derived | null): boolean => {
  if (a === b) return true
  if (a === null || b === null) return false
  return (
    a.blockId === b.blockId &&
    a.from === b.from &&
    a.to === b.to &&
    a.model.kind === b.model.kind &&
    a.model.mode === b.model.mode &&
    a.model.query === b.model.query &&
    a.model.choices.length === b.model.choices.length &&
    a.model.choices.every((choice, index) => choice.text === b.model.choices[index]?.text)
  )
}

const highlightKeyOf = (derived: Derived): string => `${derived.model.kind}:${derived.model.query}`

const activeIndexOf = (derived: Derived, highlight: Highlight | null): number =>
  highlight !== null && highlight.key === highlightKeyOf(derived) ? highlight.index : derived.model.defaultActive

/**
 * Apply a plan: the segment becomes the plan's text, the caret lands after
 * it, and when the plan says so the block Enter would create opens below,
 * selected, or the edit moves on to the heading's next segment.
 */
const commitPlan = (state: EditorState, derived: Derived, plan: CommitPlan): Transaction => {
  const tr = state.tr
  if (derived.from !== derived.to) tr.delete(derived.from, derived.to)
  tr.insertText(plan.text, derived.from)
  tr.setSelection(TextSelection.create(tr.doc, derived.from + plan.text.length))
  if (plan.then === 'next-block') {
    const next = freshBlock(tr.doc.type.schema, ENTER_TRANSITION[derived.type])
    if (next !== null) insertBlockAfter(tr, derived.blockPos, next)
  }
  const meta: PickerMeta = {
    highlight: null,
    edit: plan.then === 'next-segment' && derived.model.next !== null ? { blockId: derived.blockId, kind: derived.model.next.kind } : null,
  }
  return tr.setMeta(pickerKey, meta)
}

export type PickerOptions = {
  readonly store: EditorStore | null
  readonly labels: () => readonly MentionLabel[]
}

const anotherMenuIsOpen = (state: EditorState): boolean => {
  const slash = slashKey.getState(state) as { active?: boolean } | undefined
  const mention = mentionKey.getState(state) as { active?: boolean } | undefined
  return slash?.active === true || mention?.active === true
}

export const ScreenplayPickers = Extension.create<PickerOptions>({
  name: 'screenplayPickers',
  // Below the slash and the `@` combobox, which own Enter, Tab and the arrows while open; above the keymap.
  priority: SLASH_PRIORITY - 1,
  addOptions() {
    return { store: null, labels: () => [] }
  },
  addProseMirrorPlugins() {
    const { store, labels } = this.options
    if (store === null) return []

    const setMeta = (view: EditorView, meta: PickerMeta): void => {
      view.dispatch(view.state.tr.setMeta(pickerKey, meta))
    }

    let published: { readonly derived: Derived | null; readonly active: number; readonly hidden: boolean } | null = null

    return [
      new Plugin<PickerState>({
        key: pickerKey,
        state: {
          init: (_config, state) => ({
            dismissed: null,
            edit: null,
            highlight: null,
            derived: deriveFor(state, null, null, labels()),
          }),
          apply: (tr, previous, _old, state) => {
            const meta = tr.getMeta(pickerKey) as PickerMeta | undefined
            if (meta === undefined && !tr.docChanged && !tr.selectionSet) return previous
            let { dismissed, edit, highlight } = previous
            if (meta?.dismissed !== undefined) dismissed = meta.dismissed
            if (meta?.edit !== undefined) edit = meta.edit
            if (meta?.highlight !== undefined) highlight = meta.highlight
            const blockId = snapshotOf(state)?.blockId ?? null
            if (dismissed !== null && dismissed.blockId !== blockId) dismissed = null
            if (edit !== null && edit.blockId !== blockId) edit = null
            const derived = deriveFor(state, edit, dismissed, labels())
            return { dismissed, edit, highlight, derived: sameDerived(previous.derived, derived) ? previous.derived : derived }
          },
        },
        props: {
          handleKeyDown: (view, event) => {
            const current = pickerKey.getState(view.state)
            const derived = current?.derived ?? null
            if (current === undefined || derived === null || event.metaKey || event.ctrlKey) return false
            if (anotherMenuIsOpen(view.state)) return false
            const count = derived.model.choices.length
            const active = activeIndexOf(derived, current.highlight)
            const choice: PickerChoice | undefined = active >= 0 ? derived.model.choices[active] : undefined
            if (event.key === 'Escape') {
              if (derived.model.mode === 'edit') setMeta(view, { edit: null })
              else setMeta(view, { dismissed: { blockId: derived.blockId, kind: derived.model.kind } })
              return true
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (count === 0) return true
              const step = event.key === 'ArrowDown' ? 1 : count - 1
              const from = active < 0 ? (event.key === 'ArrowDown' ? -1 : 0) : active
              setMeta(view, { highlight: { key: highlightKeyOf(derived), index: (from + step + count) % count } })
              return true
            }
            if (event.key === 'Enter' && !event.shiftKey && choice !== undefined) {
              view.dispatch(commitPlan(view.state, derived, planCommit(derived.model, choice)))
              return true
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              const plan = planTab(derived.model, choice)
              if (plan === null) return false
              view.dispatch(commitPlan(view.state, derived, plan))
              return true
            }
            // Anything else - a letter, Backspace, an arrow sideways - is typing, and narrows the list.
            return false
          },
          handleClick: (view, _pos, event) => {
            // A click on a pill reopens that segment's selector; a click anywhere else closes one.
            const target = event.target instanceof Element ? event.target : null
            const pill = target?.closest('[data-pill]') ?? null
            const kind = pill?.getAttribute('data-pill') ?? null
            const blockId = pill?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
            if (kind !== null && blockId !== null && isPickerKind(kind)) {
              setMeta(view, { edit: { blockId, kind }, highlight: null })
              return false
            }
            if (pickerKey.getState(view.state)?.edit !== null) setMeta(view, { edit: null })
            return false
          },
        },
        view: (view) => {
          const publish = (current: EditorView): void => {
            const state = pickerKey.getState(current.state)
            const derived = state?.derived ?? null
            const hidden = anotherMenuIsOpen(current.state)
            const active = derived === null ? -1 : activeIndexOf(derived, state?.highlight ?? null)
            if (published !== null && published.derived === derived && published.active === active && published.hidden === hidden) return
            published = { derived, active, hidden }
            if (derived === null || hidden) {
              store.picker.set(null)
              return
            }
            const at = derived
            const picker: PickerView = {
              model: at.model,
              active,
              anchor: () => posToDOMRect(current, at.from, at.from),
              onHover: (index) => {
                setMeta(current, { highlight: { key: highlightKeyOf(at), index } })
              },
              onPick: (choice) => {
                current.dispatch(commitPlan(current.state, at, planCommit(at.model, choice)))
                current.focus()
              },
              onClose: () => {
                setMeta(current, { dismissed: { blockId: at.blockId, kind: at.model.kind } })
              },
            }
            store.picker.set(picker)
          }
          publish(view)
          return {
            update: publish,
            destroy: () => {
              store.picker.set(null)
            },
          }
        },
      }),
    ]
  },
})
