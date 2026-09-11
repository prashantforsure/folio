'use client'

import type { PageFrame } from '../../../../../../../lib/script/layout'

/**
 * The sheets, drawn behind the editable flow. Each is the bundle's sheet -
 * 816 x 1056, `--sheet`, 1px `--sheet-edge`, 2px radius - at the desk y the
 * layout computed from the measurement record, with its printed label at
 * `top: 48px; right: 96px` in `--ink3`. The label is the record's, so a
 * locked page prints `12A` here exactly as it will in the PDF.
 */
export const PageFrames = ({ frames }: { readonly frames: readonly PageFrame[] }) => (
  <>
    {frames.map((frame) => (
      <div
        key={frame.ordinal}
        className="folio-page"
        style={{ top: frame.topPx, height: frame.heightPx }}
        data-page-ordinal={frame.ordinal}
        data-page-label={frame.label}
        data-page-locked={frame.locked ? 'true' : 'false'}
        aria-hidden="true"
      >
        <span className="folio-page-number">{frame.label}.</span>
      </div>
    ))}
  </>
)
