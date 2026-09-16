'use client'

import type { CastRow, ProductionScene, ProductionShot, ProjectId, RenderResolution, ShotRow } from '@folio/contracts'
import type { MentionLabel } from '@folio/script'
import { labelBook } from '@folio/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  addReel,
  addShotToReel,
  cancelSceneJob,
  finalizeReel,
  generateReelFrames,
  keepFrame,
  moveReel,
  moveShotInReel,
  proposeShotsForReel,
  putShotsInReel,
  removeReel,
  renameReel,
  renderReel,
  setReelClip,
  setRenderResolution,
  unlockReel,
} from '../../../../../../lib/production/actions'
import { publishProductionCoverage } from '../../../../../../lib/production/coverage'
import type { LocationSummary } from '../../../../../../lib/production/server'
import type { GateInput } from '../../../../../../lib/production/status'
import { coverageRows, episodeStats, reelViewOf, reelsChip, statusLeft } from '../../../../../../lib/production/view'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import { useViewport } from '../../../../../../lib/state/viewport'
import { acceptShots, discardShots, saveShot } from '../../../../../../lib/storyboard/actions'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { PANEL_IN_FLOW_MIN, SIDEBAR_OPEN_MIN } from '../../../../../../lib/workspace/routes'
import { StatusBar } from '../_chrome/status-bar'
import type { SaveIndicator } from '../_chrome/status-bar'
import { EpisodeView } from './episode-view'
import type { ProductionHandlers, SceneViewProps } from './handlers'
import { ProductionToolbar } from './production-toolbar'
import type { ProductionView } from './production-toolbar'
import { SceneView } from './scene-view'

/**
 * The Production route's body inside the main-surface card - `docs/ui
 * design/Route - Production v2.dc.html`: the toolbar row, the Scene or the
 * Episode view, the 28px status bar. The sidebar beside it is the shell's
 * (`_chrome/sidebar.tsx`) with this route's two slots.
 *
 * ## `?view=` is the URL; everything else is state
 *
 * The two views are `scene | episode`, a sub-view param
 * (`lib/workspace/params.ts`), so the pill's tabs are links. Which scene
 * is selected is component state - the Scenes ruling: selection is not a
 * URL, and `?selected=SCENE_xxx` waits on the id-shape decision (open
 * decision 10). The sidebar's rows and the strip's tabs pick the same one
 * through the published cell (`lib/production/coverage.ts`).
 *
 * ## The rows are the truth, and every write returns them
 *
 * `scenes` is the server's read, patched by what each action hands back:
 * a reel write returns the whole scene re-read (`result.ts` says why); a
 * frame or render request returns the scene and the balance after the
 * reservation; the Storyboard's own shot writes - edit, accept, discard -
 * return the scene's shot list, merged over the takes already in hand.
 * Nothing here computes a number the server did not: every count on the
 * page is `lib/production/view.ts` over the same `scenes`, so the chip,
 * the tiles, the table, the sidebar and the status bar agree.
 *
 * ## Cost is named before it is spent
 *
 * `available` is the ledger's computed balance, printed in the toolbar and
 * on every Generate and Render button beside the cost. The server
 * enforces; a short balance comes back as `insufficient` with the numbers,
 * and the banner says them.
 */

export type ProductionWorkspaceProps = {
  readonly projectId: ProjectId
  readonly episode: string
  readonly episodeOrdinal: number
  readonly routeId: string
  readonly view: ProductionView
  readonly baseHref: EpisodeRoutePath
  readonly scriptHref: EpisodeRoutePath
  readonly state: 'empty' | 'script'
  readonly scenes: readonly ProductionScene[]
  readonly labels: readonly MentionLabel[]
  readonly cast: readonly CastRow[]
  readonly locations: readonly LocationSummary[]
  readonly available: number
  readonly costs: { readonly frame: number; readonly render: number }
  readonly resolution: RenderResolution
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

const indicatorOf = (state: SaveState): SaveIndicator => state.kind

/**
 * The Storyboard's shot writes return the scene's shots without their
 * takes; the takes in hand are carried over by id. A shot new to the list
 * (an accepted proposal keeps its id, so only a truly new row) has none.
 */
const mergeShots = (scene: ProductionScene, rows: readonly ShotRow[]): ProductionScene => {
  const takes = new Map<string, ProductionShot['takes']>()
  for (const reel of scene.reels) for (const shot of reel.shots) takes.set(shot.id, shot.takes)
  for (const shot of scene.unreeled) takes.set(shot.id, shot.takes)
  const toShot = (row: ShotRow): ProductionShot => ({ ...row, takes: takes.get(row.id) ?? [] })
  return {
    ...scene,
    reels: scene.reels.map((reel) => ({ ...reel, shots: rows.filter((row) => row.reelId === reel.id).map(toShot) })),
    unreeled: rows.filter((row) => row.reelId === null).map(toShot),
  }
}

const EmptyProduction = ({ state, scriptHref }: { readonly state: 'no-script' | 'no-scenes'; readonly scriptHref: EpisodeRoutePath }) => (
  <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-[20px] pb-[24px] pt-[24px]">
    <div className="flex w-[440px] max-w-full flex-col gap-[12px] rounded-[16px] border border-line2 bg-s1 px-[22px] py-[24px]" data-production-empty={state}>
      <span className="text-15 font-medium tracking-title">{state === 'no-script' ? 'Nothing to shoot yet' : 'No scenes yet'}</span>
      <p className="m-0 text-13 leading-[1.6] text-ink2 [text-wrap:pretty]">
        {state === 'no-script'
          ? 'Production reads the scenes of the script. Write one and each scene appears here, ready for reels.'
          : 'The script has no scene heading yet. Write one and it appears here, ready for reels.'}
      </p>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Link href={scriptHref} className="folio-accent-button h-[34px] rounded-[9px] px-[15px] text-13">
          Open the script
        </Link>
      </div>
      <span className="text-12 text-ink3">Reels are built here from a scene&apos;s shots. Nothing is written back to the script.</span>
    </div>
  </div>
)

export const ProductionWorkspace = ({
  projectId,
  episode,
  episodeOrdinal,
  routeId,
  view,
  baseHref,
  scriptHref,
  state,
  scenes: initialScenes,
  labels,
  cast,
  locations: locationRows,
  available: initialAvailable,
  costs,
  resolution: initialResolution,
}: ProductionWorkspaceProps) => {
  const router = useRouter()
  const session = useSession()
  const ephemeral = useEphemeral()
  const { mounted, width } = useViewport()

  const [scenes, setScenes] = useState<readonly ProductionScene[]>(initialScenes)
  const [available, setAvailable] = useState(initialAvailable)
  const [resolution, setResolution] = useState(initialResolution)
  const [selected, setSelected] = useState<string | null>(initialScenes[0]?.sceneNodeId ?? null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pendingCount = useRef(0)

  const book = useMemo(() => labelBook(labels), [labels])
  const castById = useMemo(() => new Map(cast.map((row) => [row.id as string, row])), [cast])
  const locations = useMemo(() => new Map(locationRows.map((row) => [row.id as string, row])), [locationRows])
  const input = useMemo<GateInput>(
    () => ({ available, frameCost: costs.frame, renderCost: costs.render, resolution }),
    [available, costs.frame, costs.render, resolution],
  )

  // ---------------------------------------------------------------------------
  // Geometry: the reel card's columns, from what is left of the viewport
  // ---------------------------------------------------------------------------

  const assistantOpen = (mounted ? session.assistantOpen : null) ?? false
  const panelInFlow = width >= PANEL_IN_FLOW_MIN
  const navOpen = !(assistantOpen && !panelInFlow) && ((mounted ? session.navOpen : null) ?? width >= SIDEBAR_OPEN_MIN)
  const wide = width - (navOpen ? 292 : 56) - (assistantOpen && panelInFlow ? 400 : 0) - 72
  const columns: SceneViewProps['columns'] = wide >= 1020 ? 3 : wide >= 640 ? 2 : 1

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  const run = useCallback(async (job: () => Promise<string | null>): Promise<void> => {
    pendingCount.current += 1
    setSaveState({ kind: 'saving' })
    let failure: string | null
    try {
      failure = await job()
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
    } finally {
      pendingCount.current -= 1
    }
    if (failure !== null) setSaveState({ kind: 'error', message: failure })
    else if (pendingCount.current === 0) setSaveState({ kind: 'saved' })
  }, [])

  const replaceScene = useCallback((scene: ProductionScene) => {
    setScenes((current) => current.map((entry) => (entry.sceneNodeId === scene.sceneNodeId ? scene : entry)))
  }, [])

  const sceneOf = useCallback(
    (predicate: (scene: ProductionScene) => boolean): ProductionScene | null => scenes.find(predicate) ?? null,
    [scenes],
  )

  type SceneWrite = () => ReturnType<typeof addReel>
  const sceneWrite = useCallback(
    (write: SceneWrite) => {
      void run(async () => {
        const result = await write()
        if (result.status !== 'saved') return result.message
        replaceScene(result.scene)
        return null
      })
    },
    [replaceScene, run],
  )

  const shotsWrite = useCallback(
    (sceneNodeId: string, write: () => ReturnType<typeof acceptShots>) => {
      void run(async () => {
        const result = await write()
        if (result.status !== 'saved') return result.message
        setScenes((current) => current.map((scene) => (scene.sceneNodeId === sceneNodeId ? mergeShots(scene, result.shots) : scene)))
        return null
      })
    },
    [run],
  )

  const handlers: ProductionHandlers = useMemo(
    () => ({
      onAddReel: (sceneNodeId) => {
        sceneWrite(() => addReel(projectId, episode, { sceneNodeId }))
      },
      onPutOrphans: (sceneNodeId, reelId) => {
        sceneWrite(() => putShotsInReel(projectId, episode, reelId === null ? { sceneNodeId } : { sceneNodeId, reelId }))
      },
      onProposeForScene: (sceneNodeId) => {
        void run(async () => {
          const added = await addReel(projectId, episode, { sceneNodeId })
          if (added.status !== 'saved') return added.message
          replaceScene(added.scene)
          const reel = added.scene.reels[added.scene.reels.length - 1]
          if (reel === undefined) return 'The reel was not created.'
          const proposed = await proposeShotsForReel(projectId, episode, reel.id)
          if (proposed.status !== 'saved') return proposed.message
          replaceScene(proposed.scene)
          return null
        })
      },
      onRenameReel: (reelId, name) => {
        sceneWrite(() => renameReel(projectId, episode, reelId, name))
      },
      onSetClip: (reelId, seconds) => {
        sceneWrite(() => setReelClip(projectId, episode, reelId, seconds))
      },
      onMoveReel: (reelId, direction) => {
        sceneWrite(() => moveReel(projectId, episode, reelId, direction))
      },
      onRemoveReel: (reelId) => {
        sceneWrite(() => removeReel(projectId, episode, reelId))
      },
      onAddShot: (reelId, edit) => {
        sceneWrite(() => addShotToReel(projectId, episode, reelId, edit))
      },
      onProposeForReel: (reelId) => {
        sceneWrite(() => proposeShotsForReel(projectId, episode, reelId))
      },
      onAccept: (sceneNodeId, shotId) => {
        shotsWrite(sceneNodeId, () => acceptShots(projectId, episode, { sceneNodeId, shotIds: [shotId] }))
      },
      onDiscard: (sceneNodeId, shotId) => {
        shotsWrite(sceneNodeId, () => discardShots(projectId, episode, { sceneNodeId, shotIds: [shotId] }))
      },
      onSaveShot: (shotId, edit) => {
        void run(async () => {
          const result = await saveShot(projectId, episode, shotId, edit)
          if (result.status !== 'saved') return result.message
          const saved = result.shot
          setScenes((current) =>
            current.map((scene) => ({
              ...scene,
              reels: scene.reels.map((reel) => ({
                ...reel,
                shots: reel.shots.map((shot) => (shot.id === shotId ? { ...saved, takes: shot.takes } : shot)),
              })),
              unreeled: scene.unreeled.map((shot) => (shot.id === shotId ? { ...saved, takes: shot.takes } : shot)),
            })),
          )
          return null
        })
      },
      onMoveShot: (shotId, direction) => {
        sceneWrite(() => moveShotInReel(projectId, episode, shotId, direction))
      },
      onGenerate: (reelId) => {
        void run(async () => {
          const result = await generateReelFrames(projectId, episode, reelId)
          if (result.status === 'insufficient') {
            setAvailable(result.available)
            return `Needs ${String(result.needed)} credits, you have ${String(result.available)}. Top up to continue.`
          }
          if (result.status !== 'queued') return result.message
          replaceScene(result.scene)
          setAvailable(result.available)
          return null
        })
      },
      onFinalize: (reelId) => {
        sceneWrite(() => finalizeReel(projectId, episode, reelId))
      },
      onUnlock: (reelId) => {
        sceneWrite(() => unlockReel(projectId, episode, reelId))
      },
      onRender: (reelId) => {
        void run(async () => {
          const result = await renderReel(projectId, episode, reelId)
          if (result.status === 'insufficient') {
            setAvailable(result.available)
            return `Needs ${String(result.cost)} credits, you have ${String(result.available)}. Top up to continue.`
          }
          if (result.status !== 'queued') return result.message
          replaceScene(result.scene)
          setAvailable(result.available)
          return null
        })
      },
      onKeep: (sceneNodeId, generationId) => {
        sceneWrite(() => keepFrame(projectId, episode, sceneNodeId, generationId))
      },
      onCancelJob: (sceneNodeId, jobId) => {
        void run(async () => {
          const result = await cancelSceneJob(projectId, episode, sceneNodeId, jobId)
          if (result.status === 'refused' || result.status === 'error') return result.message
          replaceScene(result.scene)
          if (result.status === 'cancelled') setAvailable(result.available)
          return null
        })
      },
      onSuggestRewrite: (shot) => {
        const reason = shot.frame.kind === 'blocked' ? shot.frame.reason : 'It was refused.'
        const scene = sceneOf((entry) => entry.sceneNodeId === shot.sceneNodeId)
        const where = scene === null ? '' : ` in Scene ${String(scene.number)}`
        ephemeral.setAssistantPrompt(
          `Shot ${shot.number}${where} was refused for a frame: ${reason} Suggest a rewrite of the shot that keeps the beat and can be rendered.`,
        )
        session.setAssistantOpen(true)
      },
    }),
    [episode, ephemeral, projectId, replaceScene, run, sceneOf, sceneWrite, session, shotsWrite],
  )

  const onResolution = useCallback(
    (next: RenderResolution) => {
      const previous = resolution
      setResolution(next)
      void run(async () => {
        const result = await setRenderResolution(projectId, next)
        if (result.status === 'saved') return null
        setResolution(previous)
        return result.message
      })
    },
    [projectId, resolution, run],
  )

  const onOpenScene = useCallback(
    (sceneNodeId: string) => {
      setSelected(sceneNodeId)
      router.push(baseHref)
    },
    [baseHref, router],
  )

  // ---------------------------------------------------------------------------
  // Figures - one derivation, read everywhere
  // ---------------------------------------------------------------------------

  const coverage = useMemo(() => coverageRows(scenes, input), [input, scenes])
  const stats = useMemo(() => episodeStats(scenes), [scenes])
  const selectedScene = scenes.find((scene) => scene.sceneNodeId === selected) ?? null
  const selectedCoverage = coverage.find((row) => row.sceneNodeId === selected) ?? null
  const firstReel = selectedScene?.reels[0]
  const firstReelLabel = firstReel === undefined ? null : reelViewOf(firstReel, input).status.label
  const short = selectedScene !== null && selectedScene.reels.some((reel) => reelViewOf(reel, input).gates.status === 'needs-credits')
  const empty = state === 'empty' ? 'no-script' : scenes.length === 0 ? 'no-scenes' : null

  useEffect(() => {
    publishProductionCoverage({ rows: coverage, stats, selectedId: selected, onPick: setSelected })
  }, [coverage, selected, stats])
  useEffect(
    () => () => {
      publishProductionCoverage(null)
    },
    [],
  )

  const sceneView: SceneViewProps = useMemo(
    () => ({ labels, book, input, pending: saveState.kind === 'saving', handlers, columns }),
    [book, columns, handlers, input, labels, saveState.kind],
  )

  return (
    <main
      data-route="production"
      data-sub-view={view}
      data-production-state={empty ?? 'reels'}
      data-mounted={mounted ? 'true' : 'false'}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <ProductionToolbar
        chip={reelsChip(selectedCoverage?.reels ?? 0)}
        view={view}
        baseHref={baseHref}
        resolution={resolution}
        available={available}
        short={short}
        pending={saveState.kind === 'saving'}
        onResolution={onResolution}
      />

      {saveState.kind === 'error' ? (
        <div role="alert" className="folio-banner" data-tone="live" data-production-error>
          <span className="min-w-0 flex-1">{saveState.message}</span>
          <button
            type="button"
            className="folio-ghost-button rounded-[8px] px-[8px] py-[3px] text-12"
            onClick={() => {
              setSaveState({ kind: 'idle' })
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {empty !== null ? (
        <EmptyProduction state={empty} scriptHref={scriptHref} />
      ) : view === 'episode' ? (
        <EpisodeView stats={stats} coverage={coverage} resolution={resolution} onOpen={onOpenScene} />
      ) : (
        <SceneView
          projectId={projectId}
          scenes={scenes}
          coverage={coverage}
          selected={selected}
          onSelect={setSelected}
          castById={castById}
          locations={locations}
          view={sceneView}
        />
      )}

      <StatusBar left={statusLeft(episodeOrdinal, stats, selectedCoverage, firstReelLabel)} save={indicatorOf(saveState)} routeId={routeId} />
    </main>
  )
}
