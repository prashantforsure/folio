import type { CSSProperties } from 'react'

/**
 * The icon set. Inline stroke SVGs, transcribed from the v2 design package.
 *
 * `docs/ui design/README.md`, "Rail": "All custom 18px/1.35-weight stroke
 * SVGs matching the product's glyph set; no icon fonts." AGENTS.md's ban on
 * icon *libraries* stands (Deliberately not using) - nothing here is
 * imported; every path is written out from the mockup that draws it, so the
 * set is exactly what the design shows and grows only when a mockup does.
 *
 * `Glyph` (`glyph.tsx`) and the Unicode set it prints survive beside this
 * for the routes not yet rebuilt. A rebuilt route draws `Icon`.
 *
 * ## One shape for every icon
 *
 * Every path is authored on a 20-unit viewBox (a few on 12 or 14, for the
 * small chevron and close marks) with `fill: none`, `stroke: currentColor`,
 * 1.35 stroke, round caps and joins. `size` scales the box; the stroke
 * scales with it, which is what keeps an 18px rail icon and a 15px pill icon
 * looking like the same family. Colour is the parent's `color`.
 *
 * `aria-hidden` always: an icon never carries meaning alone. The control it
 * sits in has the label (`title`, `aria-label`, or visible text).
 */

type IconPath = {
  readonly viewBox: number
  readonly d: readonly string[]
}

const P = (viewBox: number, ...d: string[]): IconPath => ({ viewBox, d })

export const ICONS = {
  /** Rail: sidebar toggle. Three bars. */
  menu: P(18, 'M3 5h12M3 9h12M3 13h12'),
  /** Rail: Writing. A page with three lines. */
  writing: P(20, 'M4.5 2.8h11a1.8 1.8 0 0 1 1.8 1.8v10.8a1.8 1.8 0 0 1-1.8 1.8h-11a1.8 1.8 0 0 1-1.8-1.8V4.6a1.8 1.8 0 0 1 1.8-1.8z', 'M7.4 7h5.2M7.4 10h5.2M7.4 13h3'),
  /** Rail: Characters. Head and shoulders. */
  characters: P(20, 'M12.9 7.4a2.9 2.9 0 1 1-5.8 0 2.9 2.9 0 0 1 5.8 0z', 'M4.4 16.2c.9-2.7 3-4.1 5.6-4.1s4.7 1.4 5.6 4.1'),
  /** Rail: Locations. A pin. */
  locations: P(20, 'M12.4 8a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z', 'M10 17c3.2-3.8 4.8-6.4 4.8-8.4A4.8 4.8 0 0 0 5.2 8.6c0 2 1.6 4.6 4.8 8.4z'),
  /** Rail: Timeline. Three lines, shortening. */
  timeline: P(20, 'M3.6 6h12.8M3.6 10h8.4M3.6 14h5.2'),
  /** Rail: Research. Four tiles. */
  research: P(
    20,
    'M4.9 3.6h3a1.3 1.3 0 0 1 1.3 1.3v3a1.3 1.3 0 0 1-1.3 1.3h-3A1.3 1.3 0 0 1 3.6 7.9v-3a1.3 1.3 0 0 1 1.3-1.3z',
    'M12.1 3.6h3a1.3 1.3 0 0 1 1.3 1.3v3a1.3 1.3 0 0 1-1.3 1.3h-3a1.3 1.3 0 0 1-1.3-1.3v-3a1.3 1.3 0 0 1 1.3-1.3z',
    'M4.9 10.8h3a1.3 1.3 0 0 1 1.3 1.3v3a1.3 1.3 0 0 1-1.3 1.3h-3a1.3 1.3 0 0 1-1.3-1.3v-3a1.3 1.3 0 0 1 1.3-1.3z',
    'M12.1 10.8h3a1.3 1.3 0 0 1 1.3 1.3v3a1.3 1.3 0 0 1-1.3 1.3h-3a1.3 1.3 0 0 1-1.3-1.3v-3a1.3 1.3 0 0 1 1.3-1.3z',
  ),
  /** Rail: Production. A play mark in a frame. */
  production: P(20, 'M5.8 3.4h8.4a2.4 2.4 0 0 1 2.4 2.4v8.4a2.4 2.4 0 0 1-2.4 2.4H5.8a2.4 2.4 0 0 1-2.4-2.4V5.8a2.4 2.4 0 0 1 2.4-2.4z', 'M8.4 7.6l4.2 2.4-4.2 2.4z'),
  /** Rail: Help. A ring with a question mark. */
  help: P(20, 'M16.6 10a6.6 6.6 0 1 1-13.2 0 6.6 6.6 0 0 1 13.2 0z', 'M8.2 8.1a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.7.6-.7 1.1v.3', 'M10 13.6v.2'),
  /** Rail: theme toggle, shown while dark - the sun that is coming. */
  sun: P(20, 'M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M10 2.8v1.8M10 15.4v1.8M2.8 10h1.8M15.4 10h1.8M4.9 4.9l1.3 1.3M13.8 13.8l1.3 1.3M4.9 15.1l1.3-1.3M13.8 6.2l1.3-1.3'),
  /** Rail: theme toggle, shown while light - the moon that is coming. */
  moon: P(20, 'M15.6 12.4A6.2 6.2 0 0 1 7.6 4.4a6.2 6.2 0 1 0 8 8z'),
  /** Header pill: Write. A page, smaller. */
  write: P(18, 'M5.6 2.5h6.8a1.6 1.6 0 0 1 1.6 1.6v9.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 13.9V4.1a1.6 1.6 0 0 1 1.6-1.6z', 'M6.6 6.5h4.8M6.6 9.5h4.8M6.6 12.5h2.8'),
  /** Header pill: Storyboard. Two frames. */
  storyboard: P(18, 'M4.1 4h9.8a1.6 1.6 0 0 1 1.6 1.6v6.8a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 4.1 4z', 'M9 4v10'),
  /** A dropdown's chevron. */
  chevron: P(12, 'M3 5l3 3 3-3'),
  /** Close. */
  close: P(14, 'M3.5 3.5l7 7M10.5 3.5l-7 7'),
  /** Assistant composer: dictate. */
  mic: P(16, 'M8 2a2 2 0 0 1 2 2v3a2 2 0 1 1-4 0V4a2 2 0 0 1 2-2z', 'M4 8a4 4 0 0 0 8 0M8 12v2'),
  /** Assistant composer: send. An arrow up. */
  send: P(16, 'M8 13V3.5M4 7l4-3.5L12 7'),
  /** A link, for Share. */
  link: P(20, 'M8.6 11.4a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-1 1', 'M11.4 8.6a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l1-1'),
  /** Copied. A tick. */
  check: P(16, 'M3.5 8.5l3 3 6-6'),
  /** A comment bubble, for the block handle menu. */
  comment: P(20, 'M4 5.2h12a1.4 1.4 0 0 1 1.4 1.4v6.2A1.4 1.4 0 0 1 16 14.2h-5.6L7 17v-2.8H4a1.4 1.4 0 0 1-1.4-1.4V6.6A1.4 1.4 0 0 1 4 5.2z'),
  /** Import - an arrow into a tray. */
  import: P(16, 'M8 2.5v8M5 7.5l3 3 3-3', 'M3 12.5v1h10v-1'),
  /** Export - an arrow out of a tray. */
  export: P(16, 'M8 10.5v-8M5 5.5l3-3 3 3', 'M3 12.5v1h10v-1'),
} as const

export type IconName = keyof typeof ICONS

export const Icon = ({
  name,
  size = 18,
  strokeWidth = 1.35,
  className,
  style,
}: {
  readonly name: IconName
  readonly size?: number
  readonly strokeWidth?: number
  readonly className?: string
  readonly style?: CSSProperties
}) => {
  const icon = ICONS[name]
  const box = icon.viewBox
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(box)} ${String(box)}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {icon.d.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
