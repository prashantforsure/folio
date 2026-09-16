'use client'

import { connectorPath } from '../../../../../../../lib/storyboard/canvas'
import type { Rect } from '../../../../../../../lib/storyboard/canvas'

/**
 * The threads: one path from each card to the next in the sequence. An
 * SVG in world space under the cards, `overflow: visible` so a path can
 * run anywhere the cards do without the SVG having a size. The dash moves
 * (`.folio-thread`, `globals.css`) - the README's second named exception
 * to "nothing else animates", ruled 2026-09-17 - and stops under
 * `prefers-reduced-motion`.
 *
 * The order is the sequence's, not the positions': a card dragged behind
 * its predecessor gets a thread that doubles back, which is the point -
 * where the cards sit is the writer's, where the story goes is the
 * script's.
 */
export const Connectors = ({ rects }: { readonly rects: readonly { readonly id: string; readonly rect: Rect }[] }) => (
  <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} data-threads>
    {rects.slice(1).map((entry, index) => {
      const previous = rects[index]
      if (previous === undefined) return null
      return <path key={entry.id} className="folio-thread" d={connectorPath(previous.rect, entry.rect)} data-thread={`${previous.id}:${entry.id}`} />
    })}
  </svg>
)
