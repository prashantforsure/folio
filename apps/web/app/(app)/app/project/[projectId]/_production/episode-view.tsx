'use client'

import type { RenderResolution } from '@folio/contracts'
import { memo } from 'react'

import type { EpisodeStats, SceneCoverage } from '../../../../../../lib/production/view'
import { scenePercent, sceneSecondsLabel, sceneStatus, statTiles } from '../../../../../../lib/production/view'

/**
 * The Episode view - `Route - Production v2.dc.html`, `data-screen-label="Episode"`:
 * four stat tiles (scenes with reels, reels, frames done, clips rendered)
 * over the scene table (#, scene, reels, shots, frames with a bar, duration,
 * status, `Open →`). Every number is one `EpisodeStats` and the same
 * coverage rows the strip and the sidebar read, so the tiles, the table
 * and the status bar cannot disagree.
 */
export const EpisodeView = memo(
  ({
    stats,
    coverage,
    resolution,
    onOpen,
  }: {
    readonly stats: EpisodeStats
    readonly coverage: readonly SceneCoverage[]
    readonly resolution: RenderResolution
    /** Open a scene in the Scene view. */
    readonly onOpen: (sceneNodeId: string) => void
  }) => (
    <div data-screen="episode" className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-[14px]">
        <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-stat-tiles>
          {statTiles(stats, coverage, resolution).map((tile) => (
            <div key={tile.label} className="flex flex-col gap-[9px] rounded-[14px] border border-line2 bg-s1 px-[16px] py-[15px]" data-stat-tile={tile.label}>
              <span className="text-11-5 text-ink2">{tile.label}</span>
              <span className={`tabular text-26 font-light tracking-page ${tile.tone === 'ok' ? 'text-ok' : 'text-ink'}`} data-stat-value>
                {tile.value}
              </span>
              <span className="text-11 text-ink3">{tile.note}</span>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-[14px] border border-line2 bg-s1">
          <div className="min-w-[940px]" role="table" aria-label="Scenes">
            <div className="folio-eyebrow flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]" role="row">
              <span className="w-[34px] flex-none">#</span>
              <span className="min-w-0 flex-1">Scene</span>
              <span className="w-[64px] flex-none">Reels</span>
              <span className="w-[64px] flex-none">Shots</span>
              <span className="w-[150px] flex-none">Frames</span>
              <span className="w-[64px] flex-none">Dur.</span>
              <span className="w-[130px] flex-none">Status</span>
              <span className="w-[72px] flex-none" />
            </div>
            {coverage.length === 0 ? (
              <div className="px-[16px] py-[18px] text-12-5 text-ink3">Scenes appear here as you write headings. Nothing to list yet.</div>
            ) : (
              coverage.map((row) => {
                const status = sceneStatus(row.mode)
                return (
                  <div key={row.sceneNodeId} className="folio-ep-row" role="row" data-episode-row={row.sceneNodeId}>
                    <span className="w-[34px] flex-none font-mono text-12 text-ink3">{row.number}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-12-5 uppercase text-ink">{row.heading === '' ? 'No heading yet' : row.heading}</span>
                    <span className="tabular w-[64px] flex-none text-12-5 text-ink2">{row.reels === 0 ? '—' : row.reels}</span>
                    <span className="tabular w-[64px] flex-none text-12-5 text-ink2">{row.shots === 0 ? '—' : row.shots}</span>
                    <span className="flex w-[150px] flex-none items-center gap-[9px]">
                      <span className="h-[4px] flex-1 overflow-hidden rounded-[3px] bg-s3">
                        <span
                          className="folio-tone-fill block h-full rounded-[3px]"
                          data-tone={row.mode === 'finished' ? 'ok' : 'accent'}
                          style={{ width: `${String(scenePercent(row))}%` }}
                        />
                      </span>
                      <span className="tabular flex-none font-mono text-10-5 text-ink3">{row.total === 0 ? '—' : `${String(row.done)}/${String(row.total)}`}</span>
                    </span>
                    <span className="tabular w-[64px] flex-none font-mono text-11-5 text-ink2">{sceneSecondsLabel(row)}</span>
                    <span className="w-[130px] flex-none">
                      <span className="folio-tone-pill" data-size="table" data-tone={status.tone} data-muted={row.mode === 'empty' ? 'true' : 'false'}>
                        {status.label}
                      </span>
                    </span>
                    <span className="flex w-[72px] flex-none justify-end">
                      <button
                        type="button"
                        data-open-scene={row.sceneNodeId}
                        className="folio-line-button h-[26px] rounded-[7px] px-[10px] text-11-5"
                        onClick={() => {
                          onOpen(row.sceneNodeId)
                        }}
                      >
                        Open →
                      </button>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  ),
)
EpisodeView.displayName = 'EpisodeView'
