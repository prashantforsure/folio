import Link from 'next/link'

import type { ExcerptLine } from '../../../../../../lib/scenes/excerpt'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { ABSENT, eighths as formatEighths } from '../../../../../../lib/workspace/format'
import type { CharacterPath } from '../../../../../../lib/workspace/hrefs'

/**
 * What every Scenes view prints and how: the number, the page, the eighths,
 * the time, a cast chip, the excerpt's lines. One module so the canvas node,
 * the index card, the list row, the detail dialog and the reading modal
 * cannot disagree on what `pg 3` or `4/8` or `—` looks like.
 *
 * Nothing here computes a value. Each formatter reads the field the
 * loader named (`lib/scenes/server.ts`) and prints it; `ABSENT` is the
 * chrome's `—` for a number that does not exist yet (no measurement), and
 * a count that is legitimately zero prints `0`.
 */

/** `01`, `12`, `220`. Zero-padded to two, as every route prints a scene number. */
export const sceneNo = (number: number): string => String(number).padStart(2, '0')

export const pageLabel = (card: SceneCard): string => (card.measured === null ? ABSENT : String(card.measured.startPage))

export const pageRange = (card: SceneCard): string => {
  if (card.measured === null) return ABSENT
  const { startPage, endPage } = card.measured
  return startPage === endPage ? String(startPage) : `${String(startPage)}–${String(endPage)}`
}

export const eighthsLabel = (card: SceneCard): string => formatEighths(card.measured === null ? null : card.measured.eighths)

export const timeLabel = (card: SceneCard): string => card.derived.reading.timeOfDay ?? ABSENT

export const hasSynopsis = (value: string | null): value is string => value !== null && value.trim() !== ''

/** What a card says where a synopsis would be. The mockup's line, as a button that opens the editor. */
export const NO_SYNOPSIS = 'No synopsis yet · write one'

/**
 * `@MAYA` - the label book's casing, as the Storyboard's mention chips print
 * it. With an `href` (`/characters/:id`, 2026-09-17) the chip is a link to
 * the record; the click stops at the chip, not the card around it.
 */
export const CastChip = ({ name, small, href }: { readonly name: string; readonly small?: boolean; readonly href?: CharacterPath }) => {
  const className = `whitespace-nowrap rounded-pill bg-accent-bg text-accent ${small === true ? 'px-[7px] py-[1px] text-10-5' : 'px-[8px] py-[2px] text-11'}`
  return href === undefined ? (
    <span className={className}>@{name}</span>
  ) : (
    <Link
      href={href}
      data-cast-link
      className={`${className} no-underline hover:underline`}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      @{name}
    </Link>
  )
}

/** How many lines a node's tile shows before the fade. The mockup's preview draws six to eight. */
export const TILE_EXCERPT_LINES = 8

/**
 * The excerpt as the node's tile draws it: one line per node, each inset by
 * its type (`.folio-scene-line`), ellipsis where a line runs past the tile.
 * A preview, not a page - the reading modal is where the scene wraps.
 */
export const TileLines = ({ lines }: { readonly lines: readonly ExcerptLine[] }) => (
  <>
    {lines.slice(0, TILE_EXCERPT_LINES).map((line, index) => (
      <span key={line.id} data-type={line.type} className="folio-scene-line" style={{ marginTop: index > 0 && (line.type === 'character' || line.type === 'action') ? '0.55em' : 0 }}>
        {line.text === '' ? ' ' : line.text}
      </span>
    ))}
  </>
)
