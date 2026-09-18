'use client'

import { useSession } from '../../../../../../lib/state/session'
import { useViewport } from '../../../../../../lib/state/viewport'
import { SIDEBAR_OPEN_MIN } from '../../../../../../lib/workspace/routes'

/**
 * The main surface's status bar - `docs/ui design/README.md`, "Status bar
 * (28px)": "Counts on the left; Hide/Show nav, a green Saved dot, and the
 * mono route path on the right." The record routes draw it (their mockups
 * do); the writing routes do not (theirs do not) - AGENTS.md, UI fidelity.
 * Production is the first rebuilt route to carry it; Characters,
 * Locations, Timeline and Research take the same one at their pass.
 *
 * `Hide nav` is the shell's own flag (`useSession().navOpen`), toggled here
 * and read by `project-shell.tsx`, which writes `html[data-nav-open]`. The
 * dot is green when saved, amber while a write is in flight, orange when
 * one failed - the same three the Script and Outline toolbars print.
 *
 * `toast` is a line after the counts for a few seconds after an act that
 * can be taken back - a queue decision, a rename - with the one word that
 * takes it back. The Characters route passes it; the bar draws nothing
 * without it.
 */
/** `idle` is the page as loaded - drawn as Saved; a walk can tell it from a write that finished. */
export type SaveIndicator = 'idle' | 'saved' | 'saving' | 'error'

const DOT: Record<SaveIndicator, string> = {
  idle: 'bg-ok',
  saved: 'bg-ok',
  saving: 'bg-warn',
  error: 'bg-live',
}

const WORD: Record<SaveIndicator, string> = {
  idle: 'Saved',
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Not saved',
}

export type StatusToast = {
  readonly message: string
  readonly action?: { readonly label: string; readonly onClick: () => void }
}

export const StatusBar = ({
  left,
  save,
  routeId,
  toast,
}: {
  /** The counts, already formatted: `Ep 1 · 3 scenes · 2 reels · Scene 1 · Writing shots`. */
  readonly left: string
  readonly save: SaveIndicator
  /** The mono route path: `ep_001/production`. */
  readonly routeId: string
  readonly toast?: StatusToast | null
}) => {
  const session = useSession()
  const { mounted, width } = useViewport()
  const navOpen = (mounted ? session.navOpen : null) ?? width >= SIDEBAR_OPEN_MIN
  return (
    <footer data-status-bar className="flex h-[28px] flex-none items-center gap-[10px] border-t border-line2 px-[16px] text-11 text-ink3">
      <span className="tabular min-w-0 truncate whitespace-nowrap" data-status-left>
        {left}
      </span>
      {toast === undefined || toast === null ? null : (
        <span role="status" data-status-toast className="flex min-w-0 items-center gap-[8px] truncate whitespace-nowrap text-11 text-ink2">
          <span className="truncate">{toast.message}</span>
          {toast.action === undefined ? null : (
            <button
              type="button"
              data-status-undo
              onClick={toast.action.onClick}
              className="folio-ghost-button rounded-[5px] px-[4px] text-11 text-accent hover:!bg-transparent hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        data-nav-toggle
        className="folio-ghost-button whitespace-nowrap rounded-[5px] px-[4px] text-11 text-ink3 hover:!bg-transparent hover:!text-ink2"
        onClick={() => {
          session.setNavOpen(!navOpen)
        }}
      >
        {navOpen ? 'Hide nav' : 'Show nav'}
      </button>
      <span className="flex items-center gap-[6px] whitespace-nowrap" data-save-state={save}>
        <span className={`h-[6px] w-[6px] rounded-full ${DOT[save]}`} />
        {WORD[save]}
      </span>
      <span className="whitespace-nowrap font-mono" data-route-id>
        {routeId}
      </span>
    </footer>
  )
}
