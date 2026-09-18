'use client'

import type { ReactNode } from 'react'

/**
 * A conflict block - `docs/ui design/README.md`, "Patterns to reuse": "When
 * the app detects a disagreement between a record and the script, the card
 * border turns `--warn`, and an amber block appears inline with the
 * explanation and two buttons: accept the change, or mark it deliberate.
 * The app never edits the script."
 *
 * One component for every record route; the card it sits in sets its own
 * border (`data-conflict` on the card, `globals.css`). The block is
 * `--warn-bg` with a `--warn` dot, the explanation at 12.5px, and the two
 * buttons the README names - the accept label is the caller's ("It's
 * Meera"), the deliberate one is the README's own copy unless the caller
 * has a more specific word (`Keep the name`, `Keep it there`). Both
 * disabled while a decision is in flight, so a double click is one
 * decision.
 *
 * A block may carry the deliberate button alone: a finding with nothing to
 * accept - two records that read as one person is a merge, not a bind; a
 * character who speaks before the script introduces them has nothing the
 * app could do about it - still needs the writer's `It's deliberate`, and
 * the app never edits the script to make it so. Both buttons stop the
 * click and its default, since the block sits inside cards that are links.
 */
export const ConflictBlock = ({
  title,
  detail,
  accept,
  onAccept,
  deliberate = "It’s deliberate",
  onDeliberate,
  busy,
  children,
}: {
  readonly title: string
  readonly detail?: ReactNode
  /** The accept button's label - what happens: `It's Meera`. Absent, there is no accept button. */
  readonly accept?: string
  readonly onAccept?: () => void
  /** The second button's label. The README's `It's deliberate` unless the caller says otherwise. */
  readonly deliberate?: string
  readonly onDeliberate: () => void
  readonly busy: boolean
  /** Citations, usually. Drawn under the detail. */
  readonly children?: ReactNode
}) => (
  <div data-conflict-block className="flex flex-col gap-[8px] rounded-[10px] px-[11px] py-[10px]" style={{ background: 'var(--warn-bg)' }}>
    <div className="flex items-start gap-[8px]">
      <span className="mt-[5px] h-[6px] w-[6px] flex-none rounded-full bg-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-12-5 font-medium leading-[1.45] tracking-title text-ink" style={{ textWrap: 'pretty' }}>
          {title}
        </span>
        {detail === undefined ? null : (
          <span className="text-12 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
            {detail}
          </span>
        )}
        {children}
      </div>
    </div>
    <div className="flex items-center gap-[6px]">
      {accept === undefined || onAccept === undefined ? null : (
        <button
          type="button"
          data-conflict-accept
          disabled={busy}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onAccept()
          }}
          className="folio-warn-button h-[28px] flex-1 rounded-[8px] px-[10px] text-12 font-medium"
        >
          {accept}
        </button>
      )}
      <button
        type="button"
        data-conflict-deliberate
        disabled={busy}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDeliberate()
        }}
        className="folio-line-button h-[28px] flex-1 justify-center rounded-[8px] px-[10px] text-12"
      >
        {deliberate}
      </button>
    </div>
  </div>
)
