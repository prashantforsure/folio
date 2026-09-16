'use client'

import { Glyph, Icon } from '@folio/ui'

import { useTheme } from '../../../lib/state/theme'

/**
 * The theme toggle.
 *
 * The mark shows **the theme it will switch to**, not the one in force: the
 * sun while dark, the moon while light. That is the convention the design
 * mockups use (`☀` / `☾` in the rail's bottom slot) and it is the one that
 * survives being pressed - a control labelled with its current state reads
 * as broken the instant it is used.
 *
 * `aria-pressed` is deliberately absent. This is not a two-state toggle button
 * in the ARIA sense; it is a control that swaps between two named themes, and
 * the accessible name says which one is coming. `aria-live` is absent too: the
 * whole page visibly changes, which is its own announcement.
 *
 * Two variants: `rail` is the redesigned 38px icon button (`@folio/ui`'s
 * stroke SVGs); `sidebar` is the home shell's 78px glyph button, kept until
 * that shell has its own pass.
 */
export const ThemeToggle = ({ variant = 'sidebar' }: { readonly variant?: 'rail' | 'sidebar' }) => {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'

  if (variant === 'rail') {
    return (
      <button
        type="button"
        onClick={toggle}
        title={`Switch to ${next} theme`}
        aria-label={`Switch to ${next} theme`}
        data-theme-toggle={theme}
        className="folio-rail-button h-[38px] w-[38px] rounded-[11px]"
      >
        <Icon name={next === 'dark' ? 'moon' : 'sun'} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      data-theme-toggle={theme}
      className="grid h-[34px] w-[78px] cursor-pointer place-items-center rounded-chrome border-none bg-transparent text-13 text-ink3 hover:bg-hover hover:text-ink"
    >
      <Glyph name={next === 'dark' ? 'themeDark' : 'themeLight'} />
    </button>
  )
}
