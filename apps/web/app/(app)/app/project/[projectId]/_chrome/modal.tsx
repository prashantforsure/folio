'use client'

import { Icon } from '@folio/ui'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from './use-focus-trap'

/**
 * A small form dialog over the whole app: the Scenes detail's ground
 * (`.folio-modal-scrim`, the same scrim and blur) under a 440px `--sunk`
 * panel with a title, a sub line, the caller's body and its footer. The
 * Characters route's relationship modal is the first (2026-09-20);
 * `PaperModal` (`_scenes/script-modal.tsx`) is the other shape, a page,
 * and stays its own.
 *
 * Portal to `body`, so a modal opened from inside a canvas's transformed
 * world is not scaled with it. Escape and the scrim close it; the first
 * field takes focus on open and the element that opened it gets focus
 * back on close, so a keyboard user lands where they were; Tab stays
 * inside while it is open (`use-focus-trap.ts`, 2026-09-22).
 */
export const Modal = ({
  attr,
  label,
  title,
  sub,
  onClose,
  footer,
  children,
}: {
  /** `data-relationship-modal`, for the walks. */
  readonly attr: `data-${string}`
  /** The `aria-label` when the title is not enough on its own. */
  readonly label?: string
  readonly title: string
  readonly sub?: ReactNode
  readonly onClose: () => void
  readonly footer: ReactNode
  readonly children: ReactNode
}) => {
  const [mounted, setMounted] = useState(false)
  const headingId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    setMounted(true)
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement) back.focus()
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-modal-close])')
    first?.focus()
  }, [mounted])

  useFocusTrap(panel, mounted)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!mounted) return null
  return createPortal(
    <div
      className="folio-modal-scrim"
      {...{ [attr]: '' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label === undefined ? headingId : undefined}
        aria-label={label}
        className="folio-modal flex max-h-full w-full max-w-[440px] flex-col overflow-hidden"
      >
        <div className="flex flex-none items-start gap-[10px] px-[18px] pb-[12px] pt-[16px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <h2 id={headingId} className="m-0 text-15 font-medium tracking-title">
              {title}
            </h2>
            {sub === undefined ? null : (
              <span className="text-11-5 text-ink3" data-modal-sub>
                {sub}
              </span>
            )}
          </div>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            aria-label="Close"
            className="folio-ghost-button grid h-[28px] w-[28px] flex-none place-items-center rounded-[8px] text-ink3"
          >
            <Icon name="close" size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto px-[18px] pb-[16px]">{children}</div>
        <div className="flex flex-none items-center gap-[8px] border-t border-line2 px-[18px] pb-[14px] pt-[12px]">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}
