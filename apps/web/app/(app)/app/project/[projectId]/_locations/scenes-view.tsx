'use client'

import type { LocationRow, ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { metaLine, shortRef, statusTone } from '../../../../../../lib/locations/view'
import { eighths } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { CastStack } from './set-parts'

/**
 * The Scenes here view - `Route - Locations v2.dc.html`: one `--s1` section
 * per location at a 14px radius, capped at 1080px; a head with the status
 * dot, the name (a button - it opens the drawer) and `9 scenes · 41 2/8 pp`
 * in mono; then a row per scene: `E1 · 1` in a 52px mono column, a 7px
 * square in the light's tone (amber day, accent night, `--ink3` for a
 * heading that says neither), the heading in mono uppercase over the
 * synopsis, the cast avatars, and the eighths right-aligned in 52px.
 *
 * A primary set's section lists every scene here or below; a sub-set's
 * lists its own, so the same scene sits under both - that is what "counted
 * in the parent total" means. A record with no scene prints the README's
 * line where its rows would be. The rows follow the toolbar's filter.
 */
export const ScenesView = ({
  projectId,
  shown,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly shown: readonly LocationRow[]
  readonly selectedId: string | null
}) => {
  const router = useRouter()
  return (
    <div data-scenes-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
      <div className="flex max-w-[1080px] flex-col gap-[14px]">
        {shown.length === 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-scenes-filtered-empty>
            No location matches that filter.
          </p>
        ) : null}
        {shown.map((row) => (
          <section
            key={row.id}
            data-scenes-group={row.id}
            aria-current={row.id === selectedId ? 'true' : undefined}
            className="flex flex-col overflow-hidden rounded-[14px] border border-line2 bg-s1"
          >
            <div className="flex items-center gap-[10px] border-b border-line2 px-[15px] py-[12px]">
              <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} />
              <button
                type="button"
                data-scenes-open={row.id}
                onClick={() => {
                  router.push(locationHref(projectId, row.id))
                }}
                className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-13-5 font-medium tracking-title text-ink hover:text-accent"
              >
                {row.name}
              </button>
              <span className="tabular flex-none font-mono text-11 text-ink3">{metaLine(row)}</span>
            </div>
            {row.scenes.length === 0 ? (
              <p className="m-0 px-[15px] py-[10px] text-12 text-ink3" data-scenes-none>
                Not on the page yet
              </p>
            ) : (
              row.scenes.map((scene) => (
                <div
                  key={scene.scene.sceneNodeId}
                  data-scene-row={scene.scene.sceneNodeId}
                  className="flex min-w-0 items-center gap-[12px] border-b border-line2 px-[15px] py-[10px] last:border-b-0 hover:bg-s1"
                >
                  <span className="tabular w-[52px] flex-none font-mono text-11 text-ink3">{shortRef(scene.scene)}</span>
                  <span
                    className="folio-tone-fill h-[7px] w-[7px] flex-none rounded-[2px]"
                    data-tone={scene.light === 'day' ? 'warn' : scene.light === 'night' ? 'accent' : undefined}
                    title={scene.timeOfDay ?? 'No time of day'}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate font-mono text-12 uppercase">{scene.scene.heading === '' ? 'No heading yet' : scene.scene.heading}</span>
                    <span className="truncate text-11-5 text-ink3">
                      {scene.gist ?? (scene.at.id === row.id ? 'No synopsis yet' : `In ${scene.at.name}`)}
                    </span>
                  </span>
                  <CastStack people={scene.cast} />
                  <span className="tabular w-[52px] flex-none text-right font-mono text-11 text-ink3">{eighths(scene.eighths)}</span>
                </div>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
