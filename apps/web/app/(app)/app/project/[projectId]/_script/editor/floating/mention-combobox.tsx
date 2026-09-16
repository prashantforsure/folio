'use client'

import type { MentionEntity } from '@folio/script'

import type { MentionView } from '../editor-store'
import { Floating } from './floating-layer'

/**
 * The `@` combobox, drawn under the `@` that opened it. Presentation only:
 * the extension (`extensions/mention-suggestion.ts`) filters the label book,
 * owns the highlighted index and inserts the mention. The two "New …" rows
 * create a record through the workspace's server action first.
 *
 * Same chrome as the slash menu (`.folio-slash`): `--sunk`, 14px radius,
 * one row per choice with a mono mark - `@` for a character, `⌖` for a
 * location - and the entity in `--ink3` at the right.
 */

const ENTITY_MARK: Readonly<Record<MentionEntity, string>> = { character: '@', location: '⌖' }

export const MentionCombobox = ({ view, context }: { readonly view: MentionView; readonly context: Element | null }) => {
  const { choices, active, busy } = view
  return (
    <Floating
      anchor={view.anchor}
      context={context}
      role="listbox"
      aria-label="Mention a character or location"
      data-mention-menu=""
      className="folio-slash"
    >
      <div className="folio-slash-list">
        <div className="folio-slash-title">Mention</div>
        {choices.length === 0 ? <div className="folio-slash-empty">Type a name to mention or create one.</div> : null}
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
              className="folio-slash-row"
              onMouseEnter={() => {
                view.onHover(index)
              }}
              onClick={() => {
                view.onPick(choice)
              }}
            >
              <span className="folio-slash-glyph">{ENTITY_MARK[entity]}</span>
              <span className="folio-slash-label">{label}</span>
              <kbd>{choice.kind === 'label' ? entity : 'create'}</kbd>
            </button>
          )
        })}
      </div>
    </Floating>
  )
}
