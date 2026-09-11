'use client'

import type { MentionEntity, MentionLabel } from '@folio/script'
import type { Path } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import { useEffect, useMemo, useState } from 'react'

/**
 * The `@` combobox. Ours, not Plate's: `@platejs/mention` is not installed,
 * because its node shape (`{ type: 'mention', value }`) is not the union's
 * structural reference. What this inserts is `slate-model.ts`'s
 * `ScriptMentionElement` - `{ entity, id }` - which `fromSlateValue` turns
 * into the `InlineRun` mention `derive` reads as an edge. The mention is the
 * link; the label is the record's name at render time.
 *
 * Existing records first, filtered by the query; then "New character" and
 * "New location" for a name that matches nothing, which is how a person who
 * is discussed but never speaks gets a record (the brief). Creation is a
 * server action; the mention is inserted only once the id exists.
 *
 * Keys arrive from the editor's `onKeyDown` as a window event, because the
 * editable keeps focus and the list never takes it.
 */

export type MentionQuery = {
  readonly blockPath: Path
  readonly textPath: Path
  /** Offset in the text node after the `@`. */
  readonly start: number
  readonly query: string
}

type Choice =
  | { readonly kind: 'label'; readonly label: MentionLabel }
  | { readonly kind: 'create'; readonly entity: MentionEntity; readonly name: string }

const ENTITY_GLYPH: Readonly<Record<MentionEntity, string>> = { character: '◍', location: '⌖' }

export const MentionCombobox = ({
  editor,
  query,
  labels,
  onPick,
  onCreate,
  onClose,
}: {
  readonly editor: PlateEditor
  readonly query: MentionQuery
  readonly labels: readonly MentionLabel[]
  readonly onPick: (label: MentionLabel) => void
  readonly onCreate: (entity: MentionEntity, name: string) => Promise<void>
  readonly onClose: () => void
}) => {
  const needle = query.query.trim().toLowerCase()
  const choices = useMemo<readonly Choice[]>(() => {
    const matching = labels
      .filter((label) => needle === '' || label.label.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((label): Choice => ({ kind: 'label', label }))
    const exact = labels.some((label) => label.label.toLowerCase() === needle)
    const name = query.query.trim()
    const creates: Choice[] =
      name === '' || exact
        ? []
        : [
            { kind: 'create', entity: 'character', name },
            { kind: 'create', entity: 'location', name },
          ]
    return [...matching, ...creates]
  }, [labels, needle, query.query])

  const [active, setActive] = useState(0)
  useEffect(() => {
    setActive(0)
  }, [needle])

  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const choose = (choice: Choice | undefined): void => {
      if (choice === undefined) return
      if (choice.kind === 'label') {
        onPick(choice.label)
        return
      }
      setBusy(true)
      void onCreate(choice.entity, choice.name).finally(() => {
        setBusy(false)
      })
    }
    const onKey = (event: Event): void => {
      const key = (event as CustomEvent<string>).detail
      if (key === 'ArrowDown') setActive((at) => (choices.length === 0 ? 0 : (at + 1) % choices.length))
      else if (key === 'ArrowUp') setActive((at) => (choices.length === 0 ? 0 : (at - 1 + choices.length) % choices.length))
      else if (key === 'Enter' || key === 'Tab') choose(choices[active])
    }
    window.addEventListener('folio:mention-key', onKey)
    return () => {
      window.removeEventListener('folio:mention-key', onKey)
    }
  }, [active, choices, onCreate, onPick])

  // Under the caret. Read once per query change from the live DOM range.
  const [position, setPosition] = useState<{ readonly left: number; readonly top: number } | null>(null)
  useEffect(() => {
    try {
      const domRange = editor.api.toDOMRange({
        anchor: { path: query.textPath, offset: query.start },
        focus: { path: query.textPath, offset: query.start },
      })
      const container = editor.api.toDOMNode(editor)?.getBoundingClientRect()
      const rect = domRange?.getBoundingClientRect()
      if (rect !== undefined && container !== undefined) {
        setPosition({ left: rect.left - container.left, top: rect.bottom - container.top + 4 })
      }
    } catch {
      setPosition(null)
    }
  }, [editor, query.textPath, query.start])

  if (position === null) return null

  return (
    <div
      role="listbox"
      aria-label="Mention a character or location"
      className="absolute z-30 w-[260px] rounded-chrome border border-line bg-panel p-[3px] font-sans text-11-5 text-ink"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      {choices.length === 0 ? (
        <div className="px-[8px] py-[5px] text-10-5 text-ink3">Type a name to mention or create one.</div>
      ) : null}
      {choices.map((choice, index) => {
        const label = choice.kind === 'label' ? choice.label.label : `New ${choice.entity} “${choice.name}”`
        const entity = choice.kind === 'label' ? choice.label.entity : choice.entity
        return (
          <button
            key={choice.kind === 'label' ? `${choice.label.entity}:${choice.label.id}` : `create:${choice.entity}`}
            type="button"
            role="option"
            aria-selected={index === active}
            disabled={busy}
            className={`flex w-full items-center gap-[8px] rounded-chrome px-[8px] py-[5px] text-left ${index === active ? 'bg-sel' : ''}`}
            onMouseEnter={() => {
              setActive(index)
            }}
            onClick={() => {
              if (choice.kind === 'label') onPick(choice.label)
              else {
                setBusy(true)
                void onCreate(choice.entity, choice.name).finally(() => {
                  setBusy(false)
                })
              }
            }}
          >
            <span className="w-[13px] text-center font-glyph text-11 text-ink2">{ENTITY_GLYPH[entity]}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-9-5 text-ink3">{choice.kind === 'label' ? entity : 'create'}</span>
          </button>
        )
      })}
      <div className="mt-[2px] border-t border-line2 px-[8px] pt-[4px] text-9-5 text-ink3">
        <button type="button" className="text-ink3" onClick={onClose}>
          Esc to close
        </button>
      </div>
    </div>
  )
}
