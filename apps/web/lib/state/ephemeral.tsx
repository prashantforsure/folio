'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * The two things that should not survive anything. Plain React state.
 *
 * AGENTS.md, Tech stack: "Client state | **URL first, then React state.**
 * Zustand only for the agent window rect and session flags." These two are
 * neither of those, so they are the "then React state" case, and they are here
 * rather than in `session.ts` because the storage is the difference.
 *
 * **`paletteOpen`.** A command palette that remembers it was open is a command
 * palette that opens by itself on the next page load. There is no reading of
 * "persist this" that produces a better product.
 *
 * **`aiScope`.** What the agent is pointed at - a selection, a scene, an act,
 * the draft. Ephemeral because a scope is chosen for a question and stops being
 * true the moment the user navigates somewhere the selection does not exist.
 * The value silently surviving into a different scene is how an agent run reads
 * a surface nobody meant it to.
 *
 * > Placed here on the client's instruction for this phase. The design README
 * > lists `aiScope` as session state next to the panel flags, and AGENTS.md's
 * > exception table groups it with them. If a scope is meant to outlive a route
 * > change, moving it is one line - it goes to `session.ts` - but it is a
 * > product decision about what the agent can see, and AGENTS.md, When to ask
 * > first puts "Widen what the AI can read or write, in any direction" behind a
 * > question.
 *
 * Nothing is persisted, so there is no storage guard, no hydration step and no
 * SSR branch. That absence is the reason this is a third file rather than three
 * more fields on the Zustand store.
 */

/** AGENTS.md, The AI agent: a lens reads a scope. Four, closed. */
export const AI_SCOPES = ['selection', 'scene', 'act', 'draft'] as const

export type AiScope = (typeof AI_SCOPES)[number]

type EphemeralValue = {
  readonly paletteOpen: boolean
  readonly setPaletteOpen: (open: boolean) => void
  readonly togglePalette: () => void
  readonly aiScope: AiScope
  readonly setAiScope: (scope: AiScope) => void
}

const EphemeralContext = createContext<EphemeralValue | null>(null)

export const EphemeralProvider = ({ children }: { readonly children: ReactNode }) => {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aiScope, setAiScope] = useState<AiScope>('scene')

  const togglePalette = useCallback(() => {
    setPaletteOpen((open) => !open)
  }, [])

  const value = useMemo<EphemeralValue>(
    () => ({ paletteOpen, setPaletteOpen, togglePalette, aiScope, setAiScope }),
    [paletteOpen, togglePalette, aiScope],
  )

  return <EphemeralContext.Provider value={value}>{children}</EphemeralContext.Provider>
}

export const useEphemeral = (): EphemeralValue => {
  const value = useContext(EphemeralContext)
  if (value === null) {
    throw new Error(
      'Folio: useEphemeral was called outside EphemeralProvider. The provider is in app/(app)/layout.tsx.',
    )
  }
  return value
}
