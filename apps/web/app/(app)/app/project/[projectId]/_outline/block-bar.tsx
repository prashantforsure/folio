'use client'

import type { OutlineNodeType } from '@folio/script'
import { memo } from 'react'

import { BLOCK_TOOL } from '../../../../../../lib/outline/keyboard'
import { BLOCK_TOOL_ORDER } from '../../../../../../lib/outline/slate-model'

/**
 * The block-format toolbar. Sticky above the sheet, one two-line button per
 * block - glyph over a 9px label - the caret's block lit with `--sel`.
 * Transcribed from `Route - Outline.dc.html`.
 *
 * The bundle draws six (Body, T1, T2, T3, Quote, Rule) and, after a divider,
 * Bold and Italic. Two departures, both flagged in the phase report:
 *
 *   - **Beat is a seventh button.** Numbered beats are one of the seven
 *     blocks AGENTS.md names; a block set drawn short of its own member is
 *     a toolbar that cannot make one of the outline's own blocks.
 *   - **Bold and Italic are not drawn.** `InlineRun` has no mark, so a mark
 *     cannot be saved (`lib/outline/slate-model.ts`); adding one is a
 *     node-schema change. A button that does nothing is a placeholder.
 */
const BlockBarBody = ({
  current,
  onPick,
  disabled,
}: {
  readonly current: OutlineNodeType | null
  readonly onPick: (type: OutlineNodeType) => void
  readonly disabled: boolean
}) => (
  <div
    role="toolbar"
    aria-label="Block format"
    data-block-bar
    className="sticky top-0 z-20 mb-[16px] flex items-stretch gap-[1px] rounded-chrome border border-line bg-panel p-[3px]"
  >
    {BLOCK_TOOL_ORDER.map((type) => {
      const tool = BLOCK_TOOL[type]
      const active = current === type
      return (
        <button
          key={type}
          type="button"
          disabled={disabled}
          aria-pressed={active}
          title={tool.title}
          data-block-tool={type}
          className="folio-block-tool disabled:cursor-default"
          onMouseDown={(event) => {
            // Keep the editor's selection; the pick applies to the caret block.
            event.preventDefault()
          }}
          onClick={() => {
            onPick(type)
          }}
        >
          <span className={`text-12 leading-[1.2] ${type === 'body' || type === 'quote' || type === 'rule' ? '' : 'font-bold'}`}>
            {tool.glyph}
          </span>
          <span className="text-9 text-ink3">{tool.label}</span>
        </button>
      )
    })}
  </div>
)

export const BlockBar = memo(BlockBarBody)
