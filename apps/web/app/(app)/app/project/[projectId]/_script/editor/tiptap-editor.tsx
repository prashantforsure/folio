'use client'

import type { MentionEntity, MentionLabel, ScreenplayNode } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import type { IdentityLog } from '../../../../../../../lib/script/identity'
import { mintNodeId } from '../../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../../lib/script/inline'
import { MENTION_TYPE } from '../../../../../../../lib/script/inline'
import { blockAttrsOf, toDoc } from '../../../../../../../lib/script/pm-model'
import type { EditorStore, HostMap } from './editor-store'
import { useSlice } from './editor-store'
import type { HostRegistry, SheetInputs } from './extensions'
import { caretBlock, screenplayExtensions, sheetInputsTransaction } from './extensions'
import { BlockPicker } from './floating/block-picker'
import { FloatingLayer } from './floating/floating-layer'
import { HandleMenu } from './floating/handle-menu'
import { MentionCombobox } from './floating/mention-combobox'
import { SlashMenu } from './floating/slash-menu'

/**
 * The editor, mounted. Tiptap owns the document; React owns nothing of it.
 *
 * `immediatelyRender: false` - the editor is created after hydration, so
 * the server renders none of it and the workspace draws the static page
 * (`sheet/static-sheet.tsx`) in its place until then, the same DOM at the
 * same geometry. `shouldRerenderOnTransaction: false` - a transaction is
 * not a React render; what the chrome needs comes through the store.
 *
 * Everything that changes after creation - the label book, the measurement
 * record, the page mode, the thread map, where the composer is - reaches
 * the extensions as data, never by re-creating them: `updateSheet`
 * dispatches a meta transaction the decorations plugin reads, and the
 * mention node's storage is replaced in the same call so a new label is
 * drawn by the same transaction.
 *
 * The floating surfaces are drawn here, in one portal outside the page,
 * from the views the extensions publish. The thread cards are drawn the
 * other way round - portalled *into* host elements the decorations plugin
 * creates inside the editor's DOM (`children`), so a card sits between the
 * blocks it belongs to and scrolls with them.
 */

export type ScriptEditorProps = {
  readonly documentId: string
  readonly nodes: readonly ScreenplayNode[]
  readonly store: EditorStore
  readonly log: IdentityLog
  readonly labelFor: LabelFor
  readonly labels: () => readonly MentionLabel[]
  readonly sheet: SheetInputs
  readonly onCreateMention: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
  /** Open a new-thread composer under this block. From the `+` handle's menu. */
  readonly onComment: (nodeId: string) => void
  /** Handed the editor once it exists, and `null` when it is destroyed. */
  readonly onEditor: (editor: Editor | null) => void
  readonly autoFocus: boolean
  /** Drawn until the editor exists: the server's static page. */
  readonly fallback: ReactNode
  /** The thread cards and the composer, portalled into their hosts. */
  readonly children?: ReactNode
}

/** Hand the page new inputs. The mention node's label book is replaced in the same step. */
export const updateSheet = (editor: Editor, inputs: Partial<SheetInputs>): void => {
  if (inputs.labelFor !== undefined) editor.storage[MENTION_TYPE].labelFor = inputs.labelFor
  editor.view.dispatch(sheetInputsTransaction(editor.state, inputs))
}

const FloatingSurfaces = ({
  editor,
  store,
  onComment,
}: {
  readonly editor: Editor
  readonly store: EditorStore
  readonly onComment: (nodeId: string) => void
}) => {
  const slash = useSlice(store.slash)
  const mention = useSlice(store.mention)
  const picker = useSlice(store.picker)
  const handleMenu = useSlice(store.handleMenu)
  const context = editor.view.dom
  return (
    <FloatingLayer>
      {slash === null ? null : <SlashMenu view={slash} context={context} />}
      {mention === null || slash !== null ? null : <MentionCombobox view={mention} context={context} />}
      {picker === null || slash !== null || mention !== null ? null : <BlockPicker view={picker} context={context} />}
      {handleMenu === null ? null : (
        <HandleMenu
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

export const ScriptEditor = ({
  documentId,
  nodes,
  store,
  log,
  labelFor,
  labels,
  sheet,
  onCreateMention,
  onComment,
  onEditor,
  autoFocus,
  fallback,
  children,
}: ScriptEditorProps) => {
  // The extensions are built once per document. What they need later they
  // read through these refs, so a new label book or a new server action
  // closure never re-creates the editor.
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
      screenplayExtensions({
        documentId,
        mint: mintNodeId,
        log,
        store,
        labelFor,
        labels: () => labelsRef.current(),
        onCreateMention: (entity, name) => createRef.current(entity, name),
        sheet,
        hosts,
        onHandleMenu: (request) => {
          store.handleMenu.set({ nodeId: request.nodeId, pos: request.pos, anchor: request.anchor })
        },
        onIds: (ids) => {
          store.ids.set(ids)
        },
      }),
    // The initial sheet and label book are creation-time inputs; later ones arrive through `updateSheet`.
    [documentId, hosts, log, store],
  )

  const content = useMemo(() => toDoc(nodes), [nodes])

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions,
      content,
      autofocus: autoFocus ? 'start' : false,
      editorProps: {
        attributes: {
          // Tiptap's core Tabindex extension puts `tabindex="0"` on the
          // editable, which makes `@folio/ui`'s global `[tabindex]:focus-visible`
          // ring (2px `--focus`) fire on it. The page is not a control: no
          // ring, no outline, no border, in any focus state.
          class: 'folio-editable border-none outline-none focus:border-transparent focus:outline-none focus:ring-0',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          // Grammarly (and similar extensions) draw their own box around a
          // contenteditable region unless told not to; nothing here does.
          'data-gramm': 'false',
          'data-gramm_editor': 'false',
          'data-enable-grammarly': 'false',
        },
      },
      onUpdate: () => {
        store.version.set(store.version.get() + 1)
      },
      onSelectionUpdate: ({ editor: at }) => {
        const block = caretBlock(at.state)
        const id = block === null ? null : blockAttrsOf(block.node).id
        store.caret.set({ blockId: id, type: block?.type ?? null })
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
    const block = caretBlock(editor.state)
    store.caret.set({ blockId: block === null ? null : blockAttrsOf(block.node).id, type: block?.type ?? null })
  }, [editor, store])

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
