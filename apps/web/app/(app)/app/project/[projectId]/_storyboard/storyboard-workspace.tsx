'use client'

import type { FrameState, ShotEdit, ShotRow, StoryboardScene } from '@folio/contracts'
import type { MentionLabel } from '@folio/script'
import { labelBook } from '@folio/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  acceptShots,
  addShot,
  cancelFrame,
  discardShots,
  moveShot,
  proposeShotsForScene,
  requestFrame,
  saveShot,
} from '../../../../../../lib/storyboard/actions'
import { useSession } from '../../../../../../lib/state/session'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { EmptyStoryboard } from './empty-storyboard'
import { SceneColumn } from './scene-column'
import type { ShotHandlers } from './scene-column'
import { ShotCanvas } from './shot-canvas'
import { ShotList } from './shot-list'
import { ShotEditor } from './shot-parts'

/**
 * The Storyboard route's main column: the 46px header (title, live count,
 * the `Storyboard / Canvas / Shot list` segment, the credit balance), the
 * 40px subheader (the view's hint, `Add shot`), the view, the 28px footer
 * (`N scenes · M shots · view · selected scene`, then nav toggle and the
 * route id). `Route - Storyboard.dc.html`, with the tokens in place of its
 * hexes.
 *
 * ## `?view=` is the URL; everything else is state
 *
 * The three views are `board | canvas | list`, a sub-view param
 * (`lib/workspace/params.ts`), so the tabs are links. Which scene is
 * selected is component state - the Scenes ruling: selection is not a URL,
 * and `?selected=SCENE_xxx` waits on the id-shape decision.
 *
 * ## The list is the truth, and every write returns it
 *
 * `scenes` is the server's read, seeded from the route and patched by what
 * each action hands back: a scene write (propose, add, accept, discard,
 * move) returns that scene's whole list re-read and numbered; a shot edit
 * returns the one row; a frame request returns the frame state and the
 * balance after the reservation. Nothing here computes a number or a
 * balance. The nav's Storyboard row is written in place after a write
 * that changed the accepted count.
 *
 * ## Cost is named before it is spent
 *
 * `available` is the ledger's computed balance, printed in the header and
 * on every frame button beside the cost. The server enforces; a short
 * balance comes back as `insufficient` with the numbers, and the banner
 * says them.
 */

export type StoryboardView = 'board' | 'canvas' | 'list'

export type StoryboardWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly routeId: string
  readonly view: StoryboardView
  readonly baseHref: EpisodeRoutePath
  readonly scriptHref: EpisodeRoutePath
  readonly productionHref: EpisodeRoutePath
  readonly state: 'empty' | 'script'
  readonly scenes: readonly StoryboardScene[]
  readonly labels: readonly MentionLabel[]
  readonly available: number
  /** `null` when there is no script and so no frame to price. */
  readonly cost: number | null
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

const VIEW_LABEL: Record<StoryboardView, string> = {
  board: 'Scene boards',
  canvas: 'Shot canvas',
  list: 'Shot list',
}

const writeNavShots = (count: number): void => {
  const row = document.querySelector('[data-nav-meta="storyboard"]')
  if (row !== null) row.textContent = `${String(count)} ${count === 1 ? 'shot' : 'shots'}`
}

const BLANK_SHOT: ShotEdit = {
  size: 'ms',
  movement: 'static',
  angle: 'eye_level',
  lensMm: 50,
  durationSeconds: null,
  description: [],
}

const acceptedIn = (scenes: readonly StoryboardScene[]): number =>
  scenes.reduce((total, scene) => total + scene.shots.filter((shot) => shot.state === 'accepted').length, 0)

export const StoryboardWorkspace = ({
  projectId,
  episode,
  routeId,
  view,
  baseHref,
  scriptHref,
  productionHref,
  state,
  scenes: initialScenes,
  labels,
  available: initialAvailable,
  cost,
}: StoryboardWorkspaceProps) => {
  const router = useRouter()
  const session = useSession()
  const [mounted, setMounted] = useState(false)
  const [viewport, setViewport] = useState(1440)
  useEffect(() => {
    setMounted(true)
    const read = (): void => {
      setViewport(window.innerWidth)
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
    }
  }, [])
  const navOpen = (mounted ? session.navOpen : null) ?? viewport >= 1000
  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  const [scenes, setScenes] = useState<readonly StoryboardScene[]>(initialScenes)
  const [available, setAvailable] = useState(initialAvailable)
  const [selected, setSelected] = useState<string | null>(initialScenes[0]?.sceneNodeId ?? null)
  const [adding, setAdding] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pending = useRef(0)
  const book = useMemo(() => labelBook(labels), [labels])

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
      writeNavShots(acceptedIn(next))
      return next
    })
  }, [])

  const patchShot = useCallback((shotId: string, change: (shot: ShotRow) => ShotRow) => {
    setScenes((current) =>
      current.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => (shot.id === shotId ? change(shot) : shot)),
      })),
    )
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
      onSave: (shotId, edit) => {
        void run(async () => {
          const result = await saveShot(projectId, episode, shotId, edit)
          if (result.status !== 'saved') return result.message
          patchShot(shotId, () => result.shot)
          setScenes((current) => {
            writeNavShots(acceptedIn(current))
            return current
          })
          return null
        })
      },
      onMove: (shotId, direction) => {
        const scene = scenes.find((entry) => entry.shots.some((shot) => shot.id === shotId))
        if (scene === undefined) return
        sceneWrite(scene.sceneNodeId, () => moveShot(projectId, episode, shotId, direction))
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
                shot.frame.kind !== 'empty' && shot.frame.jobId === jobId ? { ...shot, frame } : shot,
              ),
            })),
          )
          if (result.status === 'cancelled') setAvailable(result.available)
          return null
        })
      },
    }),
    [episode, patchShot, projectId, run, sceneWrite, scenes],
  )

  const onAdd = useCallback(
    (edit: ShotEdit) => {
      if (selected === null) return
      setAdding(false)
      sceneWrite(selected, () => addShot(projectId, episode, selected, edit))
    },
    [episode, projectId, sceneWrite, selected],
  )

  const onOpenBoard = useCallback(
    (sceneNodeId: string) => {
      setSelected(sceneNodeId)
      router.push(`${baseHref}?view=canvas`)
    },
    [baseHref, router],
  )

  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])

  // ---------------------------------------------------------------------------
  // Figures
  // ---------------------------------------------------------------------------

  const accepted = acceptedIn(scenes)
  const proposed = scenes.reduce((total, scene) => total + scene.shots.filter((shot) => shot.state === 'proposed').length, 0)
  const selectedScene = scenes.find((scene) => scene.sceneNodeId === selected) ?? null
  const selectedIndex = selectedScene === null ? -1 : scenes.indexOf(selectedScene)
  const selectedLabel =
    selectedScene === null ? '—' : `Scene ${String(selectedScene.number).padStart(2, '0')} · ${selectedScene.heading || 'No heading yet'}`
  const frameCost = cost ?? 0
  const empty = state === 'empty' ? 'no-script' : scenes.length === 0 ? 'no-scenes' : null

  return (
    <main
      data-route="storyboard"
      data-sub-view={view}
      data-storyboard-state={empty ?? 'board'}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        data-storyboard-header
        data-mounted={mounted ? 'true' : 'false'}
        className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-[7px] overflow-hidden">
          <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Storyboard</h1>
          <span className="tabular flex-none rounded-chrome bg-sel px-[6px] py-[1px] text-10 font-semibold text-ink2" data-shot-count>
            {accepted}
          </span>
          {proposed > 0 ? (
            <span className="tabular flex-none rounded-chrome bg-note-bg px-[6px] py-[1px] text-10 font-semibold text-note" data-proposed-count>
              {proposed} proposed
            </span>
          ) : null}
        </div>
        <nav aria-label="Storyboard views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
          {(
            [
              { id: 'board', label: 'Storyboard', glyph: '▦' },
              { id: 'canvas', label: 'Canvas', glyph: '✎' },
              { id: 'list', label: 'Shot list', glyph: '▤' },
            ] as const
          ).map((item) => {
            const active = item.id === view
            return (
              <Link
                key={item.id}
                href={item.id === 'board' ? baseHref : `${baseHref}?view=${item.id}`}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[10px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                  active ? 'bg-accent-bg text-accent' : 'text-ink2'
                }`}
              >
                <span className="font-glyph text-10 opacity-70">{item.glyph}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1" />
        <span className="flex items-center gap-[5px] whitespace-nowrap text-10-5 text-ink3" data-storyboard-save data-save-state={saveState.kind}>
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saving' ? 'bg-note' : 'bg-add'}`} />
          {saveState.kind === 'saving' ? 'saving…' : saveState.kind === 'error' ? 'not saved' : saveState.kind === 'saved' ? 'saved' : 'up to date'}
        </span>
        <Link
          href={productionHref}
          title="Credits are bought and spent in Production"
          className="tabular flex-none whitespace-nowrap rounded-chrome border border-line2 px-[7px] py-[2px] text-10 text-ink2 no-underline hover:bg-hover hover:no-underline"
          data-credits-available
        >
          {available} credits
        </Link>
      </header>

      {saveState.kind === 'error' ? (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del" data-storyboard-error>
          {saveState.message}
        </div>
      ) : null}

      {empty !== null ? (
        <EmptyStoryboard state={empty} scriptHref={scriptHref} />
      ) : (
        <>
          <div className="flex h-[40px] flex-none items-center gap-[8px] border-b border-line2 bg-panel px-[14px]">
            {view === 'canvas' ? (
              <div className="flex items-center gap-[8px]">
                <button
                  type="button"
                  title="Previous scene"
                  data-prev-scene
                  disabled={selectedIndex <= 0}
                  className="folio-icon-button h-[24px] w-[24px] text-11 disabled:opacity-40"
                  onClick={() => {
                    const previous = scenes[selectedIndex - 1]
                    if (previous !== undefined) setSelected(previous.sceneNodeId)
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  title="Next scene"
                  data-next-scene
                  disabled={selectedIndex === -1 || selectedIndex >= scenes.length - 1}
                  className="folio-icon-button h-[24px] w-[24px] text-11 disabled:opacity-40"
                  onClick={() => {
                    const next = scenes[selectedIndex + 1]
                    if (next !== undefined) setSelected(next.sceneNodeId)
                  }}
                >
                  ›
                </button>
                <span className="whitespace-nowrap text-11 text-ink3" data-canvas-label>
                  {selectedScene === null
                    ? 'No scene selected'
                    : `Scene ${String(selectedScene.number).padStart(2, '0')} · ${String(selectedScene.shots.length)} shot node${selectedScene.shots.length === 1 ? '' : 's'}`}
                </span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-11 text-ink3">
                {view === 'board' ? 'One column per scene · move a frame with ↑ ↓' : 'Grouped by scene · shot order'}
              </span>
            )}
            <div className="min-w-0 flex-1" />
            <span className="whitespace-nowrap text-10-5 text-ink3" data-frame-cost>
              Frame · {frameCost} credits each
            </span>
            <button
              type="button"
              data-add-shot
              disabled={saveState.kind === 'saving' || selectedScene === null}
              title={selectedScene === null ? 'Select a scene first' : `Add a shot to ${selectedLabel}`}
              className="folio-focus flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink disabled:opacity-60"
              onClick={() => {
                setAdding(true)
              }}
            >
              <span className="text-11 opacity-75">＋</span>Add shot
            </button>
          </div>

          {adding && selectedScene !== null ? (
            <div className="border-b border-line2 bg-panel px-[14px] py-[10px]" data-add-shot-form>
              <div className="mb-[6px] text-10-5 text-ink3">New shot on {selectedLabel}</div>
              <ShotEditor
                shot={BLANK_SHOT}
                labels={labels}
                book={book}
                pending={saveState.kind === 'saving'}
                onCancel={() => {
                  setAdding(false)
                }}
                onSave={onAdd}
              />
            </div>
          ) : null}

          {view === 'board' ? (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-[14px] right-0 top-0 z-[3] w-[56px]"
                style={{ background: 'linear-gradient(to right, transparent, var(--desk))' }}
              />
              <div className="min-h-0 flex-1 overflow-auto scroll-pl-[16px] py-[16px] pl-[16px] pr-[64px]" style={{ scrollSnapType: 'x proximity' }}>
                <div className="flex min-w-min items-start gap-[14px]" data-scene-columns>
                  {scenes.map((scene) => (
                    <SceneColumn
                      key={scene.sceneNodeId}
                      scene={scene}
                      selected={scene.sceneNodeId === selected}
                      labels={labels}
                      book={book}
                      cost={frameCost}
                      available={available}
                      pending={saveState.kind === 'saving'}
                      handlers={handlers}
                      onSelect={() => {
                        setSelected(scene.sceneNodeId)
                      }}
                      onOpenBoard={() => {
                        onOpenBoard(scene.sceneNodeId)
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : view === 'canvas' ? (
            <ShotCanvas
              scene={selectedScene}
              labels={labels}
              book={book}
              cost={frameCost}
              available={available}
              pending={saveState.kind === 'saving'}
              handlers={handlers}
            />
          ) : (
            <ShotList scenes={scenes} book={book} />
          )}
        </>
      )}

      <footer
        data-status-bar
        className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2"
      >
        <span className="flex-none whitespace-nowrap tabular-nums" data-footer-counts>
          {scenes.length} scene{scenes.length === 1 ? '' : 's'} · <b className="font-semibold text-ink">{accepted}</b> shot{accepted === 1 ? '' : 's'}
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="flex-none whitespace-nowrap">{VIEW_LABEL[view]}</span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate whitespace-nowrap" data-footer-selected>
          {selectedLabel}
        </span>
        <div className="min-w-0 flex-1" />
        <button type="button" className="folio-status-button" onClick={onToggleNav}>
          {navOpen ? 'Hide nav' : 'Show nav'}
        </button>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>
    </main>
  )
}
