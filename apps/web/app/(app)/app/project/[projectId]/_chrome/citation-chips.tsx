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
 */
export const CitationChips = ({
  refs,
  max = 4,
  className,
}: {
  readonly refs: readonly string[]
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
    <span data-citations={refs.length} title={refs.join(' · ')} className={`flex flex-wrap items-center gap-[4px] ${className ?? ''}`}>
      {shown.map((ref) => (
        <span key={ref} className="folio-cite">
          {ref}
        </span>
      ))}
      {rest > 0 ? <span className="tabular text-10-5 text-ink3">+ {rest} more</span> : null}
    </span>
  )
}
