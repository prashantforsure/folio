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
  ScriptFormat,
  SheetSpec,
} from '@folio/script'
import { formatEighths, readSlugline, resolveSheet } from '@folio/script'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { createMention, exportScriptFdx, saveScript, setFormat, setPagination } from '../../../../../../lib/script/actions'
import type { IdentityLog } from '../../../../../../lib/script/identity'
import { newIdentityLog, retirementsSince } from '../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../lib/script/inline'
import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import type { Measurer } from '../../../../../../lib/script/measure-client'
import { createMeasurer } from '../../../../../../lib/script/measure-client'
import { measureNodes } from '../../../../../../lib/script/measure'
import { fromDoc } from '../../../../../../lib/script/pm-model'
import type { MeasureOutcome, SaveConflict, SimpleResult } from '../../../../../../lib/script/result'
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
import type { EditorStore } from './editor/editor-store'
import { createEditorStore, useSlice } from './editor/editor-store'
import type { SheetInputs } from './editor/extensions'
import { ScriptEditor, updateSheet } from './editor/tiptap-editor'
import { RightPanel } from './panel/right-panel'
import { CoverSheet } from './sheet/cover-sheet'
import { EmptySheet } from './sheet/empty-sheet'
import { IMPORT_INPUT_ID, ImportForm } from './sheet/import-form'
import { PageFrames } from './sheet/page-frames'
import { StaticSheet, staticLayout } from './sheet/static-sheet'
import { StatusBar } from './status-bar'
import { ViewTab } from './view-tab'

/**
 * The Script route's main column, from the 46px header to the 27px status
 * bar, with the editor column and the right panel between them.
 *
 * ## The single source of truth, and where it is at each moment
 *
 * On the server it is the `nodes` table. Here it is the ProseMirror
 * document the writer is typing into, held by the Tiptap editor - **not by
 * React**. It becomes authoritative again only by going back through
 * `fromDoc` (the strict reader) and `saveScript`. Nothing else reads the
 * document: the layout reads block ids, types and line counts inside the
 * editor's own decorations plugin; the status bar reads the *record* and
 * the caret; the stats come from the server. So no surface here can quietly
 * become the script, and a keystroke renders no component at all - what
 * the chrome needs arrives through `editor-store.ts`, one slice each, and
 * only when it changed.
 *
 * ## Saving
 *
 * Autosave a second after the last change, and at once when the tab is hidden.
 * Last-write-wins: the server writes regardless and reports a conflict when
 * `documents.updated_at` moved, and the banner says so. `⌘S` saves now and
 * asks for a snapshot; otherwise a snapshot is requested at most every five
 * minutes (an assumption, flagged). A document the strict reader refuses is
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
 * kept here as one JSON string per node so "changed" is one comparison -
 * and ProseMirror keeps every block a change did not touch as the same
 * object, so the JSON of an untouched block is looked up, not re-made.
 *
 * One save is in flight at a time. A change that lands while one is out
 * marks another wanted, and it runs when the first returns - against the
 * document *then*, read from the editor, never one the first closed over.
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
 * The record, the sheet, the page mode and the label book reach the editor
 * as data (`updateSheet`); its decorations plugin turns them into margins
 * and page gaps and hands back the page frames it computed.
 *
 * ## Switching the document and the panel tab
 *
 * Neither is in the URL - ruled 2026-09-11, `lib/workspace/params.ts`. The
 * `▤ Script / ▣ Cover` segment is component state here, so the route always
 * opens on the script; `Info / Collaboration` is `useSession().sideTab`, so
 * the tab a writer picked survives a trip to Outline and back, as the design
 * README's state table says it should. A click flips the state and requests
 * nothing: both sheets stay mounted and the one not showing is `hidden`, so
 * the editor keeps its state and a pending autosave keeps its timer
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

/**
 * A node's JSON, remembered on the ProseMirror block it was read from. The
 * delta compares every node to the baseline by its JSON; ProseMirror keeps
 * untouched blocks as the same objects, so a save serialises the blocks
 * that changed and looks the rest up.
 */
const serialisedNode = new WeakMap<ProseMirrorNode, string>()

const serialise = (block: ProseMirrorNode | undefined, node: ScreenplayNode): string => {
  if (block === undefined) return JSON.stringify(node)
  const hit = serialisedNode.get(block)
  if (hit !== undefined) return hit
  const json = JSON.stringify(node)
  serialisedNode.set(block, json)
  return json
}

/** A record computed here for one document, with the digest a save vouches for it by. */
type LocalRecord = {
  readonly doc: ProseMirrorNode
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

const labelBookOf = (labels: readonly MentionLabel[]): LabelFor => {
  const book = new Map<string, string>()
  for (const label of labels) book.set(`${label.entity}:${label.id}`, label.label)
  return (entity, id) => book.get(`${entity}:${id}`)
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
  const [saveState, setSaveState] = useState<SaveState>(draft === null ? { kind: 'new' } : { kind: 'saved', at: 0 })
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const [defect, setDefect] = useState<string | null>(null)
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
  const editorRef = useRef<Editor | null>(null)
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
  /** The record computed here for a document, so a save can vouch for it by digest. */
  const localRecordFor = useRef<LocalRecord | null>(null)
  /** Live measurement, scheduled in idle time on the first live repaginate. */
  const measurer = useRef<Measurer | null>(null)
  const liveSerial = useRef(0)
  useEffect(
    () => () => {
      measurer.current?.dispose()
      measurer.current = null
    },
    [],
  )
  const preferencesRef = useRef<ScriptPreferences>({
    pageMode: project.pageMode,
    liveRepaginate: project.liveRepaginate,
    format: project.format,
  })

  // Every record carries its own `SheetSpec` object, equal to the last one
  // unless the format changed. The sheet is an input to every line end, so
  // a new-but-equal object would re-decorate three thousand blocks per live
  // repaginate. The previous object is kept while it is equal; the ref write
  // is the usual "remember the last" during render.
  const sheetRef = useRef<{ readonly key: string; readonly spec: SheetSpec } | null>(null)
  const sheet = useMemo(() => {
    const next = sheetFor(measurement)
    const key = JSON.stringify(next)
    const last = sheetRef.current
    if (last !== null && last.key === key) return last.spec
    sheetRef.current = { key, spec: next }
    return next
  }, [measurement])
  const labelFor = useMemo(() => labelBookOf(labels), [labels])

  const paged = preferences.pageMode === 'paged'
  const record: MeasurementRecord | null = measurement?.ok === true ? measurement.record : null

  // The layout the server's first paint draws, and the editor's starting
  // point. After that the editor's decorations plugin owns the layout and
  // reports the frames through the store.
  const initialLayout = useMemo(
    () => staticLayout(draft?.nodes ?? [], record, sheet, paged, labelFor),
    // Once: the first render's inputs. Later inputs go to the editor through `updateSheet`.
    [],
  )
  const [store] = useState<EditorStore>(() =>
    createEditorStore(
      (draft?.nodes ?? []).map((node) => node.id as string),
      { frames: initialLayout.frames, heightPx: initialLayout.heightPx, paged: initialLayout.paged },
    ),
  )
  const layout = useSlice(store.layout)
  const caret = useSlice(store.caret)
  const ids = useSlice(store.ids)

  const sheetInputs = useMemo<SheetInputs>(() => ({ sheet, record, paged, labelFor }), [labelFor, paged, record, sheet])
  const initialSheetInputs = useRef(sheetInputs)
  const sheetInputsRef = useRef(sheetInputs)
  sheetInputsRef.current = sheetInputs
  /** What the editor was last told. Only the fields that changed are sent: a new record diffs, a new sheet rebuilds. */
  const sentSheetInputs = useRef(sheetInputs)
  useEffect(() => {
    const editor = editorRef.current
    const last = sentSheetInputs.current
    if (editor === null || sheetInputs === last) return
    const partial: { -readonly [K in keyof SheetInputs]?: SheetInputs[K] } = {}
    if (sheetInputs.sheet !== last.sheet) partial.sheet = sheetInputs.sheet
    if (sheetInputs.record !== last.record) partial.record = sheetInputs.record
    if (sheetInputs.paged !== last.paged) partial.paged = sheetInputs.paged
    if (sheetInputs.labelFor !== last.labelFor) partial.labelFor = sheetInputs.labelFor
    sentSheetInputs.current = sheetInputs
    if (Object.keys(partial).length > 0) updateSheet(editor, partial)
  }, [sheetInputs])

  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const readLabels = useCallback(() => labelsRef.current, [])

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /**
   * The one engine, run here with the same inputs the server uses. `null`
   * when the document will not read or the engine refuses; the server's
   * answer then carries the refusal.
   */
  const measureLocally = useCallback(
    (next: ProseMirrorNode, using: ScriptPreferences): LocalRecord | null => {
      const read = fromDoc(next)
      if (!read.ok) return null
      const reply = measureNodes({
        serial: 0,
        nodes: read.value,
        format: using.format,
        pageMode: using.pageMode,
        liveRepaginate: using.liveRepaginate,
        mentionLabels: labels,
        lockedPages: draft?.lockedPages ?? [],
        revision: draft?.revision ?? 'white',
      })
      if (reply.measurement === null || reply.digest === null) return null
      return { doc: next, measurement: reply.measurement, digest: reply.digest }
    },
    [draft, labels],
  )

  const save = useCallback(
    async (snapshot: boolean): Promise<void> => {
      const editor = editorRef.current
      if (draft === null || editor === null) return
      if (inFlight.current) {
        queued.current = true
        return
      }
      const current = editor.state.doc
      const read = fromDoc(current)
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
      const nodeIds = nodes.map((node) => node.id)
      const before = baseline.current
      // The strict reader yields one node per top-level block, in order.
      const serialised = nodes.map((node, index) => serialise(current.maybeChild(index) ?? undefined, node))
      const upserts = nodes.filter((node, index) => before.byId.get(node.id as string) !== serialised[index])
      const sameOrder =
        nodeIds.length === before.ids.length && nodeIds.every((id, index) => id === before.ids[index])
      const retirements = retirementsSince(before.ids as readonly NodeId[], nodeIds, log)
      const wantSnapshot = snapshot || Date.now() - lastSnapshot.current > SNAPSHOT_EVERY_MS
      const wantDerive = snapshot || Date.now() - lastDerive.current > DERIVE_EVERY_MS
      // The record this save vouches for: live mode's, when it is for this
      // document, else one computed now. Applied below only if the server
      // confirms it is its own answer.
      const held = localRecordFor.current
      const local = held !== null && held.doc === current ? held : measureLocally(current, preferencesRef.current)
      try {
        const result = await saveScript({
          projectId,
          episode,
          documentId: draft.documentId,
          baseUpdatedAt: baseUpdatedAt.current,
          upserts: [...upserts],
          order: sameOrder ? null : [...nodeIds],
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
          // and every line end, and a save happens every few seconds.
          setLabels((existing) =>
            JSON.stringify(existing) === JSON.stringify(result.labels) ? existing : result.labels,
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
    [draft, episode, log, measureLocally, projectId],
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

  /**
   * Live mode, and a preference change: measure - off the main thread when
   * a worker is available - and draw it when the reply lands, unless the
   * document has moved on since, in which case the next pause measures again.
   */
  const repaginateLocally = useCallback(
    (using: ScriptPreferences) => {
      const editor = editorRef.current
      if (editor === null) return
      const current = editor.state.doc
      const read = fromDoc(current)
      if (!read.ok) return
      measurer.current ??= createMeasurer()
      liveSerial.current += 1
      const serial = liveSerial.current
      void measurer.current
        .measure({
          serial,
          nodes: read.value,
          format: using.format,
          pageMode: using.pageMode,
          liveRepaginate: using.liveRepaginate,
          mentionLabels: labelsRef.current,
          lockedPages: draft?.lockedPages ?? [],
          revision: draft?.revision ?? 'white',
        })
        .then((reply) => {
          if (reply.serial !== liveSerial.current || reply.measurement === null || reply.digest === null) return
          localRecordFor.current = { doc: current, measurement: reply.measurement, digest: reply.digest }
          setMeasurement(reply.measurement)
        })
    },
    [draft],
  )

  preferencesRef.current = preferences

  // A change in the editor: mark dirty (without a render when already
  // dirty), schedule the save, and in live mode the repagination.
  useEffect(
    () =>
      store.version.subscribe(() => {
        setSaveState((state) => (state.kind === 'saving' || state.kind === 'dirty' ? state : { kind: 'dirty' }))
        scheduleSave()
        const using = preferencesRef.current
        if (!using.liveRepaginate) return
        if (liveTimer.current !== null) window.clearTimeout(liveTimer.current)
        liveTimer.current = window.setTimeout(() => {
          liveTimer.current = null
          repaginateLocally(using)
        }, LIVE_REPAGINATE_MS)
      }),
    [repaginateLocally, scheduleSave, store],
  )

  // ---------------------------------------------------------------------------
  // Pagination and format: ahead of the row, then written to it
  // ---------------------------------------------------------------------------

  const choosePreferences = useCallback(
    (next: ScriptPreferences, write: () => Promise<SimpleResult>) => {
      const previous = preferences
      setPreferences(next)
      setPreferencesNotice(null)
      if (draft !== null) repaginateLocally(next)
      startPreference(async () => {
        const result = await write()
        if (result.status === 'done') return
        setPreferences(previous)
        if (draft !== null) repaginateLocally(previous)
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
    // change waiting on the timer is saved now rather than maybe never.
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

  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
    // Created after a save already moved the inputs on: it is told everything once.
    if (editor !== null && sheetInputsRef.current !== sentSheetInputs.current) {
      sentSheetInputs.current = sheetInputsRef.current
      updateSheet(editor, sheetInputsRef.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Status bar figures, from the record and the caret
  // ---------------------------------------------------------------------------

  const status = useMemo(() => {
    const pagedRecord: MeasurementRecord | null = measurement?.ok === true ? measurement.paged : null
    const pages = pagedRecord === null ? '—' : String(pagedRecord.totals.pages)
    let page = '—'
    let sceneLabel = 'No scenes yet'
    const editor = editorRef.current
    if (pagedRecord !== null && caret.blockId !== null && editor !== null) {
      const placed = pagedRecord.nodes.find((node) => node.id === caret.blockId)
      const ordinal = placed?.runs[0]?.page
      if (ordinal !== undefined) page = pagedRecord.pages[ordinal - 1]?.label ?? String(ordinal)
      const blocks = editor.state.doc
      const index = ids.indexOf(caret.blockId)
      for (let at = index; at >= 0; at -= 1) {
        const block = blocks.maybeChild(at)
        if (block === null || block.type.name !== 'scene') continue
        const id = block.attrs['id']
        const scene = pagedRecord.scenes.find((entry) => entry.id === id)
        if (scene !== undefined) {
          sceneLabel = `Scene ${String(scene.number)} · ${eighths(scene.eighths)} pg`
          break
        }
        if (!readSlugline(block.textContent).ok) continue
        break
      }
    } else if (pagedRecord !== null && pagedRecord.totals.scenes > 0) {
      sceneLabel = `${String(pagedRecord.totals.scenes)} scenes`
    }
    if (pagedRecord === null && caret.blockId === null) page = '1'
    return { page, pages: pagedRecord === null ? '1' : pages, sceneLabel }
  }, [caret.blockId, ids, measurement])

  /**
   * The paged record as a page map, in the golden file's row format with the
   * node's *position* in place of its id - the corpus ids are positional
   * (`f0`, `f50`) and a real document's are UUIDs, so position is the
   * comparable key. Rendered as JSON for the browser walk to diff against
   * `packages/script/src/testing/golden/us-letter.json`. Nothing in the
   * product reads it.
   */
  // The id sequence is a new array only on a split, merge or paste, not on a
  // keystroke (`editor-store.ts`), so the map below - 100 KB of JSON in a
  // hidden element - is not rebuilt and re-diffed by React for every character.
  const pageMap = useMemo(() => {
    if (measurement?.ok !== true) return null
    const pagedRecord = measurement.paged
    const position = new Map<string, number>()
    ids.forEach((id, index) => {
      if (id !== '') position.set(id, index)
    })
    const at = (id: string): string => {
      const index = position.get(id)
      return index === undefined ? '?' : String(index)
    }
    const rows = (key: (id: string) => string) => ({
      pages: pagedRecord.pages.map((entry) =>
        [
          entry.ordinal,
          entry.label,
          entry.linesUsed,
          entry.firstNode === null ? '-' : key(entry.firstNode),
          entry.artefacts.length === 0
            ? '-'
            : entry.artefacts
                .map(
                  (artefact) =>
                    `${artefact.kind}@${key(artefact.kind === 'more' ? artefact.afterNode : artefact.beforeNode)}`,
                )
                .join(' '),
        ].join(' | '),
      ),
      scenes: pagedRecord.scenes.map((scene) =>
        [scene.number, key(scene.id), scene.startPage, scene.endPage, scene.lines, formatEighths(scene.eighths)].join(' | '),
      ),
    })
    const byPosition = rows(at)
    const byId = rows((id) => id)
    return {
      totals: pagedRecord.totals,
      breaks: pagedRecord.breaks.map((entry) => entry.rule),
      pages: byPosition.pages,
      scenes: byPosition.scenes,
      pagesById: byId.pages,
      scenesById: byId.scenes,
    }
  }, [measurement, ids])

  const paginationLabel = PAGINATION_CONTROL_COPY[controlFromPagination(preferences)].label
  const refusal = measurement?.ok === false ? measurement.refusal : null

  const onImport = useCallback(() => {
    document.getElementById(IMPORT_INPUT_ID)?.click()
  }, [])
  // Export: the action returns the .fdx text and the browser is handed the
  // file; nothing is stored. A save in flight is flushed first so the file
  // is the draft on screen, not the draft of a second ago.
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const onExport = useCallback(() => {
    if (draft === null || exporting) return
    setExporting(true)
    setExportNotice(null)
    const flush = saveTimer.current === null && !inFlight.current ? Promise.resolve() : saveRef.current(false)
    void flush
      .then(() => exportScriptFdx(projectId, episode))
      .then((result) => {
        if (result.status !== 'exported') {
          setExportNotice(result.message)
          return
        }
        const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.filename
        anchor.click()
        URL.revokeObjectURL(url)
        const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`
        const notes: string[] = []
        if (result.omitted > 0) notes.push(`${plural(result.omitted, 'comment')} left out`)
        if (result.subtitlesAsGeneral > 0) notes.push(`${plural(result.subtitlesAsGeneral, 'subtitle')} written as centred General`)
        if (result.unresolvedMentions > 0) notes.push(`${plural(result.unresolvedMentions, 'mention')} with no record`)
        if (result.emptyBlocks > 0) notes.push(`${plural(result.emptyBlocks, 'empty block')} Final Draft will drop`)
        setExportNotice(notes.length === 0 ? `Exported ${result.filename}.` : `Exported ${result.filename} · ${notes.join(' · ')}.`)
      })
      .catch((cause: unknown) => {
        setExportNotice(cause instanceof Error ? cause.message : 'The export did not reach the server.')
      })
      .finally(() => {
        setExporting(false)
      })
  }, [draft, episode, exporting, projectId])
  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])
  const onCycleZoom = useCallback(() => {
    session.setZoom(session.zoom === 'fit' ? 1 : session.zoom === 1 ? 0.75 : 'fit')
  }, [session])

  const editorArea = useMemo(() => {
    if (draft === null) return null
    return (
      <ScriptEditor
        documentId={draft.documentId}
        nodes={draft.nodes}
        store={store}
        log={log}
        labelFor={initialSheetInputs.current.labelFor}
        labels={readLabels}
        sheet={initialSheetInputs.current}
        onCreateMention={onCreateMention}
        onEditor={onEditor}
        autoFocus={doc === 'script'}
        fallback={<StaticSheet nodes={draft.nodes} layout={initialLayout} sheet={initialSheetInputs.current.sheet} labelFor={initialSheetInputs.current.labelFor} />}
      />
    )
  }, [doc, draft, initialLayout, log, onCreateMention, onEditor, readLabels, store])

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
              editorRef.current?.commands.undo()
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
                  {layout.paged ? (
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
                  <b className="font-mono font-bold text-ink2">/</b> at the start of a line lists the eight block types · <b className="font-mono font-bold text-ink2">⌘1</b>–<b className="font-mono font-bold text-ink2">⌘8</b> picks one directly
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">Tab</b> Action → Character → Dialogue → Parenthetical
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">@</b> mention a character or location
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">INT.</b> on an empty Action line becomes a Scene Heading
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">Enter</b> selects or creates in a Scene, Character or Transition selector
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">(</b> on an empty Dialogue line opens a Parenthetical
                </span>
                <span>
                  <b className="font-mono font-bold text-ink2">Click</b> a location, time, cue or cut to change it
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
            onExport={onExport}
            exporting={exporting}
            exportNotice={exportNotice}
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
