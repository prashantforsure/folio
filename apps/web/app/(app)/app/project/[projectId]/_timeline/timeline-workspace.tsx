'use client'

import type { EpisodeSlug, Placement, ProjectId, StoryThreadId, StoryThreadRow, StoryTimeEdit, TimelineEpisodeColumn, TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding } from '@folio/script'
import { chronology, formatStoryTime, proposePlacements, storyJumps } from '@folio/script'
import type { NodeId } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { markDeliberate, placeScenes, reopenFinding, saveStoryTime, setSceneThreads, unplaceScenes } from '../../../../../../lib/timeline/actions'
import { findingsForScene, quietOf, timelineRefOf, unplacedOf } from '../../../../../../lib/timeline/facts'
import { publishTimelineFacts } from '../../../../../../lib/timeline/facts-cell'
import { chronologyFilename, chronologyMarkdown } from '../../../../../../lib/timeline/markdown'
import type { GridLanes, NoteBook, ScenePatch } from '../../../../../../lib/timeline/view'
import {
  applyPatches,
  bucketFindings,
  countChip,
  countsOf,
  emptyLeft,
  findingNote,
  findingsAbout,
  findingsOf,
  gridOf,
  matchesFind,
  nextDayAfter,
  noteBookOf,
  patchLanded,
  placementInputsOf,
  placementsOf,
  plural,
  previousFrameScene,
  sceneRef,
  statusLeft,
  timelineScenesOf,
  verdictOf,
} from '../../../../../../lib/timeline/view'
import type { ProjectRoutePath, ScenePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { sceneHref } from '../../../../../../lib/workspace/hrefs'
import { useFind } from '../_chrome/find-field'
import { StatusBar } from '../_chrome/status-bar'
import { useToast } from '../_chrome/use-toast'
import { Continuity } from './continuity'
import { EmptyTimeline } from './empty-timeline'
import type { DropTarget } from './lanes-grid'
import { LanesGrid } from './lanes-grid'
import { ProposalQueue } from './proposal-queue'
import { ReadModal } from './read-modal'
import type { DrawerField } from './scene-drawer'
import { SceneDrawer } from './scene-drawer'
import type { ScopeOption } from './timeline-toolbar'
import { TimelineToolbar } from './timeline-toolbar'
import { UnplacedBanner, UnplacedStrip } from './unplaced-strip'
import { useTimelineState } from './view-state'

/**
 * The Timeline route's body inside the main-surface card: the toolbar
 * (`timeline-toolbar.tsx`), the unplaced banner, the proposal queue while
 * it is open, one of the three views or the empty card, the 28px status
 * bar (`_chrome/status-bar.tsx`: `17 placed · 7 unplaced · 4 threads · 2
 * flashbacks`, the toast after a bulk write, `Hide nav`, the saved dot,
 * `/timeline`), the drawer while a scene is selected, and the reader.
 *
 * ## Everything here is state
 *
 * The three views are the provider's (`view-state.tsx`, ruled 2026-09-18 -
 * the URL stays `/timeline`), so the header's tabs are buttons;
 * `data-sub-view` keeps its name for the smoke test that reads it. The
 * selected scene is the provider's too (open decision 10 keeps it off the
 * URL), the solo thread likewise; the episode scope, the lanes, the
 * queue, the banner's dismiss, the toast, the reader: component state,
 * none of it worth a link.
 *
 * ## The core runs here, over what the writer just did
 *
 * The loader hands the rows; this component runs `@folio/script` over
 * them - the chronology, the jumps, the continuity findings, the
 * placement proposals - and lays the result out with `lib/timeline/view.ts`.
 * Every write lands as a *patch* over its row first (`applyPatches`), so
 * the grid re-orders and the findings re-run before the refresh answers;
 * a patch goes when the refreshed row agrees with it, or when its write
 * failed. The first pass computed the order on the server and drew
 * nothing until the round trip came back.
 *
 * ## One bulk write, and its undo
 *
 * `Accept all` in the queue writes every proposal the writer has not
 * skipped, in one statement, and the status bar offers `Undo` for a few
 * seconds - `unplaceScenes` over exactly the placements the write answered
 * with. A single `Accept` is the drawer's own write. Nothing here reads a
 * slugline as a date: the proposals are the core's reading of the page's
 * cues, and each says so.
 */
export type TimelineWorkspaceProps = {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly charactersHref: ProjectRoutePath
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly episodes: readonly TimelineEpisodeColumn[]
  readonly introductions: Readonly<Record<string, NodeId>>
  readonly deliberate: readonly string[]
}

type PatchEntry = { readonly patch: ScenePatch; readonly done: boolean }

export const TimelineWorkspace = ({ projectId, projectTitle, shape, charactersHref, scenes: loaded, threads, episodes, introductions, deliberate }: TimelineWorkspaceProps) => {
  const router = useRouter()
  const { view, setView, selected, select, solo, byHand, save, run, setFlags } = useTimelineState()
  const { toast, show, clear } = useToast()
  const { query } = useFind()
  const [scope, setScope] = useState<ScopeOption>('all')
  const [lanes, setLanes] = useState<GridLanes>('thread')
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [skipped, setSkipped] = useState<ReadonlySet<NodeId>>(new Set())
  const [patches, setPatches] = useState<ReadonlyMap<NodeId, PatchEntry>>(new Map())
  const [drawerField, setDrawerField] = useState<DrawerField | null>(null)
  const [reading, setReading] = useState<NodeId | null>(null)

  // A patch goes once the refreshed row agrees with it, or its write is done and a refresh has landed.
  useEffect(() => {
    setPatches((current) => {
      if (current.size === 0) return current
      const next = new Map<NodeId, PatchEntry>()
      for (const [id, entry] of current) {
        const row = loaded.find((scene) => scene.sceneNodeId === id)
        if (row !== undefined && !entry.done && !patchLanded(row, entry.patch)) next.set(id, entry)
      }
      return next.size === current.size ? current : next
    })
  }, [loaded])

  const scenes = useMemo(() => applyPatches(loaded, new Map([...patches].map(([id, entry]) => [id, entry.patch]))), [loaded, patches])
  // The same helpers `continuityOf` composes for the server (`lib/timeline/view.ts`),
  // one memo each so a patch recomputes only what it changes.
  const pure = useMemo(() => timelineScenesOf(scenes), [scenes])
  const chrono = useMemo(() => chronology(pure), [pure])
  const jumps = useMemo(() => storyJumps(pure), [pure])
  const findings = useMemo(() => findingsOf(scenes, introductions, threads), [scenes, introductions, threads])
  const deliberateKeys = useMemo(() => new Set(deliberate), [deliberate])
  const buckets = useMemo(() => bucketFindings(findings, deliberateKeys), [findings, deliberateKeys])
  const proposals = useMemo(
    () =>
      proposePlacements(placementInputsOf(scenes)).filter((proposal) => !skipped.has(proposal.sceneNodeId)),
    [scenes, skipped],
  )
  const counts = useMemo(() => countsOf(scenes, threads.length, buckets.open.length), [scenes, threads.length, buckets.open.length])
  const empty = counts.placed === 0 && threads.length === 0 && !byHand
  const shown: 'story' | 'chrono' | 'continuity' | 'empty' = empty ? 'empty' : view

  const byId = useMemo(() => new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene])), [scenes])
  const book = useMemo<NoteBook>(() => noteBookOf(scenes, threads), [scenes, threads])
  const noteOf = useCallback((finding: ContinuityFinding) => findingNote(finding, book), [book])

  // The header's Continuity badge reads the provider; the body is where the count is known.
  useEffect(() => {
    setFlags(buckets.open.length)
  }, [buckets.open.length, setFlags])
  useEffect(
    () => () => {
      setFlags(0)
    },
    [setFlags],
  )

  const selectedScene = selected === null ? null : (byId.get(selected) ?? null)
  // A selection the load no longer has - a scene deleted elsewhere - is dropped.
  useEffect(() => {
    if (selected !== null && selectedScene === null) select(null)
  }, [selected, selectedScene, select])

  // A scope the episodes no longer list - an episode deleted elsewhere - falls back to the series.
  useEffect(() => {
    if (scope !== 'all' && !episodes.some((episode) => episode.episode === scope)) setScope('all')
  }, [episodes, scope])

  // The assistant panel's facts: the open scene, the unplaced, the quiet threads.
  useEffect(() => {
    const index = scenes.map(timelineRefOf)
    publishTimelineFacts({
      projectId,
      shape,
      episodes: episodes.map((episode) => ({ slug: episode.episode as EpisodeSlug, ordinal: episode.ordinal, title: episode.title })),
      index,
      open:
        selectedScene === null
          ? null
          : {
              id: selectedScene.sceneNodeId,
              ref: timelineRefOf(selectedScene),
              findings: findingsForScene(buckets, selectedScene, book),
            },
      unplaced: unplacedOf(scenes),
      quiet: quietOf(buckets, scenes, book),
    })
  }, [book, buckets, episodes, projectId, scenes, selectedScene, shape])
  useEffect(
    () => () => {
      publishTimelineFacts(null)
    },
    [],
  )

  const grid = useMemo(
    () => gridOf(shown === 'chrono' ? 'chrono' : 'story', scenes, threads, episodes, chrono, scope === 'all' ? null : scope, lanes),
    [shown, scenes, threads, episodes, chrono, scope, lanes],
  )
  const matches = useCallback((scene: TimelineSceneRow) => matchesFind(scene, query), [query])
  const unplacedScenes = useMemo(() => scenes.filter((scene) => scene.storyTime === null && (scope === 'all' || scene.episode === scope)), [scenes, scope])

  const scriptHrefOf = useCallback((scene: TimelineSceneRow): ScenePath => sceneHref({ projectId, shape, episode: scene.episode }, scene.sceneNodeId), [projectId, shape])

  // ---------------------------------------------------------------------------
  // Writes, each as a patch first
  // ---------------------------------------------------------------------------

  const commit = useCallback(
    (id: NodeId, patch: ScenePatch, job: () => Promise<{ readonly status: string; readonly message?: string }>): void => {
      setPatches((current) => new Map(current).set(id, { patch: { ...current.get(id)?.patch, ...patch }, done: false }))
      run(async () => {
        const result = await job()
        if (result.status !== 'saved') {
          setPatches((current) => {
            const next = new Map(current)
            next.delete(id)
            return next
          })
          return result.message ?? 'That could not be saved.'
        }
        setPatches((current) => {
          const entry = current.get(id)
          return entry === undefined ? current : new Map(current).set(id, { ...entry, done: true })
        })
        router.refresh()
        return null
      })
    },
    [router, run],
  )

  const writeTime = useCallback(
    (id: NodeId, edit: StoryTimeEdit): void => {
      commit(id, { storyTime: edit.day === null ? null : { day: edit.day, clock: edit.clock }, flashback: edit.flashback }, () => saveStoryTime(projectId, id, edit))
    },
    [commit, projectId],
  )

  const writeThreads = useCallback(
    (id: NodeId, ids: readonly StoryThreadId[]): void => {
      commit(id, { threads: ids }, () => setSceneThreads(projectId, id, ids))
    },
    [commit, projectId],
  )

  /** A drop: onto a day (chronology), onto a row (a thread), or both. Page order is never touched. */
  const drop = useCallback(
    (id: NodeId, target: DropTarget): void => {
      const scene = byId.get(id)
      if (scene === undefined) return
      if (target.day !== null && scene.storyTime?.day !== target.day) {
        writeTime(id, { day: target.day, clock: null, flashback: scene.flashback })
      } else if (target.day === null && target.unplace && scene.storyTime !== null) {
        writeTime(id, { day: null, clock: null, flashback: scene.flashback })
      }
      if (lanes === 'thread' && target.rowKey !== null && target.rowKey !== 'none' && scene.threads[0] !== target.rowKey) {
        const threadId = target.rowKey as StoryThreadId
        writeThreads(id, [threadId, ...scene.threads.filter((entry) => entry !== threadId)])
      }
    },
    [byId, lanes, writeThreads, writeTime],
  )

  const nudge = useCallback(
    (id: NodeId, days: number): void => {
      const scene = byId.get(id)
      if (scene === undefined || scene.storyTime === null) return
      writeTime(id, { day: scene.storyTime.day + days, clock: scene.storyTime.clock, flashback: scene.flashback })
    },
    [byId, writeTime],
  )

  const toggleFlashback = useCallback(
    (id: NodeId): void => {
      const scene = byId.get(id)
      if (scene === undefined) return
      writeTime(id, { day: scene.storyTime?.day ?? null, clock: scene.storyTime?.clock ?? null, flashback: !scene.flashback })
    },
    [byId, writeTime],
  )

  const acceptAll = useCallback(
    (placements: readonly Placement[]): void => {
      if (placements.length === 0) return
      for (const placement of placements) {
        setPatches((current) => new Map(current).set(placement.sceneNodeId, { patch: { storyTime: placement.time }, done: false }))
      }
      run(async () => {
        const result = await placeScenes(projectId, placements)
        if (result.status !== 'placed') {
          setPatches((current) => {
            const next = new Map(current)
            for (const placement of placements) next.delete(placement.sceneNodeId)
            return next
          })
          return result.message
        }
        setPatches((current) => {
          const next = new Map(current)
          for (const placement of placements) {
            const entry = next.get(placement.sceneNodeId)
            if (entry !== undefined) next.set(placement.sceneNodeId, { ...entry, done: true })
          }
          return next
        })
        router.refresh()
        setQueueOpen(false)
        const landed = result.placements
        show(`Placed ${plural(landed.length, 'scene')}`, {
          label: 'Undo',
          onClick: () => {
            clear()
            for (const placement of landed) {
              setPatches((current) => new Map(current).set(placement.sceneNodeId, { patch: { storyTime: null }, done: false }))
            }
            run(async () => {
              const undone = await unplaceScenes(projectId, landed)
              if (undone.status !== 'unplaced') return undone.message
              setPatches((current) => {
                const next = new Map(current)
                for (const placement of landed) {
                  const entry = next.get(placement.sceneNodeId)
                  if (entry !== undefined) next.set(placement.sceneNodeId, { ...entry, done: true })
                }
                return next
              })
              router.refresh()
              return null
            })
          },
        })
        return null
      })
    },
    [clear, projectId, router, run, show],
  )

  const verdict = useCallback(
    (finding: ContinuityFinding, deliberateNow: boolean): void => {
      run(async () => {
        const result = deliberateNow ? await markDeliberate(projectId, verdictOf(finding)) : await reopenFinding(projectId, finding.key)
        if (result.status !== 'saved') return result.message
        router.refresh()
        return null
      })
    },
    [projectId, router, run],
  )

  const exportMarkdown = useCallback((): void => {
    const markdown = chronologyMarkdown(projectTitle, scenes, threads, chrono)
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = chronologyFilename(projectTitle)
    anchor.click()
    URL.revokeObjectURL(url)
    show(`Exported ${anchor.download}.`)
  }, [chrono, projectTitle, scenes, show, threads])

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const openScene = useCallback(
    (id: NodeId, field: DrawerField | null = null) => {
      select(id)
      setDrawerField(field)
    },
    [select],
  )
  const close = useCallback(() => {
    select(null)
    setDrawerField(null)
  }, [select])
  const openFromContinuity = useCallback(
    (id: NodeId) => {
      select(id)
      setView('story')
    },
    [select, setView],
  )

  const readOrder = useMemo(() => chrono.days.flatMap((day) => day.sceneIds), [chrono])
  const openQueue = (): void => {
    setQueueOpen(true)
    setSkipped(new Set())
  }

  const left = shown === 'empty' ? emptyLeft(projectTitle) : statusLeft(counts, selectedScene)
  const chip = countChip(shown === 'continuity' ? 'continuity' : 'story', counts)
  const episodeChoices = useMemo(() => episodes.map((episode) => ({ slug: episode.episode as EpisodeSlug, ordinal: episode.ordinal, title: episode.title })), [episodes])
  const newDay = nextDayAfter(scenes)

  return (
    <main data-route="timeline" data-sub-view={view} data-timeline-state={shown} data-lanes={lanes} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {shown === 'empty' ? null : (
        <TimelineToolbar
          count={chip}
          scope={scope}
          episodes={episodeChoices}
          onScope={setScope}
          lanes={lanes}
          onLanes={setLanes}
          unplaced={counts.unplaced}
          queueOpen={queueOpen}
          onQueue={() => {
            if (queueOpen) setQueueOpen(false)
            else openQueue()
          }}
          canRead={readOrder.length > 0}
          onRead={() => {
            setReading(readOrder[0] ?? null)
          }}
          onExport={exportMarkdown}
        />
      )}

      {shown !== 'empty' && shown !== 'continuity' && counts.unplaced > 0 && !bannerDismissed && !queueOpen ? (
        <UnplacedBanner
          count={counts.unplaced}
          onPlace={openQueue}
          onDismiss={() => {
            setBannerDismissed(true)
          }}
        />
      ) : null}

      {shown !== 'empty' && queueOpen ? (
        <ProposalQueue
          projectId={projectId}
          shape={shape}
          proposals={proposals}
          scenes={scenes}
          onAccept={(proposal) => {
            const scene = byId.get(proposal.sceneNodeId)
            if (scene !== undefined) writeTime(scene.sceneNodeId, { day: proposal.time.day, clock: proposal.time.clock, flashback: scene.flashback })
          }}
          onSkip={(id) => {
            setSkipped((current) => new Set(current).add(id))
          }}
          onAcceptAll={() => {
            acceptAll(placementsOf(proposals))
          }}
          onOpen={openScene}
          onClose={() => {
            setQueueOpen(false)
          }}
        />
      ) : null}

      {shown === 'empty' ? (
        <EmptyTimeline scenes={scenes.length} onPlace={openQueue} />
      ) : shown === 'continuity' ? (
        <Continuity scenes={scenes} buckets={buckets} noteOf={noteOf} placed={counts.placed} scriptHrefOf={scriptHrefOf} onOpen={openFromContinuity} onVerdict={verdict} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          <LanesGrid
            view={shown}
            lanes={lanes}
            grid={grid}
            threads={threads}
            buckets={buckets}
            noteOf={noteOf}
            jumps={jumps}
            selected={selected}
            solo={solo}
            newDay={newDay}
            matches={matches}
            onOpen={openScene}
            onDrop={drop}
            onNudge={nudge}
            onFlashback={toggleFlashback}
            onClose={close}
          />
          {shown === 'chrono' ? <UnplacedStrip scenes={unplacedScenes} selected={selected} matches={matches} onOpen={openScene} onDrop={drop} /> : null}
        </div>
      )}

      <StatusBar left={left} save={save} routeId="/timeline" toast={toast} />

      {selectedScene === null ? null : (
        <SceneDrawer
          key={selectedScene.sceneNodeId}
          projectId={projectId}
          scene={selectedScene}
          previous={previousFrameScene(scenes, selectedScene.sceneNodeId)}
          findings={findingsAbout(buckets, selectedScene.sceneNodeId)}
          deliberate={buckets.deliberate.filter((finding) => finding.sceneId === selectedScene.sceneNodeId)}
          noteOf={noteOf}
          threads={threads}
          scriptHref={scriptHrefOf(selectedScene)}
          cueHref={selectedScene.cues?.action === null || selectedScene.cues === null ? null : sceneHref({ projectId, shape, episode: selectedScene.episode }, selectedScene.cues.action.nodeId)}
          charactersHref={charactersHref}
          field={drawerField}
          busy={save === 'saving'}
          onSave={(edit) => {
            writeTime(selectedScene.sceneNodeId, edit)
          }}
          onThreads={(ids) => {
            writeThreads(selectedScene.sceneNodeId, ids)
          }}
          onVerdict={verdict}
          onClose={close}
        />
      )}

      {reading === null ? null : (
        <ReadModal
          projectId={projectId}
          order={readOrder}
          current={reading}
          labelOf={(id) => {
            const scene = byId.get(id)
            if (scene === undefined) return ''
            const when = scene.storyTime === null ? 'no time' : formatStoryTime(scene.storyTime)
            return `${sceneRef(scene)} · ${when}`
          }}
          headingOf={(id) => byId.get(id)?.heading ?? ''}
          onTurn={setReading}
          onClose={() => {
            setReading(null)
          }}
        />
      )}
    </main>
  )
}
