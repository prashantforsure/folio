'use client'

import type { ReactNode } from 'react'

/**
 * A tab of the Script route's two segments - `▤ Script / ▣ Cover` in the
 * header and `Info / Collaboration` in the panel.
 *
 * A button, not a link: neither segment is in the URL (ruled 2026-09-11,
 * `lib/workspace/params.ts`), so there is no address to put on it. A click
 * flips state in the workspace and nothing is requested. `aria-selected` is
 * the tab's state for assistive tech and the `.folio-segment` rule that
 * paints it; `onMouseDown` is swallowed so the click does not take focus
 * from the editor - the caret stays where the writer left it when they come
 * back from the cover.
 */
export const ViewTab = ({
  active,
  onPick,
  className,
  children,
}: {
  readonly active: boolean
  readonly onPick: () => void
  readonly className?: string
  readonly children: ReactNode
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    className={className ?? 'folio-focus'}
    onMouseDown={(event) => {
      event.preventDefault()
    }}
    onClick={onPick}
  >
    {children}
  </button>
)
