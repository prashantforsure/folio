import Link from 'next/link'

import type { ScenePath } from '../../../../../../lib/workspace/hrefs'

/**
 * Citation chips - `docs/ui design/README.md`, "Patterns to reuse": "Any
 * claim that comes from the script carries the scene refs that prove it as
 * small mono chips. No refs renders as 'Not on the page yet' in `--ink3`."
 *
 * One component for every record route. A chip is the mockup's mono
 * badge (`Route - Characters v2.dc.html`, the graph's edge label and the
 * card's status badge share the shape): `2px 7px`, 6px radius, `--bg`
 * ground, `--line2` hairline, 10px mono. Handed labels already formatted
 * (`E1 Sc 4`, `lib/characters/figures.ts`'s `formatSceneRef`), and an
 * optional cap: past it the rest fold into `+ n more`, still in the title.
 *
 * ## A chip with an href is a link into the script
 *
 * Since 2026-09-17 a ref may carry the scene's script href
 * (`lib/characters/figures.ts`'s `citeOf`: the episode's script and the
 * `#n-<node id>` fragment), and then the chip is a `<Link>` - accent on
 * hover, the README's link colour - so a claim that comes from the script
 * opens the scene that proves it. A plain string stays a plain chip, which
 * is what the Locations and Research routes still pass.
 */
export type CitationChip = string | { readonly label: string; readonly href: ScenePath }

const labelOf = (chip: CitationChip): string => (typeof chip === 'string' ? chip : chip.label)

export const CitationChips = ({
  refs,
  max = 4,
  className,
}: {
  readonly refs: readonly CitationChip[]
  readonly max?: number
  readonly className?: string
}) => {
  if (refs.length === 0) {
    return (
      <span data-citations="none" className={`text-11 text-ink3 ${className ?? ''}`}>
        Not on the page yet
      </span>
    )
  }
  const shown = refs.slice(0, max)
  const rest = refs.length - shown.length
  return (
    <span
      data-citations={refs.length}
      title={refs.map(labelOf).join(' · ')}
      className={`flex flex-wrap items-center gap-[4px] ${className ?? ''}`}
    >
      {shown.map((ref) =>
        typeof ref === 'string' ? (
          <span key={ref} className="folio-cite">
            {ref}
          </span>
        ) : (
          <Link
            key={ref.label}
            href={ref.href}
            data-cite-link
            className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {ref.label}
          </Link>
        ),
      )}
      {rest > 0 ? <span className="tabular text-10-5 text-ink3">+ {rest} more</span> : null}
    </span>
  )
}
