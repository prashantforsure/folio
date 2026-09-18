'use client'

import type { StoryThreadId, StoryThreadRow, TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding, StoryJump } from '@folio/script'
import { formatStoryDay } from '@folio/script'
import type { NodeId } from '@folio/script'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import type { FindingBuckets, Grid, GridLanes, GridView } from '../../../../../../lib/timeline/view'
import { KIND_LABEL, cellOf, rulerOf, threadColourVar } from '../../../../../../lib/timeline/view'
import type { DrawerField } from './scene-drawer'
import type { CardMark } from './scene-card'
import { SCENE_DRAG_TYPE, SceneCard } from './scene-card'

/** Where a card was dropped: a story day (chronology), a row (a thread), or the unplaced strip. */
export type DropTarget = {
  readonly day: number | null
  readonly rowKey: string | null
  readonly unplace: boolean
}

/** The scene id a drop carries, or null when the drag is not a card. */
export const draggedScene = (event: DragEvent): NodeId | null => {
  const id = event.dataTransfer.getData(SCENE_DRAG_TYPE)
  return id === '' ? null : (id as NodeId)
}

/**
 * The lanes: threads (or the cast, or the sets) down, episodes or story
 * days across (`lib/timeline/view.ts`'s `gridOf` decides what goes where;
 * this draws it). A sticky header row - the eyebrow (`Episodes` / `Story
 * time`), then one column card per episode (`E1 · Standpipe · 104 pp · 5
 * placed · Day 1 → 3`) or per story day (`Day 2 · 3 scenes · 4 6/8 pp`; a
 * day every scene of which is a flashback prints `flashback` in `--warn`
 * on `--warn-bg`, and its cells take the tint), each day's head carrying
 * the ruler - a bar as long as the day's share of the fullest day's
 * pages, so a pile-up reads at a glance. One row per thread, its colour
 * bar, name and span sticky on the left; a `No thread` row last while any
 * scene has none. Each cell holds the cards of the scenes whose row and
 * column it is - and, on the thread lanes, a ghost of every scene on the
 * row's thread whose card sits in an earlier thread's row.
 *
 * ## Drag and keys (the placement phase)
 *
 * A card drags. In chronology a cell is a drop target: the scene takes the
 * column's day (its clock cleared, its flag kept) and, when the row is a
 * thread other than its first, that thread as its row; a trailing `＋ Day
 * N` column is a new day. In story order the columns are page order, so a
 * drop lands only in the card's own episode column and only the row
 * changes. Every drop is one of the workspace's writes, patched onto the
 * grid before the round trip.
 *
 * The grid is `role="grid"` with a roving tabindex: one card is in the
 * tab order, the arrows move between cards (←/→ along the row, ↑/↓ across
 * rows in the same column), `Enter` opens the drawer, `Escape` closes it,
 * `F` flips the flashback flag, `[` and `]` move the scene a day earlier
 * or later, `D` and `C` open the drawer on its Day or Clock field.
 *
 * A solo thread (the sidebar's click) dims every other row to 40% and
 * takes its cards out of the tab order; the find field hides the cards
 * that do not match. Neither is a sub-view: the columns and the rows stay,
 * so the writer keeps their bearings.
 */
export const LanesGrid = ({
  view,
  lanes,
  grid,
  threads,
  buckets,
  noteOf,
  jumps,
  selected,
  solo,
  newDay,
  matches,
  onOpen,
  onDrop,
  onNudge,
  onFlashback,
  onClose,
}: {
  readonly view: GridView
  readonly lanes: GridLanes
  readonly grid: Grid
  readonly threads: readonly StoryThreadRow[]
  readonly buckets: FindingBuckets
  readonly noteOf: (finding: ContinuityFinding) => string
  readonly jumps: ReadonlyMap<NodeId, StoryJump>
  readonly selected: NodeId | null
  readonly solo: StoryThreadId | null
  /** The day the trailing chronology column offers. */
  readonly newDay: number
  /** Whether a scene passes the find field; every scene does while it is empty. */
  readonly matches: (scene: TimelineSceneRow) => boolean
  readonly onOpen: (id: NodeId, field?: DrawerField | null) => void
  readonly onDrop: (id: NodeId, target: DropTarget) => void
  readonly onNudge: (id: NodeId, days: number) => void
  readonly onFlashback: (id: NodeId) => void
  readonly onClose: () => void
}) => {
  const root = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<NodeId | null>(null)
  /** The card an arrow key asked for; only that gets `.focus()` - a refresh must not scroll the grid back to the focused card. */
  const wanted = useRef<NodeId | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const threadById = useMemo(() => new Map<StoryThreadId, StoryThreadRow>(threads.map((thread) => [thread.id, thread])), [threads])
  const markOf = useMemo(() => {
    const map = new Map<NodeId, CardMark>()
    for (const finding of buckets.flagged) map.set(finding.sceneId, { kind: finding.kind === 'flashforward' ? 'flashforward' : 'flashback', text: noteOf(finding) })
    for (const finding of buckets.open) {
      if (!map.has(finding.sceneId)) map.set(finding.sceneId, { kind: 'flag', text: `${KIND_LABEL[finding.kind]}: ${noteOf(finding)}` })
    }
    return map
  }, [buckets, noteOf])
  const ruler = useMemo(() => (view === 'chrono' ? rulerOf(grid.columns) : null), [grid.columns, view])

  // The cards in reading order - row by row, column by column - for the arrow keys.
  const positions = useMemo(() => {
    const out: { readonly id: NodeId; readonly row: number; readonly column: number }[] = []
    grid.rows.forEach((row, rowIndex) => {
      if (solo !== null && row.threadId !== solo) return
      grid.columns.forEach((column, columnIndex) => {
        for (const card of cellOf(grid, row.key, column.key)) {
          if (card.ghost || !matches(card.scene)) continue
          out.push({ id: card.scene.sceneNodeId, row: rowIndex, column: columnIndex })
        }
      })
    })
    return out
  }, [grid, matches, solo])
  const tabbable = focused !== null && positions.some((entry) => entry.id === focused) ? focused : (positions.find((entry) => entry.id === selected)?.id ?? positions[0]?.id ?? null)

  useEffect(() => {
    if (focused === null || wanted.current !== focused) return
    wanted.current = null
    const node = root.current?.querySelector<HTMLButtonElement>(`[data-scene-card="${focused}"]`)
    if (node !== null && node !== undefined && document.activeElement !== node) node.focus()
  }, [focused])

  const move = useCallback(
    (from: NodeId, key: string): NodeId | null => {
      const at = positions.findIndex((entry) => entry.id === from)
      const here = positions[at]
      if (here === undefined) return null
      if (key === 'ArrowRight') return positions[at + 1]?.id ?? null
      if (key === 'ArrowLeft') return positions[at - 1]?.id ?? null
      if (key === 'Home') return positions.find((entry) => entry.row === here.row)?.id ?? null
      if (key === 'End') return [...positions].reverse().find((entry) => entry.row === here.row)?.id ?? null
      const direction = key === 'ArrowDown' ? 1 : -1
      const rows = [...new Set(positions.map((entry) => entry.row))].sort((a, b) => a - b)
      const rowAt = rows.indexOf(here.row)
      const nextRow = rows[rowAt + direction]
      if (nextRow === undefined) return null
      const inRow = positions.filter((entry) => entry.row === nextRow)
      const same = inRow.find((entry) => entry.column === here.column)
      const nearest = inRow.reduce<(typeof inRow)[number] | null>((best, entry) => (best === null || Math.abs(entry.column - here.column) < Math.abs(best.column - here.column) ? entry : best), null)
      return same?.id ?? nearest?.id ?? null
    },
    [positions],
  )

  const onKey = (id: NodeId) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        const next = move(id, event.key)
        if (next !== null) {
          wanted.current = next
          setFocused(next)
        }
        event.preventDefault()
        return
      }
      case 'Enter':
      case ' ':
        onOpen(id)
        event.preventDefault()
        return
      case 'Escape':
        onClose()
        return
      case 'f':
      case 'F':
        onFlashback(id)
        event.preventDefault()
        return
      case '[':
        onNudge(id, -1)
        event.preventDefault()
        return
      case ']':
        onNudge(id, 1)
        event.preventDefault()
        return
      case 'd':
      case 'D':
        onOpen(id, 'day')
        event.preventDefault()
        return
      case 'c':
      case 'C':
        onOpen(id, 'clock')
        event.preventDefault()
        return
      default:
    }
  }

  // A card is the only thing the grid accepts. Its id is readable on drop, not
  // during the drag (browsers hide it), so what a drop writes is decided in
  // the workspace: in story order the columns are page order and only the
  // row changes, whichever column the card lands in.
  const dragOver = (cellKey: string) => (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(SCENE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (over !== cellKey) setOver(cellKey)
  }
  const dragLeave = (cellKey: string) => () => {
    if (over === cellKey) setOver(null)
  }
  const dropOn = (target: DropTarget) => (event: DragEvent<HTMLDivElement>) => {
    const id = draggedScene(event)
    setOver(null)
    if (id === null) return
    event.preventDefault()
    onDrop(id, target)
  }

  const columns = view === 'chrono' && grid.columns.length > 0 ? [...grid.columns, null] : grid.columns
  const template = `168px ${columns.map(() => 'minmax(196px, 1fr)').join(' ')}`

  return (
    <div ref={root} className="min-h-0 min-w-0 flex-1 overflow-auto px-[20px] pb-[24px]" data-lanes-grid={view}>
      <div role="grid" aria-label={view === 'story' ? 'Scenes by lane and episode' : 'Scenes by lane and story day'} className="folio-lanes" style={{ gridTemplateColumns: template }}>
        <div role="row" className="contents">
          <div role="columnheader" className="folio-lane-head folio-eyebrow flex items-end pb-[8px]" data-axis="corner">
            {view === 'story' ? 'Episodes' : 'Story time'}
          </div>
          {columns.map((column, index) =>
            column === null ? (
              <div key="new-day" role="columnheader" className="folio-lane-head" data-axis="column" data-grid-column="new-day">
                <div className="folio-lane-column" data-flashback="false" data-new-day>
                  <span className="text-13 font-medium tracking-title text-ink3" data-column-name>
                    ＋ {formatStoryDay(newDay)}
                  </span>
                  <span className="tabular truncate font-mono text-10-5 text-ink3">drop a scene here</span>
                </div>
              </div>
            ) : (
              <div key={column.key} role="columnheader" className="folio-lane-head" data-axis="column" data-grid-column={column.key}>
                <div className="folio-lane-column" data-flashback={column.flashback ? 'true' : 'false'}>
                  <span className="flex items-baseline gap-[6px]">
                    <span className="text-13 font-medium tracking-title" data-column-name>
                      {column.name}
                    </span>
                    {column.sub === '' ? null : <span className="min-w-0 truncate text-10-5 text-ink3">{column.sub}</span>}
                  </span>
                  <span className="tabular truncate font-mono text-10-5 text-ink3">{column.meta}</span>
                  {ruler === null ? null : (
                    <span className="folio-lane-ruler" data-lane-ruler title={column.meta}>
                      <span style={{ width: `${String(Math.round((ruler[index] ?? 0) * 100))}%` }} />
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        {grid.columns.length === 0 ? (
          <div role="row" className="contents">
            <div role="gridcell" className="col-span-full pt-[12px] text-12-5 text-ink3" data-lanes-empty>
              {view === 'story' ? 'No episode has a scene yet.' : 'No scene has a story time yet. Pick one in story order and give it a day, or drag one up from the strip below.'}
            </div>
          </div>
        ) : (
          grid.rows.map((row) => {
            const dimmed = solo !== null && row.threadId !== solo
            const colour = row.colour === null ? null : threadColourVar(row.colour)
            return (
              <div key={row.key} role="row" className="folio-lane-row" data-grid-row={row.key} data-dimmed={dimmed ? 'true' : 'false'}>
                <div role="rowheader" className="folio-lane-head flex flex-col gap-[3px]" data-axis="row">
                  <span className="flex items-center gap-[8px]">
                    <span aria-hidden="true" className="h-[14px] w-[3px] flex-none rounded-[2px]" style={{ background: colour ?? 'var(--line)' }} />
                    <span className="min-w-0 truncate text-12-5 font-medium">{row.name}</span>
                  </span>
                  <span className="truncate pl-[11px] text-10-5 text-ink3">{row.span}</span>
                </div>
                {columns.map((column) => {
                  const cellKey = `${row.key}:${column?.key ?? 'new-day'}`
                  const target: DropTarget = { day: column === null ? newDay : column.day, rowKey: lanes === 'thread' ? row.key : null, unplace: false }
                  const cards = column === null ? [] : cellOf(grid, row.key, column.key).filter((card) => matches(card.scene))
                  return (
                    <div
                      key={cellKey}
                      role="gridcell"
                      className="folio-lane-cell"
                      data-flashback={column?.flashback ? 'true' : 'false'}
                      data-drop-target={over === cellKey ? 'over' : undefined}
                      data-cell={cellKey}
                      onDragOver={dragOver(cellKey)}
                      onDragLeave={dragLeave(cellKey)}
                      onDrop={dropOn(target)}
                    >
                      {cards.map((card) => (
                        <SceneCard
                          key={`${card.scene.sceneNodeId}${card.ghost ? ':ghost' : ''}`}
                          scene={card.scene}
                          view={view}
                          colour={colour}
                          selected={card.scene.sceneNodeId === selected}
                          mark={markOf.get(card.scene.sceneNodeId) ?? null}
                          jump={view === 'story' && !card.scene.flashback ? (jumps.get(card.scene.sceneNodeId) ?? null) : null}
                          also={
                            card.ghost
                              ? []
                              : card.scene.threads.slice(1).flatMap((id) => {
                                  const thread = threadById.get(id)
                                  return thread === undefined ? [] : [thread]
                                })
                          }
                          ghost={card.ghost}
                          dimmed={dimmed}
                          tabbable={tabbable === card.scene.sceneNodeId}
                          onOpen={() => {
                            onOpen(card.scene.sceneNodeId)
                          }}
                          onFocus={() => {
                            if (!card.ghost) setFocused(card.scene.sceneNodeId)
                          }}
                          onKeyDown={card.ghost ? undefined : onKey(card.scene.sceneNodeId)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
