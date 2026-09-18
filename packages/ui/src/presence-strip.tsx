/**
 * Where in the script something appears, scene by scene: one cell per
 * present scene in running order, grouped by episode with a mono `E1`
 * label and a hairline between groups. A record's presence read as a
 * picture. The Characters route's strip and the Locations route's are this
 * one component (the Characters rebuild plan's `PresenceStrip`, built
 * 2026-09-18 - both routes import it), with three states named for the
 * picture, not the domain; each route maps its own words onto them:
 *
 *   `full`   `--ink2`   the record is in this scene: a character speaks,
 *                       a set is where the scene is
 *   `half`   `--ink3`   a weaker presence: a character only mentioned
 *   `none`   `--line2`  not in this scene
 *
 * Cells flex to the width they are given and stop at a cap per size, so a
 * three-scene film and a ninety-scene series both read; past
 * `PRESENCE_STRIP_LIMIT` cells the caller draws episode bars instead. The
 * title on each cell is the caller's (`E2 Sc 9 · INT. CHAWL - NIGHT`), so
 * the number behind the picture is one hover away. Presentational: handed
 * the cells, decides nothing about where they came from.
 */
export type PresenceCellState = 'full' | 'half' | 'none'

export type PresenceCell = {
  readonly key: string
  readonly state: PresenceCellState
  readonly title: string
}

export type PresenceGroup = {
  /** `E1`, or empty on a film. */
  readonly label: string
  readonly cells: readonly PresenceCell[]
}

export type PresenceStripSize = 'card' | 'drawer' | 'sheet'

const CELL: Readonly<Record<PresenceStripSize, { readonly max: number; readonly height: number }>> = {
  card: { max: 8, height: 8 },
  drawer: { max: 10, height: 10 },
  sheet: { max: 3, height: 6 },
}

/** How many cells a strip of this size can draw before the caller should fall back to episode bars. */
export const PRESENCE_STRIP_LIMIT: Readonly<Record<PresenceStripSize, number>> = { card: 96, drawer: 240, sheet: 80 }

const INK: Readonly<Record<PresenceCellState, string>> = {
  full: 'var(--ink2)',
  half: 'var(--ink3)',
  none: 'var(--line2)',
}

export const PresenceStrip = ({
  groups,
  size = 'card',
  className,
}: {
  readonly groups: readonly PresenceGroup[]
  readonly size?: PresenceStripSize
  readonly className?: string
}) => {
  const total = groups.reduce((sum, group) => sum + group.cells.length, 0)
  if (total === 0) return null
  const { max, height } = CELL[size]
  return (
    <span data-presence-strip={size} className={`flex min-w-0 items-end gap-[6px] ${className ?? ''}`}>
      {groups.map((group, index) => (
        <span
          key={`${group.label}-${String(index)}`}
          data-presence-group={group.label}
          className="flex min-w-0 flex-col gap-[3px]"
          style={{ flex: `${String(group.cells.length)} 1 0`, borderLeft: index === 0 ? undefined : '1px solid var(--line2)', paddingLeft: index === 0 ? undefined : 6 }}
        >
          <span className="flex min-w-0 items-center gap-[2px]">
            {group.cells.map((cell) => (
              <span
                key={cell.key}
                data-presence-cell={cell.state}
                title={cell.title}
                className="min-w-[2px] rounded-[2px]"
                style={{ flex: '1 1 0', maxWidth: max, height, background: INK[cell.state] }}
              />
            ))}
          </span>
          {size === 'sheet' || group.label === '' ? null : (
            <span className="font-mono text-[10px] leading-none text-ink3" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {group.label}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}
