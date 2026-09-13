'use client'

import type { OutlineNode } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import { blockAttrsOf, toDoc } from '../../../../../../../lib/outline/pm-model'
import type { IdentityLog } from '../../../../../../../lib/script/identity'
import { mintNodeId } from '../../../../../../../lib/script/identity'
import type { LabelFor } from '../../../../../../../lib/script/inline'
import { MENTION_TYPE } from '../../../../../../../lib/script/inline'
import { FloatingLayer } from '../../_script/editor/floating/floating-layer'
import { caretBlock, labelBookTransaction, outlineExtensions, outlineShapeOf } from './extensions'
import { OutlineSlashMenu } from './floating/outline-slash-menu'
import type { OutlineStore } from './outline-store'
import { useSlice } from './outline-store'

/**
 * The outline editor, mounted. Tiptap owns the document; React owns nothing
 * of it. The Script route's `tiptap-editor.tsx`, for the other document.
 *
 * `immediatelyRender: false` - the editor is created after hydration, so
 * the server renders none of it and the workspace draws the static sheet
 * (`static-outline.tsx`) in its place until then, the same DOM at the same
 * geometry. `shouldRerenderOnTransaction: false` - a transaction is not a
 * React render; what the chrome needs comes through the store.
 *
 * The caret is reported on every transaction, not only on a selection
 * change: `⌘1` retypes the block under a caret that did not move, and the
 * status bar must say `Heading 1` at once. The slice is equality-checked,
 * so a transaction that left the caret where it was notifies no one.
 *
 * The floating slash menu is drawn here, in one portal outside the zoomed
 * desk, from the view the extension publishes.
 */

export type OutlineEditorProps = {
  readonly documentId: string
  readonly nodes: readonly OutlineNode[]
  readonly store: OutlineStore
  readonly log: IdentityLog
  readonly labelFor: LabelFor
  /** Handed the editor once it exists, and `null` when it is destroyed. */
  readonly onEditor: (editor: Editor | null) => void
  readonly autoFocus: boolean
  /** Drawn until the editor exists: the server's static sheet. */
  readonly fallback: ReactNode
}

/** Hand the sheet a new label book. The mention node's storage is replaced in the same step. */
export const updateLabelBook = (editor: Editor, labelFor: LabelFor): void => {
  editor.storage[MENTION_TYPE].labelFor = labelFor
  editor.view.dispatch(labelBookTransaction(editor.state, labelFor))
}

const FloatingSurfaces = ({ editor, store }: { readonly editor: Editor; readonly store: OutlineStore }) => {
  const slash = useSlice(store.slash)
  return <FloatingLayer>{slash === null ? null : <OutlineSlashMenu view={slash} context={editor.view.dom} />}</FloatingLayer>
}

export const OutlineEditor = ({ documentId, nodes, store, log, labelFor, onEditor, autoFocus, fallback }: OutlineEditorProps) => {
  const onEditorRef = useRef(onEditor)
  onEditorRef.current = onEditor

  const extensions = useMemo(
    () =>
      outlineExtensions({
        documentId,
        mint: mintNodeId,
        log,
        store,
        labelFor,
        onIds: (ids) => {
          store.ids.set(ids)
        },
        onShape: (shape) => {
          store.shape.set(shape)
        },
      }),
    // The initial label book is a creation-time input; later ones arrive through `updateLabelBook`.
    [documentId, log, store],
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
          // `[tabindex]:focus-visible` ring fire on it. The sheet is not a
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
      {editor === null ? null : <FloatingSurfaces editor={editor} store={store} />}
    </>
  )
}
