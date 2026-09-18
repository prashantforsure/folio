'use client'

import type { LocationRow, LocationSceneRow, ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'

import { citeOf } from '../../../../../../lib/characters/figures'
import { breakdownCsvOf } from '../../../../../../lib/locations/sheet'
import { daysLabel, metaLine, storyTimeLabel } from '../../../../../../lib/locations/view'
import { ABSENT, eighths } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRow } from './locations-workspace'
import { CastStack, QuadrantBoxes, StatusDot } from './set-parts'

/**
 * The Scenes here view - the breakdown by set, as the rebuild draws it
 * (2026-09-18): one `--s1` section per **primary set**, capped at 1080px,
 * with every scene at the set or under any of its sub-sets listed once
 * (the v2 pass listed a sub-set's scene twice, under the sub-set and the
 * parent). The head: the status dot, the name (a link - it opens the
 * drawer), then the numbers a schedule is built from - `9 scenes · 41 2/8
 * pp`, the quadrant `INT D 3 · INT N 2 · EXT D 1 · EXT N 3`, the shooting
 * days - and `CSV` for this set's breakdown. A row per scene: `E1 Sc 1` as
 * a link into the script, `INT`/`EXT`, the light square with the time of
 * day written beside it, the Timeline's story day, the heading over the
 * synopsis, the sub-set it is in (when it is), the cast, the eighths.
 *
 * A record with no scene prints the README's line where its rows would
 * be. The rows follow the toolbar's filter and the find field; a sub-set
 * whose parent is not shown gets a section of its own.
 */
export const ScenesView = ({
  projectId,
  shape,
  shown,
  episodes,
  selectedId,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly shown: readonly LocationRow[]
  readonly episodes: readonly EpisodeRow[]
  readonly selectedId: string | null
  readonly onShowAll: () => void
}) => {
  const shownIds = new Set(shown.map((row) => row.id))
  const sections = shown.filter((row) => row.parentId === null || !shownIds.has(row.parentId))
  const series = episodes.length > 1

  const exportCsv = (row: LocationRow): void => {
    const url = URL.createObjectURL(new Blob([breakdownCsvOf(row)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${row.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'set'}-breakdown.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-scenes-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
      <div className="flex max-w-[1080px] flex-col gap-[14px]">
        {shown.length === 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-scenes-filtered-empty>
            No location matches that filter.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : null}
        {sections.map((row) => (
          <section
            key={row.id}
            data-scenes-group={row.id}
            aria-current={row.id === selectedId ? 'true' : undefined}
            className="flex flex-col overflow-hidden rounded-card border border-line2 bg-s1"
          >
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-b border-line2 px-[15px] py-[11px]">
              <StatusDot status={row.status} />
              <Link
                href={locationHref(projectId, row.id)}
                data-scenes-open={row.id}
                className="min-w-0 truncate text-13-5 font-medium tracking-title text-ink no-underline hover:text-accent hover:no-underline"
              >
                {row.name}
              </Link>
              <span className="tabular flex-none font-mono text-11 text-ink3" data-scenes-meta>
                {metaLine(row)}
              </span>
              <span className="flex-1" />
              {row.rollup.scenes === 0 ? null : <QuadrantBoxes quadrant={row.rollupQuadrant} attr="data-scenes-quadrant" />}
              <span className="tabular flex-none font-mono text-10-5 text-ink3" data-scenes-days title="Shooting days scheduled at this set, and the roll-up over its sub-sets">
                {row.rollup.shootingDays === 0 ? 'no days scheduled' : daysLabel(row.scheduledDays, row.rollup.shootingDays)}
              </span>
              {row.scenes.length === 0 ? null : (
                <button
                  type="button"
                  data-scenes-export
                  title={`This set's breakdown as CSV, one row per scene`}
                  onClick={() => {
                    exportCsv(row)
                  }}
                  className="folio-ghost-button flex h-[24px] items-center gap-[5px] rounded-[7px] px-[7px] text-11 text-ink3 hover:!text-ink2"
                >
                  <Icon name="export" size={12} strokeWidth={1.4} />
                  CSV
                </button>
              )}
            </div>
            {row.scenes.length === 0 ? (
              <p className="m-0 px-[15px] py-[10px] text-12 text-ink3" data-scenes-none>
                Not on the page yet
              </p>
            ) : (
              row.scenes.map((scene) => <SceneRow key={scene.scene.sceneNodeId} projectId={projectId} shape={shape} scene={scene} row={row} series={series} />)
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

const SceneRow = ({
  projectId,
  shape,
  scene,
  row,
  series,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly scene: LocationSceneRow
  readonly row: LocationRow
  readonly series: boolean
}) => {
  const ref = citeOf(projectId, shape, scene.scene)
  const time = storyTimeLabel(scene)
  return (
    <div data-scene-row={scene.scene.sceneNodeId} className="flex min-w-0 items-center gap-[12px] border-b border-line2 px-[15px] py-[9px] last:border-b-0 hover:bg-s2">
      <Link href={ref.href} data-cite-link className="folio-cite w-[60px] flex-none text-center no-underline hover:border-accent hover:text-accent hover:no-underline">
        {series ? ref.label : `Sc ${String(scene.scene.number)}`}
      </Link>
      <span className="tabular w-[28px] flex-none font-mono text-10-5 text-ink3" data-scene-ie>
        {scene.ie}
      </span>
      <span className="flex w-[84px] flex-none items-center gap-[6px]" title={scene.light === 'unspecified' ? 'No time of day' : scene.light}>
        <span className="folio-tone-fill h-[7px] w-[7px] flex-none rounded-[2px]" data-tone={scene.light === 'day' ? 'warn' : scene.light === 'night' ? 'accent' : undefined} />
        <span className="truncate font-mono text-10-5 uppercase text-ink3" data-scene-time>
          {scene.timeOfDay ?? ABSENT}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex min-w-0 items-baseline gap-[8px]">
          <span className="truncate font-mono text-12 uppercase">{scene.scene.heading === '' ? 'No heading yet' : scene.scene.heading}</span>
          {time === '' ? null : (
            <span className="flex-none font-mono text-10 text-ink3" data-scene-story title="The Timeline's story time for this scene">
              {time}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-[8px] text-11-5 text-ink3">
          {scene.at.id === row.id ? null : (
            <Link href={locationHref(projectId, scene.at.id)} data-scene-at={scene.at.id} className="flex-none text-11 text-ink3 no-underline hover:text-accent hover:underline">
              in {scene.at.name}
            </Link>
          )}
          <span className="truncate">{scene.gist ?? 'No synopsis yet'}</span>
        </span>
      </span>
      <CastStack people={scene.cast} hrefOf={(id) => characterHref(projectId, id)} max={4} />
      <span className="tabular w-[44px] flex-none text-right font-mono text-11 text-ink3">{eighths(scene.eighths)}</span>
    </div>
  )
}
