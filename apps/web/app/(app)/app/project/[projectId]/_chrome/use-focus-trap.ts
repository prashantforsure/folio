'use client'

import type { RefObject } from 'react'
import { useEffect } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * Keep Tab inside a dialog while it is open. A modal, a drawer and a menu
 * are the three places a keyboard user must not fall out of onto the page
 * behind; `Modal`, `DrawerShell` and the Production route's overlays all
 * take it. Focus is moved into the root on open when nothing inside has it
 * (the caller may focus a field first), and Tab / Shift+Tab wrap at the
 * ends. Escape stays the caller's - each dialog already closes on it.
 */
export const useFocusTrap = (root: RefObject<HTMLElement | null>, active = true): void => {
  useEffect(() => {
    if (!active) return undefined
    const element = root.current
    if (element === null) return undefined
    const focusables = (): HTMLElement[] =>
      [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement)
    if (!element.contains(document.activeElement)) {
      const first = focusables()[0]
      if (first !== undefined) first.focus()
      else {
        element.tabIndex = -1
        element.focus()
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      if (first === undefined || last === undefined) return
      const current = document.activeElement
      if (event.shiftKey && (current === first || !element.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !element.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [root, active])
}
