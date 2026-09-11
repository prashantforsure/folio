'use client'

import { Glyph } from '@folio/ui'

import { useTheme } from '../../../lib/state/theme'

/**
 * The theme toggle. 56x34, bottom of the sidebar, above the avatar.
 *
 * The glyph shows **the theme it will switch to**, not the one in force: `☀`
 * while dark, `☾` while light. That is the convention the route bundles use and
 * it is the one that survives being pressed - a control labelled with its
 * current state reads as broken the instant it is used.
 *
 * `aria-pressed` is deliberately absent. This is not a two-state toggle button
 * in the ARIA sense; it is a control that swaps between two named themes, and
 * the accessible name says which one is coming. `aria-live` is absent too: the
 * whole page visibly changes, which is its own announcement.
 *
 * `width` is the one thing the two shells disagree on: 78px in the home
 * sidebar (see `sidebar.tsx` for why that column is wider) and the bundle's
 * 56px in the project rail.
 */
export const ThemeToggle = ({ width = 78 }: { readonly width?: 78 | 56 }) => {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      data-theme-toggle={theme}
      className={`grid h-[34px] ${width === 78 ? 'w-[78px]' : 'w-[56px]'} cursor-pointer place-items-center rounded-chrome border-none bg-transparent text-13 text-ink3 hover:bg-hover hover:text-ink`}
    >
      <Glyph name={next === 'dark' ? 'themeDark' : 'themeLight'} />
    </button>
  )
}
