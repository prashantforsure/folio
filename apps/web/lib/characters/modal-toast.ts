import { useSyncExternalStore } from 'react'

export type ModalToast = { readonly message: string; readonly action?: { readonly label: string; readonly onClick: () => void } }

/**
 * A toast raised from inside the intercepted `/characters/:id` edit modal -
 * a rename's undo offer, a merge, a `Create instead` - published here
 * instead of local state: the modal is a separate mounted tree from the
 * persisted workspace behind it (`characters-workspace.tsx`), gone the
 * instant it closes, so a message it set on its own state would never be
 * seen. `characters-workspace.tsx` reads this cell beside its own local
 * toast and shows whichever is set. Timed the same as `_chrome/use-toast.ts`
 * (`TOAST_MS`), but the timer outlives the modal that started it - it is
 * not tied to an effect's cleanup.
 */
const TOAST_MS = 8000

type Listener = () => void

let current: ModalToast | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

export const publishModalToast = (toast: ModalToast): void => {
  if (timer !== null) clearTimeout(timer)
  current = toast
  for (const listener of listeners) listener()
  timer = setTimeout(() => {
    timer = null
    current = null
    for (const listener of listeners) listener()
  }, TOAST_MS)
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): ModalToast | null => current
const readServer = (): ModalToast | null => null

export const useModalToast = (): ModalToast | null => useSyncExternalStore(subscribe, read, readServer)
