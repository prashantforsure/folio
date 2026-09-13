'use client'

import type { Project } from '@folio/contracts'
import type { DocumentId, MentionEntity, MentionLabel, NodeId, OutlineNode } from '@folio/script'
import { typed } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { saveOutline } from '../../../../../../lib/outline/actions'
import { fromDoc } from '../../../../../../lib/outline/pm-model'
import type { OutlineStats } from '../../../../../../lib/outline/server'
import type { IdentityLog } from '../../../../../../lib/script/identity'
import { mintNodeId, newIdentityLog, retirementsSince } from '../../../../../../lib/script/identity'
import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import type { SaveConflict } from '../../../../../../lib/script/result'
import type { SideTab } from '../../../../../../lib/state/session'
import { useSession } from '../../../../../../lib/state/session'
import type { OutlineStore } from './editor/outline-store'
import { createOutlineStore, initialShape, useSlice } from './editor/outline-store'
import { StaticOutline } from './editor/static-outline'
import { OutlineEditor } from './editor/tiptap-outline-editor'
import { EmptyCaretLine, EmptyOutlineNote } from './empty-outline'
import { OutlinePanel } from './outline-panel'
import { OutlineStatusBar } from './outline-status-bar'

/**
 * The Outline route's main column, from the 46px header to the 27px status
 * bar, with the editor column and the right panel between them.
 *
 * ## One document, its own - and not in React
 *
 * On the server the outline is `nodes` rows under a `kind = 'outline'`
 * document. Here it lives in the Tiptap editor and nowhere else: this
 * component holds no value, and a keystroke renders nothing of it. It
 * becomes authoritative again only through `fromDoc` - the strict reader
 * over the seven-block union, run on `editor.state.doc` when the save is
 * built - and `saveOutline`. What the chrome draws - the caret block, the
 * counts, the block ids - comes through `editor/outline-store.ts` slices,
 * each notifying only when its value moved. The outline is not paginated,
 * so there is no measurement, no layout engine, no page frames: blocks
 * wrap in CSS and the sheet grows.
 *
 * ## The empty state is the editor
 *
 * No outline document yet (`draft === null`) draws the same sheet over one
 * blank Body block minted here after mount - there is no "Start the outline"
 * button. The first save goes up with `documentId: null` and the server
 * creates the document; from then on the workspace saves into the id it was
 * handed back. Until that save the header reads `No outline`, the nav's row
 * `—`, and the sheet carries the empty state's note, so an untouched visit
 * leaves no row behind.
 *
 * ## Saving
 *
 * Autosave a second after the last change, at once when the tab is hidden,
 * and on `⌘S` with a snapshot. The whole list goes up - an outline is tens
 * of blocks - and the server plans the fewest rows. Last-write-wins with a
 * conflict banner, as the Script. One save in flight at a time; a change
 * that lands during one queues another against the document *then*.
 *
 * ## What the panel and the nav read from a save
 *
 * The nav's `Outline` row prints `N acts`, read from this document on the
 * server. A save returns the count from the list it wrote and the workspace
 * writes it into the nav's row directly (`data-nav-meta`), so the chrome
 * stays honest without re-rendering the layout on every keystroke.
 *
 * ## The panel tab
 *
 * `Info / Collaboration` is `useSession().sideTab` - the Script's ruling -
 * so the tab a writer picked on the Script survives the trip here.
 */

const AUTOSAVE_MS = 1000

export type OutlineDraft = {
  readonly documentId: string
  readonly updatedAt: string
  readonly createdAt: string
  readonly nodes: readonly OutlineNode[]
  readonly labels: readonly MentionLabel[]
  readonly stats: OutlineStats
  readonly threads: readonly ThreadCard[]
  readonly history: readonly RevisionRow[]
}

export type OutlineWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly episodeTitle: string
  readonly project: Project
  readonly routeId: string
  readonly outlineState: 'empty' | 'draft' | 'unreadable'
  readonly draft: OutlineDraft | null
  readonly unreadable: string | null
}

type SaveState =
  | { readonly kind: 'new' }
  | { readonly kind: 'dirty' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: number }
  | { readonly kind: 'error'; readonly message: string }

const agoLabel = (state: SaveState, now: number): string => {
  switch (state.kind) {
    case 'new':
      return 'No outline'
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
      return `saved ${String(Math.round(seconds / 60))}m ago`
    }
  }
}

/** The nav's row this document feeds, updated in place after a save. */
const writeNavMeta = (acts: number): void => {
  const outline = document.querySelector('[data-nav-meta="outline"]')
  if (outline !== null) outline.textContent = `${String(acts)} act${acts === 1 ? '' : 's'}`
}

const dateLabel = (iso: string): string => {
  const date = new Date(iso)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export const OutlineWorkspace = ({
  projectId,
  episode,
  episodeTitle,
  project,
  routeId,
  outlineState,
  draft,
  unreadable,
}: OutlineWorkspaceProps) => {
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

  const panel: SideTab = mounted ? session.sideTab : 'info'

  // ---------------------------------------------------------------------------
  // The editor, and what React is told about it
  // ---------------------------------------------------------------------------

  const [store] = useState<OutlineStore>(() =>
    createOutlineStore(draft?.nodes ?? [], initialShape(draft?.nodes ?? [], draft?.stats.words ?? 0)),
  )
  const caret = useSlice(store.caret)
  const shape = useSlice(store.shape)

  // No document yet: one blank Body, minted on the client after mount so the
  // server's markup (the static caret line) carries no id to disagree with.
  const editable = unreadable === null
  const [blank, setBlank] = useState<readonly OutlineNode[] | null>(null)
  useEffect(() => {
    if (draft === null && editable) setBlank([{ type: 'body', id: mintNodeId(), provenance: typed(), content: [] }])
  }, [draft, editable])
  const nodes = draft?.nodes ?? blank
  /** The document being saved into; `null` until the first save of a new outline creates it. */
  const documentIdRef = useRef<DocumentId | null>(draft === null ? null : (draft.documentId as DocumentId))
  const [createdAt, setCreatedAt] = useState<string | null>(draft?.createdAt ?? null)

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
  const baselineIds = useRef<readonly NodeId[]>((draft?.nodes ?? []).map((node) => node.id))
  const saveTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  const queued = useRef(false)

  const labels = draft?.labels ?? []
  const labelFor = useCallback(
    (entity: MentionEntity, id: string): string | undefined =>
      labels.find((label) => label.entity === entity && label.id === id)?.label,
    [labels],
  )

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  const save = useCallback(
    async (snapshot: boolean): Promise<void> => {
      const editor = editorRef.current
      if (editor === null || !editable) return
      if (inFlight.current) {
        queued.current = true
        return
      }
      const read = fromDoc(editor.state.doc)
      if (!read.ok) {
        const where = `block ${String(read.error.index + 1)}`
        const what =
          read.error.kind === 'model' ? `${read.error.defect.at || 'block'}: ${read.error.defect.reason.kind}` : read.error.kind
        setDefect(`The editor produced a shape the outline cannot hold (${where}, ${what}). Nothing was saved.`)
        setSaveState({ kind: 'error', message: what })
        return
      }
      setDefect(null)
      inFlight.current = true
      setSaveState({ kind: 'saving' })
      const nodes = read.value
      const ids = nodes.map((node) => node.id)
      const retirements = retirementsSince(baselineIds.current, ids, log)
      try {
        const result = await saveOutline({
          projectId,
          episode,
          documentId: documentIdRef.current,
          baseUpdatedAt: baseUpdatedAt.current,
          nodes: [...nodes],
          retirements: [...retirements],
          snapshot,
        })
        if (result.status === 'saved') {
          documentIdRef.current = result.documentId
          setCreatedAt((current) => current ?? result.createdAt)
          baseUpdatedAt.current = result.updatedAt
          baselineIds.current = ids
          setConflict(result.conflict)
          setSaveState({ kind: 'saved', at: Date.now() })
          writeNavMeta(result.acts)
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
    [editable, episode, log, projectId],
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

  // A change in the editor: mark dirty (without a render when already dirty) and schedule the save.
  useEffect(
    () =>
      store.version.subscribe(() => {
        setSaveState((state) => (state.kind === 'saving' || state.kind === 'dirty' ? state : { kind: 'dirty' }))
        scheduleSave()
      }),
    [scheduleSave, store],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
        void saveRef.current(true)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') event.preventDefault()
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
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Chrome
  // ---------------------------------------------------------------------------

  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])
  const onCycleZoom = useCallback(() => {
    session.setZoom(session.zoom === 'fit' ? 1 : session.zoom === 1 ? 0.75 : 'fit')
  }, [session])
  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

  const editorArea = useMemo(() => {
    if (nodes === null) return editable ? <EmptyCaretLine /> : null
    return (
      <OutlineEditor
        // `data-doc` names the document a copied block came from; a new outline has none yet, and
        // the clipboard treats an unknown origin as foreign, which is the safe reading.
        documentId={draft?.documentId ?? 'new'}
        nodes={nodes}
        store={store}
        log={log}
        labelFor={labelFor}
        onEditor={onEditor}
        autoFocus
        fallback={<StaticOutline nodes={nodes} labelFor={labelFor} />}
      />
    )
    // The label book is a creation-time input; the outline offers no `@` combobox, so it never changes here.
  }, [draft, editable, log, nodes, onEditor, store, labelFor])

  const started = createdAt !== null

  const savedLabel = agoLabel(saveState, now)

  return (
    <main data-route="outline" data-outline-state={outlineState === 'empty' && started ? 'draft' : outlineState} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header data-outline-header data-mounted={mounted ? 'true' : 'false'} className="flex h-[46px] flex-none items-center gap-[12px] border-b border-line px-[14px]">
        <div className="flex min-w-0 items-baseline gap-[7px]">
          <h1 className="m-0 font-serif text-21 font-medium leading-none tracking-title">Outline</h1>
        </div>
        <div className="flex-1" />
        <span className="flex items-center gap-[5px] whitespace-nowrap text-10-5 text-ink3" data-save-state={saveState.kind}>
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saved' ? 'bg-add' : 'bg-note'}`} />
          {savedLabel}
        </span>
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
      </header>

      {conflict === null ? null : (
        <div role="status" className="flex items-center gap-[10px] border-b border-line bg-note-bg px-[14px] py-[6px] text-11 text-ink" data-conflict-banner>
          <span className="font-glyph text-note">⚠</span>
          <span>
            Someone else saved this outline at {new Date(conflict.found).toLocaleTimeString()}. Your save overwrote theirs — last write wins. Reload to see what they changed before continuing.
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
      {unreadable === null ? null : (
        <div role="alert" className="border-b border-line bg-del-bg px-[14px] py-[6px] text-11 text-del">
          The stored outline would not read ({unreadable}). Nothing is editable until it is repaired.
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <div data-editor-column className="relative flex min-w-0 flex-1 flex-col items-center overflow-auto px-0 pb-[48px] pt-[14px]">
          <div style={{ zoom }} className="flex w-[816px] flex-none flex-col items-center">
            <div className="folio-prose-ruler">
              <div />
            </div>
            <div className="folio-prose-sheet" data-sheet {...(started ? {} : { 'data-empty-state': '' })}>
              <div className="flex flex-col gap-[6px] px-[96px]">
                <span className="font-serif text-34 leading-[1.1] tracking-[-.015em]" data-outline-title>
                  {episodeTitle}
                </span>
                <span className="text-14 text-ink3">{createdAt === null ? 'no outline yet' : dateLabel(createdAt)}</span>
              </div>
              <div className="h-[34px]" />
              {editorArea}
              {started || !editable ? null : <EmptyOutlineNote />}
            </div>
            <div className="flex w-[816px] flex-wrap gap-[16px] px-[2px] pt-[12px] font-sans text-10-5 text-ink3">
              <span>
                <b className="font-mono font-bold text-ink2">/</b> insert a heading, quote or rule
              </span>
              <span>
                <b className="font-mono font-bold text-ink2">⌥↑↓</b> move a block
              </span>
              <span>The script is never rewritten from this page</span>
            </div>
          </div>
        </div>

        {sideOpen ? (
          <OutlinePanel
            projectId={projectId}
            episode={episode}
            project={project}
            tab={panel}
            onPickTab={session.setSideTab}
            blockCount={shape.blockCount}
            stats={
              draft === null
                ? { scenes: 0, words: shape.words, characters: 0, locations: 0, beats: shape.beats, shots: 0, relations: 0 }
                : { ...draft.stats, words: shape.words, beats: shape.beats }
            }
            threads={draft?.threads ?? []}
            history={draft?.history ?? []}
          />
        ) : null}
      </div>

      <OutlineStatusBar
        blockCount={shape.blockCount}
        caretType={caret.type}
        words={shape.words}
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        zoomLabel={zoomLabel}
        onCycleZoom={onCycleZoom}
        savedLabel={savedLabel}
        routeId={routeId}
      />
    </main>
  )
}
