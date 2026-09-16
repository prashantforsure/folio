'use client'

import { useProductionCoverage } from '../../../../../../lib/production/coverage'
import type { EpisodeStats, SceneCoverage } from '../../../../../../lib/production/view'
import { episodeFrames, sceneBarTone, sceneMeta, scenePercent } from '../../../../../../lib/production/view'
import { count } from '../../../../../../lib/workspace/format'

/**
 * The Production sidebar's two slots - `Route - Production v2.dc.html`:
 * the `Scenes from script` group (one row per scene: number, mono heading,
 * a 3px bar, `2/6 frames · 2 reels`, the selected one lit) and the
 * `Episode frames` widget (`2 / 6`, a bar, `4 frames left to generate`).
 * The layout hands both to the shared `Sidebar` card (`_chrome/sidebar.tsx`).
 *
 * Both read `lib/production/coverage.ts`, the cell the workspace publishes
 * after every write and on every selection, and fall back to the server's
 * rows (the same read the page makes) until the workspace has mounted.
 * Before it mounts no row is lit and a click does nothing - the selection
 * is the page's, and the page has not said yet.
 */

export const ProductionSidebarGroup = ({ initialRows }: { readonly initialRows: readonly SceneCoverage[] }) => {
  const live = useProductionCoverage()
  const rows = live?.rows ?? initialRows
  const selectedId = live?.selectedId ?? null
  return (
    <div className="flex flex-col gap-[4px]" data-production-scenes>
      <div className="flex items-center pb-[6px] pl-[10px] pr-[10px] pt-[2px]">
        <span className="folio-eyebrow flex-1">Scenes from script</span>
        <span className="tabular text-11 text-ink3" data-production-scene-count>
          {count(rows.length)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3">
          Scenes appear here as you write headings. Nothing to list yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
          {rows.map((row) => (
            <li key={row.sceneNodeId}>
              <button
                type="button"
                data-production-scene-row={row.sceneNodeId}
                aria-current={row.sceneNodeId === selectedId ? 'true' : undefined}
                className="folio-prod-scene-row"
                onClick={() => {
                  live?.onPick(row.sceneNodeId)
                }}
              >
                <span className="flex-none pt-[1px] font-mono text-11 text-ink3">{row.number}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
                  <span className="truncate font-mono text-11-5">{row.heading === '' ? 'No heading yet' : row.heading}</span>
                  <span className="h-[3px] overflow-hidden rounded-[3px] bg-s3">
                    <span
                      className="folio-tone-fill block h-full rounded-[3px]"
                      data-tone={sceneBarTone(row)}
                      data-bare={row.mode === 'empty' ? 'true' : 'false'}
                      style={{ width: `${String(scenePercent(row))}%` }}
                    />
                  </span>
                  <span className="tabular text-10-5 text-ink3">{sceneMeta(row)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const ProductionSidebarWidget = ({ initialStats }: { readonly initialStats: EpisodeStats }) => {
  const live = useProductionCoverage()
  const frames = episodeFrames(live?.stats ?? initialStats)
  return (
    <div data-episode-frames-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="text-12 text-ink2">Episode frames</span>
        <span className="tabular text-13 font-medium" data-episode-frames>
          {frames.label}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
        <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(frames.percent)}%` }} />
      </div>
      <span className="text-11 text-ink3" data-episode-frames-note>
        {frames.note}
      </span>
    </div>
  )
}
