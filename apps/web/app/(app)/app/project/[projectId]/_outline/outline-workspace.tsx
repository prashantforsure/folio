'use client'

import type { DocumentId, MentionEntity, MentionLabel, NodeId, OutlineNode } from '@folio/script'
import { labelBook, outlineHeadings, typed } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { registerEditor } from '../../../../../../lib/agent/editor-channel'
import { saveOutline } from '../../../../../../lib/outline/actions'
import { applyInOutlineEditor } from '../../../../../../lib/outline/apply-ops'
import { outlineFilename, outlineMarkdown } from '../../../../../../lib/outline/markdown'
import { fromDoc } from '../../../../../../lib/outline/pm-model'
import type { OutlineStats } from '../../../../../../lib/outline/server'
import type { TocRow } from '../../../../../../lib/outline/toc'
import { TITLE_ROW_ID, activeTocRow, publishOutlineToc } from '../../../../../../lib/outline/toc'
import { createMention } from '../../../../../../lib/script/actions'
import type { IdentityLog } from '../../../../../../lib/script/identity'
import { mintNodeId, newIdentityLog, retirementsSince } from '../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../lib/script/inline'
import type { RevisionRow, ThreadView } from '../../../../../../lib/script/panel'
import type { SaveConflict } from '../../../../../../lib/script/result'
import { ThreadCards } from '../_script/comments/thread-cards'
import type { OutlineInputs } from './editor/extensions'
import type { OutlineStore } from './editor/outline-store'
import { createOutlineStore, initialShape, useSlice } from './editor/outline-store'
import { StaticOutline } from './editor/static-outline'
import { OutlineEditor, updateInputs } from './editor/tiptap-outline-editor'
import { EmptyCaretLine, EmptyOutlineHints } from './empty-outline'
import { OutlineActionsMenu, OutlineDocumentMenu } from './outline-toolbar'
import type { OutlineStatRow } from './outline-toolbar'

/**
 * The Outline route's body: the toolbar row, the banners, and the scrolling
 * column - inside the main-surface card the writing layout draws
 * (`docs/ui design/Route - Outline v2.dc.html`). The header, the sidebar
 * and the assistant are the shell's; the route has no status bar since the
 * redesign.
 *
 * ## One document, its own - and not in React
 *
 * On the server the outline is `nodes` rows under a `kind = 'outline'`
 * document. Here it lives in the Tiptap editor and nowhere else: this
 * component holds no value, and a keystroke renders nothing of it. It
 * becomes authoritative again only through `fromDoc` - the strict reader
 * over the seven-block union, run on `editor.state.doc` when the save is
 * built - and `saveOutline`. What the chrome draws - the counts, the caret
 * block, the heading list - comes through `editor/outline-store.ts`
 * slices, each notifying only when its value moved. The outline is not
 * paginated, so there is no measurement, no layout engine, no page frames:
 * blocks wrap in CSS and the column grows.
 *
 * ## The empty state is the editor
 *
 * No outline document yet (`draft === null`) draws the same column over one
 * blank Body block minted here after mount - there is no "Start the
 * outline" button. The title reads `Untitled outline` in `--ink3`, the
 * caret line promises "Start typing, or type '/' to add a block", and two
 * hints sit under it. The first keystroke turns the title into the
 * episode's and the first save goes up with `documentId: null`; the server
 * creates the document and the workspace saves into the id it was handed
 * back. Until that save the toolbar reads `New outline` and the nav's row
 * `—`, so an untouched visit leaves no row behind.
 *
 * ## Saving
 *
 * Autosave a second after the last change, at once when the tab is hidden,
 * and on `⌘S` with a snapshot. The whole list goes up - an outline is tens
 * of blocks - and the server plans the fewest rows. Last-write-wins with a
 * conflict banner, as the Script. One save in flight at a time; a change
 * that lands during one queues another against the document *then*.
 *
 * ## What the sidebar reads from here
 *
 * Two things, without a render of the layout. The nav's `Outline` row
 * prints `N acts`, returned by every save and written into the row
 * (`data-nav-meta`). The `In this outline` list is the heading slice plus
 * the caret, published to `lib/outline/toc.ts` on every change and cleared
 * on unmount.
 *
 * ## Threads
 *
 * Comment threads are drawn in the document, under the block each anchors
 * to, by the editor's decorations plugin (hosts) and the Script's
 * `ThreadCards` (portals) - the same cards, opened with the `outline_block`
 * anchor. `composerAt` is the one block a new thread is being written
 * under, from the `+` handle.
 */

const AUTOSAVE_MS = 1000

export type OutlineDraft = {
  readonly documentId: string
  readonly updatedAt: string
  readonly createdAt: string
  readonly nodes: readonly OutlineNode[]
  readonly labels: readonly MentionLabel[]
  readonly stats: OutlineStats
  readonly threads: readonly ThreadView[]
  /** The manual snapshots, newest first - the title menu's `Drafts` list. */
  readonly drafts: readonly RevisionRow[]
}

export type OutlineWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly episodeTitle: string
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
      return 'New outline'
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

/** `09/05/26` - the mono date under the title, as the mockup draws it. */
const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })

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

export const OutlineWorkspace = ({ projectId, episode, episodeTitle, outlineState, draft, unreadable }: OutlineWorkspaceProps) => {
  // The clock differs between the server render and the first client
  // render, so it is not read until after hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // ---------------------------------------------------------------------------
  // Document state
  // ---------------------------------------------------------------------------

  const [labels, setLabels] = useState<readonly MentionLabel[]>(draft?.labels ?? [])
  const [threads, setThreads] = useState<readonly ThreadView[]>(draft?.threads ?? [])
  const [composerAt, setComposerAt] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<readonly RevisionRow[]>(draft?.drafts ?? [])
  const [saveState, setSaveState] = useState<SaveState>(draft === null ? { kind: 'new' } : { kind: 'saved', at: 0 })
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const [defect, setDefect] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  const [store] = useState<OutlineStore>(() =>
    createOutlineStore(
      draft?.nodes ?? [],
      initialShape(draft?.nodes ?? [], draft?.stats.words ?? 0),
      draft === null ? [] : outlineHeadings(draft.nodes, labelBook(draft.labels)),
    ),
  )
  const caret = useSlice(store.caret)
  const shape = useSlice(store.shape)
  const headings = useSlice(store.headings)
  const ids = useSlice(store.ids)

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

  const log = useMemo<IdentityLog>(() => newIdentityLog(), [])
  const editorRef = useRef<Editor | null>(null)
  const baseUpdatedAt = useRef(draft?.updatedAt ?? '')
  const baselineIds = useRef<readonly NodeId[]>((draft?.nodes ?? []).map((node) => node.id))
  const saveTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  const queued = useRef(false)

  const labelFor = useMemo(() => labelBookOf(labels), [labels])
  const threadsByNode = useMemo(() => threadsByNodeOf(threads), [threads])
  const inputs = useMemo<OutlineInputs>(() => ({ labelFor, threadsByNode, composerAt }), [composerAt, labelFor, threadsByNode])
  const initialInputs = useRef(inputs)
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs
  /** What the editor was last told. Only the fields that changed are sent. */
  const sentInputs = useRef(inputs)
  useEffect(() => {
    const editor = editorRef.current
    const last = sentInputs.current
    if (editor === null || inputs === last) return
    const partial: { -readonly [K in keyof OutlineInputs]?: OutlineInputs[K] } = {}
    if (inputs.labelFor !== last.labelFor) partial.labelFor = inputs.labelFor
    if (inputs.threadsByNode !== last.threadsByNode) partial.threadsByNode = inputs.threadsByNode
    if (inputs.composerAt !== last.composerAt) partial.composerAt = inputs.composerAt
    sentInputs.current = inputs
    if (Object.keys(partial).length > 0) updateInputs(editor, partial)
  }, [inputs])
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const readLabels = useCallback(() => labelsRef.current, [])

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
          if (result.snapshotTaken) {
            const taken = new Date()
            setDrafts((current) => [
              {
                id: `local:${taken.toISOString()}`,
                name: 'Snapshot',
                meta: `${taken.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(nodes.length)} blocks`,
              },
              ...current,
            ])
          }
        } else if (result.status === 'stale') {
          // Unreachable from here: this editor never sends `expectedDigest`,
          // because it *is* the open editor and last-write-wins with a banner
          // is the ruling for two people typing (AGENTS.md, no realtime). The
          // branch exists because the result type has the case, and a client
          // that silently ignored a write that did not happen is the failure
          // the compare-and-swap was added to prevent.
          setSaveState({ kind: 'error', message: 'The outline changed under this edit. Reload to continue.' })
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
  // Mentions and threads
  // ---------------------------------------------------------------------------

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
    if (editor !== null && inputsRef.current !== sentInputs.current) {
      sentInputs.current = inputsRef.current
      updateInputs(editor, inputsRef.current)
    }
  }, [])

  // The agent's way in (roadmap task 3.4, ADR 0003 D10 path A) - the Script
  // workspace's, for the outline: a proposal that edits this outline while it
  // is open is applied here and persisted by the autosave above.
  const registeredId = draft === null ? null : draft.documentId
  useEffect(() => {
    if (registeredId === null) return
    return registerEditor(registeredId, {
      kind: 'outline',
      flush: async () => {
        if (saveTimer.current !== null) {
          window.clearTimeout(saveTimer.current)
          saveTimer.current = null
          await saveRef.current(false)
        }
        for (let tries = 0; (inFlight.current || queued.current) && tries < 100; tries += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 100))
        }
      },
      apply: (ops, run) => {
        const editor = editorRef.current
        return editor === null ? { ok: false, message: 'The outline is not open.', stale: false } : applyInOutlineEditor(editor, ops, run)
      },
    })
  }, [registeredId])

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
  // The sidebar's list
  // ---------------------------------------------------------------------------

  const started = createdAt !== null || saveState.kind !== 'new'

  const columnRef = useRef<HTMLDivElement>(null)
  const onPickToc = useCallback((id: string) => {
    const editor = editorRef.current
    if (id === TITLE_ROW_ID) {
      columnRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      editor?.chain().focus('start').run()
      return
    }
    if (editor === null) return
    let at: number | null = null
    editor.state.doc.forEach((block, pos) => {
      if (at === null && block.attrs['id'] === id) at = pos
    })
    if (at === null) return
    editor
      .chain()
      .focus()
      .setTextSelection(at + 1)
      .scrollIntoView()
      .run()
  }, [])

  useEffect(() => {
    if (!started || headings.length === 0) {
      publishOutlineToc(started ? { rows: [], activeId: null, onPick: onPickToc } : null)
      return
    }
    const rows: readonly TocRow[] = [
      { id: TITLE_ROW_ID, text: episodeTitle, level: 'title' },
      ...headings.map((heading): TocRow => ({ id: heading.id as string, text: heading.text, level: heading.level })),
    ]
    publishOutlineToc({ rows, activeId: activeTocRow(rows, ids, caret.blockId), onPick: onPickToc })
  }, [caret.blockId, episodeTitle, headings, ids, onPickToc, started])
  useEffect(
    () => () => {
      publishOutlineToc(null)
    },
    [],
  )

  // ---------------------------------------------------------------------------
  // The toolbar
  // ---------------------------------------------------------------------------

  const onSnapshot = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    void saveRef.current(true)
  }, [])
  const onUndo = useCallback(() => {
    editorRef.current?.commands.undo()
  }, [])
  const onExport = useCallback(() => {
    const editor = editorRef.current
    if (editor === null) return
    const read = fromDoc(editor.state.doc)
    if (!read.ok) {
      setNotice('The outline could not be read for export. Fix the block the banner names first.')
      return
    }
    const markdown = outlineMarkdown(episodeTitle, read.value, labelBook(labelsRef.current))
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = outlineFilename(episodeTitle)
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${anchor.download}.`)
  }, [episodeTitle])

  const wordLabel = !started ? 'Empty' : `${shape.words.toLocaleString('en-US')} ${shape.words === 1 ? 'word' : 'words'}`
  const documentTitle = started ? `Outline · Draft ${String(drafts.length + 1)}` : 'Untitled outline'
  const stats: readonly OutlineStatRow[] = [
    ['Words', shape.words],
    ['Blocks', shape.blockCount],
    ['Acts', shape.acts],
    ['Beats', shape.beats],
    ['Scenes', draft?.stats.scenes ?? 0],
    ['Characters', draft?.stats.characters ?? 0],
    ['Locations', draft?.stats.locations ?? 0],
  ]

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
        inputs={initialInputs.current}
        labels={readLabels}
        onCreateMention={onCreateMention}
        onComment={onComment}
        onEditor={onEditor}
        autoFocus
        fallback={<StaticOutline nodes={nodes} labelFor={initialInputs.current.labelFor} />}
      >
        <ThreadCards
          hosts={store.hosts}
          kind="outline_block"
          threads={threads}
          composerAt={composerAt}
          projectId={projectId}
          episode={episode}
          onChange={onThreadChange}
          onResolved={onThreadResolved}
          onOpened={onThreadOpened}
          onCancelComposer={onCancelComposer}
        />
      </OutlineEditor>
    )
  }, [
    composerAt,
    draft,
    editable,
    episode,
    log,
    nodes,
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
    <main data-route="outline" data-outline-state={outlineState === 'empty' && started ? 'draft' : outlineState} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div data-outline-header data-mounted={mounted ? 'true' : 'false'} className="flex flex-none items-center gap-[10px] px-[20px] pb-[4px] pt-[14px]">
        <OutlineDocumentMenu title={documentTitle} drafts={drafts} />
        <div className="flex-1" />
        <span className="flex items-center gap-[7px] whitespace-nowrap text-12 text-ink3" data-save-state={saveState.kind}>
          <span className="tabular" data-word-count>
            {wordLabel}
          </span>
          <span className="folio-dot" />
          <span className={`h-[6px] w-[6px] rounded-full ${saveState.kind === 'error' ? 'bg-live' : saveState.kind === 'saved' ? 'bg-ok' : 'bg-warn'}`} />
          {agoLabel(saveState, now)}
        </span>
        <OutlineActionsMenu onSnapshot={onSnapshot} onExport={onExport} onUndo={onUndo} canAct={editable && nodes !== null} notice={notice} stats={stats} />
      </div>

      {conflict === null ? null : (
        <div role="status" className="folio-banner" data-tone="warn" data-conflict-banner>
          <span>
            Someone else saved this outline at {new Date(conflict.found).toLocaleTimeString()}. Your save overwrote theirs — last write wins. Reload to see what they changed before continuing.
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
      {unreadable === null ? null : (
        <div role="alert" className="folio-banner" data-tone="live">
          The stored outline would not read ({unreadable}). Nothing is editable until it is repaired.
        </div>
      )}

      <div ref={columnRef} data-editor-column className="flex min-h-0 flex-1 justify-center overflow-y-auto px-[24px] pb-[56px] pt-[18px]">
        <div className="folio-script-column">
          <div className="folio-outline" data-sheet {...(started ? {} : { 'data-empty-state': '' })}>
            <div className="folio-outline-title" data-outline-title>
              <span className="folio-outline-title-text">{started ? episodeTitle : 'Untitled outline'}</span>
              {started ? <span className="font-mono text-12-5 text-ink3">{createdAt === null ? 'unsaved' : dateLabel(createdAt)}</span> : null}
            </div>
            {editorArea}
            {started ? (
              <p className="folio-outline-footnote">Beats written here stay in the outline; the script is never rewritten from this page.</p>
            ) : editable ? (
              <EmptyOutlineHints />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  )
}
