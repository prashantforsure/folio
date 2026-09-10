import type { CSSProperties } from 'react'

/**
 * A revision colour, drawn.
 *
 * AGENTS.md, UI fidelity: revision colours "are industry artefacts, not palette
 * tokens, and must survive a theme switch intact." `revision.css` guarantees
 * the values; this component is the only sanctioned way to put one on screen,
 * which is what keeps the guarantee from being routed around.
 *
 * The fill is `var(--rev-<name>)` and the ring is `var(--rev-ring)`, drawn
 * INSET via `box-shadow: inset`. Inset matters: a ring outside the swatch would
 * have to contrast with the page, which is theme-dependent, and the moment it
 * is theme-dependent someone reaches for `--line` and the swatch stops being
 * invariant. Inside, it sits on the swatch's own fill, so one value works in
 * both themes and on all five colours.
 *
 * ## The duplicated list, and why it is not drift
 *
 * `REVISION_COLOUR_NAMES` below repeats a tuple that already exists as
 * `REVISION_COLOURS` in `@folio/script`. That is deliberate: AGENTS.md,
 * Architecture makes this package presentational, and the brief for this phase
 * is explicit - "no imports from @folio/db or @folio/script". A UI package that
 * imports the pure core to learn a colour name has learned a domain fact.
 *
 * The copy is prevented from drifting by a test rather than by discipline:
 * `apps/web/tests/revision-colours.test.ts` may import both, and asserts the
 * two tuples are identical in value and order. `packages/script` remains the
 * authority; this is a transcription with an alarm on it.
 */

export const REVISION_COLOUR_NAMES = ['white', 'blue', 'pink', 'yellow', 'green'] as const

export type RevisionColourName = (typeof REVISION_COLOUR_NAMES)[number]

export const isRevisionColourName = (value: unknown): value is RevisionColourName =>
  typeof value === 'string' && (REVISION_COLOUR_NAMES as readonly string[]).includes(value)

/** The custom property holding a colour. The only place the name is composed. */
export const revisionColourVar = (name: RevisionColourName): string => `var(--rev-${name})`

type RevisionSwatchProps = {
  readonly colour: RevisionColourName
  /** Edge length in px. The bundles draw these at 8-12px beside a draft name. */
  readonly size?: number
  /**
   * A visible label sits beside the swatch almost everywhere, so the swatch is
   * decoration. Pass a label only where it stands alone.
   */
  readonly label?: string
  readonly className?: string
}

export const RevisionSwatch = ({ colour, size = 10, label, className }: RevisionSwatchProps) => {
  const style: CSSProperties = {
    width: `${String(size)}px`,
    height: `${String(size)}px`,
    background: revisionColourVar(colour),
    boxShadow: 'inset 0 0 0 1px var(--rev-ring)',
    borderRadius: 'var(--radius-sheet)',
    display: 'inline-block',
    flex: 'none',
  }

  if (label === undefined) {
    return <span aria-hidden="true" className={className} style={style} data-revision={colour} />
  }

  return (
    <span role="img" aria-label={label} className={className} style={style} data-revision={colour} />
  )
}
