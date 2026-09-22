import type { DescriptionPart } from '@folio/script'

/**
 * §3.3 row 3, the description as rich runs: plain text, an `@Character`
 * mention as an accent chip, dialogue italic on the ok tone. The same runs
 * the drawer and the table print; the Columns view edits the plain text.
 */
export const Description = ({ parts, className }: { readonly parts: readonly DescriptionPart[]; readonly className?: string }) => (
  <span className={className ?? 'folio-prod-desc'}>
    {parts.length === 0 ? (
      <span className="text-ink3">Describe the shot</span>
    ) : (
      parts.map((part, index) => (
        <span key={`${String(index)}-${part.text}`} className="folio-prod-run" data-kind={part.kind}>
          {part.text}
        </span>
      ))
    )}
  </span>
)
