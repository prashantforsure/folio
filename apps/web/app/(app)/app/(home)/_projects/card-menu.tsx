'use client'

import type { ProjectCard } from '@folio/contracts'
import { useRef } from 'react'

import { useDismiss } from '../../../../../lib/chrome/use-dismiss'
import { isArchived } from '../../../../../lib/projects/view'

/**
 * The `⋯` menu on a card and on a row. Seven items, four of which write.
 *
 * `handoff-account-v2/`'s menu is Open · Rename · Duplicate · Pin to sidebar ·
 * Export PDF · Archive · Delete. Item by item, in this product:
 *
 *   Open           a link to the project's workspace. Real.
 *   Rename         `renameProject`. Real.
 *   Duplicate      drawn, refuses in words - what a copy does with `@mention`s
 *                  bound to records, with notes and revisions, and with the
 *                  ledger is undecided (`lib/projects/actions.ts`).
 *   Pin to sidebar **drawn disabled.** The same handoff removed the sidebar's
 *                  Pinned section, so there is nowhere to pin to. Flagged
 *                  rather than quietly dropped.
 *   Export PDF     `exportProjectPdf` (roadmap task 5.3): every episode with a
 *                  script, in running order, each on its own cover, laid out
 *                  from its measurement record on the pdf-lib engine. Real.
 *                  One episode's PDF is on the script's own actions menu.
 *   Archive        `archiveProjects`, or `Unarchive` when it is archived. Real.
 *   Move to trash  `trashProjects`. Real, and named for what it does - the
 *                  handoff's `Delete` reads as final and this is not; deleting
 *                  for good is the Trash route's refusal.
 *
 * The menu is a plain list of buttons the parent wires up: this file decides
 * what is offered and the workspace decides what each one posts, so the
 * writes stay in one place with one gate.
 */

export type CardAction = 'open' | 'rename' | 'duplicate' | 'pdf' | 'archive' | 'trash'

export const CardMenu = ({
  card,
  onAct,
  onClose,
  align = 'right',
}: {
  readonly card: ProjectCard
  readonly onAct: (action: CardAction) => void
  readonly onClose: () => void
  readonly align?: 'right' | 'left'
}) => {
  const root = useRef<HTMLDivElement>(null)
  useDismiss(true, onClose, root)
  const archived = isArchived(card)

  const act = (action: CardAction) => () => {
    onClose()
    onAct(action)
  }

  return (
    <div
      ref={root}
      role="menu"
      aria-label={`${card.project.title} actions`}
      className={`folio-menu absolute top-[34px] z-[25] w-[196px] ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <button type="button" role="menuitem" onClick={act('open')} className="folio-menu-item text-12-5">
        Open
        <span className="tabular ml-auto font-mono text-10-5 text-ink3">↵</span>
      </button>
      <button type="button" role="menuitem" onClick={act('rename')} className="folio-menu-item text-12-5">
        Rename
        <span className="tabular ml-auto font-mono text-10-5 text-ink3">F2</span>
      </button>
      <button type="button" role="menuitem" onClick={act('duplicate')} className="folio-menu-item text-12-5">
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        disabled
        title="There is no pinned section in the sidebar to pin to - the same pass that drew this menu removed it."
        className="folio-menu-item text-12-5"
      >
        Pin to sidebar
      </button>
      <button type="button" role="menuitem" data-card-pdf onClick={act('pdf')} className="folio-menu-item border-t border-line2 text-12-5">
        Export PDF
      </button>
      <button type="button" role="menuitem" onClick={act('archive')} className="folio-menu-item text-12-5">
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={act('trash')}
        className="folio-menu-item border-t border-line2 text-12-5 text-live hover:text-live"
      >
        Move to trash
        <span className="tabular ml-auto font-mono text-10-5 text-ink3">⌫</span>
      </button>
    </div>
  )
}
