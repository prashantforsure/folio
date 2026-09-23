import { describe, expect, it } from 'vitest'

import { HOME_NAV, PROJECTS } from '../app/(app)/_shell/home-nav'
import { ACCOUNT_SETTINGS, TRASH } from '../app/(app)/_shell/nav'
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

describe('the home sidebar', () => {
  it('is exactly four rows, in this order', () => {
    // The account routes pass (2026-09-22) replaced Recents · Screenwriting ·
    // Filmmaking with one Projects route, and brought Trash and Settings in
    // from the header and the avatar menu. Four rows either way.
    expect(HOME_NAV.map((item) => item.label)).toEqual(['New', 'Projects', 'Trash', 'Settings'])
  })

  it('points each one at its route under the /app prefix', () => {
    // AGENTS.md, Routing: "Everything under `/app/`. One prefix for the
    // signed-in product."
    expect(HOME_NAV.map((item) => item.href)).toEqual([
      '/app/new',
      PROJECTS,
      TRASH,
      ACCOUNT_SETTINGS,
    ])
    expect(PROJECTS).toBe('/app/projects')
  })

  it('counts only the Projects row, and it is a live count', () => {
    // AGENTS.md, UI fidelity: "Badges are live counts, never placeholders."
    // The badge is a number the layout reads; the table only says which row
    // carries one.
    expect(HOME_NAV.filter((item) => item.counted === true).map((item) => item.label)).toEqual([
      'Projects',
    ])
  })

  it('does not carry anything AGENTS.md cut', () => {
    // "Cut, do not build: Community, writing leaderboard, activity heatmap."
    const labels = HOME_NAV.map((item) => item.label.toLowerCase())
    for (const cut of ['community', 'leaderboard', 'heatmap']) {
      expect(labels).not.toContain(cut)
    }
  })

  it('leaves the three old list routes out of the nav, redirect or not', () => {
    const hrefs = HOME_NAV.map((item) => String(item.href))
    for (const gone of ['/app/recents', '/app/screenwriting', '/app/filmmaking']) {
      expect(hrefs).not.toContain(gone)
    }
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
    useSession.setState({ zoom: 1.5, navOpen: true, sideOpen: false, sideTab: 'collab', assistantOpen: true })
    const raw = globalThis.sessionStorage.getItem('folio.session')
    expect(raw).not.toBeNull()
    const stored: unknown = JSON.parse(raw ?? '{}')
    const state = (stored as { state?: Record<string, unknown> }).state ?? {}
    expect(Object.keys(state).sort()).toEqual([
      'assistantChats',
      'assistantDraft',
      'assistantOpen',
      'colourCues',
      'navOpen',
      'sideOpen',
      'sideTab',
      'zoom',
    ])
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

  it('holds only the six session flags, the open chat per episode, the draft, and their setters', () => {
    // `assistantOpen` joined the four with the redesign (2026-09-16): the
    // assistant panel is one panel on every route, so whether it is open is
    // the window's, like the sidebar. `colourCues` joined with the Characters
    // rebuild (2026-09-18): each cue in its record's colour, a way of looking.
    // `assistantChats` and `assistantDraft` joined with roadmap task 2.2
    // (2026-09-23): the app-wide panel's open chat per episode and its unsent
    // draft, which must survive a reload and a trip to another project.
    const values = Object.keys(useSession.getState()).filter(
      (key) => typeof useSession.getState()[key as 'zoom'] !== 'function',
    )
    expect(values.sort()).toEqual([
      'assistantChats',
      'assistantDraft',
      'assistantOpen',
      'colourCues',
      'navOpen',
      'sideOpen',
      'sideTab',
      'zoom',
    ])
  })

  it('states the pagination default without pretending to store it', () => {
    expect(PAGE_MODES).toEqual(['paged', 'continuous'])
    expect(DEFAULT_PROJECT_PAGINATION).toEqual({ pageMode: 'paged', liveRepaginate: false })
  })

  it('keeps aiScope to the four scopes a lens can read', () => {
    expect(AI_SCOPES).toEqual(['selection', 'scene', 'act', 'draft'])
  })
})
