import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration } from '@tiptap/pm/view'

/**
 * The block handles - the `+` / `⠿` pair every writing mockup draws at a
 * block's left (`docs/ui design/README.md`; ruled 2026-09-16, "Follow the
 * design"). One widget per block, drawn by both editors: the Script's
 * `sheet-decorations.ts` and the Outline's `decorations.ts` each keep a
 * handles set and build it from here, so the two routes cannot drift on
 * what a handle is.
 *
 *   `+`   asks the route for its block menu (`onHandleMenu`), anchored to
 *         the button - the route decides what the menu lists.
 *   `⠿`   node-selects the block on mousedown and lets ProseMirror's own
 *         drag-and-drop move it; the drop is a move, and a move keeps its
 *         id (each editor's `clipboard.ts` reads `view.dragging.move`).
 *
 * The widget is absolutely placed inside the block (`.folio-handles`,
 * `globals.css`), so it takes no room and moves with its block; CSS shows it
 * at the caret block and on hover. `stopEvent` keeps every event but the
 * drag's own out of ProseMirror, and `ignoreSelection` keeps the widget out
 * of the selection arithmetic.
 */

export type HandleMenuRequest = {
  readonly nodeId: string
  readonly pos: number
  readonly anchor: () => DOMRect | null
}

export type OnHandleMenu = ((request: HandleMenuRequest) => void) | null

const handlesElement = (
  view: EditorView,
  getPos: () => number | undefined,
  idOf: (block: ProseMirrorNode) => string,
  onHandleMenu: OnHandleMenu,
): HTMLElement => {
  const wrap = document.createElement('span')
  wrap.className = 'folio-handles'
  wrap.setAttribute('contenteditable', 'false')
  wrap.setAttribute('aria-hidden', 'true')

  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'folio-handle'
  add.dataset['handle'] = 'add'
  add.title = 'Insert below'
  add.textContent = '+'
  add.tabIndex = -1
  add.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  add.addEventListener('click', (event) => {
    event.preventDefault()
    const pos = getPos()
    if (pos === undefined) return
    const block = view.state.doc.nodeAt(pos)
    if (block === null) return
    onHandleMenu?.({
      nodeId: idOf(block),
      pos,
      anchor: () => add.getBoundingClientRect(),
    })
  })

  const drag = document.createElement('span')
  drag.className = 'folio-handle'
  drag.dataset['handle'] = 'drag'
  drag.title = 'Drag to reorder'
  drag.textContent = '⠿'
  drag.draggable = true
  drag.addEventListener('mousedown', () => {
    // Node-select the block so ProseMirror's own dragstart drags exactly it
    // and its drop deletes exactly it (`move`). The event itself is left to
    // reach the browser, which is what starts the drag.
    const pos = getPos()
    if (pos === undefined) return
    const selection = NodeSelection.create(view.state.doc, pos)
    view.dispatch(view.state.tr.setSelection(selection))
  })

  wrap.append(add, drag)
  return wrap
}

/** The handles widget for one block, keyed by the block's id so a rebuild reuses the element. */
export const handleDecorationFor = (
  block: ProseMirrorNode,
  pos: number,
  idOf: (block: ProseMirrorNode) => string,
  onHandleMenu: OnHandleMenu,
): Decoration =>
  Decoration.widget(pos + 1, (view, getPos) => handlesElement(view, getPos, idOf, onHandleMenu), {
    side: -1,
    key: `handles:${idOf(block)}`,
    ignoreSelection: true,
    stopEvent: (event) => event.type !== 'dragstart' && event.type !== 'dragend' && event.type !== 'drop',
  })
