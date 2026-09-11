'use client'

import type { Project, TitlePage } from '@folio/contracts'
import type {
  LockedPage,
  MeasurementRecord,
  MentionEntity,
  MentionLabel,
  NodeId,
  RevisionColour,
  ScreenplayNode,
  ScreenplayNodeType,
  ScriptFormat,
  SheetSpec,
} from '@folio/script'
import { formatEighths, paginate, readSlugline, resolveSheet } from '@folio/script'
import type { TElement } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { createMention, saveScript, setFormat, setPagination } from '../../../../../../lib/script/actions'
import { digestOf } from '../../../../../../lib/script/digest'
import type { IdentityLog } from '../../../../../../lib/script/identity'
import { newIdentityLog, retirementsSince } from '../../../../../../lib/script/identity'
import type { SheetLayout } from '../../../../../../lib/script/layout'
import { charsPerLineFor, layoutSheet } from '../../../../../../lib/script/layout'
import { lineCountOf, lineEndsOfBlock } from '../../../../../../lib/script/lines'
import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import type { MeasureOutcome, SaveConflict, SimpleResult } from '../../../../../../lib/script/result'
import type { ScriptValue } from '../../../../../../lib/script/slate-model'
import { fromSlateValue, isScriptElement } from '../../../../../../lib/script/slate-model'
import type { ScriptStats } from '../../../../../../lib/script/stats'
import type { PaginationControl, ProjectPagination } from '../../../../../../lib/state/project-preferences'
import {
  controlFromPagination,
  PAGINATION_CONTROL_COPY,
  paginationFromControl,
} from '../../../../../../lib/state/project-preferences'
import type { SideTab } from '../../../../../../lib/state/session'
import { useSession } from '../../../../../../lib/state/session'
import { eighths } from '../../../../../../lib/workspace/format'
import type { CaretInfo } from './editor/plate-editor'
import { ScriptEditor } from './editor/plate-editor'
import { RightPanel } from './panel/right-panel'
import { CoverSheet } from './sheet/cover-sheet'
import { EmptySheet } from './sheet/empty-sheet'
import { IMPORT_INPUT_ID, ImportForm } from './sheet/import-form'
import { PageFrames } from './sheet/page-frames'
import { StatusBar } from './status-bar'
import { TypeBar } from './type-bar'
import { ViewTab } from './view-tab'

/**
 * The Script route's main column, from the 46px header to the 27px status
 * bar, with the editor column and the right panel between them.
 *
 * ## The single source of truth, and where it is at each moment
 *
 * On the server it is the `nodes` table. Here it is the Slate value the
 * writer is typing into - and that value becomes authoritative again only
 * by going back through `fromSlateValue` (the strict reader) and
 * `saveScript`. Nothing else reads the Slate value: the layout reads block
 * ids, types and line counts; the status bar reads the *record*; the stats
 * come from the server. So no surface here can quietly become the script.
 *
 * ## Saving
 *
 * Autosave a second after the last change, and at once when the tab is hidden.
 * Last-write-wins: the server writes regardless and reports a conflict when
 * `documents.updated_at` moved, and the banner says so. `⌘S` saves now and
 * asks for a snapshot; otherwise a snapshot is requested at most every five
 * minutes (an assumption, flagged). A value the strict reader refuses is
 * not saved - the banner names the defect - which is the editor being told
 * it made a shape the script cannot hold, rather than the script being
 * widened to hold it.
 *
 * What goes over the wire is a **delta** against the last save: the nodes
 * that are new or changed, and the id order only when a node was added,
 * removed or moved. A feature is half a megabyte as a whole list and a
 * keystroke is one node; the server lays the delta over its rows and has
 * the whole list back before it decides anything (`actions.ts`). The
 * baseline the delta is against is the list the server last confirmed,
 * kept here as one JSON string per node so "changed" is one comparison.
 *
 * One save is in flight at a time. A change that lands while one is out
 * marks another wanted, and it runs when the first returns - against the
 * value *then*, read through a ref, never the value the first closed over.
 * A save that throws - the network, not the script - clears the in-flight
 * flag in `finally` so the next change can try again.
 *
 * ## Pagination
 *
 * The record is the server's, returned by every save. With `liveRepaginate`
 * the same `paginate` runs here on every change (debounced 150ms) - with
 * the same locked pages and revision colour the server uses, handed down at
 * load - so the breaks follow the keystroke; without it the breaks move on
 * save. Either way the record the sheet draws was produced by the one
 * engine with the same inputs, and the page number never touches a node.
 * Because the inputs are the same, a save sends a digest of the record it
 * holds and the server answers "same" instead of 400 KB of record when they
 * agree (`lib/script/digest.ts`). Without `liveRepaginate` the record is
 * computed here once per save, for the digest, and applied only when the
 * server has confirmed it - which is still "the breaks move on save", with
 * the server's answer and without the server's bytes.
 *
 * ## Switching the document and the panel tab
 *
 * Neither is in the URL - ruled 2026-09-11, `lib/workspace/params.ts`. The
 * `▤ Script / ▣ Cover` segment is component state here, so the route always
 * opens on the script; `Info / Collaboration` is `useSession().sideTab`, so
 * the tab a writer picked survives a trip to Outline and back, as the design
 * README's state table says it should. A click flips the state and requests
 * nothing: both sheets stay mounted and the one not showing is `hidden`, so
 * the Plate editor keeps its state and a pending autosave keeps its timer
 * across a look at the cover.
 *
 * ## Pagination and format
 *
 * Per project, on the row (`lib/state/project-preferences.ts`) - and the
 * row is still the only place they are *decided*. What is here is the row as
 * this client last knew it, seeded from the server render and moved ahead of
 * the write: a click re-paginates in the browser with the new setting,
 * through the same `paginate` the live mode uses, and the server action
 * writes the row behind it. If the write is refused the setting snaps back
 * and the panel says why. Nothing is revalidated - a second `loadScript` for
 * a one-column update was the delay the client called "routing" - and the
 * next save's record, measured against the written row, replaces the local
 * one as every save's does.
 */

/** A second after the last change. A save is a delta and one statement now, so the pause can be short. */
const AUTOSAVE_MS = 1000
const LIVE_REPAGINATE_MS = 150
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000
/** Derivation - project-wide, the expensive half of a save - at most this often between explicit saves. */
const DERIVE_EVERY_MS = 20 * 1000

/** The header segment. `cover` is the title page on the same sheet geometry. */
export type ScriptDoc = 'script' | 'cover'

/** The three project-row settings the Info panel writes. */
export type ScriptPreferences = ProjectPagination & { readonly format: ScriptFormat }

export type ScriptDraft = {
  readonly documentId: string
  readonly updatedAt: string
  readonly nodes: readonly ScreenplayNode[]
  readonly value: ScriptValue
  readonly measurement: MeasureOutcome
  readonly stats: ScriptStats
  readonly labels: readonly MentionLabel[]
  /** The engine's other inputs, so a local pass equals the server's. */
  readonly lockedPages: readonly LockedPage[]
  readonly revision: RevisionColour
  readonly threads: readonly ThreadCard[]
  readonly revisions: readonly RevisionRow[]
}

export type ScriptWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly episodeTitle: string
  readonly project: Project
  readonly revisionLabel: string
  readonly routeId: string
  readonly scriptState: 'empty' | 'draft' | 'unreadable'
  readonly draft: ScriptDraft | null
  readonly titlePage: TitlePage | null
  readonly unreadable: string | null
}

type SaveState =
  | { readonly kind: 'new' }
  | { readonly kind: 'dirty' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: number }
  | { readonly kind: 'error'; readonly message: string }

const sheetFor = (measurement: MeasureOutcome | null): SheetSpec => {
  if (measurement?.ok === true) return measurement.record.sheet
  const letter = resolveSheet('hollywood')
  if (!letter.ok) throw new Error('Folio: US Letter must resolve.')
  return letter.value
}

/** Wrapped through the per-block cache in `lines.ts`: a keystroke wraps one block, not three thousand. */
const blocksOf = (
  value: readonly TElement[],
  sheet: SheetSpec,
  labelFor: (entity: MentionEntity, id: string) => string | undefined,
) =>
  value.flatMap((element) => {
    if (!isScriptElement(element)) return []
    const lines = lineCountOf(lineEndsOfBlock(element, labelFor, charsPerLineFor(sheet, element.type)))
    return [{ id: element.id, type: element.type, lines }]
  })

/**
 * A node's JSON, remembered on the Slate element it was read from. The delta
 * compares every node to the baseline by its JSON; Slate keeps untouched
 * elements as the same objects, so a save serialises the blocks that changed
 * and looks the rest up.
 */
const serialisedNode = new WeakMap<TElement, string>()

const serialise = (element: TElement | undefined, node: ScreenplayNode): string => {
  if (element === undefined) return JSON.stringify(node)
  const hit = serialisedNode.get(element)
  if (hit !== undefined) return hit
  const json = JSON.stringify(node)
  serialisedNode.set(element, json)
  return json
}

/** A record computed here for one value, with the digest a save vouches for it by. */
type LocalRecord = {
  readonly value: readonly TElement[]
  readonly measurement: MeasureOutcome
  readonly digest: string
}

/** The baseline a delta is computed against: the list the server last confirmed. */
type Baseline = {
  readonly ids: readonly string[]
  /** Node id -> the node as JSON, so "changed" is one string comparison. */
  readonly byId: ReadonlyMap<string, string>
}

const baselineOf = (nodes: readonly ScreenplayNode[], serialised: readonly string[]): Baseline => ({
  ids: nodes.map((node) => node.id as string),
  byId: new Map(nodes.map((node, index) => [node.id as string, serialised[index] ?? JSON.stringify(node)])),
})

const agoLabel = (state: SaveState, now: number): string => {
  switch (state.kind) {
    case 'new':
      return 'New script'
    case 'dirty':
      return 'unsaved changes'
    case 'saving':
      return 'saving…'
    case 'error':
      return 'not saved'
    case 'saved': {
      if (state.at === 0 || now === 0) return 'saved'
      const seconds = Math.max(0, Math.round((now - state.at) / 1000))
      if (seconds < 60) return `saved ${String(seconds)}s ago`
      const minutes = Math.round(seconds / 60)
      return `saved ${String(minutes)}m ago`
    }
  }
}

export const ScriptWorkspace = ({
  projectId,
  episode,
  episodeTitle,
  project,
  revisionLabel,
  routeId,
  scriptState,
  draft,
  titlePage,
  unreadable,
}: ScriptWorkspaceProps) => {
  const session = useSession()

  // Session flags come from sessionStorage and the clock from Date.now(): both
  // differ between the server render and the first client render, so neither
  // is read until after hydration. Until then the route draws its defaults.
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
  const sideOpen = (mounted ? session.sideOpen : null) ?? viewport >= 1280
  const available = viewport - 66 - (navOpen ? 238 : 0) - (sideOpen ? 296 : 0) - 48
  const fit = Math.max(0.5, Math.min(1, available / 816))
  const zoomSetting = mounted ? session.zoom : 'fit'
  const zoom = zoomSetting === 'fit' ? Math.round(fit * 1000) / 1000 : zoomSetting
  const zoomLabel = zoomSetting === 'fit' ? `Fit ${String(Math.round(fit * 100))}%` : `${String(Math.round(zoom * 100))}%`

  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  // ---------------------------------------------------------------------------
  // The two switches. Neither is in the URL; see the header.
  // ---------------------------------------------------------------------------

  const [doc, setDoc] = useState<ScriptDoc>('script')
  const panel: SideTab = mounted ? session.sideTab : 'info'

  // ---------------------------------------------------------------------------
  // Document state
  // ---------------------------------------------------------------------------

  const [measurement, setMeasurement] = useState<MeasureOutcome | null>(draft?.measurement ?? null)
  const [preferences, setPreferences] = useState<ScriptPreferences>({
    pageMode: project.pageMode,
    liveRepaginate: project.liveRepaginate,
    format: project.format,
  })
  const [preferencesPending, startPreference] = useTransition()
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null)
  const [stats, setStats] = useState<ScriptStats>(
    draft?.stats ?? { scenes: 0, words: 0, characters: 0, locations: 0, beats: 0, shots: 0, relations: 0 },
  )
  const [labels, setLabels] = useState<readonly MentionLabel[]>(draft?.labels ?? [])
  const [value, setValue] = useState<readonly TElement[]>(() => (draft?.value ?? []).map((block) => ({ ...block })))
  const [saveState, setSaveState] = useState<SaveState>(draft === null ? { kind: 'new' } : { kind: 'saved', at: 0 })
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const [defect, setDefect] = useState<string | null>(null)
  const [caret, setCaret] = useState<CaretInfo>({ blockId: null, type: null })
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    setSaveState((state) => (state.kind === 'saved' && state.at === 0 ? { kind: 'saved', at: Date.now() } : state))
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const log = useMemo<IdentityLog>(() => newIdentityLog(), [])
  const editorRef = useRef<PlateEditor | null>(null)
  const baseUpdatedAt = useRef(draft?.updatedAt ?? '')
  // Lazily: a `useRef(initial)` evaluates its argument on every render, and
  // this one serialises every node.
  const [initialBaseline] = useState<Baseline>(() =>
    baselineOf(draft?.nodes ?? [], (draft?.nodes ?? []).map((node) => JSON.stringify(node))),
  )
  const baseline = useRef<Baseline>(initialBaseline)
  const lastSnapshot = useRef(Date.now())
  const lastDerive = useRef(Date.now())
  const saveTimer = useRef<number | null>(null)
  const liveTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  const queued = useRef(false)
  /** The record computed here for a value, so a save can vouch for it by digest. */
  const localRecordFor = useRef<LocalRecord | null>(null)
  const preferencesRef = useRef<ScriptPreferences>({
    pageMode: project.pageMode,
    liveRepaginate: project.liveRepaginate,
    format: project.format,
  })

  // Every record carries its own `SheetSpec` object, equal to the last one
  // unless the format changed. The editor's context hands the sheet to
  // every block, so a new-but-equal object would re-render three thousand
  // blocks per live repaginate. The previous object is kept while it is
  // equal; the ref write is the usual "remember the last" during render.
  const sheetRef = useRef<{ readonly key: string; readonly spec: SheetSpec } | null>(null)
  const sheet = useMemo(() => {
    const next = sheetFor(measurement)
    const key = JSON.stringify(next)
    const last = sheetRef.current
    if (last !== null && last.key === key) return last.spec
    sheetRef.current = { key, spec: next }
    return next
  }, [measurement])
  const labelFor = useCallback(
    (entity: MentionEntity, id: string): string | undefined =>
      labels.find((label) => label.entity === entity && label.id === id)?.label,
    [labels],
  )

  const paged = preferences.pageMode === 'paged'
  // `layoutSheet` builds a fresh frames array every time; the frames change
  // only when a page is added, a label moves or a comment grows a page, so
  // the previous array is kept while its rows are equal and `<PageFrames>`
  // - a hundred-odd sheets - is not drawn again for a keystroke.
  const framesRef = useRef<{ readonly key: string; readonly frames: SheetLayout['frames'] } | null>(null)
  const layout = useMemo<SheetLayout>(() => {
    const next = layoutSheet(
      blocksOf(value, sheet, labelFor),
      measurement?.ok === true ? measurement.record : null,
      sheet,
      paged,
    )
    const key = next.frames
      .map((frame) => `${String(frame.ordinal)}:${frame.label}:${String(frame.topPx)}:${String(frame.heightPx)}:${frame.locked ? 'L' : ''}`)
      .join('|')
    const last = framesRef.current
    if (last !== null && last.key === key) return { ...next, frames: last.frames }
    framesRef.current = { key, frames: next.frames }
    return next
  }, [value, sheet, labelFor, measurement, paged])

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /**
   * The one engine, run here with the same inputs the server uses. `null`
   * when the value will not read or the engine refuses; the server's answer
   * then carries the refusal.
   */
  const measureLocally = useCallback(
    (next: readonly TElement[], using: ScriptPreferences): LocalRecord | null => {
      const read = fromSlateValue(next)
      if (!read.ok) return null
      const base = {
        format: using.format,
        liveRepaginate: using.liveRepaginate,
        mentionLabels: labels,
        lockedPages: draft?.lockedPages ?? [],
        revision: draft?.revision ?? 'white',
      }
      const record = paginate(read.value, { ...base, pageMode: using.pageMode })
      if (!record.ok) return null
      const pagedRecord =
        using.pageMode === 'paged' ? record : paginate(read.value, { ...base, pageMode: 'paged' })
      if (!pagedRecord.ok) return null
      const measurement: MeasureOutcome = { ok: true, record: record.value, paged: pagedRecord.value }
      return { value: next, measurement, digest: digestOf([record.value, pagedRecord.value]) }
    },
    [draft, labels],
  )

  const save = useCallback(
    async (snapshot: boolean): Promise<void> => {
      if (draft === null) return
      if (inFlight.current) {
        queued.current = true
        return
      }
      const read = fromSlateValue(value)
      if (!read.ok) {
        const where = `block ${String(read.error.index + 1)}`
        const what =
          read.error.kind === 'model'
            ? `${read.error.defect.at || 'node'}: ${read.error.defect.reason.kind}`
            : read.error.kind
        setDefect(`The editor produced a shape the script cannot hold (${where}, ${what}). Nothing was saved.`)
        setSaveState({ kind: 'error', message: what })
        return
      }
      setDefect(null)
      inFlight.current = true
      setSaveState({ kind: 'saving' })
      const nodes = read.value
      const ids = nodes.map((node) => node.id)
      const before = baseline.current
      // The strict reader yields one node per top-level element, in order.
      const serialised = nodes.map((node, index) => serialise(value[index], node))
      const upserts = nodes.filter((node, index) => before.byId.get(node.id as string) !== serialised[index])
      const sameOrder =
        ids.length === before.ids.length && ids.every((id, index) => id === before.ids[index])
      const retirements = retirementsSince(before.ids as readonly NodeId[], ids, log)
      const wantSnapshot = snapshot || Date.now() - lastSnapshot.current > SNAPSHOT_EVERY_MS
      const wantDerive = snapshot || Date.now() - lastDerive.current > DERIVE_EVERY_MS
      // The record this save vouches for: live mode's, when it is for this
      // value, else one computed now. Applied below only if the server
      // confirms it is its own answer.
      const held = localRecordFor.current
      const local = held !== null && held.value === value ? held : measureLocally(value, preferencesRef.current)
      try {
        const result = await saveScript({
          projectId,
          episode,
          documentId: draft.documentId,
          baseUpdatedAt: baseUpdatedAt.current,
          upserts: [...upserts],
          order: sameOrder ? null : [...ids],
          retirements: [...retirements],
          snapshot: wantSnapshot,
          derive: wantDerive,
          recordDigest: local?.digest ?? null,
        })
        if (result.status === 'saved') {
          baseUpdatedAt.current = result.updatedAt
          baseline.current = baselineOf(nodes, serialised)
          if (result.snapshotTaken) lastSnapshot.current = Date.now()
          if (result.stats !== null) {
            lastDerive.current = Date.now()
            setStats(result.stats)
          }
          if (result.measurement !== null) setMeasurement(result.measurement)
          else if (local !== null) setMeasurement(local.measurement)
          // Same book, same array: `labelFor` keys the per-block wrap cache
          // and the editor's context, and a save happens every few seconds.
          setLabels((current) =>
            JSON.stringify(current) === JSON.stringify(result.labels) ? current : result.labels,
          )
          setConflict(result.conflict)
          setSaveState({ kind: 'saved', at: Date.now() })
        } else if (result.status === 'ids-unusable') {
          setSaveState({
            kind: 'error',
            message: `${String(result.ids.length)} id(s) were already used. Reload to continue.`,
          })
        } else {
          setSaveState({ kind: 'error', message: result.message })
        }
      } catch (cause) {
        setSaveState({ kind: 'error', message: cause instanceof Error ? cause.message : 'The save did not reach the server.' })
      } finally {
        inFlight.current = false
      }
      if (queued.current) {
        queued.current = false
        void saveRef.current(false)
      }
    },
    [draft, episode, log, measureLocally, projectId, value],
  )

  const saveRef = useRef(save)
  saveRef.current = save

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void saveRef.current(false)
    }, AUTOSAVE_MS)
  }, [])

  /** Live mode, and a preference change: measure here and draw it now. */
  const repaginateLocally = useCallback(
    (next: readonly TElement[], using: ScriptPreferences) => {
      const local = measureLocally(next, using)
      if (local === null) return
      localRecordFor.current = local
      setMeasurement(local.measurement)
    },
    [measureLocally],
  )

  const onValueChange = useCallback(
    (next: readonly TElement[]) => {
      setValue(next)
      setSaveState((state) => (state.kind === 'saving' ? state : { kind: 'dirty' }))
      scheduleSave()
      if (preferences.liveRepaginate) {
        if (liveTimer.current !== null) window.clearTimeout(liveTimer.current)
        liveTimer.current = window.setTimeout(() => {
          liveTimer.current = null
          repaginateLocally(next, preferences)
        }, LIVE_REPAGINATE_MS)
      }
    },
    [preferences, repaginateLocally, scheduleSave],
  )

  // ---------------------------------------------------------------------------
  // Pagination and format: ahead of the row, then written to it
  // ---------------------------------------------------------------------------

  const valueRef = useRef(value)
  valueRef.current = value
  preferencesRef.current = preferences

  const choosePreferences = useCallback(
    (next: ScriptPreferences, write: () => Promise<SimpleResult>) => {
      const previous = preferences
      setPreferences(next)
      setPreferencesNotice(null)
      if (draft !== null) repaginateLocally(valueRef.current, next)
      startPreference(async () => {
        const result = await write()
        if (result.status === 'done') return
        setPreferences(previous)
        if (draft !== null) repaginateLocally(valueRef.current, previous)
        setPreferencesNotice(result.message)
      })
    },
    [draft, preferences, repaginateLocally],
  )
  const choosePagination = useCallback(
    (control: PaginationControl) => {
      choosePreferences({ ...preferences, ...paginationFromControl(control) }, () =>
        setPagination(projectId, episode, control),
      )
    },
    [choosePreferences, episode, preferences, projectId],
  )
  const chooseFormat = useCallback(
    (format: ScriptFormat) => {
      choosePreferences({ ...preferences, format }, () => setFormat(projectId, episode, format))
    },
    [choosePreferences, episode, preferences, projectId],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
        void saveRef.current(true)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        // The composer is a floating window and is not built this phase.
        event.preventDefault()
      }
    }
    // A tab going to the background is the moment a laptop lid closes: a
    // change waiting on the 1.5s timer is saved now rather than maybe never.
    const onHidden = (): void => {
      if (document.visibilityState !== 'hidden' || saveTimer.current === null) return
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      void saveRef.current(false)
    }
    // And a tab closed with a save pending or in flight is asked about it.
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (saveTimer.current === null && !inFlight.current && !queued.current) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (liveTimer.current !== null) window.clearTimeout(liveTimer.current)
    },
    [],
  )

  const onCreateMention = useCallback(
    async (entity: MentionEntity, name: string): Promise<MentionLabel | null> => {
      const result = await createMention(projectId, episode, entity, name)
      if (result.status !== 'created') return null
      setLabels((current) => [...current, result.label])
      return result.label
    },
    [episode, projectId],
  )

  // ---------------------------------------------------------------------------
  // Status bar figures, from the record
  // ---------------------------------------------------------------------------

  const status = useMemo(() => {
    const record: MeasurementRecord | null = measurement?.ok === true ? measurement.paged : null
    const pages = record === null ? '—' : String(record.totals.pages)
    let page = '—'
    let sceneLabel = 'No scenes yet'
    if (record !== null && caret.blockId !== null) {
      const placed = record.nodes.find((node) => node.id === caret.blockId)
      const ordinal = placed?.runs[0]?.page
      if (ordinal !== undefined) page = record.pages[ordinal - 1]?.label ?? String(ordinal)
      const index = value.findIndex((element) => isScriptElement(element) && element.id === caret.blockId)
      for (let at = index; at >= 0; at -= 1) {
        const element = value[at]
        if (!isScriptElement(element) || element.type !== 'scene') continue
        const scene = record.scenes.find((entry) => entry.id === element.id)
        if (scene !== undefined) {
          sceneLabel = `Scene ${String(scene.number)} · ${eighths(scene.eighths)} pg`
          break
        }
        const heading = element.children.map((child) => ('text' in child ? child.text : '')).join('')
        if (!readSlugline(heading).ok) continue
        break
      }
    } else if (record !== null && record.totals.scenes > 0) {
      sceneLabel = `${String(record.totals.scenes)} scenes`
    }
    if (record === null && caret.blockId === null) page = '1'
    return { page, pages: record === null ? '1' : pages, sceneLabel }
  }, [caret.blockId, measurement, value])

  /**
   * The paged record as a page map, in the golden file's row format with the
   * node's *position* in place of its id - the corpus ids are positional
   * (`f0`, `f50`) and a real document's are UUIDs, so position is the
   * comparable key. Rendered as JSON for the browser walk to diff against
   * `packages/script/src/testing/golden/us-letter.json`. Nothing in the
   * product reads it.
   */
  // The id sequence as one string: it changes on a split, merge or paste,
  // not on a keystroke, so the map below - 100 KB of JSON in a hidden
  // element - is not rebuilt and re-diffed by React for every character.
  const idsKey = useMemo(
    () => value.map((element) => (isScriptElement(element) ? element.id : '')).join('\n'),
    [value],
  )
  const pageMap = useMemo(() => {
    if (measurement?.ok !== true) return null
    const record = measurement.paged
    const position = new Map<string, number>()
    idsKey.split('\n').forEach((id, index) => {
      if (id !== '') position.set(id, index)
    })
    const at = (id: string): string => {
      const index = position.get(id)
      return index === undefined ? '?' : String(index)
    }
    const rows = (at: (id: string) => string) => ({
      pages: record.pages.map((page) =>
        [
          page.ordinal,
          page.label,
          page.linesUsed,
          page.firstNode === null ? '-' : at(page.firstNode),
          page.artefacts.length === 0
            ? '-'
            : page.artefacts
                .map(
                  (artefact) =>
                    `${artefact.kind}@${at(artefact.kind === 'more' ? artefact.afterNode : artefact.beforeNode)}`,
                )
                .join(' '),
        ].join(' | '),
      ),
      scenes: record.scenes.map((scene) =>
        [scene.number, at(scene.id), scene.startPage, scene.endPage, scene.lines, formatEighths(scene.eighths)].join(' | '),
      ),
    })
    const byPosition = rows(at)
    const byId = rows((id) => id)
    return {
      totals: record.totals,
      breaks: record.breaks.map((entry) => entry.rule),
      pages: byPosition.pages,
      scenes: byPosition.scenes,
      pagesById: byId.pages,
      scenesById: byId.scenes,
    }
  }, [measurement, idsKey])

  const paginationLabel = PAGINATION_CONTROL_COPY[controlFromPagination(preferences)].label
  const refusal = measurement?.ok === false ? measurement.refusal : null

  const onImport = useCallback(() => {
    document.getElementById(IMPORT_INPUT_ID)?.click()
  }, [])
  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])
  const onCycleZoom = useCallback(() => {
    session.setZoom(session.zoom === 'fit' ? 1 : session.zoom === 1 ? 0.75 : 'fit')
  }, [session])
  const setCaretType = useCallback((type: ScreenplayNodeType) => {
    const editor = editorRef.current
    if (editor === null) return
    const entry = editor.api.above<TElement>({ match: (n) => isScriptElement(n) })
    if (entry === undefined) return
    editor.tf.setNodes({ type, ...(type === 'character' ? {} : { modifiers: [] }) }, { at: entry[1] })
    editor.tf.focus()
  }, [])

  const editorArea = useMemo(() => {
    if (draft === null) return null
    return (
      <ScriptEditor
        documentId={draft.documentId}
        initialValue={draft.value}
        sheet={sheet}
        layout={layout}
        labels={labels}
        log={log}
        onValueChange={onValueChange}
        onCaret={setCaret}
        onCreateMention={onCreateMention}
        editorRef={editorRef}
        autoFocus={doc === 'script'}
      />
    )
  }, [doc, draft, labels, layout, log, onCreateMention, onValueChange, sheet])


  return (
    <main
      data-route="script"
      data-doc-tab={doc}
      data-script-state={scriptState}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header data-script-header data-mounted={mounted ? 'true' : 'false'} className="flex h-[46px] flex-none items-center gap-[12px] border-b border-line px-[14px]">
        <div className="flex min-w-0 items-baseline gap-[7px]">
          <h1 className="m-0 font-serif text-21 font-medium leading-none tracking-title">Script</h1>
        </div>
        <div className="flex-1" />
        <div className="folio-segment" data-view="true" role="tablist" aria-label="Document">
          <ViewTab
            active={doc === 'script'}
            onPick={() => {
              setDoc('script')
            }}
            className="folio-focus !flex items-center gap-[6px] !px-[11px] !py-[4px]"
          >
            <span className="font-glyph text-10 opacity-70">▤</span>Script
          </ViewTab>
          <ViewTab
            active={doc === 'cover'}
            onPick={() => {
              setDoc('cover')
            }}
            className="folio-focus !flex items-center gap-[6px] !px-[11px] !py-[4px]"
          >
            <span className="font-glyph text-10 opacity-70">▣</span>Cover
          </ViewTab>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-[7px]">
          <span className="flex items-center gap-[5px] whitespace-nowrap text-10-5 text-ink3" data-save-state={saveState.kind}>
            <span
              className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saved' ? 'bg-add' : 'bg-note'}`}
            />
            {agoLabel(saveState, now)}
          </span>
          <button
            type="button"
            title="Undo last operation"
            className="folio-icon-button font-glyph"
            disabled={draft === null}
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              editorRef.current?.undo()
            }}
          >
            ↩
          </button>
          <button
            type="button"
            title="Toggle panel"
            aria-pressed={sideOpen}
            className="folio-icon-button font-glyph"
            onClick={() => {
              session.setSideOpen(!sideOpen)
            }}
          >
            ◫
          </button>
        </div>
      </header>

      {conflict === null ? null : (
        <div role="status" className="flex items-center gap-[10px] border-b border-line bg-note-bg px-[14px] py-[6px] text-11 text-ink" data-conflict-banner>
          <span className="font-glyph text-note">⚠</span>
          <span>
            Someone else saved this script at {new Date(conflict.found).toLocaleTimeString()}. Your save overwrote theirs — last write wins. Reload to see what they changed before continuing.
          </span>
          <button
            type="button"
            className="folio-small-button ml-auto"
            onClick={() => {
              setConflict(null)
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {defect === null ? null : (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del" data-defect-banner>
          {defect}
        </div>
      )}
      {refusal === null ? null : (
        <div role="status" className="border-b border-line bg-note-bg px-[14px] py-[6px] text-11 text-ink" data-refusal-banner>
          Pagination is off: {refusal.detail}
        </div>
      )}
      {unreadable === null ? null : (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del">
          The stored script would not read ({unreadable}). Nothing is editable until it is repaired.
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          data-editor-column
          className="relative flex min-w-0 flex-1 flex-col items-center overflow-auto px-0 pb-[40px] pt-[14px]"
        >
          {doc === 'script' && draft !== null ? (
            <TypeBar current={caret.type} onPick={setCaretType} disabled={false} />
          ) : null}
          <div style={{ zoom }} className="flex w-[816px] flex-none flex-col items-center">
            <div hidden={doc !== 'cover'} data-doc="cover" className="flex w-full flex-col items-center">
              <CoverSheet projectId={projectId} episode={episode} titlePage={titlePage} episodeTitle={episodeTitle} />
            </div>
            <div hidden={doc !== 'script'} data-doc="script" className="flex w-full flex-col items-center">
              {draft === null ? (
                <EmptySheet projectId={projectId} episode={episode} />
              ) : (
                <div className="folio-desk" data-sheet data-page-mode={preferences.pageMode} style={{ minHeight: layout.heightPx }}>
                  {pageMap === null ? null : (
                    <div hidden data-page-map>
                      {JSON.stringify(pageMap)}
                    </div>
                  )}
                  {paged ? (
                    <PageFrames frames={layout.frames} />
                  ) : (
                    <div className="folio-page" style={{ top: 0, height: layout.heightPx }} aria-hidden="true" />
                  )}
                  {editorArea}
                </div>
              )}
            </div>
            {draft === null ? null : <ImportForm projectId={projectId} episode={episode} />}
            {doc === 'script' ? (
              <div className="flex w-[816px] flex-wrap gap-[16px] px-[2px] pt-[12px] font-sans text-10-5 text-ink3">
                <span>
                  <b className="font-mono font-bold text-ink2">Tab</b> Action → Character → Dialogue → Parenthetical
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">@</b> mention a character or location
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">INT.</b> on an empty Action line becomes a Scene Heading
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {sideOpen ? (
          <RightPanel
            projectId={projectId}
            episode={episode}
            project={project}
            tab={panel}
            onPickTab={session.setSideTab}
            pagination={controlFromPagination(preferences)}
            format={preferences.format}
            preferencesPending={preferencesPending}
            preferencesNotice={preferencesNotice}
            onPickPagination={choosePagination}
            onPickFormat={chooseFormat}
            stats={stats}
            threads={draft?.threads ?? []}
            revisions={draft?.revisions ?? []}
            onImport={onImport}
          />
        ) : null}
      </div>

      <StatusBar
        page={status.page}
        pages={status.pages}
        paginationLabel={paginationLabel}
        caretType={caret.type}
        sceneLabel={status.sceneLabel}
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        zoomLabel={zoomLabel}
        onCycleZoom={onCycleZoom}
        revisionLabel={revisionLabel}
        savedLabel={agoLabel(saveState, now)}
        routeId={routeId}
      />
    </main>
  )
}
