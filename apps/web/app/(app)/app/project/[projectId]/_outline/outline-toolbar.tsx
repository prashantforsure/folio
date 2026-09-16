'use client'

import { Icon } from '@folio/ui'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { memo, useEffect, useRef, useState } from 'react'

import type { RevisionRow } from '../../../../../../lib/script/panel'

/**
 * The Outline route's toolbar row - `docs/ui design/Route - Outline v2.dc.html`:
 * the document title as a dropdown (`Outline · Draft 2 ▾`), then the word
 * count and the saved dot, then `⋯`. The Script route's `toolbar.tsx` over
 * this document's two menus.
 *
 *   the title menu     the outline's drafts, read-only: every snapshot the
 *                      writer took with `⌘S`, newest first, under a
 *                      `Drafts` eyebrow. "Draft N" is the count of those
 *                      plus one (ruled 2026-09-16: a snapshot ends a draft).
 *                      There is one document, so there is nothing to switch
 *                      to - the menu is the list.
 *   the actions menu   Snapshot now, Export as Markdown, Undo; then the
 *                      statistics, counted from the document.
 *
 * Neither menu takes focus from the editor for longer than a click: every
 * button swallows `mousedown` so the caret stays where it was.
 */

const keepCaret = (event: ReactMouseEvent): void => {
  event.preventDefault()
}

const useDismiss = (open: boolean, close: () => void, root: RefObject<HTMLDivElement | null>): void => {
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open, root])
}

export const OutlineDocumentMenu = memo(
  ({ title, drafts }: { readonly title: string; readonly drafts: readonly RevisionRow[] }) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    return (
      <div ref={root} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-document-menu
          onMouseDown={keepCaret}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="folio-pill-button flex items-center gap-[8px] whitespace-nowrap rounded-[11px] px-[13px] py-[8px] text-13-5 font-medium !text-ink"
        >
          {title}
          <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-50" />
        </button>
        {open ? (
          <div role="menu" className="folio-menu absolute left-0 top-[40px] w-[300px]">
            <div className="px-[9px] pb-[4px] pt-[4px]">
              <span className="folio-eyebrow">Drafts</span>
              {drafts.length === 0 ? (
                <p className="m-0 mt-[6px] text-12 leading-[1.5] text-ink3">No snapshot yet. ⌘S takes one and starts the next draft.</p>
              ) : (
                <div className="mt-[6px] flex flex-col gap-[8px]" data-draft-list>
                  {drafts.map((draft) => (
                    <div key={draft.id} className="flex flex-col">
                      <span className="text-12-5 text-ink">{draft.name}</span>
                      <span className="text-11 text-ink3">{draft.meta}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    )
  },
)
OutlineDocumentMenu.displayName = 'OutlineDocumentMenu'

export type OutlineStatRow = readonly [label: string, value: number]

export type OutlineActionsMenuProps = {
  readonly onSnapshot: () => void
  readonly onExport: () => void
  readonly onUndo: () => void
  readonly canAct: boolean
  readonly notice: string | null
  readonly stats: readonly OutlineStatRow[]
}

export const OutlineActionsMenu = memo(({ onSnapshot, onExport, onUndo, canAct, notice, stats }: OutlineActionsMenuProps) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title="Export outline"
        aria-label="Outline actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-actions-menu
        onMouseDown={keepCaret}
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-[9px] text-15 leading-none text-ink3"
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[36px] w-[300px]">
          <button
            type="button"
            role="menuitem"
            disabled={!canAct}
            data-action="snapshot"
            className="folio-menu-item"
            onMouseDown={keepCaret}
            onClick={() => {
              setOpen(false)
              onSnapshot()
            }}
          >
            <Icon name="check" size={15} strokeWidth={1.4} className="text-ink3" />
            Snapshot now
            <kbd className="ml-auto font-sans text-11 text-ink3">⌘S</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canAct}
            data-action="export"
            className="folio-menu-item"
            onMouseDown={keepCaret}
            onClick={() => {
              setOpen(false)
              onExport()
            }}
          >
            <Icon name="export" size={15} strokeWidth={1.4} className="text-ink3" />
            Export as Markdown
          </button>
          <button type="button" role="menuitem" disabled={!canAct} className="folio-menu-item" onMouseDown={keepCaret} onClick={onUndo}>
            <span className="w-[15px] text-center text-ink3">↩</span>
            Undo
            <kbd className="ml-auto font-sans text-11 text-ink3">⌘Z</kbd>
          </button>
          {notice === null ? null : <p className="m-0 px-[9px] pb-[2px] pt-[4px] text-11-5 leading-[1.5] text-ink3">{notice}</p>}

          <div className="mt-[4px] border-t border-line2 px-[9px] pb-[4px] pt-[8px]">
            <span className="folio-eyebrow">Statistics</span>
            <div className="mt-[4px] flex flex-col">
              {stats.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between border-b border-line2 py-[5px] last:border-b-0">
                  <span className="text-12 text-ink2">{label}</span>
                  <span className="tabular font-mono text-12 text-ink" data-stat={label.toLowerCase()}>
                    {value.toLocaleString('en-US')}
                  </span>
                </div>
              ))}
            </div>
            <p className="m-0 pt-[6px] text-11 leading-[1.45] text-ink3">Counted from the outline; scenes, characters and locations from the script.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
})
OutlineActionsMenu.displayName = 'OutlineActionsMenu'
