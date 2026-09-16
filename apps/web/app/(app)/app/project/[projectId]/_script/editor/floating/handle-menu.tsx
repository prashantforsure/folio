'use client'

import type { ScreenplayNodeType } from '@folio/script'
import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

import { SLASH_ENTRIES } from '../../../../../../../../lib/script/slash'
import type { HandleMenuView } from '../editor-store'
import { freshBlock, insertBlockAfter } from '../extensions/commands'
import { Floating } from './floating-layer'

/**
 * The `+` handle's menu: the eight block types, each inserted *below* the
 * block the handle belongs to, and `Comment`, which opens a new thread
 * under it. `docs/ui design/Route - Script v2.dc.html` draws the handle
 * ("Insert below") and the slash menu's list; this is the two put together.
 *
 * Same chrome as the slash menu (`--sunk`, 14px radius, the deep shadow).
 * Arrow keys move, Enter picks, Escape closes; the editable keeps focus
 * throughout, which is why the menu takes no focus itself and every key is
 * read from the window while it is open.
 */
type Row = { readonly kind: 'block'; readonly type: ScreenplayNodeType; readonly label: string; readonly glyph: string } | { readonly kind: 'comment' }

const ROWS: readonly Row[] = [
  ...SLASH_ENTRIES.map((entry): Row => ({ kind: 'block', type: entry.type, label: entry.label, glyph: entry.glyph })),
  { kind: 'comment' },
]

export const HandleMenu = ({
  view,
  editor,
  context,
  onComment,
  onClose,
}: {
  readonly view: HandleMenuView
  readonly editor: Editor
  readonly context: Element | null
  readonly onComment: (nodeId: string) => void
  readonly onClose: () => void
}) => {
  const [active, setActive] = useState(0)

  const pick = (row: Row): void => {
    onClose()
    if (row.kind === 'comment') {
      onComment(view.nodeId)
      return
    }
    const block = freshBlock(editor.state.schema, row.type)
    if (block === null) return
    const tr = editor.state.tr
    if (insertBlockAfter(tr, view.pos, block)) editor.view.dispatch(tr.scrollIntoView())
    editor.view.focus()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((index) => (index + 1) % ROWS.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) => (index - 1 + ROWS.length) % ROWS.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const row = ROWS[active]
        if (row !== undefined) pick(row)
      }
    }
    const onDown = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-handle-menu]') === null) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
    // `pick` closes over the view and editor of this render; both are stable while the menu is open.
  }, [active, onClose])

  return (
    <Floating anchor={view.anchor} context={context} role="listbox" aria-label="Insert below" data-handle-menu="" className="folio-slash">
      <div className="folio-slash-title">Insert below</div>
      <div className="folio-slash-list">
        {ROWS.map((row, index) => (
          <button
            key={row.kind === 'block' ? row.type : 'comment'}
            type="button"
            role="option"
            aria-selected={index === active}
            data-handle-choice={row.kind === 'block' ? row.type : 'comment'}
            className="folio-slash-row"
            onMouseEnter={() => {
              setActive(index)
            }}
            onClick={() => {
              pick(row)
            }}
          >
            <span className="folio-slash-glyph">{row.kind === 'block' ? row.glyph : '❝'}</span>
            <span className="folio-slash-label">{row.kind === 'block' ? row.label : 'Comment'}</span>
            {index === active ? <span className="folio-slash-enter">↵</span> : null}
          </button>
        ))}
      </div>
    </Floating>
  )
}
