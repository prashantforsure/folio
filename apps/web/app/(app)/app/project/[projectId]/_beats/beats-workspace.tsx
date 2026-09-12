'use client'

import type { BeatRow, BeatScene, BeatTiming } from '@folio/contracts'
import { readBeatHeadline } from '@folio/script'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  addBeat,
  deleteBeat,
  linkScene,
  moveBeat,
  saveBeatHeadline,
  saveBeatTiming,
  unlinkScene,
} from '../../../../../../lib/beats/actions'
import { useSession } from '../../../../../../lib/state/session'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { Arrangement } from './arrangement'
import { BeatSheet } from './beat-sheet'
import { EmptyBeats } from './empty-beats'

/**
 * The Beats route's main column: the 46px header (title, live count, the
 * `Arrangement / Beats` segment, `＋ Add beat`), the sheet or the
 * arrangement, and the 28px footer (`N beats · P placed · Beat sheet ·
 * Selected: … · Xm of Ym`, then `Hide nav`, zoom, the route id).
 *
 * ## `?view=` is the URL; everything else is state
 *
 * The two views are `beats | arrangement`, a sub-view param
 * (`lib/workspace/params.ts`), so the tabs are links. Which beat is
 * selected is component state - the Scenes ruling: selection is not a URL.
 * The arrangement's scale is React state too, not the session's `zoom`,
 * which is the sheet's.
 *
 * ## The list is the truth, and every write returns it
 *
 * `beats` here is the server's read, seeded from the route and replaced by
 * what each action hands back: a document write (add, move, delete) returns
 * the whole list re-read, because the ordinals moved; an authored write
 * (headline, timing, link) is applied to the one row it changed. Nothing
 * here computes an ordinal or a page. The nav's Beats row is written in
 * place after an add or a delete.
 *
 * The save indicator is one for the route: any write in flight is
 * `saving…`, the last outcome `saved` or `not saved` with the reason on the
 * banner.
 */

export type BeatsView = 'beats' | 'arrangement'

export type BeatsWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly project: { readonly title: string }
  readonly routeId: string
  readonly view: BeatsView
  /** The route's bare path; `?view=arrangement` is appended here. */
  readonly sheetHref: EpisodeRoutePath
  readonly beatsState: 'no-outline' | 'beats' | 'unreadable'
  readonly beats: readonly BeatRow[]
  readonly scenes: readonly BeatScene[]
  readonly sheetTitle: string
  readonly sheetDate: string
  readonly unreadable: string | null
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

const writeNavBeats = (count: number): void => {
  const row = document.querySelector('[data-nav-meta="beats"]')
  if (row !== null) row.textContent = String(count)
}

export const BeatsWorkspace = ({
  projectId,
  episode,
  routeId,
  view,
  sheetHref,
  beatsState,
  beats: initialBeats,
  scenes,
  sheetTitle,
  sheetDate,
  unreadable,
}: BeatsWorkspaceProps) => {
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
  const available = viewport - 66 - (navOpen ? 238 : 0) - 48
  const fit = Math.max(0.5, Math.min(1, available / 816))
  const zoomSetting = mounted ? session.zoom : 'fit'
  const zoom = zoomSetting === 'fit' ? Math.round(fit * 1000) / 1000 : zoomSetting
  const [scale, setScale] = useState(1)
  const zoomLabel =
    view === 'beats'
      ? zoomSetting === 'fit'
        ? `Fit ${String(Math.round(fit * 100))}%`
        : `${String(Math.round(zoom * 100))}%`
      : `${String(Math.round(scale * 100))}%`

  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  const [beats, setBeats] = useState<readonly BeatRow[]>(initialBeats)
  const [selected, setSelected] = useState<string | null>(initialBeats[0]?.beatNodeId ?? null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pending = useRef(0)

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

  const patch = useCallback((beatNodeId: string, change: (beat: BeatRow) => BeatRow) => {
    setBeats((current) => current.map((beat) => (beat.beatNodeId === beatNodeId ? change(beat) : beat)))
  }, [])

  const onHeadline = useCallback(
    (beatNodeId: string, name: string, line: string) => {
      void run(async () => {
        const result = await saveBeatHeadline(projectId, episode, beatNodeId, { name, line })
        if (result.status !== 'saved') return result.message
        patch(beatNodeId, (beat) => ({ ...beat, text: result.text }))
        return null
      })
    },
    [episode, patch, projectId, run],
  )

  const writeTiming = useCallback(
    (beatNodeId: string, timing: BeatTiming) => {
      patch(beatNodeId, (beat) => ({ ...beat, timing }))
      void run(async () => {
        const result = await saveBeatTiming(projectId, episode, beatNodeId, timing)
        if (result.status !== 'saved') return result.message
        patch(beatNodeId, (beat) => ({ ...beat, timing: result.timing }))
        return null
      })
    },
    [episode, patch, projectId, run],
  )

  const timingOf = useCallback(
    (beatNodeId: string): BeatTiming | null => beats.find((beat) => beat.beatNodeId === beatNodeId)?.timing ?? null,
    [beats],
  )

  const onDuration = useCallback(
    (beatNodeId: string, minutes: number | null) => {
      const timing = timingOf(beatNodeId)
      if (timing === null) return
      writeTiming(beatNodeId, { ...timing, durationMinutes: minutes })
    },
    [timingOf, writeTiming],
  )
  const onPlace = useCallback(
    (beatNodeId: string, minute: number) => {
      const timing = timingOf(beatNodeId)
      if (timing === null) return
      writeTiming(beatNodeId, { ...timing, placedAtMinute: minute })
    },
    [timingOf, writeTiming],
  )
  const onCanvas = useCallback(
    (beatNodeId: string, x: number, y: number) => {
      const timing = timingOf(beatNodeId)
      if (timing === null) return
      writeTiming(beatNodeId, { ...timing, placedAtMinute: null, canvas: { x, y } })
    },
    [timingOf, writeTiming],
  )

  const onMove = useCallback(
    (beatNodeId: string, direction: 'up' | 'down') => {
      void run(async () => {
        const result = await moveBeat(projectId, episode, beatNodeId, direction)
        if (result.status !== 'saved') return result.message
        setBeats(result.beats)
        return null
      })
    },
    [episode, projectId, run],
  )

  const onDelete = useCallback(
    (beatNodeId: string) => {
      void run(async () => {
        const result = await deleteBeat(projectId, episode, beatNodeId)
        if (result.status !== 'deleted') return result.message
        setBeats(result.beats)
        setSelected((current) => (current === beatNodeId ? (result.beats[0]?.beatNodeId ?? null) : current))
        writeNavBeats(result.beats.length)
        return null
      })
    },
    [episode, projectId, run],
  )

  const onAdd = useCallback(
    (name: string, line: string) => {
      void run(async () => {
        const result = await addBeat(projectId, episode, { name, line })
        if (result.status !== 'added') return result.message
        setBeats(result.beats)
        setSelected(result.beat.beatNodeId)
        writeNavBeats(result.beats.length)
        return null
      })
    },
    [episode, projectId, run],
  )

  const onLink = useCallback(
    (beatNodeId: string, sceneNodeId: string) => {
      const scene = scenes.find((entry) => entry.sceneNodeId === sceneNodeId)
      if (scene === undefined) return
      patch(beatNodeId, (beat) =>
        beat.scenes.some((entry) => entry.sceneNodeId === sceneNodeId)
          ? beat
          : { ...beat, scenes: [...beat.scenes, scene].sort((a, b) => a.number - b.number) },
      )
      void run(async () => {
        const result = await linkScene(projectId, episode, beatNodeId, sceneNodeId)
        if (result.status !== 'saved') {
          patch(beatNodeId, (beat) => ({ ...beat, scenes: beat.scenes.filter((entry) => entry.sceneNodeId !== sceneNodeId) }))
          return result.message
        }
        return null
      })
    },
    [episode, patch, projectId, run, scenes],
  )

  const onUnlink = useCallback(
    (beatNodeId: string, sceneNodeId: string) => {
      const before = beats.find((beat) => beat.beatNodeId === beatNodeId)?.scenes ?? []
      patch(beatNodeId, (beat) => ({ ...beat, scenes: beat.scenes.filter((entry) => entry.sceneNodeId !== sceneNodeId) }))
      void run(async () => {
        const result = await unlinkScene(projectId, episode, beatNodeId, sceneNodeId)
        if (result.status !== 'saved') {
          patch(beatNodeId, (beat) => ({ ...beat, scenes: before }))
          return result.message
        }
        return null
      })
    },
    [beats, episode, patch, projectId, run],
  )

  // ---------------------------------------------------------------------------
  // Footer figures
  // ---------------------------------------------------------------------------

  const placed = useMemo(() => beats.filter((beat) => beat.timing.placedAtMinute !== null), [beats])
  const placedMinutes = placed.reduce((total, beat) => total + (beat.timing.durationMinutes ?? 0), 0)
  const allMinutes = beats.reduce((total, beat) => total + (beat.timing.durationMinutes ?? 0), 0)
  const selectedBeat = beats.find((beat) => beat.beatNodeId === selected) ?? null
  const selectedName = selectedBeat === null ? '—' : readBeatHeadline(selectedBeat.text).name || 'Untitled beat'

  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])
  const onCycleZoom = useCallback(() => {
    if (view === 'beats') session.setZoom(session.zoom === 'fit' ? 1 : session.zoom === 1 ? 0.75 : 'fit')
    else setScale((current) => (current >= 1.5 ? 0.75 : Math.round((current + 0.25) * 100) / 100))
  }, [session, view])

  const empty = beatsState !== 'beats' || beats.length === 0

  return (
    <main
      data-route="beats"
      data-sub-view={view}
      data-beats-state={beatsState}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header data-beats-header data-mounted={mounted ? 'true' : 'false'} className="flex h-[46px] flex-none items-center gap-[12px] border-b border-line px-[14px]">
        <div className="flex min-w-0 flex-1 items-baseline gap-[7px] overflow-hidden">
          <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Beats</h1>
          <span className="tabular flex-none rounded-chrome bg-sel px-[6px] py-[1px] text-10 font-semibold text-ink2" data-beat-count>
            {beats.length}
          </span>
        </div>
        <nav aria-label="Beat views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
          {(
            [
              { id: 'arrangement', label: 'Arrangement', glyph: '◷' },
              { id: 'beats', label: 'Beats', glyph: '⧗' },
            ] as const
          ).map((item) => {
            const active = item.id === view
            return (
              <Link
                key={item.id}
                href={item.id === 'beats' ? sheetHref : `${sheetHref}?view=arrangement`}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[11px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
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
        <span className="flex items-center gap-[5px] whitespace-nowrap text-10-5 text-ink3" data-beats-save data-save-state={saveState.kind}>
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saving' ? 'bg-note' : 'bg-add'}`} />
          {saveState.kind === 'saving' ? 'saving…' : saveState.kind === 'error' ? 'not saved' : saveState.kind === 'saved' ? 'saved' : 'up to date'}
        </span>
        <button
          type="button"
          data-add-beat
          disabled={saveState.kind === 'saving' || beatsState === 'unreadable'}
          className="folio-focus flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink disabled:opacity-60"
          onClick={() => {
            onAdd('', '')
          }}
        >
          <span className="text-11 opacity-75">＋</span>Add beat
        </button>
      </header>

      {saveState.kind === 'error' ? (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del" data-beats-error>
          {saveState.message}
        </div>
      ) : null}
      {unreadable === null ? null : (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del">
          The stored outline would not read ({unreadable}). Beats are its blocks, so nothing is editable until it is repaired.
        </div>
      )}

      {empty ? (
        <EmptyBeats
          state={beatsState}
          onAdd={() => {
            onAdd('', '')
          }}
          pending={saveState.kind === 'saving'}
        />
      ) : view === 'beats' ? (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-0 pb-[48px] pt-[20px]">
          <div style={{ zoom }} className="flex w-[816px] flex-none flex-col items-center">
            <div className="folio-prose-ruler">
              <div />
            </div>
            <BeatSheet
              beats={beats}
              scenes={scenes}
              selected={selected}
              title={sheetTitle}
              date={sheetDate}
              onSelect={setSelected}
              onHeadline={onHeadline}
              onDuration={onDuration}
              onMove={onMove}
              onDelete={onDelete}
              onLink={onLink}
              onUnlink={onUnlink}
              onAdd={onAdd}
            />
            <div className="flex w-[816px] flex-wrap gap-[16px] px-[2px] pt-[12px] font-sans text-10-5 text-ink3">
              <span>
                <b className="font-mono font-bold text-ink2">⌥↑↓</b> reorder a beat
              </span>
              <span>Reordering here renumbers the beat sheet; it never moves a scene in the script</span>
            </div>
          </div>
        </div>
      ) : (
        <Arrangement
          beats={beats}
          selected={selected}
          scale={scale}
          sheetHref={sheetHref}
          onSelect={setSelected}
          onPlace={onPlace}
          onCanvas={onCanvas}
          onScale={setScale}
        />
      )}

      <footer
        data-status-bar
        className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2"
      >
        <span className="flex-none whitespace-nowrap tabular-nums">
          {beats.length} beat{beats.length === 1 ? '' : 's'} · <b className="font-semibold text-ink" data-footer-placed-count>{placed.length}</b> placed
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="flex-none whitespace-nowrap">{view === 'beats' ? 'Beat sheet' : 'Arrangement'}</span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate whitespace-nowrap" data-footer-selected>
          Selected: {selectedName}
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="flex-none whitespace-nowrap tabular-nums" data-footer-placed>
          {placedMinutes}m of {allMinutes}m
        </span>
        <div className="min-w-0 flex-1" />
        <button type="button" className="folio-status-button" onClick={onToggleNav}>
          {navOpen ? 'Hide nav' : 'Show nav'}
        </button>
        <button type="button" className="folio-status-button" title="Zoom" onClick={onCycleZoom}>
          {zoomLabel}
        </button>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>
    </main>
  )
}
