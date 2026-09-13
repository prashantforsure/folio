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
import type { EditorStore } from './editor-store'
import { useSlice } from './editor-store'
import type { SheetInputs } from './extensions'
import { caretBlock, screenplayExtensions, sheetInputsTransaction } from './extensions'
import { BlockPicker } from './floating/block-picker'
import { FloatingLayer } from './floating/floating-layer'
import { MentionCombobox } from './floating/mention-combobox'
import { SlashMenu } from './floating/slash-menu'

/**
 * The editor, mounted. Tiptap owns the document; React owns nothing of it.
 *
 * `immediatelyRender: false` - the editor is created after hydration, so
 * the server renders none of it and the workspace draws the static sheet
 * (`sheet/static-sheet.tsx`) in its place until then, the same DOM at the
 * same geometry. `shouldRerenderOnTransaction: false` - a transaction is
 * not a React render; what the chrome needs comes through the store.
 *
 * Everything that changes after creation - the label book, the measurement
 * record, the page mode, the sheet - reaches the extensions as data, never
 * by re-creating them: `updateSheet` dispatches a meta transaction the
 * decorations plugin reads, and the mention node's storage is replaced in
 * the same call so a new label is drawn by the same transaction.
 *
 * The floating surfaces are drawn here, in one portal outside the zoomed
 * desk, from the views the extensions publish.
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
  /** Handed the editor once it exists, and `null` when it is destroyed. */
  readonly onEditor: (editor: Editor | null) => void
  readonly autoFocus: boolean
  /** Drawn until the editor exists: the server's static sheet. */
  readonly fallback: ReactNode
}

/** Hand the sheet new inputs. The mention node's label book is replaced in the same step. */
export const updateSheet = (editor: Editor, inputs: Partial<SheetInputs>): void => {
  if (inputs.labelFor !== undefined) editor.storage[MENTION_TYPE].labelFor = inputs.labelFor
  editor.view.dispatch(sheetInputsTransaction(editor.state, inputs))
}

const FloatingSurfaces = ({ editor, store }: { readonly editor: Editor; readonly store: EditorStore }) => {
  const slash = useSlice(store.slash)
  const mention = useSlice(store.mention)
  const picker = useSlice(store.picker)
  const context = editor.view.dom
  return (
    <FloatingLayer>
      {slash === null ? null : <SlashMenu view={slash} context={context} />}
      {mention === null || slash !== null ? null : <MentionCombobox view={mention} context={context} />}
      {picker === null || slash !== null || mention !== null ? null : <BlockPicker view={picker} context={context} />}
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
  onEditor,
  autoFocus,
  fallback,
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
        onLayout: (layout) => {
          store.layout.set({ frames: layout.frames, heightPx: layout.heightPx, paged: layout.paged })
        },
        onIds: (ids) => {
          store.ids.set(ids)
        },
      }),
    // The initial sheet and label book are creation-time inputs; later ones arrive through `updateSheet`.
    [documentId, log, store],
  )

  const content = useMemo(() => toDoc(nodes), [nodes])

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions,
      content,
      autofocus: autoFocus ? 'start' : false,
      editorProps: { attributes: { class: 'folio-editable', spellcheck: 'false' } },
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
      <EditorContent editor={editor} className="folio-editor-host" data-editor-ready={editor === null ? 'false' : 'true'} />
      {editor === null ? null : <FloatingSurfaces editor={editor} store={store} />}
    </>
  )
}
