'use client'

import type { OutlineNodeType } from '@folio/script'
import { memo } from 'react'

import { BLOCK_LABEL, BLOCK_SHORTCUT } from '../../../../../../lib/outline/keyboard'

/**
 * The Outline's 27px status bar. `Route - Outline.dc.html`'s footer, left to
 * right: `Outline · N blocks · Body ⌘0 · 1,543 words`, then right-aligned
 * `Hide nav` / `Show nav`, the zoom button, the save state, and the route id
 * in 9.5px monospace (`ep_001/outline`).
 *
 * Every figure is live: the block count is the value's length, the caret
 * block is the editor's selection, the words are counted over the value.
 */
export type OutlineStatusBarProps = {
  readonly blockCount: number
  readonly caretType: OutlineNodeType | null
  readonly words: number
  readonly navOpen: boolean
  readonly onToggleNav: () => void
  readonly zoomLabel: string
  readonly onCycleZoom: () => void
  readonly savedLabel: string
  readonly routeId: string
}

const OutlineStatusBarBody = ({
  blockCount,
  caretType,
  words,
  navOpen,
  onToggleNav,
  zoomLabel,
  onCycleZoom,
  savedLabel,
  routeId,
}: OutlineStatusBarProps) => (
  <footer
    data-status-bar
    className="flex h-[27px] flex-none items-center gap-[12px] border-t border-line bg-panel px-[14px] text-10-5 text-ink2"
  >
    <span className="tabular-nums">
      Outline · <b className="font-semibold text-ink" data-block-count>{blockCount.toLocaleString('en-US')}</b> blocks
    </span>
    <span className="text-ink3">·</span>
    <span data-caret-block>
      {caretType === null ? '—' : BLOCK_LABEL[caretType]}{' '}
      <span className="text-ink3">{caretType === null ? '' : BLOCK_SHORTCUT[caretType]}</span>
    </span>
    <span className="text-ink3">·</span>
    <span className="tabular-nums" data-word-count>
      {words.toLocaleString('en-US')} words
    </span>
    <div className="flex-1" />
    <button type="button" className="folio-status-button" onClick={onToggleNav}>
      {navOpen ? 'Hide nav' : 'Show nav'}
    </button>
    <button type="button" className="folio-status-button" title="View zoom — the page stays fixed in inches" onClick={onCycleZoom}>
      {zoomLabel}
    </button>
    <span className="text-ink3">·</span>
    <span>{savedLabel}</span>
    <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
  </footer>
)

export const OutlineStatusBar = memo(OutlineStatusBarBody)
