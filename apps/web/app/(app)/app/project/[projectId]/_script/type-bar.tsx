'use client'

import type { ScreenplayNodeType } from '@folio/script'

import { DIGIT_TYPES, digitForType } from '../../../../../../lib/script/keyboard'
import { TYPE_LABEL } from './editor/elements'

/**
 * The element type bar. Sticky above the sheet, all eight types with their
 * `⌘N` shortcut, the caret's type lit with `--sel` and 600 weight. Transcribed
 * from `Route - Script.dc.html`. `DIGIT_TYPES` is the order the digits take,
 * which is the bundle's order, which is the union's.
 */
export const TypeBar = ({
  current,
  onPick,
  disabled,
}: {
  readonly current: ScreenplayNodeType | null
  readonly onPick: (type: ScreenplayNodeType) => void
  readonly disabled: boolean
}) => (
  <div
    role="toolbar"
    aria-label="Element type"
    className="sticky top-0 z-20 mb-[16px] flex gap-[1px] rounded-chrome border border-line bg-panel p-[3px]"
  >
    {DIGIT_TYPES.map((type) => {
      const active = current === type
      return (
        <button
          key={type}
          type="button"
          disabled={disabled}
          aria-pressed={active}
          onMouseDown={(event) => {
            // Keep the editor's selection; the pick applies to the caret block.
            event.preventDefault()
          }}
          onClick={() => {
            onPick(type)
          }}
          className={`folio-focus relative flex flex-col items-center gap-[1px] rounded-chrome px-[10px] py-[5px] hover:bg-hover disabled:cursor-default ${active ? 'bg-sel' : ''}`}
        >
          <span className={`whitespace-nowrap text-11-5 ${active ? 'font-semibold' : ''}`}>
            {TYPE_LABEL[type]}
          </span>
          <span className="text-9 text-ink3">⌘{digitForType(type)}</span>
        </button>
      )
    })}
  </div>
)
