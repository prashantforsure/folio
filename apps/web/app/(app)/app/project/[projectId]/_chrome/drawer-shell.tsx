'use client'

import { Icon } from '@folio/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useViewport } from '../../../../../../lib/state/viewport'
import { publishDrawer } from '../../../../../../lib/workspace/drawer'
import { PANEL_IN_FLOW_MIN } from '../../../../../../lib/workspace/routes'
import { useFocusTrap } from './use-focus-trap'

/**
 * The drawer's frame - `docs/ui design/README.md`, "Panels (assistant and
 * drawer)": 400px, `--sunk`, one left hairline; in flow above 1200px, over
 * the content with the `-24px 0 70px` shadow below it, where an open panel
 * forces the sidebar closed. The forcing is the shell's
 * (`project-shell.tsx`) and it learns of this drawer through
 * `lib/workspace/drawer.ts`, published while mounted.
 *
 * Head: an optional lead (the Characters drawer's 32px portrait thumbnail)
 * before the title at 15px/500 with a meta line (a string, or nodes when a
 * ref in it is a link), the caller's actions beside it, and ✕. Body: the scrolling
 * column, `0 18px 20px`, 18px between sections. Foot: the caller's - the
 * README's "destructive action on the left and Cancel / Save on the
 * right". Escape closes; Tab stays inside while it is open
 * (`use-focus-trap.ts`, 2026-09-22).
 *
 * One frame for every record route's drawer. Rendered through a portal into
 * the route layout's slot - `#<route>-drawer`, a sibling of the column
 * (`characters-layout.tsx`, `locations-layout.tsx`, `research-layout.tsx`, `timeline-layout.tsx`) - so it sits beside the
 * column, full height, as the mockups draw it; a page renders inside the
 * surface and could not otherwise reach that position. The slot exists
 * only after hydration, so the drawer's first paint is a client paint.
 * `data-<route>-drawer` carries the label, for the walks.
 */
export const DrawerShell = ({
  route,
  overlay = false,
  title,
  meta,
  label,
  lead,
  actions,
  onClose,
  footer,
  children,
}: {
  /** Which route's slot to fill: `characters` portals into `#characters-drawer`. Unread when `overlay`. */
  readonly route: 'characters' | 'locations' | 'research' | 'timeline'
  /**
   * Floating over the whole app instead of docked in the route's slot: a
   * blurred scrim (`.folio-modal-scrim`, the same ground `_chrome/modal.tsx`
   * uses) behind a full-height sheet at the right edge, portalled straight to
   * `body` rather than the route's `#<route>-drawer`. Used by the Characters
   * edit modal reached through the intercepted `/characters/:id`
   * (`_characters/character-edit-modal.tsx`) so opening a record does not
   * remount the canvas behind it; every other caller leaves this unset and
   * keeps the in-flow drawer.
   */
  readonly overlay?: boolean
  readonly title: string
  readonly meta: ReactNode
  /** The `aria-label`; `data-<route>-drawer` carries it too, for the walks. */
  readonly label: string
  /** Drawn before the title column: a small thumbnail. */
  readonly lead?: ReactNode
  /** Ghost buttons drawn between the title column and ✕: `Ask`, `Open in script`. */
  readonly actions?: ReactNode
  readonly onClose: () => void
  readonly footer: ReactNode
  readonly children: ReactNode
}) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const { width } = useViewport()
  const inFlow = !overlay && width >= PANEL_IN_FLOW_MIN

  useEffect(() => {
    if (overlay) {
      setMounted(true)
      return
    }
    setSlot(document.getElementById(`${route}-drawer`))
  }, [overlay, route])

  useEffect(() => {
    if (overlay) return
    publishDrawer(true)
    return () => {
      publishDrawer(false)
    }
  }, [overlay])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useFocusTrap(panelRef, overlay ? mounted : slot !== null)

  const panel = (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label={label}
      {...{ [`data-${route}-drawer`]: label }}
      data-drawer-route={route}
      data-in-flow={inFlow ? 'true' : 'false'}
      data-overlay={overlay ? 'true' : undefined}
      className={`folio-drawer ${overlay ? '' : inFlow ? 'relative' : 'absolute inset-y-0 right-0'} z-[7] flex min-h-0 flex-none flex-col`}
    >
      <div className="flex flex-none items-start gap-[10px] pb-[12px] pl-[18px] pr-[14px] pt-[16px]">
        {lead === undefined ? null : <div className="flex-none pt-[1px]">{lead}</div>}
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-15 font-medium tracking-title">{title}</span>
          <span className="flex flex-wrap items-center gap-x-[4px] text-11-5 text-ink3" data-drawer-meta>
            {meta}
          </span>
        </div>
        {actions === undefined ? null : <div className="flex flex-none items-center gap-[4px] pt-[1px]">{actions}</div>}
        <button
          type="button"
          title="Close"
          aria-label="Close"
          data-drawer-close
          onClick={onClose}
          className="folio-ghost-button grid h-[28px] w-[28px] flex-none place-items-center rounded-[8px] text-ink3"
        >
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] pb-[20px]">{children}</div>
      <div className="flex flex-none items-center gap-[8px] border-t border-line2 px-[18px] pb-[16px] pt-[12px]">{footer}</div>
    </aside>
  )

  if (overlay) {
    if (!mounted) return null
    return createPortal(
      <div
        className="folio-modal-scrim"
        data-align="end"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        {panel}
      </div>,
      document.body,
    )
  }

  if (slot === null) return null
  return createPortal(panel, slot)
}

/** A labelled field: the 11.5px `--ink2` label over the control. */
export const Field = ({ label, children, className }: { readonly label: string; readonly children: ReactNode; readonly className?: string }) => (
  <label className={`flex min-w-0 flex-col gap-[6px] ${className ?? ''}`}>
    <span className="text-11-5 text-ink2">{label}</span>
    {children}
  </label>
)

/** A section under a hairline: `padding-top: 16px; border-top`. */
export const Section = ({ children, gap = 9 }: { readonly children: ReactNode; readonly gap?: number }) => (
  <div className="flex flex-col border-t border-line2 pt-[16px]" style={{ gap }}>
    {children}
  </div>
)
