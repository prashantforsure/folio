import type { CastRow, ProductionScene, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { memo } from 'react'

import type { LocationSummary } from '../../../../../../lib/production/server'
import { locationHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'

/**
 * The reel card's third column - `Route - Production v2.dc.html`, "In this
 * reel": the scene's cast, each a 34×44 tile with initials (the portrait
 * when there is one) beside the name and `age · role`, then the location
 * in mono uppercase over its description. Both read-only, both linked to
 * the route that edits them: a look is edited in Characters, a set in
 * Locations. The cast is derivation's (`scene_derivations.cast`) and the
 * location the heading's resolved record; a scene with neither says so in
 * `--ink3` rather than drawing nothing.
 */

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => (part[0] ?? '').toUpperCase())
    .join('')

const metaOf = (row: CastRow): string => [row.age, row.role].filter((part): part is string => part !== null && part !== '').join(' · ')

export const InThisReel = memo(
  ({
    projectId,
    scene,
    cast,
    location,
  }: {
    readonly projectId: ProjectId
    readonly scene: ProductionScene
    /** The scene's cast, resolved to the Characters route's rows, in cast order. */
    readonly cast: readonly CastRow[]
    readonly location: LocationSummary | null
  }) => (
    <div className="flex min-w-0 flex-col gap-[14px] px-[16px] py-[14px]" data-in-this-reel>
      <span className="folio-eyebrow">In this reel</span>

      <div className="flex flex-col gap-[9px]">
        <div className="flex items-baseline gap-[8px]">
          <span className="flex-1 text-11-5 text-ink2">Cast</span>
          <Link href={projectRouteHref(projectId, 'characters')} className="text-11">
            → Characters
          </Link>
        </div>
        {cast.length === 0 ? (
          <span className="text-11-5 text-ink3">No one is on the page in this scene yet.</span>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {cast.map((row) => (
              <span key={row.id} className="flex min-w-0 items-center gap-[10px]" data-cast-row={row.id}>
                <span
                  className="grid h-[44px] w-[34px] flex-none place-items-center overflow-hidden rounded-[8px] text-10-5 font-semibold"
                  style={{ background: `var(--chip-${String(row.hue)})`, color: 'var(--chip-ink)' }}
                >
                  {row.portraitUrl === null ? (
                    initialsOf(row.name)
                  ) : (
                    // A plain img: the portrait is at a public storage URL, not an asset Next can optimise.
                    <img src={row.portraitUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-12-5">{row.name}</span>
                  <span className="text-11 text-ink3">{metaOf(row) === '' ? 'in this scene' : metaOf(row)}</span>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[9px] border-t border-line2 pt-[12px]">
        <div className="flex items-baseline gap-[8px]">
          <span className="flex-1 text-11-5 text-ink2">Location</span>
          <Link href={location === null ? projectRouteHref(projectId, 'locations') : locationHref(projectId, location.id)} className="text-11">
            → Locations
          </Link>
        </div>
        <span className="font-mono text-12 uppercase text-ink" data-reel-location>
          {location === null ? scene.set || '—' : location.name}
        </span>
        <span className="text-11-5 leading-[1.5] text-ink3 [text-wrap:pretty]">
          {location === null ? 'Not on the page yet - no location record resolves this heading.' : (location.description ?? 'No description yet.')}
        </span>
      </div>
    </div>
  ),
)
InThisReel.displayName = 'InThisReel'
