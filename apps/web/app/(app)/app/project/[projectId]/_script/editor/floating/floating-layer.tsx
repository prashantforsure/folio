'use client'

import type { VirtualElement } from '@floating-ui/dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import type { Anchor } from '../editor-store'

/**
 * Where every floating surface is drawn, and how it is placed.
 *
 * One portal, on `document.body`, *outside* the desk. The desk is zoomed
 * with CSS `zoom`, and a menu rendered inside it would be scaled twice:
 * once by the zoom, once by the viewport rectangle it was placed from,
 * which is already in zoomed pixels. Out here `position: fixed` and the
 * rectangle agree.
 *
 * `Floating` takes an `Anchor` - a function returning the viewport rect
 * of the query, the segment or the caret, as the Suggestion plugin and
 * `posToDOMRect` supply it - wraps it as a floating-ui virtual element,
 * and lets `computePosition` put the box below it, flipping above when the
 * bottom of the viewport is near and shifting in from the sides. `autoUpdate`
 * re-places it on scroll and resize, watching the editable's ancestors
 * through `contextElement`.
 *
 * Nothing here listens to the keyboard. The editable keeps focus; the keys
 * that move through a menu are handled inside ProseMirror.
 */

const NOWHERE = (): DOMRect => new DOMRect(-9999, -9999, 0, 0)

export const FloatingLayer = ({ children }: { readonly children: ReactNode }) =>
  createPortal(<div className="folio-floating-layer">{children}</div>, document.body)

export const Floating = ({
  anchor,
  context,
  children,
  ...rest
}: {
  readonly anchor: Anchor
  /** The editable, so scrolling any of its ancestors re-places the box. */
  readonly context: Element | null
  readonly children: ReactNode
  readonly className?: string
  readonly role?: string
  readonly 'aria-label'?: string
  readonly 'data-slash-menu'?: string
  readonly 'data-picker'?: string
  readonly 'data-mode'?: string
  readonly 'data-mention-menu'?: string
}) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const floating = ref.current
    if (floating === null) return undefined
    const reference: VirtualElement =
      context === null
        ? { getBoundingClientRect: () => anchor() ?? NOWHERE() }
        : { getBoundingClientRect: () => anchor() ?? NOWHERE(), contextElement: context }
    return autoUpdate(reference, floating, () => {
      void computePosition(reference, floating, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        floating.style.left = `${String(x)}px`
        floating.style.top = `${String(y)}px`
      })
    })
  }, [anchor, context])
  return (
    <div
      ref={ref}
      {...rest}
      style={{ position: 'fixed', left: 0, top: 0 }}
      onMouseDown={(event) => {
        // The editable keeps focus and its selection.
        event.preventDefault()
      }}
    >
      {children}
    </div>
  )
}
