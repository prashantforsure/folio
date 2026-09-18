'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import type { NodeId, ScriptFormat } from '@folio/script'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { UnacceptedHeading } from '../../../../../../lib/scenes/excerpt'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { ABSENT, count } from '../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { SceneCanvas } from './canvas/scene-canvas'
import { IndexView } from './index-view'
import { ListView } from './list-view'
import { SceneDetail } from './scene-detail'
import { sceneNo } from './scene-parts'
import { ScriptModal } from './script-modal'
import { UnacceptedList } from './unaccepted'
import { VIEW_LABEL, useScenesView } from './view-state'

/**
 * The Scenes route's body (2026-09-17, "Redesign phase 8" in
 * `docs/build-decisions.md`): the toolbar row, the banners, and one of
 * three views over the same cards - inside the main-surface card the
 * writing layout draws, on the Storyboard workspace's pattern. The header,
 * the sidebar and the assistant are the shell's; the route has no page
 * header and no status bar since the redesign (the README: the writing
 * routes have none).
 *
 * ## One container, three layouts
 *
 * The selection, the saved synopses, which dialog is open and the one
 * write live here; `canvas/scene-canvas.tsx`, `index-view.tsx` and
 * `list-view.tsx` are layouts over the same `SceneCard[]` and call back.
 * Which of the three is drawn is the cell the header's tabs set
 * (`view-state.tsx`, ruled 2026-09-17: state, not `?view=` - a click
 * switches the layout here and the URL stays `/scenes`); nothing in this
 * file is an address.
 *
 * ## Selection is component state
 *
 * The client ruled it (2026-09-11): no `/scenes/:sceneId`, no scene id in
 * the URL. A click on a card selects it; `Edit` (or the card's `No
 * synopsis yet`) opens the detail dialog; the card's script tile opens the
 * reading modal. On the index and the list a click opens the detail, as
 * the ruling's "detail card in place" always did. None of it survives a
 * reload, and none of it is meant to.
 *
 * ## The one write
 *
 * The synopsis, from the detail dialog through `saveSynopsis`. After a
 * save the server revalidates and the new value arrives in props; `saved`
 * is the transient copy every view prints until it does, and the toolbar
 * says `synopsis saved` the way the Storyboard's says `saved`.
 */
export const SceneWorkspace = ({
  projectId,
  episode,
  format,
  productionHref,
  scenes,
  totalPages,
  measured,
  stale,
  unaccepted,
}: {
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  /** The project's script format: the reading modal opens on it. */
  readonly format: ScriptFormat
  readonly productionHref: EpisodeRoutePath
  readonly scenes: readonly SceneCard[]
  /** `measurements.total_pages`, or `null` when the script has never been measured. */
  readonly totalPages: number | null
  readonly measured: boolean
  /** The measurement's node digest no longer matches the node list. */
  readonly stale: boolean
  readonly unaccepted: readonly UnacceptedHeading[]
}) => {
  // Hydrated: the E2E walk waits for `data-mounted` before its first click, as the
  // Storyboard's does - a click before hydration is replayed only once it finishes.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // The view the header's tabs set; the route's root resets it on unmount.
  const view = useScenesView()

  const [selected, setSelected] = useState<NodeId | null>(null)
  const [editing, setEditing] = useState<{ readonly id: NodeId; readonly focus: boolean } | null>(null)
  const [reading, setReading] = useState<NodeId | null>(null)
  const [saved, setSaved] = useState<Readonly<Record<string, string | null>>>({})
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const synopsisOf = useCallback(
    (card: SceneCard): string | null => (card.derived.sceneNodeId in saved ? (saved[card.derived.sceneNodeId] ?? null) : card.derived.synopsis),
    [saved],
  )
  const cardOf = useCallback((id: NodeId | null): SceneCard | null => (id === null ? null : (scenes.find((card) => card.derived.sceneNodeId === id) ?? null)), [scenes])

  const select = useCallback((id: NodeId) => {
    setSelected(id)
  }, [])
  const edit = useCallback((id: NodeId, focus = false) => {
    setSelected(id)
    setReading(null)
    setEditing({ id, focus })
  }, [])
  const read = useCallback((id: NodeId) => {
    setSelected(id)
    setEditing(null)
    setReading(id)
  }, [])
  const closeEditor = useCallback(() => {
    setEditing(null)
  }, [])
  const closeReader = useCallback(() => {
    setReading(null)
  }, [])
  const onSaved = useCallback((id: NodeId, synopsis: string | null) => {
    setSaved((current) => ({ ...current, [id]: synopsis }))
    setLastSavedAt(Date.now())
  }, [])

  const current = useMemo(() => cardOf(selected), [cardOf, selected])
  const editingCard = useMemo(() => (editing === null ? null : cardOf(editing.id)), [cardOf, editing])
  const readingCard = useMemo(() => cardOf(reading), [cardOf, reading])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-scene-board data-scene-count={scenes.length} data-scene-view={view}>
      <div data-scenes-header data-mounted={mounted ? 'true' : 'false'} className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] pb-[12px] pt-[12px]">
        {current === null ? (
          <span className="text-12-5 text-ink3">{VIEW_LABEL[view]}</span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-[8px]" data-selected-scene>
            <span className="text-13-5 font-medium">Scene {sceneNo(current.derived.number)}</span>
            <span className="truncate font-mono text-11 text-ink3">{current.derived.heading}</span>
          </span>
        )}
        <div className="flex-1" />
        <span className="flex items-center gap-[7px] whitespace-nowrap text-12 text-ink3">
          <span className="tabular" data-scene-count>
            {count(scenes.length)} scene{scenes.length === 1 ? '' : 's'} · {totalPages === null ? ABSENT : count(totalPages)} page
            {totalPages === 1 ? '' : 's'}
          </span>
          {lastSavedAt === null ? null : (
            <>
              <span className="folio-dot" />
              <span className="h-[6px] w-[6px] rounded-full bg-ok" />
              synopsis saved
            </>
          )}
        </span>
      </div>

      {measured && !stale ? null : (
        <div className="folio-banner" data-tone="warn" data-measurement-notice>
          <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
          {measured
            ? 'The measurement record is older than the script: pages and eighths were measured against an earlier draft and are shown as recorded, not recomputed.'
            : 'This script has no measurement record yet. Pages and eighths show — until it is paginated; nothing here estimates them.'}
        </div>
      )}

      {unaccepted.length === 0 ? null : (
        <div className="folio-banner" data-tone="warn">
          <UnacceptedList unaccepted={unaccepted} />
        </div>
      )}

      {view === 'cards' ? (
        <SceneCanvas projectId={projectId} scenes={scenes} synopsisOf={synopsisOf} selected={selected} productionHref={productionHref} onSelect={select} onEdit={edit} onRead={read} />
      ) : view === 'index' ? (
        <IndexView projectId={projectId} scenes={scenes} synopsisOf={synopsisOf} selected={selected} onOpen={edit} />
      ) : (
        <ListView projectId={projectId} scenes={scenes} synopsisOf={synopsisOf} selected={selected} onOpen={edit} />
      )}

      {editing === null || editingCard === null ? null : (
        <SceneDetail
          key={editingCard.derived.sceneNodeId}
          card={editingCard}
          synopsis={synopsisOf(editingCard)}
          focusEditor={editing.focus}
          projectId={projectId}
          episode={episode}
          productionHref={productionHref}
          onClose={closeEditor}
          onRead={() => {
            read(editingCard.derived.sceneNodeId)
          }}
          onSaved={onSaved}
        />
      )}

      {readingCard === null ? null : <ScriptModal key={readingCard.derived.sceneNodeId} card={readingCard} format={format} onClose={closeReader} />}
    </div>
  )
}
