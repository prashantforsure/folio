'use client'

import type { MentionEntity } from '@folio/script'

import type { MentionView } from '../editor-store'
import { Floating } from './floating-layer'

/**
 * The `@` combobox, drawn under the `@` that opened it. Presentation only:
 * the extension (`extensions/mention-suggestion.ts`) filters the label book,
 * owns the highlighted index and inserts the mention. The two "New …" rows
 * create a record through the workspace's server action first.
 */

const ENTITY_GLYPH: Readonly<Record<MentionEntity, string>> = { character: '◍', location: '⌖' }

export const MentionCombobox = ({ view, context }: { readonly view: MentionView; readonly context: Element | null }) => {
  const { choices, active, busy } = view
  return (
    <Floating
      anchor={view.anchor}
      context={context}
      role="listbox"
      aria-label="Mention a character or location"
      data-mention-menu=""
      className="z-30 w-[260px] rounded-chrome border border-line bg-panel p-[3px] font-sans text-11-5 text-ink"
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
              view.onHover(index)
            }}
            onClick={() => {
              view.onPick(choice)
            }}
          >
            <span className="w-[13px] text-center font-glyph text-11 text-ink2">{ENTITY_GLYPH[entity]}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-9-5 text-ink3">{choice.kind === 'label' ? entity : 'create'}</span>
          </button>
        )
      })}
      <div className="mt-[2px] border-t border-line2 px-[8px] pt-[4px] text-9-5 text-ink3">
        <button type="button" className="text-ink3" onClick={view.onClose}>
          Esc to close
        </button>
      </div>
    </Floating>
  )
}
