'use client'

import type { ProjectId, ResearchClipId, ResearchClipRow, ResearchSourceId, ResearchSourceRow } from '@folio/contracts'
import { useState } from 'react'

import type { FilingTargets } from '../../../../../../lib/research/server'
import { clipSourceLine, filingLabel } from '../../../../../../lib/research/view'
import type { Run } from '../_chrome/use-run'
import { ClipMenu } from './clip-menu'

/**
 * Every clip in the project - `Route - Research v2.dc.html`'s `Clips` view:
 * an 860px column of cards, 10px apart; each the amber `❝`, the line at
 * 14px/1.6, then under it the mono `Interview · Sunita Pawar` source line,
 * the filing chips in `--accent-bg`, and - only while unfiled - the dashed
 * `Send to…`. Oldest first, as they were cut.
 *
 * A chip and `Send to…` both open the clip's menu (`clip-menu.tsx`): the
 * mockup's chips are plain spans, but a filed clip needs a door to a second
 * filing or to unfiling, and the chip is where the eye already is.
 */
export const ClipsView = ({
  projectId,
  clips,
  sourcesById,
  targets,
  run,
}: {
  readonly projectId: ProjectId
  readonly clips: readonly ResearchClipRow[]
  readonly sourcesById: ReadonlyMap<ResearchSourceId, ResearchSourceRow>
  readonly targets: FilingTargets
  readonly run: Run
}) => {
  const [open, setOpen] = useState<ResearchClipId | null>(null)
  return (
    <div data-clips-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="flex max-w-[860px] flex-col gap-[10px]">
        {clips.length === 0 ? (
          <p className="m-0 pt-[8px] text-13 leading-[1.55] text-ink3" data-clips-empty>
            No clips yet. Open a source and highlight a line to cut one.
          </p>
        ) : null}
        {clips.map((clip) => {
          const source = sourcesById.get(clip.sourceId)
          return (
            <div key={clip.id} className="folio-clip-card" data-clip-card={clip.id}>
              <div className="flex min-w-0 gap-[11px]">
                <span aria-hidden="true" className="folio-mark flex-none text-15 leading-[1.4] text-warn">
                  ❝
                </span>
                <p className="m-0 min-w-0 flex-1 text-14 leading-[1.6] text-ink" style={{ textWrap: 'pretty' }}>
                  {clip.text}
                </p>
              </div>
              <div className="relative flex flex-wrap items-center gap-[9px] pl-[26px]">
                <span className="whitespace-nowrap font-mono text-10-5 text-ink3" data-clip-source>
                  {source === undefined ? 'Source removed' : clipSourceLine(source)}
                </span>
                <span className="flex-1" />
                {clip.filings.map((filing) => (
                  <button
                    key={filing.id}
                    type="button"
                    data-filing-chip={filing.id}
                    title="Where this clip is filed"
                    onClick={() => {
                      setOpen((current) => (current === clip.id ? null : clip.id))
                    }}
                    className="folio-filing-chip"
                  >
                    {filingLabel(filing)}
                  </button>
                ))}
                {clip.filings.length === 0 ? (
                  <button
                    type="button"
                    data-send-to={clip.id}
                    aria-expanded={open === clip.id}
                    onClick={() => {
                      setOpen((current) => (current === clip.id ? null : clip.id))
                    }}
                    className="folio-dashed-button h-[26px] rounded-[8px] px-[11px]"
                  >
                    Send to…
                  </button>
                ) : null}
                {open === clip.id ? (
                  <ClipMenu projectId={projectId} clip={clip} targets={targets} run={run} onClose={() => setOpen(null)} align="right" />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
