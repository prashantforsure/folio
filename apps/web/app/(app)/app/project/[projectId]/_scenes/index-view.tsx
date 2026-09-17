'use client'

import type { NodeId } from '@folio/script'

import { SCENE_STATUS_LABEL, sceneStatus } from '../../../../../../lib/scenes/canvas'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { eighthsLabel, hasSynopsis, pageLabel, sceneNo, timeLabel } from './scene-parts'

/**
 * The `Index cards` view: the mockup's index card - `--sunk`, a 3px bar along the
 * top, the mono number and heading, the synopsis, a tag and `pg N · 4/8` -
 * in a flat grid. The mockup groups them under act columns coloured by
 * act, character or storyline; acts are not a table and there is no
 * colour-by yet, so the bar is the status (`--ok` once a synopsis is
 * written, `--warn` until then) and the grid is the sequence. A click,
 * Enter or Space opens the detail dialog - the ruling's "detail card in
 * place" (2026-09-11).
 */
export const IndexView = ({
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
  <div className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px] pt-[4px]">
    <div className="grid items-start gap-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {scenes.map((card) => {
        const id = card.derived.sceneNodeId
        const synopsis = synopsisOf(card)
        const status = sceneStatus(synopsis)
        return (
          <article
            key={id}
            data-index-card={id}
            data-scene-status={status}
            role="button"
            tabIndex={0}
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
            className={`flex cursor-pointer flex-col overflow-hidden rounded-[12px] border bg-sunk transition-[border-color] hover:border-line ${selected === id ? 'border-line' : 'border-line2'}`}
          >
            <span className={`h-[3px] ${status === 'ready' ? 'bg-ok' : 'bg-warn'}`} />
            <div className="flex flex-col gap-[8px] p-[12px]">
              <div className="flex items-baseline gap-[8px]">
                <span className="flex-none font-mono text-11 text-ink3">{sceneNo(card.derived.number)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-12 uppercase text-ink">{card.derived.heading}</span>
              </div>
              <p className={`m-0 min-h-[40px] text-12-5 leading-[1.55] ${hasSynopsis(synopsis) ? 'text-ink2' : 'text-ink3'}`}>
                {hasSynopsis(synopsis) ? synopsis : 'No synopsis yet — open the scene and write one.'}
              </p>
              <div className="flex items-center gap-[8px]">
                <span className="text-11 text-ink3">
                  {card.derived.reading.ie} · {timeLabel(card)}
                </span>
                <span className="flex-1" />
                <span className={`text-10-5 ${status === 'ready' ? 'text-ok' : 'text-warn'}`}>{SCENE_STATUS_LABEL[status]}</span>
                <span className="tabular font-mono text-10-5 text-ink3">
                  pg {pageLabel(card)} · {eighthsLabel(card)}
                </span>
              </div>
              {card.cast.length === 0 ? null : (
                <div className="flex flex-wrap gap-[4px]">
                  {card.cast.map((member) => (
                    <span key={member.id} className="whitespace-nowrap text-10-5 text-accent">
                      @{member.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  </div>
)
