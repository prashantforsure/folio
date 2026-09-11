'use client'

import { useEphemeral } from '../../../../../../lib/state/ephemeral'

/**
 * `Search or jump to…  ⌘K`. Full width, 1px `--line2`, `5px 8px`, 11.5px
 * `--ink3`. Opens the command palette - which is not built; the ephemeral
 * flag it sets is the one the palette will read when it is.
 */
export const SearchTrigger = () => {
  const { setPaletteOpen } = useEphemeral()

  return (
    <button
      type="button"
      onClick={() => {
        setPaletteOpen(true)
      }}
      className="flex w-full cursor-pointer items-center justify-between rounded-chrome border border-line2 bg-transparent pb-[5px] pl-[8px] pr-[8px] pt-[5px] text-11-5 text-ink3 hover:bg-hover"
    >
      <span>Search or jump to…</span>
      <span className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
        ⌘K
      </span>
    </button>
  )
}
