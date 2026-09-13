'use client'

import type { PickerView } from '../editor-store'
import { Floating } from './floating-layer'

/**
 * The block selector, drawn under the segment it is completing.
 *
 * Presentation only. The model (`lib/script/pickers.ts`) says what the
 * choices are and what the keys do; the extension (`extensions/pickers.ts`)
 * owns the highlighted index and applies the plan. This draws the prompt,
 * the two key hints, and the list, and reports a hover or a click. It
 * never takes focus. Reopened from a pill (`model.mode === 'edit'`) it is
 * the same box under the same segment, with the current value lit.
 */
export const BlockPicker = ({ view, context }: { readonly view: PickerView; readonly context: Element | null }) => {
  const { model, active } = view
  return (
    <Floating
      anchor={view.anchor}
      context={context}
      role="listbox"
      aria-label={model.prompt}
      data-picker={model.kind}
      data-mode={model.mode}
      className="folio-picker"
    >
      <div className="folio-picker-prompt">{model.prompt}</div>
      <div className="folio-picker-hints">
        {model.hints.tab === null ? null : (
          <span>
            <kbd>Tab</kbd>
            {model.hints.tab}
          </span>
        )}
        <span>
          <kbd>Enter</kbd>
          {model.hints.enter}
        </span>
      </div>
      <div className="folio-picker-list">
        {model.choices.map((choice, index) => (
          <button
            key={`${choice.kind}:${choice.text}`}
            type="button"
            role="option"
            aria-selected={index === active}
            data-kind={choice.kind}
            className="folio-picker-choice"
            onMouseEnter={() => {
              view.onHover(index)
            }}
            onClick={() => {
              view.onPick(choice)
            }}
          >
            <span className="folio-picker-choice-text">{choice.text}</span>
            <span className="folio-picker-choice-detail">{choice.detail}</span>
          </button>
        ))}
      </div>
      <div className="folio-picker-foot">
        <button type="button" onClick={view.onClose}>
          Esc to close
        </button>
      </div>
    </Floating>
  )
}
