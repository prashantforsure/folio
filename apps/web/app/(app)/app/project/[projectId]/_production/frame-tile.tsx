'use client'

import type { ProductionShot } from '@folio/contracts'
import { memo, useState } from 'react'

import { drawnTakes, frameCaption, frameTileOf, takeLabel } from '../../../../../../lib/production/view'
import type { SceneViewProps } from './handlers'
import { Mark } from './mark'

/**
 * One frame per shot, in shot order - `Route - Production v2.dc.html`, the
 * Frames column. A 16:9 tile on the recessed ground, its caption row
 * (`Shot 2 · 5s · Done`), then the takes row (`take 2 of 3 ◂ ▸ · Keep ·
 * Compare`) or, with no drawn take, `no takes yet` / `takes appear when
 * the frame lands`.
 *
 * The tile's state is `frameTileOf` (`lib/production/view.ts`), from the
 * job row and nothing else. A drawn tile is the picture; every other one
 * is the glyph and its line - the generating tile's glyph breathes and a
 * bar runs under it (a percentage when the fold has one; it has none
 * today, so the bar slides).
 *
 * Takes page through the shot's drawn generations, kept first then newest;
 * `Keep` makes the one in view the shot's frame for both routes; `Compare`
 * lays every drawn take out under the tile, the kept one marked.
 */
export const FrameTile = memo(
  ({ shot, view }: { readonly shot: ProductionShot; readonly view: SceneViewProps }) => {
    const { pending, handlers } = view
    const tile = frameTileOf(shot)
    const takes = drawnTakes(shot)
    const [at, setAt] = useState(0)
    const [compare, setCompare] = useState(false)
    const index = Math.min(at, Math.max(0, takes.length - 1))
    const current = takes[index]
    const url = tile.kind === 'done' ? (current?.frame.kind === 'drawn' ? current.frame.url : tile.url) : null

    return (
      <div className="flex min-w-0 max-w-[320px] flex-col gap-[7px]" data-frame-tile={shot.id} data-frame-kind={tile.kind}>
        <div className="folio-frame-tile" data-dashed={tile.dashed ? 'true' : 'false'} data-tone={tile.tone}>
          {url === null ? null : (
            // A plain img: the frame is at a URL the worker wrote, not an asset Next can optimise.
            <img src={url} alt={`Frame for shot ${shot.number}`} />
          )}
          {tile.kind === 'done' ? null : (
            <span className="relative flex flex-col items-center gap-[5px] p-[10px] text-center">
              <Mark glyph={tile.glyph} tone={tile.tone} className={`text-15 ${tile.kind === 'generating' ? 'folio-shimmer' : ''}`} />
              <span
                className="folio-tone-ink text-11 leading-[1.4]"
                data-tone={tile.tone === 'bad' || tile.tone === 'warn' ? tile.tone : 'none'}
                data-frame-label
              >
                {tile.label}
                {tile.progress === null ? '' : ` ${String(tile.progress)}%`}
              </span>
            </span>
          )}
          {tile.kind === 'generating' ? (
            <span className="folio-frame-progress" data-indeterminate={tile.progress === null ? 'true' : 'false'}>
              <span style={tile.progress === null ? undefined : { width: `${String(tile.progress)}%` }} />
            </span>
          ) : null}
        </div>

        <div className="tabular flex min-w-0 items-center gap-[6px] font-mono text-10-5">
          <span className="flex-none whitespace-nowrap text-ink3">{frameCaption(shot)}</span>
          <span className="folio-tone-ink min-w-0 flex-1 truncate whitespace-nowrap" data-tone={tile.tone} data-frame-state>
            {tile.word}
          </span>
        </div>

        {takes.length > 0 && current !== undefined ? (
          <>
            <div className="flex min-w-0 items-center gap-[6px]" data-takes-row>
              <span className="tabular whitespace-nowrap font-mono text-10-5 text-ink3" data-take-label>
                {takeLabel(index, takes.length)}
              </span>
              <button
                type="button"
                title="Previous take"
                aria-label="Previous take"
                data-prev-take
                disabled={index === 0}
                className="folio-shot-tool h-[20px] w-[20px] rounded-[5px] text-10"
                onClick={() => {
                  setAt(index - 1)
                }}
              >
                ◂
              </button>
              <button
                type="button"
                title="Next take"
                aria-label="Next take"
                data-next-take
                disabled={index >= takes.length - 1}
                className="folio-shot-tool h-[20px] w-[20px] rounded-[5px] text-10"
                onClick={() => {
                  setAt(index + 1)
                }}
              >
                ▸
              </button>
              <span className="flex-1" />
              <button
                type="button"
                data-keep-take
                disabled={pending || current.kept}
                title={current.kept ? 'This take is the shot’s frame' : 'Make this take the shot’s frame'}
                className="folio-line-button h-[22px] flex-none rounded-[6px] px-[9px] text-11"
                onClick={() => {
                  handlers.onKeep(shot.sceneNodeId, current.generationId)
                }}
              >
                {current.kept ? 'Kept' : 'Keep'}
              </button>
              <button
                type="button"
                data-compare-takes
                aria-pressed={compare}
                disabled={takes.length < 2}
                className="folio-ghost-button h-[22px] flex-none rounded-[6px] px-[7px] text-11 text-ink3 hover:!bg-transparent hover:!text-ink disabled:opacity-50"
                onClick={() => {
                  setCompare((value) => !value)
                }}
              >
                Compare
              </button>
            </div>
            {compare ? (
              <div className="grid grid-cols-2 gap-[6px]" data-compare-grid>
                {takes.map((take, i) =>
                  take.frame.kind === 'drawn' ? (
                    <button
                      key={take.generationId}
                      type="button"
                      aria-pressed={i === index}
                      title={take.kept ? 'Kept' : takeLabel(i, takes.length)}
                      className={`folio-frame-tile cursor-pointer ${i === index ? '!border-accent' : ''}`}
                      onClick={() => {
                        setAt(i)
                      }}
                    >
                      <img src={take.frame.url} alt={takeLabel(i, takes.length)} />
                      {take.kept ? (
                        <span className="absolute left-[6px] top-[5px] rounded-[5px] bg-frame-badge px-[5px] py-[2px] font-mono text-9 text-frame-badge-ink">kept</span>
                      ) : null}
                    </button>
                  ) : null,
                )}
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-10-5 text-ink3" data-no-takes>
            {tile.noTakesLabel}
          </span>
        )}
      </div>
    )
  },
)
FrameTile.displayName = 'FrameTile'
