'use client'

import type { MentionEntity, MentionLabel, OutlineNodeType } from '@folio/script'
import { BEAT_HEADLINE_SEPARATOR, OUTLINE_NODE_TYPES, isOutlineNodeType, typed } from '@folio/script'
import type { NodeEntry, Path, TElement, TRange } from 'platejs'
import { PathApi } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import { Plate, PlateContent, createPlatePlugin, usePlateEditor } from 'platejs/react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  BLOCK_LABEL,
  BLOCK_TOOL,
  ENTER_TRANSITION,
  filterSlashMenu,
  typeForDigit,
  typeForShiftLetter,
} from '../../../../../../../lib/outline/keyboard'
import type { OutlineElement, OutlineValue } from '../../../../../../../lib/outline/slate-model'
import { isOutlineElement } from '../../../../../../../lib/outline/slate-model'
import type { IdentityLog } from '../../../../../../../lib/script/identity'
import { mintNodeId, withScriptIdentity } from '../../../../../../../lib/script/identity'
import { MENTION_TYPE } from '../../../../../../../lib/script/slate-model'
import type { OutlineContextValue, OutlineDecoration } from './outline-elements'
import { OutlineBlock, OutlineContext, OutlineLeaf, OutlineMention } from './outline-elements'

/**
 * Plate, configured to express exactly `@folio/script`'s outline union and
 * nothing more. The twin of `_script/editor/plate-editor.tsx` over the
 * other closed set.
 *
 * Seven block plugins, one per `OutlineNodeType`, built from the union's own
 * tuple; `rule` is a void. One inline void for the `@mention` (drawn, never
 * offered - the combobox is the Script route's and is not built here;
 * flagged). One override plugin for normalisation and the clipboard. **No
 * other Plate plugin**: no headings plugin, no list plugin, no marks - the
 * bundle's Bold / Italic have no inline run to land in and are not built.
 * `nodeId: false`, and `withScriptIdentity` on `apply` is the only minter,
 * replaying ADR 0001 at the one door every transform goes through.
 *
 * ## The keyboard
 *
 * `lib/outline/keyboard.ts` is the model. `⌘0`-`⌘3` set body and the three
 * headings, `⌘⇧Q` / `⌘⇧R` / `⌘⇧B` quote, rule and beat. Enter at the end
 * of a block creates the block `ENTER_TRANSITION` names - a beat continues
 * the list, a heading is followed by body - and Enter on an *empty* beat
 * ends the list. `⌥↑` / `⌥↓` move the caret block. `/` on an empty block
 * opens the slash menu over the closed set; typing narrows it, Enter picks,
 * Escape closes.
 *
 * ## Where the value goes
 *
 * `onChange` hands the parent the raw Slate value. The parent turns it into
 * `OutlineNode[]` through `fromSlateValue` - the strict reader - when it
 * saves. This component never sees an `OutlineNode`.
 */

const BLOCK_PLUGINS = OUTLINE_NODE_TYPES.map((type) =>
  createPlatePlugin({
    key: type,
    node: { isElement: true, type, component: OutlineBlock, ...(type === 'rule' ? { isVoid: true } : {}) },
  }),
)

const MentionPlugin = createPlatePlugin({
  key: MENTION_TYPE,
  node: { isElement: true, isInline: true, isVoid: true, type: MENTION_TYPE, component: OutlineMention },
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

const emptyBlock = (type: OutlineNodeType): OutlineElement => ({
  type,
  id: mintNodeId(),
  provenance: typed(),
  children: [{ text: '' }],
})

export type OutlineCaret = {
  readonly blockId: string | null
  readonly type: OutlineNodeType | null
}

type SlashQuery = {
  readonly blockPath: Path
  readonly textPath: Path
  /** Offset in the text node after the `/`. */
  readonly start: number
  readonly query: string
}

/** What the chrome can ask the editor to do. Filled by the editor, read by the toolbar's owner. */
export type OutlineCommands = {
  readonly setCaretType: (type: OutlineNodeType) => void
}

export type OutlineEditorProps = {
  readonly documentId: string
  readonly initialValue: OutlineValue
  readonly labels: readonly MentionLabel[]
  readonly log: IdentityLog
  readonly beatOrdinal: ReadonlyMap<string, number>
  readonly lastBlockId: string | null
  readonly onValueChange: (value: readonly TElement[]) => void
  readonly onCaret: (caret: OutlineCaret) => void
  readonly editorRef: { current: PlateEditor | null }
  readonly commandRef: { current: OutlineCommands | null }
  readonly autoFocus: boolean
}

export const OutlineEditor = ({
  documentId,
  initialValue,
  labels,
  log,
  beatOrdinal,
  lastBlockId,
  onValueChange,
  onCaret,
  editorRef,
  commandRef,
  autoFocus,
}: OutlineEditorProps) => {
  const labelFor = useCallback(
    (entity: MentionEntity, id: string): string | undefined =>
      labels.find((label) => label.entity === entity && label.id === id)?.label,
    [labels],
  )

  const FolioPlugin = useMemo(
    () =>
      createPlatePlugin({ key: 'folio-outline' }).overrideEditor(
        ({ editor, tf: { normalizeNode, insertData, setFragmentData } }) => ({
          transforms: {
            /** Only the seven may stand at the top level. Anything else becomes body. */
            normalizeNode(entry, options) {
              const [node, path] = entry as NodeEntry
              if (path.length === 1 && typeof node === 'object' && node !== null && 'type' in node) {
                const type = (node as { type?: unknown }).type
                const record = node as { provenance?: unknown; id?: unknown }
                if (typeof type !== 'string' || !isOutlineNodeType(type)) {
                  editor.tf.setNodes({ type: 'body', provenance: typed(), id: mintNodeId() }, { at: path })
                  return
                }
                if (record.provenance === undefined || typeof record.id !== 'string') {
                  editor.tf.setNodes(
                    { provenance: record.provenance ?? typed(), id: typeof record.id === 'string' ? record.id : mintNodeId() },
                    { at: path },
                  )
                  return
                }
              }
              normalizeNode(entry, options)
            },
            setFragmentData(data, originEvent) {
              setFragmentData(data, originEvent)
              data.setData(FOLIO_DOCUMENT_MIME, documentId)
            },
            /**
             * ADR 0001's paste rule in DOM terms, as the script's. Plain text
             * with line breaks becomes one body block per non-empty line.
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
              const lines = text
                .replace(/\r/gu, '')
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== '')
              if (lines.length <= 1) {
                editor.tf.insertText(lines[0] ?? '')
                return
              }
              editor.tf.insertFragment(lines.map((line) => ({ ...emptyBlock('body'), children: [{ text: line }] })))
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
      autoSelect: autoFocus ? 'end' : false,
    },
    [documentId, FolioPlugin],
  )

  useMemo(() => withScriptIdentity(editor, mintNodeId, log), [editor, log])
  editorRef.current = editor

  // ---------------------------------------------------------------------------
  // The beat lead, as a decoration
  // ---------------------------------------------------------------------------

  const decorate = useCallback(({ entry }: { readonly editor: PlateEditor; readonly entry: NodeEntry }): TRange[] => {
    const [node, path] = entry
    if (path.length !== 1 || !isOutlineElement(node) || node.type !== 'beat') return []
    // The lead runs to the first colon across the block's text children.
    for (let child = 0; child < node.children.length; child += 1) {
      const value = node.children[child]
      if (value === undefined || !('text' in value)) continue
      const at = value.text.indexOf(BEAT_HEADLINE_SEPARATOR)
      if (at === -1) continue
      const ranges: TRange[] = []
      // Earlier text children are wholly lead.
      for (let earlier = 0; earlier < child; earlier += 1) {
        const previous = node.children[earlier]
        if (previous === undefined || !('text' in previous) || previous.text === '') continue
        const decoration: OutlineDecoration & TRange = {
          anchor: { path: [...path, earlier], offset: 0 },
          focus: { path: [...path, earlier], offset: previous.text.length },
          beatLead: true,
        }
        ranges.push(decoration)
      }
      const decoration: OutlineDecoration & TRange = {
        anchor: { path: [...path, child], offset: 0 },
        focus: { path: [...path, child], offset: at + 1 },
        beatLead: true,
      }
      ranges.push(decoration)
      return ranges
    }
    return []
  }, [])

  // ---------------------------------------------------------------------------
  // The caret, the slash menu and the keyboard
  // ---------------------------------------------------------------------------

  const currentBlock = useCallback((): NodeEntry<OutlineElement> | null => {
    const entry = editor.api.above<TElement>({ match: (n) => isOutlineElement(n) })
    if (entry === undefined) return null
    const [node, path] = entry
    return isOutlineElement(node) ? [node, path] : null
  }, [editor])

  const setType = useCallback(
    (path: Path, type: OutlineNodeType) => {
      const entry = editor.api.node(path)
      const element = entry?.[0]
      if (type === 'rule') {
        // A rule carries no text: whatever was on the block is dropped and the
        // caret lands on the rule, ready for Enter. The block keeps its id.
        const kept = isOutlineElement(element) ? element.id : mintNodeId()
        editor.tf.withoutNormalizing(() => {
          editor.tf.removeNodes({ at: path })
          editor.tf.insertNodes({ ...emptyBlock('rule'), id: kept }, { at: path, select: true })
        })
        editor.tf.focus()
        return
      }
      if (isOutlineElement(element) && element.type === 'rule') {
        editor.tf.withoutNormalizing(() => {
          editor.tf.removeNodes({ at: path })
          editor.tf.insertNodes({ ...emptyBlock(type), id: element.id }, { at: path, select: true })
        })
        editor.tf.focus()
        return
      }
      editor.tf.setNodes({ type }, { at: path })
      editor.tf.focus()
    },
    [editor],
  )

  commandRef.current = {
    setCaretType: (type) => {
      const block = currentBlock()
      if (block !== null) setType(block[1], type)
    },
  }

  const [slash, setSlash] = useState<SlashQuery | null>(null)

  const readSlashQuery = useCallback((): SlashQuery | null => {
    if (slash === null || editor.selection === null) return null
    const { anchor } = editor.selection
    if (!PathApi.equals(anchor.path, slash.textPath) || anchor.offset < slash.start) return null
    const text = editor.api.string(slash.textPath)
    if (text[slash.start - 1] !== '/') return null
    const query = text.slice(slash.start, anchor.offset)
    if (query.includes(' ')) return null
    return { ...slash, query }
  }, [editor, slash])

  const liveSlash = readSlashQuery()
  const slashChoices = useMemo(() => (liveSlash === null ? [] : filterSlashMenu(liveSlash.query)), [liveSlash])
  const [slashActive, setSlashActive] = useState(0)
  useEffect(() => {
    setSlashActive(0)
  }, [liveSlash?.query])

  const commitSlash = useCallback(
    (type: OutlineNodeType) => {
      const live = readSlashQuery()
      if (live === null) {
        setSlash(null)
        return
      }
      editor.tf.delete({
        at: {
          anchor: { path: live.textPath, offset: live.start - 1 },
          focus: { path: live.textPath, offset: live.start + live.query.length },
        },
      })
      setType(live.blockPath, type)
      setSlash(null)
    },
    [editor, readSlashQuery, setType],
  )

  const reportCaret = useCallback(() => {
    const block = currentBlock()
    onCaret({ blockId: block?.[0].id ?? null, type: block?.[0].type ?? null })
  }, [currentBlock, onCaret])

  // The selection is set by `autoSelect` before any `onSelectionChange`, and
  // a click on the block it already sits in changes nothing - so the caret is
  // reported once on mount, and again after every change to the value (a
  // block retyped under the caret is a change to what the caret is in).
  useEffect(() => {
    reportCaret()
  }, [reportCaret])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const live = readSlashQuery()
      if (live !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setSlash(null)
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const count = slashChoices.length
          if (count === 0) return
          setSlashActive((at) => (event.key === 'ArrowDown' ? (at + 1) % count : (at - 1 + count) % count))
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          const choice = slashChoices[slashActive]
          if (choice !== undefined) commitSlash(choice.type)
          else setSlash(null)
          return
        }
      }

      const block = currentBlock()
      if (block === null) return
      const [element, path] = block
      const modifier = event.metaKey || event.ctrlKey

      if (modifier && !event.shiftKey && !event.altKey && /^[0-3]$/u.test(event.key)) {
        const type = typeForDigit(event.key)
        if (type !== null) {
          event.preventDefault()
          setType(path, type)
        }
        return
      }
      if (modifier && event.shiftKey && !event.altKey) {
        const type = typeForShiftLetter(event.key)
        if (type !== null) {
          event.preventDefault()
          setType(path, type)
          return
        }
      }

      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const index = path[0] ?? 0
        const to = event.key === 'ArrowUp' ? index - 1 : index + 1
        if (to < 0 || to >= editor.children.length) return
        editor.tf.moveNodes({ at: path, to: [to] })
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) return
        if (editor.selection === null) return
        if (editor.api.isExpanded()) editor.tf.delete()
        const text = editor.api.string(path)
        if (element.type === 'rule') {
          editor.tf.insertNodes(emptyBlock('body'), { at: PathApi.next(path), select: true })
          return
        }
        if (text === '' && element.type === 'beat') {
          // An empty beat ends the list.
          setType(path, 'body')
          return
        }
        const selection = editor.selection
        if (selection === null) return
        if (editor.api.isEnd(selection.focus, path)) {
          editor.tf.insertNodes(emptyBlock(ENTER_TRANSITION[element.type]), { at: PathApi.next(path), select: true })
          return
        }
        if (editor.api.isStart(selection.focus, path)) {
          editor.tf.insertNodes(emptyBlock(element.type), { at: path })
          return
        }
        // Mid-block: split. The head keeps its id; `apply` mints the tail's.
        editor.tf.splitNodes({ always: true })
        return
      }

      if (event.key === 'Backspace' && editor.selection !== null && element.type !== 'body' && element.type !== 'rule') {
        // At the start of a heading, quote or beat, Backspace demotes to body
        // before it would merge into the block above.
        if (editor.api.isCollapsed() && editor.api.isStart(editor.selection.focus, path)) {
          event.preventDefault()
          setType(path, 'body')
          return
        }
      }

      if (event.key === '/' && !modifier && editor.selection !== null && element.type !== 'rule') {
        const { anchor } = editor.selection
        if (editor.api.string(path) === '') {
          // The `/` is inserted by the browser; the query starts after it.
          setSlash({ blockPath: path, textPath: anchor.path, start: anchor.offset + 1, query: '' })
        }
      }
    },
    [commitSlash, currentBlock, editor, readSlashQuery, setType, slashActive, slashChoices],
  )

  const context = useMemo<OutlineContextValue>(
    () => ({ labelFor, beatOrdinal, caretBlockId: null, lastBlockId }),
    [beatOrdinal, labelFor, lastBlockId],
  )

  // The slash menu sits under the caret block. Read from the live DOM.
  const [slashPosition, setSlashPosition] = useState<{ readonly left: number; readonly top: number } | null>(null)
  useEffect(() => {
    if (liveSlash === null) {
      setSlashPosition(null)
      return
    }
    try {
      const domRange = editor.api.toDOMRange({
        anchor: { path: liveSlash.textPath, offset: liveSlash.start },
        focus: { path: liveSlash.textPath, offset: liveSlash.start },
      })
      const container = editor.api.toDOMNode(editor)?.getBoundingClientRect()
      const rect = domRange?.getBoundingClientRect()
      if (rect !== undefined && container !== undefined) {
        setSlashPosition({ left: rect.left - container.left, top: rect.bottom - container.top + 4 })
      }
    } catch {
      setSlashPosition(null)
    }
  }, [editor, liveSlash?.textPath, liveSlash?.start, liveSlash === null])

  return (
    <OutlineContext.Provider value={context}>
      <Plate
        editor={editor}
        decorate={decorate}
        renderLeaf={OutlineLeaf}
        onValueChange={({ value }) => {
          onValueChange(value)
          reportCaret()
          if (slash !== null && readSlashQuery() === null) setSlash(null)
        }}
        onSelectionChange={() => {
          reportCaret()
        }}
      >
        <div className="relative">
          <PlateContent
            className="folio-outline-editable"
            spellCheck={false}
            autoFocus={autoFocus}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setSlash(null)
            }}
          />
          {liveSlash === null || slashPosition === null ? null : (
            <div
              role="listbox"
              aria-label="Insert a block"
              data-slash-menu
              className="folio-slash-menu"
              style={{ left: slashPosition.left, top: slashPosition.top }}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
            >
              {slashChoices.length === 0 ? (
                <div className="px-[8px] py-[5px] text-10-5 text-ink3">No block matches. Esc to close.</div>
              ) : null}
              {slashChoices.map((choice, index) => (
                <button
                  key={choice.type}
                  type="button"
                  role="option"
                  aria-selected={index === slashActive}
                  data-slash-choice={choice.type}
                  onMouseEnter={() => {
                    setSlashActive(index)
                  }}
                  onClick={() => {
                    commitSlash(choice.type)
                  }}
                >
                  <span className="w-[22px] text-center text-11 font-semibold text-ink2">{BLOCK_TOOL[choice.type].glyph}</span>
                  <span className="min-w-0 flex-1">{BLOCK_LABEL[choice.type]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Plate>
    </OutlineContext.Provider>
  )
}
