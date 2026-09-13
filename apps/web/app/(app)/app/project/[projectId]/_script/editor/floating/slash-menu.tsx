'use client'

import type { SlashView } from '../editor-store'
import { Floating } from './floating-layer'

/**
 * The slash menu, drawn under the `/` that opened it.
 *
 * Presentation only. The model (`lib/script/slash.ts`) says what the rows
 * are and how they are sectioned; the extension (`extensions/slash.ts`)
 * owns the highlighted index and applies the pick. It never takes focus -
 * the editable keeps it, which is what lets the writer keep typing to
 * narrow the list - and it reports a hover or a click through the view.
 *
 * The search line - "Type to search" after a bare slash - is the Suggestion
 * plugin's empty-query decoration, styled in `globals.css`; nothing here
 * draws it.
 */
export const SlashMenu = ({ view, context }: { readonly view: SlashView; readonly context: Element | null }) => {
  const { menu, query, active } = view
  let index = -1
  return (
    <Floating anchor={view.anchor} context={context} role="listbox" aria-label="Insert a block" data-slash-menu="" className="folio-slash">
      <div className="folio-slash-list">
        {menu.sections.length === 0 ? <div className="folio-slash-empty">No block matches “{query}”</div> : null}
        {menu.sections.map((section) => (
          <div key={section.title} className="folio-slash-section">
            <div className="folio-slash-title">{section.title}</div>
            {section.entries.map((entry) => {
              index += 1
              const row = index
              return (
                <button
                  key={`${section.title}:${entry.type}`}
                  type="button"
                  role="option"
                  aria-selected={row === active}
                  data-slash-choice={entry.type}
                  className="folio-slash-row"
                  onMouseEnter={() => {
                    view.onHover(row)
                  }}
                  onClick={() => {
                    view.onPick(entry)
                  }}
                >
                  <span className="folio-slash-glyph">{entry.glyph}</span>
                  <span className="folio-slash-label">
                    {entry.label}
                    <span className="folio-slash-detail"> · {entry.detail}</span>
                  </span>
                  <kbd>{entry.shortcut}</kbd>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="folio-slash-foot">
        <button type="button" onClick={view.onClose}>
          Close menu
        </button>
        <span>esc</span>
      </div>
    </Floating>
  )
}
