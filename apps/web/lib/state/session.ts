'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

/**
 * Session flags. Four of them, per tab, in sessionStorage.
 *
 * AGENTS.md, Tech stack: "Client state | URL first, then React state | **Zustand
 * only for the agent window rect and session flags.**" This is the second half
 * of that sentence and the whole of what Zustand is for in this codebase. The
 * agent window rect joins it when the agent window is built; nothing else does.
 *
 * ## What is in here, and what is deliberately not
 *
 * In: `zoom`, `navOpen`, `sideOpen`, `sideTab`. All four describe the geometry
 * of one window. They must survive a route change - AGENTS.md's shell brief is
 * explicit that "Panel show/hide and theme live HERE and persist across route
 * changes" - and they must not survive the tab, because a panel someone closed
 * three days ago is not a preference they were expressing.
 *
 * sessionStorage is exactly that lifetime, and it is the reason this is a
 * separate store from `theme.tsx` rather than one convenient object with a
 * mixed persistence policy. A second tab is a second window and is free to
 * differ; the theme is not.
 *
 * Not in: `theme` (per user - localStorage), `pageMode` / `liveRepaginate`
 * (per project - a database row), `paletteOpen` / `aiScope` (ephemeral). See
 * `README.md` in this directory for the table and the reasoning.
 *
 * ## `null` is not `false`
 *
 * `navOpen` and `sideOpen` are `boolean | null`, and `null` means *automatic* -
 * the route decides, usually from viewport width. It is the initial state and
 * it is not reachable again from the UI: once someone has opened or closed a
 * panel, they have an opinion and the route stops overriding it. Collapsing
 * this to a boolean loses the difference between "nobody has said" and
 * "somebody said no", and the visible symptom is a panel that springs open
 * again on a narrow screen after being deliberately closed.
 */

/** `'fit'` scales the sheet to the column; a number is a literal factor. */
export type Zoom = 'fit' | number

/** The Script route's right panel. Two tabs, per the route bundle. */
export type SideTab = 'info' | 'collab'

/** `null` = automatic: the route decides. See the header. */
export type PanelState = boolean | null

type SessionState = {
  readonly zoom: Zoom
  readonly navOpen: PanelState
  readonly sideOpen: PanelState
  readonly sideTab: SideTab
  readonly setZoom: (zoom: Zoom) => void
  readonly setNavOpen: (open: PanelState) => void
  readonly setSideOpen: (open: PanelState) => void
  readonly setSideTab: (tab: SideTab) => void
  readonly toggleNav: () => void
  readonly toggleSide: () => void
}

/**
 * Toggling from `null` has to pick a direction.
 *
 * `null` means the route is deciding, and the only reason someone presses the
 * toggle is to disagree with what they can currently see. Both panels default
 * to visible, so the first press closes.
 */
const flip = (current: PanelState): boolean => (current === null ? false : !current)

/**
 * What `persist` gets on the server, where `sessionStorage` does not exist.
 *
 * An explicit no-op rather than `undefined`: zustand's storage getter is typed
 * as returning a storage, and a nullish return is the shape that produces a
 * runtime "cannot read property getItem of undefined" one render later. Reading
 * nothing on the server is correct - there is no tab yet, so there is nothing
 * to restore.
 */
const NO_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      zoom: 'fit',
      navOpen: null,
      sideOpen: null,
      sideTab: 'info',
      setZoom: (zoom) => {
        set({ zoom })
      },
      setNavOpen: (navOpen) => {
        set({ navOpen })
      },
      setSideOpen: (sideOpen) => {
        set({ sideOpen })
      },
      setSideTab: (sideTab) => {
        set({ sideTab })
      },
      toggleNav: () => {
        set((state) => ({ navOpen: flip(state.navOpen) }))
      },
      toggleSide: () => {
        set((state) => ({ sideOpen: flip(state.sideOpen) }))
      },
    }),
    {
      name: 'folio.session',
      /*
       * `sessionStorage`, not the default `localStorage`. The whole point of
       * this store is the per-tab lifetime; the default would quietly give the
       * flags the same lifetime as the theme and the difference would only show
       * up as a complaint months later.
       *
       * Guarded for the server: `create()` runs during SSR, where the global
       * does not exist. `NO_STORAGE` reads nothing and writes nothing for that
       * render, which is correct - there is no tab yet to restore.
       */
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? NO_STORAGE : window.sessionStorage,
      ),
      /*
       * Persist the values, never the actions. Without this, a stored blob from
       * an older build can rehydrate over the current function references and
       * replace a working callback with a stale one - or with `undefined`.
       */
      partialize: (state) => ({
        zoom: state.zoom,
        navOpen: state.navOpen,
        sideOpen: state.sideOpen,
        sideTab: state.sideTab,
      }),
    },
  ),
)
