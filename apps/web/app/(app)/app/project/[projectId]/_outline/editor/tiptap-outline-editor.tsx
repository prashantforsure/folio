'use client'

import type { MentionEntity, MentionLabel, OutlineNode } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import { blockAttrsOf, toDoc } from '../../../../../../../lib/outline/pm-model'
import type { IdentityLog } from '../../../../../../../lib/script/identity'
import { mintNodeId } from '../../../../../../../lib/script/identity'
import { MENTION_TYPE } from '../../../../../../../lib/script/inline'
import type { HostMap } from '../../_script/editor/editor-store'
import type { HostRegistry } from '../../_script/editor/extensions'
import { FloatingLayer } from '../../_script/editor/floating/floating-layer'
import { MentionCombobox } from '../../_script/editor/floating/mention-combobox'
import type { OutlineInputs } from './extensions'
import { caretBlock, outlineExtensions, outlineHeadingsOf, outlineInputsTransaction, outlineShapeOf } from './extensions'
import { OutlineHandleMenu } from './floating/outline-handle-menu'
import { OutlineSlashMenu } from './floating/outline-slash-menu'
import type { OutlineStore } from './outline-store'
import { useSlice } from './outline-store'

/**
 * The outline editor, mounted. Tiptap owns the document; React owns nothing
 * of it. The Script route's `tiptap-editor.tsx`, for the other document.
 *
 * `immediatelyRender: false` - the editor is created after hydration, so
 * the server renders none of it and the workspace draws the static column
 * (`static-outline.tsx`) in its place until then, the same DOM at the same
 * geometry. `shouldRerenderOnTransaction: false` - a transaction is not a
 * React render; what the chrome needs comes through the store.
 *
 * The caret is reported on every transaction, not only on a selection
 * change: `⌘1` retypes the block under a caret that did not move, and the
 * sidebar's lit row must follow at once. The slice is equality-checked, so
 * a transaction that left the caret where it was notifies no one.
 *
 * Everything that changes after creation - the label book, the thread
 * map, where the composer is - reaches the decorations plugin as data,
 * never by re-creating the extensions (`updateInputs`). The floating
 * surfaces are drawn here, in one portal outside the page; the thread
 * cards go the other way, portalled *into* host elements the plugin
 * creates inside the editor's DOM (`children`).
 */

export type OutlineEditorProps = {
  readonly documentId: string
  readonly nodes: readonly OutlineNode[]
  readonly store: OutlineStore
  readonly log: IdentityLog
  readonly inputs: OutlineInputs
  /** The label book as the workspace currently holds it, for the `@` combobox. */
  readonly labels: () => readonly MentionLabel[]
  readonly onCreateMention: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
  /** Open a new-thread composer under this block. From the `+` handle's menu. */
  readonly onComment: (nodeId: string) => void
  /** Handed the editor once it exists, and `null` when it is destroyed. */
  readonly onEditor: (editor: Editor | null) => void
  readonly autoFocus: boolean
  /** Drawn until the editor exists: the server's static column. */
  readonly fallback: ReactNode
  /** The thread cards and the composer, portalled into their hosts. */
  readonly children?: ReactNode
}

/** Hand the editor new inputs. The mention node's label book is replaced in the same step. */
export const updateInputs = (editor: Editor, inputs: Partial<OutlineInputs>): void => {
  if (inputs.labelFor !== undefined) editor.storage[MENTION_TYPE].labelFor = inputs.labelFor
  editor.view.dispatch(outlineInputsTransaction(editor.state, inputs))
}

const FloatingSurfaces = ({
  editor,
  store,
  onComment,
}: {
  readonly editor: Editor
  readonly store: OutlineStore
  readonly onComment: (nodeId: string) => void
}) => {
  const slash = useSlice(store.slash)
  const mention = useSlice(store.mention)
  const handleMenu = useSlice(store.handleMenu)
  const context = editor.view.dom
  return (
    <FloatingLayer>
      {slash === null ? null : <OutlineSlashMenu view={slash} context={context} />}
      {mention === null || slash !== null ? null : <MentionCombobox view={mention} context={context} />}
      {handleMenu === null ? null : (
        <OutlineHandleMenu
          view={handleMenu}
          editor={editor}
          context={context}
          onComment={onComment}
          onClose={() => {
            store.handleMenu.set(null)
          }}
        />
      )}
    </FloatingLayer>
  )
}

export const OutlineEditor = ({
  documentId,
  nodes,
  store,
  log,
  inputs,
  labels,
  onCreateMention,
  onComment,
  onEditor,
  autoFocus,
  fallback,
  children,
}: OutlineEditorProps) => {
  // The extensions are built once per document. What they need later they
  // read through these refs, so a new label book or a new server action
  // never rebuilds the editor.
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const createRef = useRef(onCreateMention)
  createRef.current = onCreateMention
  const onEditorRef = useRef(onEditor)
  onEditorRef.current = onEditor

  const hosts = useMemo<HostRegistry>(
    () => ({
      mount: (key, element) => {
        const next = new Map<string, HTMLElement>(store.hosts.get() as HostMap)
        next.set(key, element)
        store.hosts.set(next)
      },
      unmount: (key) => {
        const current = store.hosts.get()
        if (!current.has(key)) return
        const next = new Map<string, HTMLElement>(current)
        next.delete(key)
        store.hosts.set(next)
      },
    }),
    [store],
  )

  const extensions = useMemo(
    () =>
      outlineExtensions({
        documentId,
        mint: mintNodeId,
        log,
        store,
        inputs,
        labels: () => labelsRef.current(),
        onCreateMention: (entity, name) => createRef.current(entity, name),
        hosts,
        onHandleMenu: (request) => {
          store.handleMenu.set({ nodeId: request.nodeId, pos: request.pos, anchor: request.anchor })
        },
        onIds: (ids) => {
          store.ids.set(ids)
        },
        onShape: (shape) => {
          store.shape.set(shape)
        },
        onHeadings: (headings) => {
          store.headings.set(headings)
        },
      }),
    // The initial inputs are creation-time; later ones arrive through `updateInputs`.
    [documentId, hosts, log, store],
  )

  const content = useMemo(() => toDoc(nodes), [nodes])

  const reportCaret = (editor: Editor): void => {
    const block = caretBlock(editor.state)
    store.caret.set({ blockId: block === null ? null : blockAttrsOf(block.node).id, type: block?.type ?? null })
  }

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions,
      content,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: {
          // Tiptap's core Tabindex extension puts `tabindex="0"` on the
          // editable, which would make `@folio/ui`'s global
          // `[tabindex]:focus-visible` ring fire on it. The column is not a
          // control: no ring, no outline, no border, in any focus state.
          class: 'folio-outline-editable border-none outline-none focus:border-transparent focus:outline-none focus:ring-0',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          'data-gramm': 'false',
          'data-gramm_editor': 'false',
          'data-enable-grammarly': 'false',
        },
      },
      onUpdate: () => {
        store.version.set(store.version.get() + 1)
      },
      onTransaction: ({ editor: at }) => {
        reportCaret(at)
      },
      onCreate: ({ editor: created }) => {
        onEditorRef.current(created)
      },
      onDestroy: () => {
        onEditorRef.current(null)
      },
    },
    [extensions],
  )

  useEffect(() => {
    if (editor === null) return
    reportCaret(editor)
    const shape = outlineShapeOf(editor.state)
    if (shape !== undefined) store.shape.set(shape)
    const headings = outlineHeadingsOf(editor.state)
    if (headings !== undefined) store.headings.set(headings)
    // `reportCaret` closes over the store, which is stable for the editor's life.
  }, [editor])

  return (
    <>
      {editor === null ? fallback : null}
      <EditorContent
        editor={editor}
        className="folio-editor-host border-none outline-none focus:border-transparent focus:outline-none focus:ring-0"
        data-editor-ready={editor === null ? 'false' : 'true'}
      />
      {editor === null ? null : <FloatingSurfaces editor={editor} store={store} onComment={onComment} />}
      {editor === null ? null : children}
    </>
  )
}
