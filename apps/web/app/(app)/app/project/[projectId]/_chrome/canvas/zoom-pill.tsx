'use client'

import { ZOOM_MAX, ZOOM_MIN, zoomLabel } from '../../../../../../../lib/storyboard/canvas'

/**
 * The canvas's zoom pill: `−`, the percentage, `+`, a hairline, `Fit`.
 * Lifted from `_scenes/canvas/scene-canvas.tsx` (2026-09-20) for the
 * Characters canvas - the third canvas on the shell, and the first to
 * draw the pill from here. The Storyboard's and Scenes' canvases still
 * carry their own copy; their comments ask for the move, and it waits on
 * a pass in those routes rather than an edit from this one.
 *
 * `position` is where the pill sits over the ground: the Storyboard's
 * bottom-left, or the Characters canvas's top-right (laper's corner).
 */
export const ZoomPill = ({
  k,
  onZoom,
  onFit,
  position,
  fitTitle = 'Fit everything in the window',
}: {
  readonly k: number
  readonly onZoom: (direction: 1 | -1) => void
  readonly onFit: () => void
  readonly position: 'bottom-left' | 'top-right'
  readonly fitTitle?: string
}) => (
  <div
    data-zoom-pill
    className={`absolute ${position === 'top-right' ? 'right-[20px] top-[14px]' : 'bottom-[18px] left-[20px]'} flex items-center gap-[2px] rounded-pill border border-line bg-sunk p-[4px] shadow-[0_12px_34px_var(--shade)]`}
  >
    <button
      type="button"
      title="Zoom out"
      aria-label="Zoom out"
      disabled={k <= ZOOM_MIN}
      className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
      onClick={() => {
        onZoom(-1)
      }}
    >
      −
    </button>
    <span className="tabular min-w-[48px] text-center font-mono text-11-5 text-ink2" data-zoom-label>
      {zoomLabel(k)}
    </span>
    <button
      type="button"
      title="Zoom in"
      aria-label="Zoom in"
      disabled={k >= ZOOM_MAX}
      className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
      onClick={() => {
        onZoom(1)
      }}
    >
      +
    </button>
    <span className="mx-[3px] h-[18px] w-[1px] bg-line" />
    <button type="button" data-zoom-fit title={fitTitle} className="folio-ghost-button h-[30px] rounded-pill px-[11px] text-12-5 text-ink2" onClick={onFit}>
      Fit
    </button>
  </div>
)
