'use client'

import type { MentionEntity, MentionLabel, ScreenplayNodeType, SheetSpec } from '@folio/script'
import { SCREENPLAY_NODE_TYPES, countFountainNodes, isScreenplayNodeType, parseFountain, typed } from '@folio/script'
import type { NodeEntry, Path, TElement, TRange } from 'platejs'
import { PathApi } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import { Plate, PlateContent, createPlatePlugin, useRedecorate, usePlateEditor } from 'platejs/react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { IdentityLog } from '../../../../../../../lib/script/identity'
import { mintNodeId, withScriptIdentity } from '../../../../../../../lib/script/identity'
import {
  ENTER_TRANSITION,
  nextInTabCycle,
  promotesToHeading,
  typeForDigit,
} from '../../../../../../../lib/script/keyboard'
import type { SheetLayout } from '../../../../../../../lib/script/layout'
import { charsPerLineFor } from '../../../../../../../lib/script/layout'
import { lineEndsOf } from '../../../../../../../lib/script/lines'
import type { ScriptElement, ScriptValue } from '../../../../../../../lib/script/slate-model'
import { MENTION_TYPE, isScriptElement, toSlateValue } from '../../../../../../../lib/script/slate-model'
import type { LineDecoration } from './elements'
import { Leaf, MentionInline, ScriptBlock } from './elements'
import { SheetContext } from './layout-context'
import type { SheetContextValue } from './layout-context'
import { MentionCombobox } from './mention-combobox'
import type { MentionQuery } from './mention-combobox'

/**
 * Plate, configured to express exactly `@folio/script`'s union and nothing
 * more.
 *
 * ## The plugin set, and what is deliberately absent
 *
 * Eight block plugins, one per `ScreenplayNodeType`, built from the union's
 * own tuple so the list cannot be longer or shorter than the union. One
 * inline void for the `@mention`. One override plugin for normalisation and
 * the clipboard. **No other Plate plugin.** No paragraph beyond the core one
 * (which is normalised away below), no headings, no lists, no marks, no
 * page-break plugin - AGENTS.md: "Pagination is ours, not Plate's". And
 * `nodeId: false`: Plate's core NodeIdPlugin would mint `nanoid(10)` ids on
 * split and paste, which would make Plate an id authority. It is off, and
 * `withScriptIdentity` on `editor.apply` is the only minter.
 *
 * ## Where the value goes
 *
 * `onChange` hands the parent the raw Slate value. The parent turns it into
 * `ScreenplayNode[]` through `fromSlateValue` - the strict reader - when it
 * saves. This component never sees a `ScreenplayNode`; the boundary is
 * `slate-model.ts`, and it is crossed in one direction here (load) and the
 * other there (save).
 */

/** The eight block plugins, from the union's tuple. */
const BLOCK_PLUGINS = SCREENPLAY_NODE_TYPES.map((type) =>
  createPlatePlugin({
    key: type,
    node: { isElement: true, type, component: ScriptBlock },
  }),
)

const MentionPlugin = createPlatePlugin({
  key: MENTION_TYPE,
  node: { isElement: true, isInline: true, isVoid: true, type: MENTION_TYPE, component: MentionInline },
})

const FOLIO_DOCUMENT_MIME = 'application/x-folio-document'
const SLATE_FRAGMENT_MIME = 'application/x-slate-fragment'

const decodeFragment = (encoded: string): unknown => {
  try {
    return JSON.parse(decodeURIComponent(window.atob(encoded)))
  } catch {
    return null
  }
}

/** A foreign fragment: every block loses its id, so `apply` mints (cross-document paste). */
const stripIds = (fragment: unknown): TElement[] => {
  if (!Array.isArray(fragment)) return []
  return fragment.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { id: _id, ...rest } = entry as { id?: unknown; type?: unknown; children?: unknown }
    void _id
    if (typeof rest.type !== 'string' || !Array.isArray(rest.children)) return []
    return [{ ...rest, type: rest.type, children: rest.children as TElement['children'] }]
  })
}

const emptyBlock = (type: ScreenplayNodeType): ScriptElement => ({
  type,
  id: mintNodeId(),
  modifiers: [],
  provenance: typed(),
  children: [{ text: '' }],
})

/**
 * Re-run `decorate` when the layout or the labels change. A child of
 * `<Plate>`, because the hook needs the editor's store, and the decorations
 * read `layoutRef` / `labelForRef` which are updated before this renders.
 */
const Redecorate = ({ layout, labels }: { readonly layout: SheetLayout; readonly labels: readonly MentionLabel[] }) => {
  const redecorate = useRedecorate()
  useEffect(() => {
    redecorate()
  }, [layout, labels, redecorate])
  return null
}

export type CaretInfo = {
  readonly blockId: string | null
  readonly type: ScreenplayNodeType | null
}

export type ScriptEditorProps = {
  readonly documentId: string
  readonly initialValue: ScriptValue
  readonly sheet: SheetSpec
  readonly layout: SheetLayout
  readonly labels: readonly MentionLabel[]
  readonly log: IdentityLog
  readonly onValueChange: (value: readonly TElement[]) => void
  readonly onCaret: (caret: CaretInfo) => void
  readonly onCreateMention: (entity: MentionEntity, name: string) => Promise<MentionLabel | null>
  readonly editorRef: { current: PlateEditor | null }
  readonly autoFocus: boolean
}

export const ScriptEditor = ({
  documentId,
  initialValue,
  sheet,
  layout,
  labels,
  log,
  onValueChange,
  onCaret,
  onCreateMention,
  editorRef,
  autoFocus,
}: ScriptEditorProps) => {
  const labelFor = useCallback(
    (entity: MentionEntity, id: string): string | undefined =>
      labels.find((label) => label.entity === entity && label.id === id)?.label,
    [labels],
  )

  // Refs, so `decorate` and the clipboard override stay one stable function
  // each and read the latest layout and labels without re-creating the editor.
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const labelForRef = useRef(labelFor)
  labelForRef.current = labelFor
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet

  const FolioPlugin = useMemo(
    () =>
      createPlatePlugin({ key: 'folio' }).overrideEditor(
        ({ editor, tf: { normalizeNode, insertData, setFragmentData } }) => ({
          transforms: {
            /**
             * Only the eight may stand at the top level. Anything else Plate
             * or a paste produced - a core `p`, a foreign block - becomes an
             * Action. The strict reader would refuse it at save anyway; this
             * is so the writer sees a script block, not a blank.
             */
            normalizeNode(entry, options) {
              const [node, path] = entry as NodeEntry
              if (path.length === 1 && typeof node === 'object' && node !== null && 'type' in node) {
                const type = (node as { type?: unknown }).type
                const record = node as { provenance?: unknown; modifiers?: unknown; id?: unknown }
                if (typeof type !== 'string' || !isScreenplayNodeType(type)) {
                  editor.tf.setNodes(
                    { type: 'action', modifiers: [], provenance: typed(), id: mintNodeId() },
                    { at: path },
                  )
                  return
                }
                if (record.provenance === undefined || record.modifiers === undefined || typeof record.id !== 'string') {
                  editor.tf.setNodes(
                    { modifiers: record.modifiers ?? [], provenance: record.provenance ?? typed(), id: typeof record.id === 'string' ? record.id : mintNodeId() },
                    { at: path },
                  )
                  return
                }
              }
              normalizeNode(entry, options)
            },
            /** Stamp the source document so a paste can tell a move from a copy from elsewhere. */
            setFragmentData(data, originEvent) {
              setFragmentData(data, originEvent)
              data.setData(FOLIO_DOCUMENT_MIME, documentId)
            },
            /**
             * ADR 0001's paste rule in DOM terms. Same document: Slate's own
             * path, and `apply` keeps an absent id (a move) or mints a present
             * one (a copy). Another document: ids stripped, so every block is
             * minted. Plain text: parsed as Fountain - parser parity with the
             * import path - or inserted as text when it is a single line.
             */
            insertData(data) {
              const origin = data.getData(FOLIO_DOCUMENT_MIME)
              const fragment = data.getData(SLATE_FRAGMENT_MIME)
              if (fragment !== '' && origin === documentId) {
                insertData(data)
                return
              }
              if (fragment !== '') {
                const foreign = stripIds(decodeFragment(fragment))
                if (foreign.length > 0) editor.tf.insertFragment(foreign)
                return
              }
              const text = data.getData('text/plain')
              if (text === '') {
                insertData(data)
                return
              }
              if (!text.includes('\n')) {
                editor.tf.insertText(text.replace(/\r/gu, ''))
                return
              }
              const needed = countFountainNodes(text)
              const parsed = parseFountain(text, {
                freshIds: Array.from({ length: needed }, () => mintNodeId()),
              })
              if (!parsed.ok || parsed.value.nodes.length === 0) {
                editor.tf.insertText(text.replace(/\s+/gu, ' '))
                return
              }
              editor.tf.insertFragment(toSlateValue(parsed.value.nodes).map((block) => ({ ...block })))
            },
          },
        }),
      ),
    [documentId],
  )

  const editor = usePlateEditor(
    {
      id: documentId,
      plugins: [...BLOCK_PLUGINS, MentionPlugin, FolioPlugin],
      value: initialValue.map((block) => ({ ...block })),
      nodeId: false,
      autoSelect: autoFocus ? 'start' : false,
    },
    [documentId, FolioPlugin],
  )

  useMemo(() => withScriptIdentity(editor, mintNodeId, log), [editor, log])
  editorRef.current = editor

  // ---------------------------------------------------------------------------
  // Line ends and page gaps, as decorations
  // ---------------------------------------------------------------------------

  const decorate = useCallback(
    ({ entry }: { readonly editor: PlateEditor; readonly entry: NodeEntry }): TRange[] => {
      const [node, path] = entry
      if (path.length !== 1 || !isScriptElement(node)) return []
      const measure = charsPerLineFor(sheetRef.current, node.type)
      const ends = lineEndsOf(node.children, labelForRef.current, measure)
      const placed = layoutRef.current.blocks.get(node.id)
      const gapAfterLine = placed?.gap === null || placed?.gap === undefined ? -1 : placed.gap.afterLine
      const ranges: TRange[] = []
      const lastEnd = new Map<number, number>()
      ends.forEach((end, index) => {
        const from = lastEnd.get(end.child) ?? 0
        lastEnd.set(end.child, end.offset)
        const decoration: LineDecoration & TRange = {
          anchor: { path: [...path, end.child], offset: from },
          focus: { path: [...path, end.child], offset: end.offset },
          lineEnd: true,
        }
        if (index + 1 === gapAfterLine && placed?.gap !== null && placed?.gap !== undefined) {
          const cueInset = sheetRef.current.element.character.leftPx
          const dialogueInset = sheetRef.current.element.dialogue.leftPx
          const blockInset =
            node.type === 'dialogue' || node.type === 'paren' || node.type === 'subtitle'
              ? sheetRef.current.element[node.type].leftPx
              : sheetRef.current.element.action.leftPx
          const withGap: LineDecoration & TRange = {
            ...decoration,
            pageGap: {
              heightPx: placed.gap.heightPx,
              more: placed.gap.more,
              continued: placed.gap.continued,
              cueOffsetPx: cueInset - blockInset,
              moreOffsetPx: dialogueInset - blockInset,
            },
          }
          ranges.push(withGap)
          return
        }
        ranges.push(decoration)
      })
      return ranges
    },
    [],
  )


  // ---------------------------------------------------------------------------
  // The caret, and the keyboard
  // ---------------------------------------------------------------------------

  const currentBlock = useCallback((): NodeEntry<ScriptElement> | null => {
    const entry = editor.api.above<TElement>({ match: (n) => isScriptElement(n) })
    if (entry === undefined) return null
    const [node, path] = entry
    return isScriptElement(node) ? [node, path] : null
  }, [editor])

  const setType = useCallback(
    (path: Path, type: ScreenplayNodeType) => {
      editor.tf.setNodes({ type, ...(type === 'character' ? {} : { modifiers: [] }) }, { at: path })
      editor.tf.focus()
    },
    [editor],
  )

  const [mention, setMention] = useState<MentionQuery | null>(null)

  const reportCaret = useCallback(() => {
    const block = currentBlock()
    onCaret({ blockId: block?.[0].id ?? null, type: block?.[0].type ?? null })
  }, [currentBlock, onCaret])

  const readMentionQuery = useCallback((): MentionQuery | null => {
    if (mention === null || editor.selection === null) return null
    const { anchor } = editor.selection
    if (!PathApi.equals(anchor.path, mention.textPath) || anchor.offset < mention.start) return null
    const leaf = editor.api.node(mention.textPath)
    if (leaf === undefined) return null
    const text = editor.api.string(mention.textPath)
    if (text[mention.start - 1] !== '@') return null
    const query = text.slice(mention.start, anchor.offset)
    if (/\s{2,}/u.test(query)) return null
    return { ...mention, query }
  }, [editor, mention])

  const commitMention = useCallback(
    (label: MentionLabel) => {
      if (mention === null) return
      const live = readMentionQuery()
      if (live === null) {
        setMention(null)
        return
      }
      const at: TRange = {
        anchor: { path: live.textPath, offset: live.start - 1 },
        focus: { path: live.textPath, offset: live.start + live.query.length },
      }
      editor.tf.delete({ at })
      editor.tf.insertNodes(
        { type: MENTION_TYPE, entity: label.entity, id: label.id, children: [{ text: '' }] },
        { at: at.anchor, select: true },
      )
      editor.tf.move({ unit: 'offset' })
      editor.tf.focus()
      setMention(null)
    },
    [editor, mention, readMentionQuery],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const liveMention = readMentionQuery()
      if (liveMention !== null && (event.key === 'Escape')) {
        event.preventDefault()
        setMention(null)
        return
      }
      if (liveMention !== null && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) {
        // The combobox owns these while it is open; it listens on the same window.
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('folio:mention-key', { detail: event.key }))
        return
      }

      const block = currentBlock()
      if (block === null) return
      const [element, path] = block
      const modifier = event.metaKey || event.ctrlKey

      if (modifier && /^[1-8]$/u.test(event.key)) {
        const type = typeForDigit(event.key)
        if (type !== null) {
          event.preventDefault()
          setType(path, type)
        }
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        setType(path, nextInTabCycle(element.type, event.shiftKey))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) return
        if (editor.selection === null) return
        if (editor.api.isExpanded()) editor.tf.delete()
        const text = editor.api.string(path)
        if (text === '' && element.type === 'character') {
          // Nothing to say: the empty cue becomes action rather than a blank cue.
          setType(path, 'action')
          return
        }
        const selection = editor.selection
        if (selection === null) return
        const atEnd = editor.api.isEnd(selection.focus, path)
        if (atEnd) {
          const next = ENTER_TRANSITION[element.type]
          editor.tf.insertNodes(emptyBlock(next), { at: PathApi.next(path), select: true })
          return
        }
        // Mid-block: split. The head keeps its id; `apply` mints the tail's.
        editor.tf.splitNodes({ always: true })
        return
      }

      if (event.key === '.' && element.type === 'action' && editor.selection !== null) {
        const start = editor.api.start(path)
        const before = start === undefined ? '' : editor.api.string({ anchor: start, focus: editor.selection.focus })
        if (start !== undefined && promotesToHeading(`${before}.`)) {
          event.preventDefault()
          editor.tf.insertText('.')
          setType(path, 'scene')
          return
        }
      }

      if (event.key === '@' && !modifier && editor.selection !== null && element.type !== 'comment') {
        const { anchor } = editor.selection
        const leaf = editor.api.node(anchor.path)
        if (leaf !== undefined) {
          // The `@` is inserted by the browser; the query starts after it.
          setMention({ blockPath: path, textPath: anchor.path, start: anchor.offset + 1, query: '' })
        }
      }
    },
    [currentBlock, editor, readMentionQuery, setType],
  )

  const context = useMemo<SheetContextValue>(
    () => ({ layout, sheet, labelFor, caretBlockId: null }),
    [layout, sheet, labelFor],
  )

  const liveMention = readMentionQuery()

  return (
    <SheetContext.Provider value={context}>
      <Plate
        editor={editor}
        decorate={decorate}
        renderLeaf={Leaf}
        onValueChange={({ value }) => {
          onValueChange(value)
          if (mention !== null && readMentionQuery() === null) setMention(null)
        }}
        onSelectionChange={() => {
          reportCaret()
        }}
      >
        <Redecorate layout={layout} labels={labels} />
        <PlateContent
          className="folio-editable"
          spellCheck={false}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setMention(null)
          }}
        />
        {liveMention === null ? null : (
          <MentionCombobox
            editor={editor}
            query={liveMention}
            labels={labels}
            onPick={commitMention}
            onCreate={async (entity, name) => {
              const created = await onCreateMention(entity, name)
              if (created !== null) commitMention(created)
            }}
            onClose={() => {
              setMention(null)
            }}
          />
        )}
      </Plate>
    </SheetContext.Provider>
  )
}
