import { describe, expect, it } from 'vitest'

import { ACCOUNT_SETTINGS, SIDEBAR, TRASH } from '../app/(app)/_shell/nav'
import { AI_SCOPES } from '../lib/state/ephemeral'
import { DEFAULT_PROJECT_PAGINATION, PAGE_MODES } from '../lib/state/project-preferences'
import { useSession } from '../lib/state/session'

/**
 * The shell's shape and the state layer's boundaries.
 *
 * Both are things a later phase will be tempted to loosen for a good local
 * reason - one more sidebar item, one more field on the store - so both are
 * asserted rather than trusted to a comment.
 */

describe('the sidebar', () => {
  it('is exactly four items, in this order', () => {
    expect(SIDEBAR.map((item) => item.label)).toEqual([
      'New',
      'Recents',
      'Screenwriting',
      'Filmmaking',
    ])
  })

  it('points each one at its route under the /app prefix', () => {
    // AGENTS.md, Routing: "Everything under `/app/`. One prefix for the
    // signed-in product."
    expect(SIDEBAR.map((item) => item.href)).toEqual([
      '/app/new',
      '/app/recents',
      '/app/screenwriting',
      '/app/filmmaking',
    ])
  })

  it('does not carry Trash or Account settings', () => {
    // Trash is reached from the project list; account settings from the avatar
    // menu. Neither is a sidebar item.
    const labels = SIDEBAR.map((item) => item.label.toLowerCase())
    expect(labels).not.toContain('trash')
    expect(labels).not.toContain('settings')
    expect(labels).not.toContain('account settings')
    expect(SIDEBAR.map((item) => item.href)).not.toContain(ACCOUNT_SETTINGS)
  })

  it('does not carry anything AGENTS.md cut', () => {
    // "Cut, do not build: Community, writing leaderboard, activity heatmap,
    // sidebar credits card." Credits belong in the Production header.
    const labels = SIDEBAR.map((item) => item.label.toLowerCase())
    for (const cut of ['community', 'leaderboard', 'heatmap', 'credits']) {
      expect(labels).not.toContain(cut)
    }
  })

  it('keeps Trash off the sidebar even now that it exists', () => {
    // The route landed with the shell routes; the sidebar stayed four items.
    // Trash is reached from the project list header.
    expect(SIDEBAR.map((item) => item.href)).not.toContain(TRASH)
    expect(TRASH).toBe('/app/trash')
  })
})

describe('session state', () => {
  it('starts panels at null, which means automatic rather than closed', () => {
    const state = useSession.getState()
    expect(state.navOpen).toBeNull()
    expect(state.sideOpen).toBeNull()
    expect(state.zoom).toBe('fit')
    expect(state.sideTab).toBe('info')
  })

  it('closes on the first toggle from automatic', () => {
    // Both panels default to visible, so the only reason to press the toggle
    // while it is still automatic is to close what you can see.
    useSession.setState({ navOpen: null })
    useSession.getState().toggleNav()
    expect(useSession.getState().navOpen).toBe(false)

    useSession.getState().toggleNav()
    expect(useSession.getState().navOpen).toBe(true)
  })

  it('persists the values and never the actions', () => {
    // A stored blob from an older build rehydrating over the current function
    // references replaces a working callback with a stale one, or undefined.
    useSession.setState({ zoom: 1.5, navOpen: true, sideOpen: false, sideTab: 'collab' })
    const raw = globalThis.sessionStorage.getItem('folio.session')
    expect(raw).not.toBeNull()
    const stored: unknown = JSON.parse(raw ?? '{}')
    const state = (stored as { state?: Record<string, unknown> }).state ?? {}
    expect(Object.keys(state).sort()).toEqual(['navOpen', 'sideOpen', 'sideTab', 'zoom'])
  })
})

describe('the state boundaries', () => {
  it('keeps pageMode out of every client store', () => {
    /*
     * The point of this test is what it does NOT find. AGENTS.md's exception
     * table puts `pageMode` and `liveRepaginate` per project, which is a
     * database row shared with collaborators - and the schema has no home for
     * them yet (see lib/state/project-preferences.ts).
     *
     * The tempting fix is a Zustand field or a localStorage key. Either makes
     * the setting per person, and two writers on one script then disagree about
     * how many pages it is, which is the exact drift the product exists to
     * prevent. So the session store is asserted not to grow one.
     */
    const keys = Object.keys(useSession.getState())
    expect(keys).not.toContain('pageMode')
    expect(keys).not.toContain('liveRepaginate')
  })

  it('holds only the four session flags and their setters', () => {
    const values = Object.keys(useSession.getState()).filter(
      (key) => typeof useSession.getState()[key as 'zoom'] !== 'function',
    )
    expect(values.sort()).toEqual(['navOpen', 'sideOpen', 'sideTab', 'zoom'])
  })

  it('states the pagination default without pretending to store it', () => {
    expect(PAGE_MODES).toEqual(['paged', 'continuous'])
    expect(DEFAULT_PROJECT_PAGINATION).toEqual({ pageMode: 'paged', liveRepaginate: false })
  })

  it('keeps aiScope to the four scopes a lens can read', () => {
    expect(AI_SCOPES).toEqual(['selection', 'scene', 'act', 'draft'])
  })
})
