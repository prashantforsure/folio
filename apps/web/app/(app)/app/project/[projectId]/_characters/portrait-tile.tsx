import type { ReactNode } from 'react'

/**
 * The portrait tile: the character's colour with the person glyph until a
 * portrait is set, the image once one is. The card draws it 3:4 with the
 * name and facts over its foot; the drawer draws a small square one beside
 * the colour picker. The glyph is `◍`, the rail's own Characters mark,
 * rendered as text like every glyph in the app.
 *
 * A plain `<img>`, not `next/image`: the portrait's host is whatever
 * `R2_PUBLIC_URL` says per deploy, and an image optimiser that has to know
 * the host in advance would need a config change per bucket.
 */
export const PortraitTile = ({
  hue,
  portraitUrl,
  name,
  glyphSize = 64,
  className = '',
  children,
}: {
  readonly hue: number
  readonly portraitUrl: string | null
  readonly name: string
  readonly glyphSize?: number
  readonly className?: string
  readonly children?: ReactNode
}) => (
  <div
    data-portrait-tile
    data-has-portrait={portraitUrl === null ? 'false' : 'true'}
    className={`relative overflow-hidden ${className}`}
    style={{ background: `var(--chip-${String(hue)})` }}
  >
    {portraitUrl === null ? (
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center leading-none opacity-40"
        style={{ fontFamily: 'var(--font-glyph)', color: 'var(--chip-ink)', fontSize: glyphSize }}
      >
        ◍
      </span>
    ) : (
      <img src={portraitUrl} alt={`${name}'s portrait`} className="absolute inset-0 h-full w-full object-cover" />
    )}
    {children}
  </div>
)
