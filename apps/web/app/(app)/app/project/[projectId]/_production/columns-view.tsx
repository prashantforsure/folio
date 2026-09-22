'use client'

import type { ProductionScene, Reel, ReelShot } from '@folio/contracts'
import { REEL_STATUS_LABELS, SHOT_STATUS_LABELS } from '@folio/contracts'
import { useState } from 'react'

import { secondsLabel } from '../../../../../../lib/production/camera'
import { reelTiming, sceneFacts, sceneSummary, shotStatusOf } from '../../../../../../lib/production/derive'
import { tableColumns, tableTemplate } from '../../../../../../lib/production/fields'
import { visibleShots } from '../../../../../../lib/production/filters'
import { STATUS_TONE } from '../../../../../../lib/production/menus'
import { useProduction } from './production-context'

/**
 * §4, the Columns view: one card per scene (min 1080px, scrolls), a header
 * with the collapse caret, the location, `Seq. {n}`, the facts pill and the
 * mono summary, the logline under it; then the table - a reel header row,
 * shot rows (checkbox + index, the preview tile, title, status, an
 * inline-editable description with the refusal note and `Read full`,
 * type / duration / character / assignee cells opening their menus) and an
 * empty row. Rows drag-reorder; `＋ New shot` at the foot.
 */
export const ColumnsView = () => {
  const { scenes, prefs } = useProduction()
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const template = tableTemplate(prefs)
  const columns = tableColumns(prefs)
  return (
    <div data-columns-view className="flex flex-col">
      {scenes.map((scene) => {
        const open = !closed.has(scene.sceneNodeId)
        return (
          <section key={scene.sceneNodeId} className="folio-prod-table-card" data-scene-table={scene.number}>
            <div className="flex flex-col gap-[5px] px-[14px] pb-[12px] pt-[13px]">
              <span className="flex items-center gap-[10px]">
                <button
                  type="button"
                  title={open ? 'Collapse' : 'Expand'}
                  aria-label={open ? `Collapse scene ${String(scene.number)}` : `Expand scene ${String(scene.number)}`}
                  aria-expanded={open}
                  onClick={() => {
                    setClosed((current) => {
                      const next = new Set(current)
                      if (next.has(scene.sceneNodeId)) next.delete(scene.sceneNodeId)
                      else next.add(scene.sceneNodeId)
                      return next
                    })
                  }}
                  className="folio-prod-caret-btn"
                  data-open={open ? 'true' : 'false'}
                >
                  ▼
                </button>
                <span className="text-14 font-medium tracking-title">{scene.locationName ?? scene.set}</span>
                <span className="h-[14px] w-px bg-line" aria-hidden="true" />
                <span className="text-13 text-ink2">Seq. {String(scene.number)}</span>
                <span className="folio-prod-pill" data-tone="none">
                  {sceneFacts(scene)}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-11-5 tabular-nums text-ink3">{sceneSummary(scene)}</span>
              </span>
              <span className="pl-[32px] text-12-5 leading-[1.5] text-ink2 [text-wrap:pretty]">{scene.logline}</span>
            </div>
            {open ? (
              <div className="flex flex-col border-t border-line2">
                <div className="folio-prod-thead" style={{ gridTemplateColumns: template }} role="row">
                  {columns.map((column) => (
                    <span key={column.id} role="columnheader">
                      {column.label}
                    </span>
                  ))}
                </div>
                {scene.reels.length === 0 ? <EmptyRow scene={scene} text="No reels in this scene yet." /> : null}
                {scene.reels.map((reel) => (
                  <ReelRows key={reel.id} scene={scene} reel={reel} template={template} />
                ))}
                {scene.reels.length > 0 && scene.reels.every((reel) => visibleShots(reel.shots, prefs).length === 0) ? <EmptyRow scene={scene} text="No shots match the current filter." /> : null}
                <NewShotFoot scene={scene} />
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

const EmptyRow = ({ scene, text }: { readonly scene: ProductionScene; readonly text: string }) => {
  const { act } = useProduction()
  return (
    <div className="flex items-center gap-[10px] border-b border-line2 p-[14px]" data-empty-row>
      <span className="text-12-5 text-ink3">{text}</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => {
          act.proposeShots(scene.sceneNodeId)
        }}
        className="folio-prod-accent-small h-[26px]"
      >
        ✦ Propose shots
      </button>
    </div>
  )
}

const NewShotFoot = ({ scene }: { readonly scene: ProductionScene }) => {
  const { act } = useProduction()
  const last = scene.reels[scene.reels.length - 1] ?? null
  return (
    <button
      type="button"
      data-new-shot
      onClick={() => {
        if (last === null) act.addReel(scene.sceneNodeId)
        else act.addShot(last.id)
      }}
      className="folio-prod-foot"
    >
      ＋ New shot
    </button>
  )
}

const ReelRows = ({ scene, reel, template }: { readonly scene: ProductionScene; readonly reel: Reel; readonly template: string }) => {
  const { prefs } = useProduction()
  const timing = reelTiming(reel)
  const shots = visibleShots(reel.shots, prefs)
  const tone = reel.status === 'rendered' ? 'ok' : reel.status === 'generating' ? 'accent' : reel.status === 'stale' ? 'warn' : 'none'
  return (
    <>
      <div className="flex items-center gap-[10px] border-b border-line2 bg-s1 px-[14px] py-[9px]" data-reel-row={reel.id}>
        <span className="text-12-5 font-medium">{reel.name}</span>
        <span className="folio-prod-pill folio-prod-pill-sm" data-tone={tone}>
          {REEL_STATUS_LABELS[reel.status]}
        </span>
        <span className="folio-prod-time text-11" data-tone={timing.tone}>
          {String(timing.used)} / {String(timing.target)} s
        </span>
      </div>
      {shots.map((shot) => (
        <ShotRow key={shot.id} scene={scene} reel={reel} shot={shot} template={template} />
      ))}
    </>
  )
}

const ShotRow = ({ scene, reel, shot, template }: { readonly scene: ProductionScene; readonly reel: Reel; readonly shot: ReelShot; readonly template: string }) => {
  const { act, picked, detail, dragging, shown, members } = useProduction()
  const status = shotStatusOf(shot)
  const index = reel.shots.findIndex((candidate) => candidate.id === shot.id)
  const selected = picked.has(shot.id)
  const cast = shot.characters.map((entry) => scene.cast.find((member) => member.id === entry.characterId)?.name).filter((name): name is string => name !== undefined)
  const assignee = shot.assigneeId === null ? null : (members.find((member) => member.id === shot.assigneeId)?.name ?? null)
  const tileLabel = shot.frame?.url ? '' : shot.blocked ? 'refused' : shot.frameState === 'empty' ? 'describe the shot' : shot.frameState === 'ready' ? 'ready to draw' : shot.frameState === 'gen' ? 'generating' : shot.frameState === 'queued' ? 'queued' : shot.frameState === 'failed' ? 'failed · refunded' : shot.frameState === 'cancelled' ? 'cancelled' : 'frame'
  return (
    <div
      role="row"
      draggable
      data-shot-row={shot.id}
      data-selected={selected ? 'true' : undefined}
      data-open={detail === shot.id ? 'true' : undefined}
      data-dragging={dragging === shot.id ? 'true' : undefined}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        act.setDragging(shot.id)
      }}
      onDragEnd={() => {
        act.setDragging(null)
      }}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (dragging !== null && dragging !== shot.id) act.moveShot(dragging, reel.id, shot.id)
        act.setDragging(null)
      }}
      onClick={() => {
        act.openDetail(shot.id)
      }}
      className="folio-prod-trow"
      style={{ gridTemplateColumns: template }}
    >
      <span role="cell" className="folio-prod-tcell flex items-center gap-[8px] font-mono text-12 text-ink3">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          title="Select shot"
          aria-label={`Select shot ${String(index + 1)}`}
          onClick={(event) => {
            event.stopPropagation()
            act.togglePick(shot.id)
          }}
          className="folio-prod-check folio-prod-check-sm"
        >
          ✓
        </button>
        {String(index + 1)}
      </span>
      <span role="cell" className="folio-prod-tcell flex items-start gap-[6px] py-[10px]">
        <span className="folio-prod-tile" data-drawn={shot.frame?.url ? 'true' : undefined} data-refused={shot.blocked ? 'true' : undefined} style={shot.frame?.url ? { backgroundImage: `url(${shot.frame.url})` } : undefined}>
          {tileLabel}
        </span>
      </span>
      {shown('title') ? (
        <span role="cell" className="folio-prod-tcell text-13">
          {shot.title ?? `Shot ${String(index + 1)}`}
        </span>
      ) : null}
      {shown('status') ? (
        <span
          role="cell"
          className="folio-prod-tcell"
          onClick={(event) => {
            act.openMenu('status', { kind: 'shot', id: shot.id }, event)
          }}
        >
          <button type="button" aria-haspopup="menu" aria-label={`Status: ${SHOT_STATUS_LABELS[status]}`} className="folio-prod-status" data-tone={status === 'refused' ? 'bad' : undefined}>
            <span className="folio-prod-dot h-[7px] w-[7px]" data-tone={STATUS_TONE[status]} data-pulse={status === 'generating' ? 'true' : undefined} />
            {SHOT_STATUS_LABELS[status]}
            <span className="folio-prod-caret">▾</span>
          </button>
        </span>
      ) : null}
      {shown('desc') ? (
        <span role="cell" className="folio-prod-tcell flex flex-col items-start gap-[5px]">
          <span
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label={`Description of shot ${String(index + 1)}`}
            title="Click to edit"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') (event.target as HTMLElement).blur()
            }}
            onBlur={(event) => {
              act.saveDescription(shot.id, (event.currentTarget.textContent ?? '').trim())
            }}
            className="folio-prod-tdesc"
          >
            {shot.description}
          </span>
          {shot.blocked ? <span className="text-11-5 leading-[1.45] text-bad">{shot.blockReason}</span> : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              act.openDetail(shot.id)
            }}
            className="folio-prod-linklike text-accent"
          >
            Read full
          </button>
        </span>
      ) : null}
      {shown('type') ? (
        <span
          role="cell"
          className="folio-prod-tcell text-12-5 text-ink2"
          onClick={(event) => {
            act.openMenu('type', { kind: 'shot', id: shot.id }, event)
          }}
        >
          <button type="button" aria-haspopup="menu" aria-label={`Shot type: ${shot.shotType}`} className="folio-prod-cellbtn">
            {shot.shotType}
            <span className="folio-prod-caret ml-[6px]">▾</span>
          </button>
        </span>
      ) : null}
      {shown('duration') ? (
        <span role="cell" className="folio-prod-tcell font-mono text-12-5 tabular-nums text-ink2">
          {secondsLabel(shot.durationS).replace(' ', '')}
        </span>
      ) : null}
      {shown('cast') ? (
        <span
          role="cell"
          className="folio-prod-tcell text-12-5"
          onClick={(event) => {
            act.openMenu('cast', { kind: 'shot', id: shot.id }, event)
          }}
        >
          <button type="button" aria-haspopup="menu" aria-label={`Character: ${cast.length === 0 ? 'No character' : cast.join(', ')}`} className="folio-prod-cellbtn" data-empty={cast.length === 0 ? 'true' : undefined}>
            {cast.length === 0 ? 'No character' : cast.join(', ')}
            <span className="folio-prod-caret ml-[6px]">▾</span>
          </button>
        </span>
      ) : null}
      {shown('assignee') ? (
        <span
          role="cell"
          className="folio-prod-tcell text-12-5"
          onClick={(event) => {
            act.openMenu('assignee', { kind: 'shot', id: shot.id }, event)
          }}
        >
          <button type="button" aria-haspopup="menu" aria-label={`Assignee: ${assignee ?? 'Unassigned'}`} className="folio-prod-cellbtn" data-empty={assignee === null ? 'true' : undefined}>
            {assignee ?? 'Unassigned'}
            <span className="folio-prod-caret ml-[6px]">▾</span>
          </button>
        </span>
      ) : null}
    </div>
  )
}
