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
import { formatEighths, resolveSheet } from '@folio/script'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { createMention, exportScriptFdx, saveScript, setFormat, setPagination } from '../../../../../../lib/script/actions'
import type { IdentityLog } from '../../../../../../lib/script/identity'
import { newIdentityLog, retirementsSince } from '../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../lib/script/inline'
import type { Measurer } from '../../../../../../lib/script/measure-client'
import { createMeasurer } from '../../../../../../lib/script/measure-client'
import { measureNodes } from '../../../../../../lib/script/measure'
import type { RevisionRow, ThreadView } from '../../../../../../lib/script/panel'
import { fromDoc } from '../../../../../../lib/script/pm-model'
import type { MeasureOutcome, SaveConflict, SimpleResult } from '../../../../../../lib/script/result'
import type { ScriptStats } from '../../../../../../lib/script/stats'
import type { PaginationControl, ProjectPagination } from '../../../../../../lib/state/project-preferences'
import { controlFromPagination, paginationFromControl } from '../../../../../../lib/state/project-preferences'
import { ThreadCards } from './comments/thread-cards'
import type { EditorStore } from './editor/editor-store'
import { createEditorStore, useSlice } from './editor/editor-store'
import type { SheetInputs } from './editor/extensions'
import { ScriptEditor, updateSheet } from './editor/tiptap-editor'
import { CoverSheet } from './sheet/cover-sheet'
import { EmptySheet } from './sheet/empty-sheet'
import { IMPORT_INPUT_ID, ImportForm } from './sheet/import-form'
import { StaticSheet } from './sheet/static-sheet'
import { ActionsMenu, DocumentMenu } from './toolbar'
import type { ScriptDoc } from './toolbar'

/**
 * The Script route's body: the toolbar row, the banners, and the scrolling
 * page - inside the main-surface card the writing layout draws
 * (`docs/ui design/Route - Script v2.dc.html`). The header, the sidebar and
 * the assistant are the shell's; the route has no status bar since the
 * redesign.
 *
 * ## The single source of truth, and where it is at each moment
 *
 * On the server it is the `nodes` table. Here it is the ProseMirror
 * document the writer is typing into, held by the Tiptap editor - **not by
 * React**. It becomes authoritative again only by going back through
 * `fromDoc` (the strict reader) and `saveScript`. Nothing else reads the
 * document: the toolbar reads the *record*; the stats come from the
 * server. So no surface here can quietly become the script, and a
 * keystroke renders no component at all - what the chrome needs arrives
 * through `editor-store.ts`, one slice each, and only when it changed.
 *
 * ## Saving
 *
 * Autosave a second after the last change, and at once when the tab is hidden.
 * Last-write-wins: the server writes regardless and reports a conflict when
 * `documents.updated_at` moved, and the banner says so. `⌘S` saves now and
 * asks for a snapshot; otherwise a snapshot is requested at most every five
 * minutes. A document the strict reader refuses is not saved - the banner
 * names the defect.
 *
 * What goes over the wire is a **delta** against the last save: the nodes
 * that are new or changed, and the id order only when a node was added,
 * removed or moved. The baseline is the list the server last confirmed,
 * kept as one JSON string per node so "changed" is one comparison. One save
 * is in flight at a time; a change that lands while one is out runs when
 * the first returns, against the document *then*.
 *
 * ## Pagination
 *
 * The record is the server's, returned by every save. With `liveRepaginate`
 * the same `paginate` runs here on every change (debounced 150ms) so the
 * page dividers follow the keystroke; without it they move on save. Either
 * way the record the page draws was produced by the one engine with the
 * same inputs, and the page number never touches a node. A save sends a
 * digest of the record it holds and the server answers "same" instead of
 * 400 KB of record when they agree. Since the redesign the record reaches
 * the screen as `Page N` dividers only (`lib/script/pages.ts`) - the body is
 * Geist and wraps on its own, so nothing here measures a line.
 *
 * ## Threads
 *
 * Comment threads are drawn in the document, under the block each anchors
 * to, by the editor's decorations plugin (hosts) and `ThreadCards`
 * (portals). Their state is here: the list the server loaded, replaced
 * card by card as replies land, resolved ones dropped. `composerAt` is the
 * one block a new thread is being written under, from the `+` handle.
 *
 * ## The document switch
 *
 * Script or title page - component state (ruled 2026-09-11), reached from
 * the toolbar's title menu since the redesign. A click flips the state and
 * requests nothing: both stay mounted and the one not showing is `hidden`,
 * so the editor keeps its state and a pending autosave keeps its timer.
 *
 * ## Pagination and format
 *
 * Per project, on the row (`lib/state/project-preferences.ts`). What is
 * here is the row as this client last knew it, moved ahead of the write: a
 * click re-paginates in the browser and the server action writes the row
 * behind it. If the write is refused the setting snaps back and the menu
 * says why.
 */

/** A second after the last change. A save is a delta and one statement, so the pause can be short. */
const AUTOSAVE_MS = 1000
const LIVE_REPAGINATE_MS = 150
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000
/** Derivation - project-wide, the expensive half of a save - at most this often between explicit saves. */
const DERIVE_EVERY_MS = 20 * 1000

/** The three project-row settings the actions menu writes. */
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
  readonly threads: readonly ThreadView[]
  readonly revisions: readonly RevisionRow[]
}

export type ScriptWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly episodeTitle: string
  readonly project: Project
  /** `Standpipe · Rev. Blue` - the toolbar's title. */
  readonly documentTitle: string
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

const threadsByNodeOf = (threads: readonly ThreadView[]): ReadonlyMap<string, readonly string[]> => {
  const out = new Map<string, string[]>()
  for (const thread of threads) {
    const list = out.get(thread.nodeId)
    if (list === undefined) out.set(thread.nodeId, [thread.id])
    else list.push(thread.id)
  }
  return out
}

export const ScriptWorkspace = ({
  projectId,
  episode,
  episodeTitle,
  project,
  documentTitle,
  scriptState,
  draft,
  titlePage,
  unreadable,
}: ScriptWorkspaceProps) => {
  // The clock differs between the server render and the first client
  // render, so it is not read until after hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // ---------------------------------------------------------------------------
  // The document switch. Not in the URL; see the header.
  // ---------------------------------------------------------------------------

  const [doc, setDoc] = useState<ScriptDoc>('script')

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
  const [threads, setThreads] = useState<readonly ThreadView[]>(draft?.threads ?? [])
  const [composerAt, setComposerAt] = useState<string | null>(null)
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
  // unless the format changed. The sheet keys the per-block wrap cache that
  // places a mid-block page divider, so the previous object is kept while it
  // is equal; the ref write is the usual "remember the last" during render.
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
  const threadsByNode = useMemo(() => threadsByNodeOf(threads), [threads])

  const paged = preferences.pageMode === 'paged'
  const record: MeasurementRecord | null = measurement?.ok === true ? measurement.record : null

  const [store] = useState<EditorStore>(() => createEditorStore((draft?.nodes ?? []).map((node) => node.id as string)))
  const ids = useSlice(store.ids)

  const sheetInputs = useMemo<SheetInputs>(
    () => ({ sheet, record, paged, labelFor, threadsByNode, composerAt }),
    [composerAt, labelFor, paged, record, sheet, threadsByNode],
  )
  const initialSheetInputs = useRef(sheetInputs)
  const sheetInputsRef = useRef(sheetInputs)
  sheetInputsRef.current = sheetInputs
  /** What the editor was last told. Only the fields that changed are sent: a new record re-places the dividers, a new thread map rebuilds. */
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
    if (sheetInputs.threadsByNode !== last.threadsByNode) partial.threadsByNode = sheetInputs.threadsByNode
    if (sheetInputs.composerAt !== last.composerAt) partial.composerAt = sheetInputs.composerAt
    sentSheetInputs.current = sheetInputs
    if (Object.keys(partial).length > 0) updateSheet(editor, partial)
  }, [sheetInputs])

  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const readLabels = useCallback(() => labelsRef.current, [])

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

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
      const serialised = nodes.map((node, index) => serialise(current.maybeChild(index) ?? undefined, node))
      const upserts = nodes.filter((node, index) => before.byId.get(node.id as string) !== serialised[index])
      const sameOrder = nodeIds.length === before.ids.length && nodeIds.every((id, index) => id === before.ids[index])
      const retirements = retirementsSince(before.ids as readonly NodeId[], nodeIds, log)
      const wantSnapshot = snapshot || Date.now() - lastSnapshot.current > SNAPSHOT_EVERY_MS
      const wantDerive = snapshot || Date.now() - lastDerive.current > DERIVE_EVERY_MS
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
          setLabels((existing) => (JSON.stringify(existing) === JSON.stringify(result.labels) ? existing : result.labels))
          setConflict(result.conflict)
          setSaveState({ kind: 'saved', at: Date.now() })
        } else if (result.status === 'ids-unusable') {
          setSaveState({ kind: 'error', message: `${String(result.ids.length)} id(s) were already used. Reload to continue.` })
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
      choosePreferences({ ...preferences, ...paginationFromControl(control) }, () => setPagination(projectId, episode, control))
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
    }
    const onHidden = (): void => {
      if (document.visibilityState !== 'hidden' || saveTimer.current === null) return
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      void saveRef.current(false)
    }
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
    if (editor !== null && sheetInputsRef.current !== sentSheetInputs.current) {
      sentSheetInputs.current = sheetInputsRef.current
      updateSheet(editor, sheetInputsRef.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------

  const onThreadChange = useCallback((thread: ThreadView) => {
    setThreads((existing) => existing.map((entry) => (entry.id === thread.id ? thread : entry)))
  }, [])
  const onThreadResolved = useCallback((threadId: string) => {
    setThreads((existing) => existing.filter((entry) => entry.id !== threadId))
  }, [])
  const onThreadOpened = useCallback((thread: ThreadView) => {
    setThreads((existing) => [...existing, thread])
    setComposerAt(null)
  }, [])
  const onComment = useCallback((nodeId: string) => {
    setComposerAt(nodeId)
  }, [])
  const onCancelComposer = useCallback(() => {
    setComposerAt(null)
    editorRef.current?.view.focus()
  }, [])

  // ---------------------------------------------------------------------------
  // Toolbar figures, from the record
  // ---------------------------------------------------------------------------

  const pagesLabel = useMemo(() => {
    const pagedRecord: MeasurementRecord | null = measurement?.ok === true ? measurement.paged : null
    if (pagedRecord === null) return draft === null ? 'Empty' : '— pp'
    return `${String(pagedRecord.totals.pages)} pp`
  }, [draft, measurement])

  /**
   * The paged record as a page map, in the golden file's row format with the
   * node's *position* in place of its id - rendered as JSON in a hidden
   * element for the browser walk to diff against
   * `packages/script/src/testing/golden/us-letter.json`. Nothing in the
   * product reads it.
   */
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
                .map((artefact) => `${artefact.kind}@${key(artefact.kind === 'more' ? artefact.afterNode : artefact.beforeNode)}`)
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

  const refusal = measurement?.ok === false ? measurement.refusal : null

  const onImport = useCallback(() => {
    document.getElementById(IMPORT_INPUT_ID)?.click()
  }, [])
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
        if (result.omitted > 0) notes.push(`${plural(result.omitted, 'note')} left out`)
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
  const onUndo = useCallback(() => {
    editorRef.current?.commands.undo()
  }, [])

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
        onComment={onComment}
        onEditor={onEditor}
        autoFocus={doc === 'script'}
        fallback={
          <StaticSheet
            nodes={draft.nodes}
            record={initialSheetInputs.current.record}
            paged={initialSheetInputs.current.paged}
            labelFor={initialSheetInputs.current.labelFor}
          />
        }
      >
        <ThreadCards
          hosts={store.hosts}
          kind="script_node"
          threads={threads}
          composerAt={composerAt}
          projectId={projectId}
          episode={episode}
          onChange={onThreadChange}
          onResolved={onThreadResolved}
          onOpened={onThreadOpened}
          onCancelComposer={onCancelComposer}
        />
      </ScriptEditor>
    )
  }, [
    composerAt,
    doc,
    draft,
    episode,
    log,
    onCancelComposer,
    onComment,
    onCreateMention,
    onEditor,
    onThreadChange,
    onThreadOpened,
    onThreadResolved,
    projectId,
    readLabels,
    store,
    threads,
  ])

  return (
    <main data-route="script" data-doc-tab={doc} data-script-state={scriptState} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div data-script-header data-mounted={mounted ? 'true' : 'false'} className="flex flex-none items-center gap-[10px] px-[20px] pb-[4px] pt-[14px]">
        <DocumentMenu title={documentTitle} doc={doc} onPickDoc={setDoc} revisions={draft?.revisions ?? []} />
        <div className="flex-1" />
        <span className="flex items-center gap-[7px] whitespace-nowrap text-12 text-ink3" data-save-state={saveState.kind}>
          <span className="tabular" data-pages-label>
            {pagesLabel}
          </span>
          <span className="folio-dot" />
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-live' : saveState.kind === 'saved' ? 'bg-ok' : 'bg-warn'}`} />
          {agoLabel(saveState, now)}
        </span>
        <ActionsMenu
          project={project}
          pagination={controlFromPagination(preferences)}
          format={preferences.format}
          preferencesPending={preferencesPending}
          preferencesNotice={preferencesNotice}
          onPickPagination={choosePagination}
          onPickFormat={chooseFormat}
          stats={stats}
          onImport={onImport}
          onExport={onExport}
          exporting={exporting}
          exportNotice={exportNotice}
          onUndo={onUndo}
          canUndo={draft !== null}
        />
      </div>

      {conflict === null ? null : (
        <div role="status" className="folio-banner" data-tone="warn" data-conflict-banner>
          <span>
            Someone else saved this script at {new Date(conflict.found).toLocaleTimeString()}. Your save overwrote theirs — last write wins. Reload to see what they changed before continuing.
          </span>
          <button
            type="button"
            className="folio-ghost-button ml-auto rounded-[8px] px-[8px] py-[3px] text-12"
            onClick={() => {
              setConflict(null)
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {defect === null ? null : (
        <div role="alert" className="folio-banner" data-tone="live" data-defect-banner>
          {defect}
        </div>
      )}
      {refusal === null ? null : (
        <div role="status" className="folio-banner" data-tone="warn" data-refusal-banner>
          Pagination is off: {refusal.detail}
        </div>
      )}
      {unreadable === null ? null : (
        <div role="alert" className="folio-banner" data-tone="live">
          The stored script would not read ({unreadable}). Nothing is editable until it is repaired.
        </div>
      )}

      <div data-editor-column className="flex min-h-0 flex-1 justify-center overflow-y-auto px-[24px] pb-[56px] pt-[18px]">
        <div className="folio-script-column">
          <div hidden={doc !== 'cover'} data-doc="cover">
            <CoverSheet projectId={projectId} episode={episode} titlePage={titlePage} episodeTitle={episodeTitle} />
          </div>
          <div hidden={doc !== 'script'} data-doc="script">
            {draft === null ? (
              <EmptySheet projectId={projectId} episode={episode} />
            ) : (
              <div className="folio-script" data-sheet data-page-mode={preferences.pageMode}>
                {pageMap === null ? null : (
                  <div hidden data-page-map>
                    {JSON.stringify(pageMap)}
                  </div>
                )}
                {editorArea}
              </div>
            )}
          </div>
          {draft === null ? null : <ImportForm projectId={projectId} episode={episode} />}
        </div>
      </div>
    </main>
  )
}
