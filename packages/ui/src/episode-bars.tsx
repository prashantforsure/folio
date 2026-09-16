/**
 * Per-episode distribution as a row of bars - `docs/ui design/README.md`,
 * "Episode bars": "a row of 14×4px bars, strongest at `--ink2`, absent at
 * `--line2`, with the numbers in the `title` attribute." The Characters
 * card draws one under its scene count; Locations and Research reuse it.
 *
 * The mockup's own thresholds (`Route - Characters v2.dc.html`,
 * `renderVals`): an episode at 60% of the peak or more is `--ink2`, below
 * that `--ink3`, a zero `--line2`. The title reads `E1 28 · E2 24 · E3 27`
 * - one entry per bar, in order, so the numbers behind the picture are
 * one hover away. Presentational: handed the counts, decides nothing about
 * where they came from.
 */
export const EpisodeBars = ({
  counts,
  className,
}: {
  /** One count per episode, in episode order. An empty list draws nothing. */
  readonly counts: readonly number[]
  readonly className?: string
}) => {
  if (counts.length === 0) return null
  const peak = counts.reduce((most, count) => Math.max(most, count), 0)
  return (
    <span
      data-episode-bars
      title={counts.map((count, index) => `E${String(index + 1)} ${String(count)}`).join(' · ')}
      className={`flex flex-none items-center gap-[3px] ${className ?? ''}`}
    >
      {counts.map((count, index) => (
        <span
          key={index}
          data-bar={count === 0 ? 'none' : count >= peak * 0.6 ? 'strong' : 'weak'}
          className="h-[4px] w-[14px] rounded-[2px]"
          style={{ background: count === 0 ? 'var(--line2)' : count >= peak * 0.6 ? 'var(--ink2)' : 'var(--ink3)' }}
        />
      ))}
    </span>
  )
}
