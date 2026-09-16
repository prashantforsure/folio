'use client'

import type { FrameState, ShotEdit, ShotRow, StoryboardScene } from '@folio/contracts'
import type { MentionLabel } from '@folio/script'
import { labelBook } from '@folio/script'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  acceptShots,
  addShot,
  cancelFrame,
  clearFrame,
  discardShots,
  moveShot,
  placeShot,
  placeShotOnCanvas,
  proposeShotsForScene,
  requestFrame,
  saveShot,
  uploadFrame,
} from '../../../../../../lib/storyboard/actions'
import { coverageOf, coverageRows, matchesFilter, sceneNo } from '../../../../../../lib/storyboard/board'
import type { ShotFilter, ShotSort } from '../../../../../../lib/storyboard/board'
import { publishBoardCoverage } from '../../../../../../lib/storyboard/coverage'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { BoardView } from './board-view'
import { CanvasView } from './canvas/canvas-view'
import { EmptyStoryboard } from './empty-storyboard'
import type { ShotHandlers, ViewProps } from './handlers'
import { ListView } from './list-view'
import { DisplayMenu } from './storyboard-toolbar'
import type { DisplayOptions, StoryboardView } from './storyboard-toolbar'

/**
 * The Storyboard route's body: the toolbar row, the banners, and one of
 * three views - inside the main-surface card the writing layout draws
 * (`docs/ui design/Route - Storyboard v2.dc.html`). The header, the
 * sidebar and the assistant are the shell's; the route has no status bar
 * since the redesign.
 *
 * ## One container, three layouts
 *
 * The rows, the selection, the filter, the sort, the display toggles, the
 * save state and every write live here; `board-view.tsx`,
 * `canvas/canvas-view.tsx` and `list-view.tsx` are layouts over `ViewProps`
 * and call back. They share the parts (`shot-parts.tsx`) and share no
 * state, so the three cannot disagree on what a shot is or what it can do.
 *
 * ## `?view=` is the URL; everything else is state
 *
 * The three views are `board | canvas | list`, a sub-view param
 * (`lib/workspace/params.ts`), so the pill's tabs are links. Which scene
 * is selected is component state - the Scenes ruling: selection is not a
 * URL, and `?selected=SCENE_xxx` waits on the id-shape decision (open
 * decision 10). The filter, the sort and the display toggles are component
 * state too: a filter is a way of looking, not an address. The selection
 * survives a `?view=` change because Next keys the page segment without
 * its search params, so this component stays mounted across the pill -
 * which is what lets the board's `Open` pick a scene and land on it.
 *
 * ## The list is the truth, and every write returns it
 *
 * `scenes` is the server's read, seeded from the route and patched by what
 * each action hands back: a scene write (propose, add, accept, discard,
 * move, place) returns that scene's whole list re-read and numbered; a
 * shot edit, a canvas drop, an upload and a clear return the one row; a
 * frame request returns the frame state
 * and the balance after the reservation. Nothing here computes a number or
 * a balance. After every change the coverage is published to the sidebar
 * (`lib/storyboard/coverage.ts`), which is where the count lives since the
 * redesign; the sidebar's Storyboard row (a row again since 2026-09-17)
 * prints the server's `38 shots` meta and is not republished.
 *
 * ## Cost is named before it is spent
 *
 * `available` is the ledger's computed balance, and every draw button
 * prints the cost beside its label. The server enforces; a short balance
 * comes back as `insufficient` with the numbers, and the banner says them.
 */

export type StoryboardWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly view: StoryboardView
  readonly baseHref: EpisodeRoutePath
  readonly scriptHref: EpisodeRoutePath
  readonly state: 'empty' | 'script'
  readonly scenes: readonly StoryboardScene[]
  readonly labels: readonly MentionLabel[]
  readonly available: number
  /** `null` when there is no script and so no frame to price. */
  readonly cost: number | null
  /** Whether the `R2_*` block is set, so `Upload image` can do anything. */
  readonly storage: boolean
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

export const StoryboardWorkspace = ({
  projectId,
  episode,
  view,
  baseHref,
  scriptHref,
  state,
  scenes: initialScenes,
  labels,
  available: initialAvailable,
  cost,
  storage,
}: StoryboardWorkspaceProps) => {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const [scenes, setScenes] = useState<readonly StoryboardScene[]>(initialScenes)
  const [available, setAvailable] = useState(initialAvailable)
  const [selected, setSelected] = useState<string | null>(initialScenes[0]?.sceneNodeId ?? null)
  const [filter, setFilter] = useState<ShotFilter>('all')
  const [sort, setSort] = useState<ShotSort>('sequence')
  const [display, setDisplay] = useState<DisplayOptions>({ descriptions: true, frames: true })
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pending = useRef(0)
  const book = useMemo(() => labelBook(labels), [labels])

  // The sidebar's `Boards` group and widget read this cell; cleared on unmount.
  const onPick = useCallback((sceneNodeId: string) => {
    setSelected(sceneNodeId)
  }, [])
  useEffect(() => {
    publishBoardCoverage({ rows: coverageRows(scenes), selectedId: selected, onPick })
  }, [onPick, scenes, selected])
  useEffect(
    () => () => {
      publishBoardCoverage(null)
    },
    [],
  )

  const run = useCallback(async (job: () => Promise<string | null>): Promise<void> => {
    pending.current += 1
    setSaveState({ kind: 'saving' })
    let failure: string | null
    try {
      failure = await job()
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
    } finally {
      pending.current -= 1
    }
    if (failure !== null) setSaveState({ kind: 'error', message: failure })
    else if (pending.current === 0) setSaveState({ kind: 'saved' })
  }, [])

  const replaceScene = useCallback((sceneNodeId: string, shots: readonly ShotRow[]) => {
    setScenes((current) => {
      const next = current.map((scene) => (scene.sceneNodeId === sceneNodeId ? { ...scene, shots: [...shots] } : scene))
      return next
    })
  }, [])

  const patchShot = useCallback((shotId: string, change: (shot: ShotRow) => ShotRow) => {
    setScenes((current) => {
      const next = current.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => (shot.id === shotId ? change(shot) : shot)),
      }))
      return next
    })
  }, [])

  const sceneWrite = useCallback(
    (sceneNodeId: string, write: () => ReturnType<typeof proposeShotsForScene>) => {
      void run(async () => {
        const result = await write()
        if (result.status !== 'saved') return result.message
        replaceScene(sceneNodeId, result.shots)
        return null
      })
    },
    [replaceScene, run],
  )

  const sceneOfShot = useCallback(
    (shotId: string): StoryboardScene | undefined => scenes.find((entry) => entry.shots.some((shot) => shot.id === shotId)),
    [scenes],
  )

  const handlers: ShotHandlers = useMemo(
    () => ({
      onPropose: (sceneNodeId) => {
        setSelected(sceneNodeId)
        sceneWrite(sceneNodeId, () => proposeShotsForScene(projectId, episode, sceneNodeId))
      },
      onAcceptAll: (sceneNodeId, shotIds) => {
        sceneWrite(sceneNodeId, () => acceptShots(projectId, episode, { sceneNodeId, shotIds }))
      },
      onAccept: (sceneNodeId, shotId) => {
        sceneWrite(sceneNodeId, () => acceptShots(projectId, episode, { sceneNodeId, shotIds: [shotId] }))
      },
      onDiscard: (sceneNodeId, shotId) => {
        sceneWrite(sceneNodeId, () => discardShots(projectId, episode, { sceneNodeId, shotIds: [shotId] }))
      },
      onSave: (shotId, edit: ShotEdit) => {
        void run(async () => {
          const result = await saveShot(projectId, episode, shotId, edit)
          if (result.status !== 'saved') return result.message
          patchShot(shotId, () => result.shot)
          return null
        })
      },
      onPlaceOnCanvas: (shotId, position) => {
        // Optimistic: the card is already where the pointer left it.
        patchShot(shotId, (shot) => ({ ...shot, canvasX: position.x, canvasY: position.y }))
        void run(async () => {
          const result = await placeShotOnCanvas(projectId, episode, shotId, position)
          if (result.status !== 'saved') return result.message
          patchShot(shotId, () => result.shot)
          return null
        })
      },
      onUploadFrame: (shotId, file) => {
        void run(async () => {
          const form = new FormData()
          form.set('frame', file)
          const result = await uploadFrame(projectId, episode, shotId, form)
          if (result.status !== 'saved') return result.message
          patchShot(shotId, () => result.shot)
          return null
        })
      },
      onClearFrame: (shotId) => {
        void run(async () => {
          const result = await clearFrame(projectId, episode, shotId)
          if (result.status !== 'saved') return result.message
          patchShot(shotId, () => result.shot)
          return null
        })
      },
      onAdd: (sceneNodeId, edit: ShotEdit) => {
        setSelected(sceneNodeId)
        sceneWrite(sceneNodeId, () => addShot(projectId, episode, sceneNodeId, edit))
      },
      onMove: (shotId, direction) => {
        const scene = sceneOfShot(shotId)
        if (scene === undefined) return
        sceneWrite(scene.sceneNodeId, () => moveShot(projectId, episode, shotId, direction))
      },
      onPlace: (shotId, index) => {
        const scene = sceneOfShot(shotId)
        if (scene === undefined) return
        sceneWrite(scene.sceneNodeId, () => placeShot(projectId, episode, shotId, index))
      },
      onDraw: (shotId) => {
        void run(async () => {
          const result = await requestFrame(projectId, episode, shotId)
          if (result.status === 'insufficient') {
            setAvailable(result.available)
            return `Not enough credits: ${String(result.available)} available, ${String(result.cost)} needed. Credits are bought in the Production header.`
          }
          if (result.status !== 'queued') return result.message
          const frame: FrameState = result.frame
          patchShot(shotId, (shot) => ({ ...shot, frame }))
          setAvailable(result.available)
          return null
        })
      },
      onCancelFrame: (jobId) => {
        void run(async () => {
          const result = await cancelFrame(projectId, episode, jobId)
          if (result.status === 'refused' || result.status === 'error') return result.message
          const frame: FrameState = result.frame
          setScenes((current) =>
            current.map((scene) => ({
              ...scene,
              shots: scene.shots.map((shot) =>
                'jobId' in shot.frame && shot.frame.jobId === jobId ? { ...shot, frame } : shot,
              ),
            })),
          )
          if (result.status === 'cancelled') setAvailable(result.available)
          return null
        })
      },
    }),
    [episode, patchShot, projectId, run, sceneOfShot, sceneWrite],
  )

  // ---------------------------------------------------------------------------
  // Figures
  // ---------------------------------------------------------------------------

  const coverage = coverageOf(coverageRows(scenes))
  const selectedScene = scenes.find((scene) => scene.sceneNodeId === selected) ?? null
  const empty = state === 'empty' ? 'no-script' : scenes.length === 0 ? 'no-scenes' : null
  const visible = useCallback((shot: ShotRow) => matchesFilter(shot, filter), [filter])

  const viewProps: ViewProps = {
    scenes,
    selected,
    onSelect: onPick,
    visible,
    display,
    sort,
    storage,
    canvasHref: { pathname: baseHref, query: { view: 'canvas' } },
    labels,
    book,
    cost: cost ?? 0,
    available,
    pending: saveState.kind === 'saving',
    handlers,
  }

  const countLabel =
    view === 'canvas' && selectedScene !== null
      ? `Scene ${sceneNo(selectedScene.number)} · ${String(selectedScene.shots.filter((shot) => shot.state === 'accepted').length)} ${
          selectedScene.shots.filter((shot) => shot.state === 'accepted').length === 1 ? 'shot' : 'shots'
        }`
      : `${String(coverage.shots)} ${coverage.shots === 1 ? 'shot' : 'shots'}`

  return (
    <main
      data-route="storyboard"
      data-sub-view={view}
      data-storyboard-state={empty ?? 'board'}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div data-storyboard-header data-mounted={mounted ? 'true' : 'false'} className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] pb-[12px] pt-[12px]">
        <div className="flex-1" />
        <span className="flex items-center gap-[7px] whitespace-nowrap text-12 text-ink3" data-storyboard-save data-save-state={saveState.kind}>
          <span className="tabular" data-shot-count>
            {countLabel}
          </span>
          {coverage.proposed > 0 ? (
            <>
              <span className="folio-dot" />
              <span className="tabular text-warn" data-proposed-count>
                {coverage.proposed} proposed
              </span>
            </>
          ) : null}
          <span className="folio-dot" />
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-live' : saveState.kind === 'saving' ? 'bg-warn' : 'bg-ok'}`} />
          {saveState.kind === 'saving' ? 'saving…' : saveState.kind === 'error' ? 'not saved' : 'saved'}
        </span>
        <DisplayMenu display={display} sort={sort} filter={filter} view={view} onDisplay={setDisplay} onSort={setSort} onFilter={setFilter} />
      </div>

      {saveState.kind === 'error' ? (
        <div role="alert" className="folio-banner" data-tone="live" data-storyboard-error>
          {saveState.message}
        </div>
      ) : null}

      {empty !== null ? (
        <EmptyStoryboard state={empty} scriptHref={scriptHref} />
      ) : view === 'board' ? (
        <BoardView view={viewProps} scriptHref={scriptHref} />
      ) : view === 'canvas' ? (
        <CanvasView view={viewProps} />
      ) : (
        <ListView view={viewProps} />
      )}
    </main>
  )
}
