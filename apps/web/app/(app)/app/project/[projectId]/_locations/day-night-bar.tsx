import { dayNightSplit } from '../../../../../../lib/locations/figures'

/**
 * The day-against-night bar every location row, sub-location card and
 * breakdown cell carries: `--day` on the left for the share of scenes whose
 * heading says day, `--night` on the right for night, and the `--line2`
 * track showing through for headings that say neither (`CONTINUOUS`,
 * `LATER`). `Route - Locations.dc.html` draws two colours over a track; the
 * track showing is the honest third state.
 */
export const DayNightBar = ({
  scenes,
  dayScenes,
  nightScenes,
  width,
  height = 6,
  className,
}: {
  readonly scenes: number
  readonly dayScenes: number
  readonly nightScenes: number
  /** A fixed width, or `undefined` to take the width the caller's class gives it. */
  readonly width?: number
  readonly height?: number
  readonly className?: string
}) => {
  const split = dayNightSplit({ scenes, dayScenes, nightScenes })
  return (
    <span
      aria-hidden="true"
      data-day-night={`${String(dayScenes)}/${String(nightScenes)}`}
      className={`flex overflow-hidden rounded-sheet bg-line2 ${className ?? ''}`}
      style={{ height, ...(width === undefined ? {} : { width }) }}
    >
      <span className="bg-day" style={{ width: `${String(Math.round(split.day * 100))}%` }} />
      <span className="bg-night" style={{ width: `${String(Math.round(split.night * 100))}%` }} />
    </span>
  )
}
