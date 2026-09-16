'use client'

import type { Project } from '@folio/contracts'
import type { ScriptFormat } from '@folio/script'
import { Icon } from '@folio/ui'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { memo, useRef, useState } from 'react'

import type { RevisionRow } from '../../../../../../lib/script/panel'
import type { ScriptStats } from '../../../../../../lib/script/stats'
import { PAGINATION_CONTROLS, PAGINATION_CONTROL_COPY } from '../../../../../../lib/state/project-preferences'
import type { PaginationControl } from '../../../../../../lib/state/project-preferences'
import { useDismiss } from '../_chrome/use-dismiss'

/**
 * The Script route's toolbar row - `docs/ui design/Route - Script v2.dc.html`:
 * the document title as a dropdown (`Standpipe · Rev. Blue ▾`), then the
 * page count and the saved dot, then `⋯` document actions.
 *
 * ## The two menus hold what the old chrome held
 *
 * The header's `▤ Script / ▣ Cover` segment and the 296px right panel are
 * gone with the redesign. What they carried is here, in the two places
 * the mockup gives:
 *
 *   the title menu     which document - the script or its title page - and
 *                      the revision list, read-only, under a `Revisions`
 *                      eyebrow. Ruled 2026-09-11 and unchanged: which
 *                      document is showing is component state, not the URL.
 *   the actions menu   Import, Export as .fdx, Undo; then the project row's
 *                      Pagination (Minimal / Paged / Live) and Format
 *                      (Hollywood / Asian), decided in the workspace and drawn
 *                      here; then the statistics, counted from the document.
 *
 * Neither menu takes focus from the editor for longer than a click: every
 * button swallows `mousedown` so the caret stays where it was.
 */

export type ScriptDoc = 'script' | 'cover'

const FORMATS: readonly { readonly id: ScriptFormat; readonly label: string; readonly page: string }[] = [
  { id: 'hollywood', label: 'Hollywood', page: 'US Letter · Courier 12pt' },
  { id: 'asian', label: 'Asian', page: 'A4 · Courier 12pt' },
]

const keepCaret = (event: ReactMouseEvent): void => {
  event.preventDefault()
}

export const DocumentMenu = memo(
  ({
    title,
    doc,
    onPickDoc,
    revisions,
  }: {
    readonly title: string
    readonly doc: ScriptDoc
    readonly onPickDoc: (doc: ScriptDoc) => void
    readonly revisions: readonly RevisionRow[]
  }) => {
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
          {doc === 'cover' ? `${title} · Title page` : title}
          <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-50" />
        </button>
        {open ? (
          <div role="menu" className="folio-menu absolute left-0 top-[40px] w-[300px]">
            <div role="tablist" aria-label="Document">
              <button
                type="button"
                role="tab"
                aria-selected={doc === 'script'}
                data-pick-doc="script"
                className="folio-menu-item"
                onMouseDown={keepCaret}
                onClick={() => {
                  onPickDoc('script')
                  setOpen(false)
                }}
              >
                Script
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={doc === 'cover'}
                data-pick-doc="cover"
                className="folio-menu-item"
                onMouseDown={keepCaret}
                onClick={() => {
                  onPickDoc('cover')
                  setOpen(false)
                }}
              >
                Title page
              </button>
            </div>
            <div className="mt-[4px] border-t border-line2 px-[9px] pb-[4px] pt-[8px]">
              <span className="folio-eyebrow">Revisions</span>
              {revisions.length === 0 ? (
                <p className="m-0 mt-[6px] text-12 leading-[1.5] text-ink3">No revision has been cut. The draft is on white paper until one is.</p>
              ) : (
                <div className="mt-[6px] flex flex-col gap-[8px]" data-revision-list>
                  {revisions.map((revision) => (
                    <div key={revision.id} className="flex flex-col">
                      <span className="text-12-5 text-ink">{revision.name}</span>
                      <span className="text-11 text-ink3">{revision.meta}</span>
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
DocumentMenu.displayName = 'DocumentMenu'

export type ActionsMenuProps = {
  readonly project: Project
  readonly pagination: PaginationControl
  readonly format: ScriptFormat
  readonly preferencesPending: boolean
  readonly preferencesNotice: string | null
  readonly onPickPagination: (control: PaginationControl) => void
  readonly onPickFormat: (format: ScriptFormat) => void
  readonly stats: ScriptStats
  readonly onImport: () => void
  readonly onExport: () => void
  readonly exporting: boolean
  readonly exportNotice: string | null
  readonly onUndo: () => void
  readonly canUndo: boolean
}

const Segment = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex flex-col gap-[6px] px-[9px] pt-[6px]">
    <span className="folio-eyebrow">{label}</span>
    <div role="radiogroup" aria-label={label} className="flex items-center gap-[2px] rounded-pill border border-line2 bg-s1 p-[3px]">
      {children}
    </div>
  </div>
)

export const ActionsMenu = memo(
  ({
    project,
    pagination,
    format,
    preferencesPending,
    preferencesNotice,
    onPickPagination,
    onPickFormat,
    stats,
    onImport,
    onExport,
    exporting,
    exportNotice,
    onUndo,
    canUndo,
  }: ActionsMenuProps) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    const radio = (checked: boolean) => `rounded-pill px-[10px] py-[4px] text-12 ${checked ? 'bg-s2 text-ink' : 'text-ink2'}`
    return (
      <div ref={root} className="relative">
        <button
          type="button"
          title="Document actions"
          aria-label="Document actions"
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
            <button type="button" role="menuitem" className="folio-menu-item" onMouseDown={keepCaret} onClick={() => { setOpen(false); onImport() }}>
              <Icon name="import" size={15} strokeWidth={1.4} className="text-ink3" />
              Import .fdx or .fountain
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={exporting}
              className="folio-menu-item"
              onMouseDown={keepCaret}
              onClick={() => {
                setOpen(false)
                onExport()
              }}
            >
              <Icon name="export" size={15} strokeWidth={1.4} className="text-ink3" />
              {exporting ? 'Exporting…' : 'Export as .fdx'}
            </button>
            <button type="button" role="menuitem" disabled={!canUndo} className="folio-menu-item" onMouseDown={keepCaret} onClick={onUndo}>
              <span className="w-[15px] text-center text-ink3">↩</span>
              Undo
              <kbd className="ml-auto font-sans text-11 text-ink3">⌘Z</kbd>
            </button>
            {exportNotice === null ? null : <p className="m-0 px-[9px] pb-[2px] pt-[4px] text-11-5 leading-[1.5] text-ink3">{exportNotice}</p>}

            <div className="mt-[4px] border-t border-line2 pb-[4px]">
              <Segment label="Pagination">
                {PAGINATION_CONTROLS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={pagination === entry}
                    disabled={preferencesPending}
                    title={PAGINATION_CONTROL_COPY[entry].note}
                    className={radio(pagination === entry)}
                    onMouseDown={keepCaret}
                    onClick={() => {
                      onPickPagination(entry)
                    }}
                  >
                    {PAGINATION_CONTROL_COPY[entry].label}
                  </button>
                ))}
              </Segment>
              <p className="m-0 px-[9px] pt-[4px] text-11 leading-[1.45] text-ink3">{PAGINATION_CONTROL_COPY[pagination].note}</p>
              <Segment label="Format">
                {FORMATS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={format === entry.id}
                    disabled={preferencesPending}
                    title={entry.page}
                    className={radio(format === entry.id)}
                    onMouseDown={keepCaret}
                    onClick={() => {
                      onPickFormat(entry.id)
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </Segment>
              <p className="m-0 px-[9px] pt-[4px] text-11 leading-[1.45] text-ink3">
                {FORMATS.find((entry) => entry.id === format)?.page} · {project.projectType === 'film' ? 'Film' : 'Series'}
              </p>
              {preferencesNotice === null ? null : (
                <p className="m-0 px-[9px] pt-[6px] text-11-5 text-live" role="alert">
                  {preferencesNotice}
                </p>
              )}
            </div>

            <div className="mt-[4px] border-t border-line2 px-[9px] pb-[4px] pt-[8px]">
              <span className="folio-eyebrow">Statistics</span>
              <div className="mt-[4px] flex flex-col">
                {(
                  [
                    ['Scenes', stats.scenes],
                    ['Words', stats.words],
                    ['Characters', stats.characters],
                    ['Locations', stats.locations],
                    ['Shots', stats.shots],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between border-b border-line2 py-[5px] last:border-b-0">
                    <span className="text-12 text-ink2">{label}</span>
                    <span className="tabular font-mono text-12 text-ink" data-stat={label.toLowerCase()}>
                      {value.toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
              <p className="m-0 pt-[6px] text-11 leading-[1.45] text-ink3">Counted from the document, not estimated. Notes are excluded.</p>
            </div>
          </div>
        ) : null}
      </div>
    )
  },
)
ActionsMenu.displayName = 'ActionsMenu'
