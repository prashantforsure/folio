'use client'

import type { ScreenplayNodeType } from '@folio/script'

import { digitForType } from '../../../../../../lib/script/keyboard'
import { TYPE_LABEL } from './editor/elements'

/**
 * The 27px status bar. `Route - Script.dc.html`'s footer, left to right:
 * `Pg 1 / 104 · Paged · Action ⌘2 · Scene 1 · 2/8 pg`, then right-aligned
 * `Hide nav`, the zoom button ("View zoom — the page stays fixed in inches"),
 * `Rev. Blue · saved 12s ago`, and the route id in 9.5px monospace.
 *
 * Every figure is live. The page is the caret block's page in the paged
 * record; the total is the paged record's total even in minimal mode, per
 * the bundle's note ("Page count still live in the status bar"); the scene
 * and its eighths are the record's `scenes`; the revision is the episode's.
 * When the engine refused (open decision 8) the page reads `—`.
 */
export type StatusBarProps = {
  readonly page: string
  readonly pages: string
  readonly paginationLabel: string
  readonly caretType: ScreenplayNodeType | null
  readonly sceneLabel: string
  readonly navOpen: boolean
  readonly onToggleNav: () => void
  readonly zoomLabel: string
  readonly onCycleZoom: () => void
  readonly revisionLabel: string
  readonly savedLabel: string
  readonly routeId: string
}

export const StatusBar = ({
  page,
  pages,
  paginationLabel,
  caretType,
  sceneLabel,
  navOpen,
  onToggleNav,
  zoomLabel,
  onCycleZoom,
  revisionLabel,
  savedLabel,
  routeId,
}: StatusBarProps) => (
  <footer
    data-status-bar
    className="flex h-[27px] flex-none items-center gap-[12px] border-t border-line bg-panel px-[14px] text-10-5 text-ink2"
  >
    <span className="tabular-nums">
      Pg <b className="font-semibold text-ink">{page}</b> / {pages}
    </span>
    <span className="text-ink3">·</span>
    <span>{paginationLabel}</span>
    <span className="text-ink3">·</span>
    <span>
      {caretType === null ? '—' : TYPE_LABEL[caretType]}{' '}
      <span className="text-ink3">{caretType === null ? '' : `⌘${digitForType(caretType)}`}</span>
    </span>
    <span className="text-ink3">·</span>
    <span>{sceneLabel}</span>
    <div className="flex-1" />
    <button type="button" className="folio-status-button" onClick={onToggleNav}>
      {navOpen ? 'Hide nav' : 'Show nav'}
    </button>
    <button
      type="button"
      className="folio-status-button"
      title="View zoom — the page stays fixed in inches"
      onClick={onCycleZoom}
    >
      {zoomLabel}
    </button>
    <span className="text-ink3">·</span>
    <span>
      {revisionLabel} · {savedLabel}
    </span>
    <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
  </footer>
)
