'use client'

import type { NodeId } from '@folio/script'

import { SCENE_STATUS_LABEL, sceneStatus } from '../../../../../../lib/scenes/canvas'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { count } from '../../../../../../lib/workspace/format'
import { CastChip, eighthsLabel, hasSynopsis, sceneNo, timeLabel } from './scene-parts'

/**
 * The `Scene list` view: the mockup's table - one `--s1` card with a sticky `--sunk`
 * header row and a hairline under every row. The columns are the route's
 * own (I/E and Time where the mockup folds them into `Day / Night`, and
 * Lines and Status which it does not draw); each is read from the table
 * the loader names. A click, Enter or Space opens the detail dialog -
 * the ruling's "detail card in place" (2026-09-11).
 */
export const ListView = ({
  scenes,
  synopsisOf,
  selected,
  onOpen,
}: {
  readonly scenes: readonly SceneCard[]
  readonly synopsisOf: (card: SceneCard) => string | null
  readonly selected: NodeId | null
  /** Select the scene and open its detail dialog - the ruling's "detail card in place". */
  readonly onOpen: (id: NodeId) => void
}) => (
  <div className="min-h-0 flex-1 overflow-auto px-[20px] pb-[20px] pt-[4px]">
    <div className="min-w-[960px] overflow-hidden rounded-[14px] border border-line2 bg-s1">
      <div className="folio-eyebrow sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
        <span className="w-[40px] flex-none">#</span>
        <span className="w-[260px] flex-none">Heading</span>
        <span className="w-[56px] flex-none">I/E</span>
        <span className="w-[80px] flex-none">Time</span>
        <span className="w-[60px] flex-none">Length</span>
        <span className="w-[56px] flex-none">Lines</span>
        <span className="w-[150px] flex-none">Cast</span>
        <span className="min-w-0 flex-1">Description</span>
        <span className="w-[64px] flex-none text-right">Status</span>
      </div>
      {scenes.map((card) => {
        const id = card.derived.sceneNodeId
        const synopsis = synopsisOf(card)
        const status = sceneStatus(synopsis)
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            data-scene-row={id}
            data-scene-status={status}
            aria-pressed={selected === id}
            onClick={() => {
              onOpen(id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(id)
              }
            }}
            className={`flex cursor-pointer items-center gap-[12px] border-b border-line2 px-[16px] py-[12px] hover:bg-hover ${selected === id ? 'bg-s2' : ''}`}
          >
            <span className="flex w-[40px] flex-none items-center gap-[7px]">
              <span className={`h-[6px] w-[6px] flex-none rounded-full ${status === 'ready' ? 'bg-ok' : 'bg-warn'}`} />
              <span className="font-mono text-12 text-ink2">{sceneNo(card.derived.number)}</span>
            </span>
            <span className="w-[260px] flex-none truncate font-mono text-12-5 uppercase text-ink">{card.derived.heading}</span>
            <span className="w-[56px] flex-none font-mono text-12 text-ink2">{card.derived.reading.ie}</span>
            <span className="w-[80px] flex-none truncate text-13 text-ink2">{timeLabel(card)}</span>
            <span className="tabular w-[60px] flex-none font-mono text-12 text-ink2" data-scene-eighths>
              {eighthsLabel(card)}
            </span>
            <span className="tabular w-[56px] flex-none font-mono text-12 text-ink2">{count(card.derived.lines)}</span>
            <span className="flex w-[150px] flex-none flex-wrap gap-[5px] overflow-hidden">
              {card.cast.map((member) => (
                <CastChip key={member.id} name={member.name} small />
              ))}
            </span>
            <span className={`min-w-0 flex-1 truncate text-13 leading-[1.5] ${hasSynopsis(synopsis) ? 'text-ink2' : 'text-ink3'}`}>
              {hasSynopsis(synopsis) ? synopsis : 'No synopsis yet'}
            </span>
            <span className={`w-[64px] flex-none text-right text-11 ${status === 'ready' ? 'text-ok' : 'text-warn'}`}>{SCENE_STATUS_LABEL[status]}</span>
          </div>
        )
      })}
    </div>
  </div>
)
