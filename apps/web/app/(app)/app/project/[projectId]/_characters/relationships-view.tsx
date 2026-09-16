'use client'

import type { CharacterMap, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useMemo } from 'react'

import type { CastFigure } from '../../../../../../lib/characters/cast'
import { edgeWidth, graphEdges, graphLayout, neverShare } from '../../../../../../lib/characters/cast'
import { characterHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { CastMark } from './cast-mark'

/**
 * The Relationships view - `Route - Characters v2.dc.html`: a legend
 * (`Line weight is shared scenes.` and the amber dash for `never share a
 * scene`), the 540px dotted ground (`--sunk`, `--dot` every 22px) with an
 * SVG of edges under absolutely placed node pills - a 26px gradient disc,
 * the short name over `N scenes` - and each edge's `21 sc` label at 38%
 * along it; then the finding card under it.
 *
 * Every number is the map's (`buildMap`, `lib/characters/figures.ts`):
 * an edge is two characters' shared scenes, its width the mockup's
 * `max(1.5, min(7, n / 3.2))`. Where the nodes sit is computed
 * (`graphLayout`, deterministic) - the mockup hand-places its six. The
 * dashed edge is drawn between principals who never share a scene; the
 * finding names the first such pair. The mockup's second sentence there is
 * bespoke prose about its story; the app writes what it can count.
 *
 * A node links to the drawer; the selected record's node has the
 * `--accent` border.
 */
export const RelationshipsView = ({
  projectId,
  figures,
  map,
  episodes,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly figures: readonly CastFigure[]
  readonly map: CharacterMap
  readonly episodes: number
  readonly selectedId: string | null
}) => {
  const byId = useMemo(() => new Map(figures.map((figure) => [figure.id, figure])), [figures])
  const groups = useMemo(() => map.columns.map((column) => byId.get(column.id)?.group ?? 'supporting'), [byId, map.columns])
  const points = useMemo(() => graphLayout(map), [map])
  const edges = useMemo(() => graphEdges(map, groups), [groups, map])
  const finding = useMemo(() => neverShare(map, groups), [groups, map])

  if (map.columns.length === 0) {
    return (
      <div data-relationships-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
        <p className="m-0 text-12-5 text-ink3" data-relationships-empty>
          Nobody is on the page yet. Relationships are counted from scenes; write one and the graph draws itself.
        </p>
      </div>
    )
  }

  const a = finding === null ? null : map.columns[finding[0]]
  const b = finding === null ? null : map.columns[finding[1]]

  return (
    <div data-relationships-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-center gap-[14px]">
          <span className="text-12-5 text-ink2">Line weight is shared scenes.</span>
          <span className="flex items-center gap-[7px] text-12 text-ink3">
            <span className="h-[2px] w-[16px] rounded-[2px] bg-warn" />
            never share a scene
          </span>
        </div>

        <div className="folio-cast-ground" data-relationships-ground>
          <svg viewBox="0 0 1000 540" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
            {edges.map((edge) => {
              const p = points[edge.a]
              const q = points[edge.b]
              if (p === undefined || q === undefined) return null
              return (
                <line
                  key={`${String(edge.a)}-${String(edge.b)}`}
                  x1={p.x * 10}
                  y1={p.y * 5.4}
                  x2={q.x * 10}
                  y2={q.y * 5.4}
                  stroke={edge.shared === 0 ? 'var(--warn)' : 'var(--s3)'}
                  strokeWidth={edgeWidth(edge.shared)}
                  strokeDasharray={edge.shared === 0 ? '7 7' : undefined}
                  strokeLinecap="round"
                />
              )
            })}
          </svg>
          {edges.map((edge) => {
            const p = points[edge.a]
            const q = points[edge.b]
            if (p === undefined || q === undefined) return null
            return (
              <span
                key={`label-${String(edge.a)}-${String(edge.b)}`}
                data-edge-label={edge.shared}
                className="folio-cite absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${String(p.x + (q.x - p.x) * 0.38)}%`,
                  top: `${String(p.y + (q.y - p.y) * 0.38)}%`,
                  color: edge.shared === 0 ? 'var(--warn)' : undefined,
                }}
              >
                {edge.shared === 0 ? 'none' : `${String(edge.shared)} sc`}
              </span>
            )
          })}
          {map.columns.map((column, index) => {
            const figure = byId.get(column.id)
            const point = points[index]
            if (figure === undefined || point === undefined) return null
            return (
              <Link
                key={column.id}
                href={characterHref(projectId, column.id)}
                data-graph-node={column.id}
                aria-current={column.id === selectedId ? 'true' : undefined}
                className="folio-cast-node"
                style={{ left: `${String(point.x)}%`, top: `${String(point.y)}%` }}
              >
                <CastMark initial={figure.initial} hue={figure.hue} size={26} radius="full" fontSize={10} />
                <span className="flex flex-col items-start gap-[1px]">
                  <span className="text-12-5 font-medium">{figure.short}</span>
                  <span className="tabular text-10 text-ink3">
                    {column.scenes} {column.scenes === 1 ? 'scene' : 'scenes'}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>

        {a !== undefined && b !== undefined && a !== null && b !== null ? (
          <div data-relationships-finding className="flex items-start gap-[12px] rounded-card border border-line2 bg-s1 px-[14px] py-[12px]">
            <span className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full bg-warn" />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-13-5 font-medium tracking-title">
                {byId.get(a.id)?.short ?? a.name} and {byId.get(b.id)?.short ?? b.name} never share a scene.
              </span>
              <span className="text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                Two principals - {a.scenes} and {b.scenes} scenes - with no contact across {episodes} {episodes === 1 ? 'episode' : 'episodes'}.
              </span>
            </div>
            <Link href={projectRouteHref(projectId, 'timeline')} className="flex-none pt-[2px] text-12">
              Timeline →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
