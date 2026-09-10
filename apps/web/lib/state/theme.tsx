'use client'

import { DEFAULT_THEME, THEME_ATTRIBUTE, isTheme, otherTheme } from '@folio/ui'
import type { Theme } from '@folio/ui'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * The theme. Per user, in localStorage, applied to `<html>` as `data-theme`.
 *
 * AGENTS.md, UI fidelity: "Theme is `dark` by default, via `data-theme`."
 * AGENTS.md, Deliberately not using: Tailwind's `dark:` variant, "Routes nest a
 * light sheet inside a dark page."
 *
 * ## The attribute is the state; this context is a remote control
 *
 * The single source of truth at runtime is `document.documentElement`'s
 * `data-theme`, because that is what the cascade reads. This provider mirrors
 * it into React so a toggle can re-render, and writes through on change - it
 * never renders the theme itself. That ordering is what lets a route nest
 * `<div data-theme="light">` around a script sheet without telling anyone: the
 * sheet is light because of an attribute, not because a component asked a hook.
 *
 * ## The flash, and why the inline script is not optional
 *
 * The server does not know the user's stored preference - it is in
 * localStorage, which does not exist on the server, and putting it in a cookie
 * to find out would send it on every request for a value only the browser
 * needs. So the server renders the default, `dark`, and `themeScript` below
 * corrects the attribute **before first paint**, in the `<head>`.
 *
 * Without it, a light-theme user gets a dark flash on every full page load.
 * With it, there is nothing to flash: the attribute is right before anything is
 * painted, and React catches up afterwards without touching the DOM.
 *
 * That is also why the initial React state is the default rather than a read of
 * localStorage. Reading storage in a `useState` initialiser produces a value
 * the server could not have produced, which is a hydration mismatch - React
 * discards the server HTML and re-renders the whole tree. The `useEffect` below
 * syncs from the DOM one tick later, which is invisible because the DOM was
 * already correct.
 */

const STORAGE_KEY = 'folio.theme'

type ThemeContextValue = {
  readonly theme: Theme
  readonly setTheme: (theme: Theme) => void
  readonly toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Runs in `<head>`, before first paint, as its own `<script>`.
 *
 * Written as a string because it must execute before React exists. It is
 * deliberately tiny and total: a failed read of localStorage - Safari private
 * mode, a blocked-cookies setting - leaves the server-rendered default in
 * place, which is a correct page rather than a broken one.
 *
 * `folio.theme` is repeated here rather than interpolated from `STORAGE_KEY`,
 * because interpolating a value into a script string is the shape of an
 * injection even when today's value is a constant. Both are checked against
 * each other by `tests/theme-script.test.ts`.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('folio.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`

export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  // Adopt whatever `themeScript` decided. The DOM is already correct; this only
  // brings React's copy into line so the toggle renders the right glyph.
  // Mount only, and it reads no React state, so the dependency list is honestly
  // empty. Every later change goes through `setTheme`, which writes the
  // attribute and this state together.
  useEffect(() => {
    const applied = document.documentElement.getAttribute(THEME_ATTRIBUTE)
    if (isTheme(applied)) setThemeState(applied)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage unavailable or full. The theme still applies for this page; it
      // just will not be remembered. Not worth telling the user about.
    }
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => {
    setTheme(otherTheme(theme))
  }, [setTheme, theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext)
  if (value === null) {
    throw new Error('Folio: useTheme was called outside ThemeProvider. The provider is in app/layout.tsx.')
  }
  return value
}
