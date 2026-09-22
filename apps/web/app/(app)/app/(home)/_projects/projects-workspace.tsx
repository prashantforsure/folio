'use client'

import type { ProjectCard as Card } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'

import { useDismiss } from '../../../../../lib/chrome/use-dismiss'
import {
  archiveProjects,
  duplicateProjects,
  editProject,
  trashProjects,
} from '../../../../../lib/projects/actions'
import { IDLE } from '../../../../../lib/projects/result'
import {
  FILTER_LABEL,
  PROJECT_FILTERS,
  PROJECT_SORTS,
  SORT_LABEL,
  countLabel,
  filterCounts,
  isArchived,
  matchesFilter,
  sortCards,
} from '../../../../../lib/projects/view'
import type { ProjectFilter, ProjectLayout, ProjectSort } from '../../../../../lib/projects/view'
import { workspaceHref } from '../../../../../lib/projects/workspace'
import { RouteFrame } from '../../../_shell/route-frame'
import type { CardAction } from './card-menu'
import { NewProjectDialog } from './new-project-dialog'
import { ProjectCard } from './project-card'
import { ProjectRow } from './project-row'

/**
 * The Projects route's body: the toolbar, the chips, the two layouts, the
 * selection and every write the route makes.
 *
 * One container over two layouts is the shape the Storyboard and Scenes both
 * settled on: the state, the filtering and the actions live here, and
 * `project-card.tsx` and `project-row.tsx` only draw. So a chip, a sort or a
 * selection cannot mean two things depending on which layout is showing.
 *
 * ## Everything here is client state, and the URL never moves
 *
 * The filter, the sort, the layout and the selection are `useState`. AGENTS.md
 * makes a sub-view a query param and a query param "ask first"; the rulings
 * since 2026-09-16 have made every route's views client state for the same
 * reason the client gave then - switching must be smooth and the address must
 * not change. A stale `/app/projects?view=list` opens the grid rather than a
 * 404, because nothing here reads the query.
 *
 * ## The writes
 *
 * Four server actions, each with the membership gate inside it
 * (`lib/projects/actions.ts`): rename, archive, trash and the duplicate that
 * refuses. Each revalidates `/app`, so the list, the sidebar's count and the
 * credits card come back together. Nothing is optimistic: a card does not
 * move until the server says it moved, which is what keeps this list and the
 * database the same list.
 */
export const ProjectsWorkspace = ({
  cards,
  me,
  trashed,
  crumbs,
  now: nowIso,
}: {
  readonly cards: readonly Card[]
  readonly me: string
  readonly trashed: number
  /** The header's breadcrumb, read on the server where the name is. */
  readonly crumbs: readonly string[]
  readonly now: string
}) => {
  const router = useRouter()
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [sort, setSort] = useState<ProjectSort>('recent')
  const [layout, setLayout] = useState<ProjectLayout>('grid')
  const [sortOpen, setSortOpen] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [lastTouched, setLastTouched] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Card | null>(null)

  const [archiveResult, archive] = useActionState(archiveProjects, IDLE)
  const [trashResult, trash] = useActionState(trashProjects, IDLE)
  const [duplicateResult, duplicate] = useActionState(duplicateProjects, IDLE)

  const counts = useMemo(() => filterCounts(cards, me), [cards, me])
  const visible = useMemo(
    () => sortCards(cards.filter((card) => matchesFilter(card, filter, me)), sort),
    [cards, filter, me, sort],
  )

  const sortRoot = useRef<HTMLDivElement>(null)
  useDismiss(sortOpen, () => {
    setSortOpen(false)
  }, sortRoot)

  /*
   * A card that leaves the list - trashed, or archived out from under the
   * chip - must not stay selected, or the bulk bar counts something nobody
   * can see. Narrowing at render rather than pruning in an effect: the
   * selection is then a function of what is on screen, and there is no frame
   * in which the two disagree.
   */
  const visibleIds: readonly string[] = visible.map((card) => card.project.id)
  const selected = picked.filter((id) => visibleIds.includes(id))

  const post = (action: (data: FormData) => void, ids: readonly string[], extra?: Record<string, string>): void => {
    const data = new FormData()
    for (const id of ids) data.append('projectId', id)
    for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value)
    action(data)
  }

  const onAct = (card: Card, action: CardAction): void => {
    if (action === 'open') {
      router.push(workspaceHref(card.project, card.openingEpisode))
      return
    }
    if (action === 'rename') {
      setRenaming(card)
      return
    }
    if (action === 'duplicate') {
      post(duplicate, [card.project.id])
      return
    }
    if (action === 'archive') {
      post(archive, [card.project.id], { archived: isArchived(card) ? '0' : '1' })
      return
    }
    post(trash, [card.project.id])
  }

  const toggle = (id: string, extend: boolean): void => {
    setLastTouched(id)
    if (extend && lastTouched !== null) {
      const from = visibleIds.indexOf(lastTouched)
      const to = visibleIds.indexOf(id)
      if (from !== -1 && to !== -1) {
        const range = visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)
        setPicked((current) => [...new Set([...current, ...range])])
        return
      }
    }
    setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  const refusal =
    duplicateResult.status === 'error'
      ? duplicateResult.message
      : archiveResult.status === 'error'
        ? archiveResult.message
        : trashResult.status === 'error'
          ? trashResult.message
          : null

  const selectedCards = cards.filter((card) => selected.includes(card.project.id))
  const allSelectedArchived = selectedCards.length > 0 && selectedCards.every(isArchived)

  /*
   * The frame is this component's rather than the page's, and `scroll={false}`
   * with it: the toolbar and the chips are a fixed strip and only the grid
   * below them moves, which is what keeps a filter reachable while a long
   * list is scrolled. Settings does the same for the same reason.
   */
  return (
    <RouteFrame crumbs={crumbs} scroll={false}>
      <div className="flex flex-none flex-col gap-[14px] border-b border-line2 px-[22px] pb-[14px] pt-[20px]">
        <div className="flex flex-wrap items-end gap-[14px]">
          <h2 className="m-0 min-w-[220px] flex-1 text-25 font-normal tracking-page">Projects</h2>
          <div className="flex items-center gap-[8px]">
            <Link href="/app/trash" className="folio-pill-button h-[32px] rounded-[9px] px-[11px] text-12-5 leading-[30px]">
              Trash <span className="tabular font-mono text-11 text-ink3">{trashed}</span>
            </Link>

            <div ref={sortRoot} className="relative">
              <button
                type="button"
                onClick={() => {
                  setSortOpen((open) => !open)
                }}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                className="folio-pill-button flex h-[32px] items-center gap-[8px] rounded-[9px] border-line px-[11px] text-12-5"
              >
                <Icon name="sort" size={14} strokeWidth={1.4} />
                {SORT_LABEL[sort]}
              </button>
              {sortOpen ? (
                <div role="menu" aria-label="Sort" className="folio-menu absolute right-0 top-[38px] w-[196px]">
                  {PROJECT_SORTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sort === value}
                      aria-current={sort === value ? 'true' : undefined}
                      onClick={() => {
                        setSort(value)
                        setSortOpen(false)
                      }}
                      className="folio-menu-item text-12-5"
                    >
                      {SORT_LABEL[value]}
                      {sort === value ? <span className="ml-auto text-accent">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="folio-pill-group" role="group" aria-label="Layout">
              <button
                type="button"
                aria-pressed={layout === 'grid'}
                onClick={() => {
                  setLayout('grid')
                }}
                title="Grid"
              >
                <Icon name="grid" size={15} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-pressed={layout === 'list'}
                onClick={() => {
                  setLayout('list')
                }}
                title="List"
              >
                <Icon name="list" size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[7px]">
          {PROJECT_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value)
              }}
              className="folio-chip"
            >
              {FILTER_LABEL[value]}
              <span className="folio-chip-count">{counts[value]}</span>
            </button>
          ))}
          <span className="flex-1" />
          {selected.length > 0 ? (
            <span className="flex h-[28px] items-center gap-[8px] rounded-pill border border-accent bg-accent-bg pl-[11px] pr-[6px] text-12">
              <span className="tabular">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => {
                  post(duplicate, selected)
                }}
                className="folio-ghost-button h-[20px] rounded-pill px-[8px] text-11-5 text-ink2"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  post(archive, selected, { archived: allSelectedArchived ? '0' : '1' })
                }}
                className="folio-ghost-button h-[20px] rounded-pill px-[8px] text-11-5 text-ink2"
              >
                {allSelectedArchived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => {
                  post(trash, selected)
                }}
                className="folio-ghost-button h-[20px] rounded-pill px-[8px] text-11-5 text-live"
              >
                Move to trash
              </button>
              <button
                type="button"
                onClick={() => {
                  setPicked([])
                }}
                aria-label="Clear selection"
                className="folio-ghost-button grid h-[20px] w-[20px] place-items-center rounded-full text-11 text-ink3"
              >
                <Icon name="close" size={11} strokeWidth={1.5} />
              </button>
            </span>
          ) : null}
        </div>

        {refusal === null ? null : (
          <p role="alert" className="m-0 rounded-card border border-line2 bg-s1 px-[11px] py-[9px] text-11-5 leading-[1.5] text-ink2">
            {refusal}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {cards.length === 0 ? (
          <EmptyProjects
            onCreate={() => {
              setCreating(true)
            }}
          />
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-[16px] px-[22px] pb-[40px] pt-[18px]">
            <button
              type="button"
              onClick={() => {
                setCreating(true)
              }}
              className="flex min-h-[300px] flex-col items-start gap-[8px] rounded-[15px] border border-dashed border-line bg-transparent p-[18px] text-left hover:border-accent-line hover:bg-accent-bg"
            >
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-s2 text-ink2">
                <Icon name="plus" size={16} strokeWidth={1.5} />
              </span>
              <span className="h-[6px]" />
              <span className="text-14 font-medium tracking-title">New script</span>
              <p className="m-0 text-12-5 leading-[1.55] text-ink3">
                Scenes, characters and locations are derived from what you write, never kept
                separately.
              </p>
              <span className="flex-1" />
              <span className="font-mono text-10-5 text-ink3">US Letter or A4 · Courier 12pt</span>
            </button>

            {visible.map((card) => (
              <ProjectCard
                key={card.project.id}
                card={card}
                now={now}
                selected={selected.includes(card.project.id)}
                menuOpen={menu === card.project.id}
                onMenu={() => {
                  setMenu((current) => (current === card.project.id ? null : card.project.id))
                }}
                onAct={(action) => {
                  onAct(card, action)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="px-[22px] pb-[40px] pt-[18px]">
            <div className="overflow-x-auto rounded-[15px] border border-line2 bg-s1">
              <div className="folio-list-row folio-eyebrow text-10-5" data-head="true">
                <span />
                <span>Project</span>
                <span>Kind</span>
                <span>Stage</span>
                <span>Length</span>
                <span>Team</span>
                <span>Edited</span>
                <span />
              </div>
              {visible.map((card) => (
                <ProjectRow
                  key={card.project.id}
                  card={card}
                  now={now}
                  selected={selected.includes(card.project.id)}
                  menuOpen={menu === card.project.id}
                  onMenu={() => {
                    setMenu((current) => (current === card.project.id ? null : card.project.id))
                  }}
                  onAct={(action) => {
                    onAct(card, action)
                  }}
                  onToggle={(extend) => {
                    toggle(card.project.id, extend)
                  }}
                />
              ))}
              <div className="flex min-w-[860px] items-center gap-[10px] px-[14px] py-[11px] text-11-5 text-ink3">
                <span className="flex-1">{countLabel(visible)}</span>
                <span className="font-mono text-11">shift-click to select a range</span>
              </div>
            </div>
          </div>
        )}

        {cards.length > 0 && visible.length === 0 ? (
          <p className="m-0 px-[22px] pb-[30px] text-12-5 text-ink3">
            Nothing under {FILTER_LABEL[filter].toLocaleLowerCase()}.
          </p>
        ) : null}
      </div>

      <NewProjectDialog
        open={creating}
        kind="screenwriting"
        onClose={() => {
          setCreating(false)
        }}
      />
      <RenameDialog
        card={renaming}
        onClose={() => {
          setRenaming(null)
        }}
      />
    </RouteFrame>
  )
}

/** The empty state: a sheet, what this list is for, and the two ways in. */
const EmptyProjects = ({ onCreate }: { readonly onCreate: () => void }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-[26px] px-[24px] py-[70px]">
    <div
      aria-hidden="true"
      className="relative h-[158px] w-[126px] rotate-[-4deg] rounded-[6px] border border-line bg-sunk px-[17px] py-[20px] font-mono text-8 leading-[1.75] text-ink3"
    >
      <span className="block">FADE IN:</span>
      <span className="mt-[7px] block h-[5px] rounded-[2px] bg-s3" />
      <span className="mt-[5px] block h-[5px] w-[72%] rounded-[2px] bg-s3" />
      <span className="mt-[5px] block h-[5px] w-[86%] rounded-[2px] bg-s3" />
      <span className="absolute right-[10px] top-[9px]">1.</span>
    </div>
    <div className="flex max-w-[430px] flex-col gap-[8px] text-center">
      <span className="text-20 font-normal tracking-page">No projects yet</span>
      <p className="m-0 text-13 leading-[1.6] text-ink2">
        Everything you belong to lives here, most recently edited first. Start one and it appears
        at the top.
      </p>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-[9px]">
      <button type="button" onClick={onCreate} className="folio-solid-button h-[34px] rounded-pill px-[15px] text-13 font-medium">
        New project
      </button>
      <button type="button" onClick={onCreate} className="folio-pill-button h-[34px] rounded-pill border-line px-[15px] text-12-5">
        Import a Final Draft file
      </button>
    </div>
  </div>
)

/**
 * Rename, in the dialog the `⋯` menu opens - and the logline with it, which
 * is the other thing about a project that is a sentence somebody wrote and
 * the only other one the card prints. One dialog, one action, one write.
 */
const RenameDialog = ({ card, onClose }: { readonly card: Card | null; readonly onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const [result, action] = useActionState(editProject, IDLE)

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (card !== null && !element.open) element.showModal()
    if (card === null && element.open) element.close()
  }, [card])

  useEffect(() => {
    if (result.status === 'done') onClose()
  }, [onClose, result])

  return (
    <dialog
      ref={dialog}
      data-rename-project
      aria-label="Rename project"
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(440px,92vw)] rounded-panel border border-line bg-bg p-0 text-ink backdrop:bg-scrim"
    >
      {card === null ? null : (
        <form action={action} className="flex flex-col">
          <input type="hidden" name="projectId" value={card.project.id} />
          <div className="flex flex-col gap-[12px] px-[18px] pb-[14px] pt-[16px]">
            <h2 className="m-0 text-15 font-medium tracking-title">Rename {card.project.title}</h2>
            <label className="flex flex-col gap-[7px]">
              <span className="folio-eyebrow text-10-5">Name</span>
              <input
                name="title"
                type="text"
                required
                maxLength={200}
                defaultValue={card.project.title}
                autoComplete="off"
                className="folio-field h-[36px] rounded-[10px] border-line bg-s1 text-13"
              />
            </label>
            <label className="flex flex-col gap-[7px]">
              <span className="folio-eyebrow text-10-5">What it is about</span>
              <textarea
                name="logline"
                rows={2}
                maxLength={600}
                defaultValue={card.project.logline ?? ''}
                placeholder="One or two sentences. Shown on the card."
                className="folio-field min-h-[54px] resize-y rounded-[10px] border-line bg-s1 text-13 leading-[1.5]"
              />
            </label>
            {result.status === 'error' ? (
              <p role="alert" className="m-0 text-10-5 text-live">
                {result.message}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-[8px] border-t border-line2 bg-s1 px-[18px] py-[12px]">
            <button type="button" onClick={onClose} className="folio-pill-button h-[31px] rounded-pill px-[13px] text-12-5">
              Cancel
            </button>
            <button type="submit" className="folio-solid-button h-[31px] rounded-pill px-[15px] text-12-5 font-medium">
              Save
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
