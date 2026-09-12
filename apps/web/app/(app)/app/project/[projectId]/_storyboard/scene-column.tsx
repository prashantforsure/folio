'use client'

import type { ShotEdit, ShotRow, StoryboardScene } from '@folio/contracts'
import type { LabelBook, MentionLabel } from '@folio/script'
import { useState } from 'react'

import { ABSENT } from '../../../../../../lib/workspace/format'
import { Description, FrameTile, ShotEditor, lensLabel, sizeShort } from './shot-parts'

/**
 * One scene column of the board view. `Route - Storyboard.dc.html`'s
 * "STORYBOARD: scene columns": 322px, a 3px clapper stripe (accent when
 * selected, ink otherwise), the four-cell header (Scene / I/E / Location /
 * D/N), `Open board` and `Auto board`, then the shots as 16:9 frames or the
 * "No shots yet" state with its miniature grid.
 *
 * What is drawn and where it comes from: the scene number, I/E, set and
 * time of day are `scene_derivations` through `StoryboardScene`; each shot
 * is a `shots` row with its frame folded from the job row. The location
 * cell prints the heading's *set* text, not the record's name - the record
 * is what the establishing shot mentions, and the header is the slugline as
 * written, as the bundle prints `Community Pitch`.
 *
 * `Open board` selects the scene and switches to the canvas; `Auto board`
 * runs the proposer. A proposal is drawn as a shot with an amber dashed
 * frame and `Accept` / `Discard`; editing one accepts it.
 */

export type ShotHandlers = {
  readonly onPropose: (sceneNodeId: string) => void
  readonly onAcceptAll: (sceneNodeId: string, shotIds: readonly string[]) => void
  readonly onAccept: (sceneNodeId: string, shotId: string) => void
  readonly onDiscard: (sceneNodeId: string, shotId: string) => void
  readonly onSave: (shotId: string, edit: ShotEdit) => void
  readonly onMove: (shotId: string, direction: 'up' | 'down') => void
  readonly onDraw: (shotId: string) => void
  readonly onCancelFrame: (jobId: string) => void
}

export const ShotCard = ({
  shot,
  index,
  count,
  labels,
  book,
  cost,
  available,
  pending,
  handlers,
}: {
  readonly shot: ShotRow
  readonly index: number
  readonly count: number
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly cost: number
  readonly available: number
  readonly pending: boolean
  readonly handlers: ShotHandlers
}) => {
  const [editing, setEditing] = useState(false)
  const proposed = shot.state === 'proposed'

  if (editing) {
    return (
      <div data-shot={shot.id} data-shot-state={shot.state}>
        <ShotEditor
          shot={shot}
          labels={labels}
          book={book}
          pending={pending}
          onCancel={() => {
            setEditing(false)
          }}
          onSave={(edit) => {
            handlers.onSave(shot.id, edit)
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div data-shot={shot.id} data-shot-state={shot.state} data-shot-number={shot.number} className="flex flex-col gap-[6px]">
      <FrameTile
        shot={shot}
        cost={cost}
        available={available}
        pending={pending}
        onDraw={() => {
          handlers.onDraw(shot.id)
        }}
        onCancel={handlers.onCancelFrame}
      >
        <span
          className={`rounded-chrome px-[6px] py-[2px] font-mono text-8-5 ${
            shot.frame.kind === 'drawn' ? 'bg-[rgba(0,0,0,.38)] text-[rgba(255,255,255,.8)]' : 'border border-line2 text-ink3'
          }`}
        >
          {sizeShort(shot)} · {lensLabel(shot.lensMm)}
        </span>
      </FrameTile>
      <p className="m-0 text-11 leading-[1.5] text-ink2" data-shot-description>
        <Description content={shot.description} book={book} />
      </p>
      <div className="flex flex-wrap items-center gap-[4px]">
        {proposed ? (
          <>
            <button
              type="button"
              data-accept-shot
              disabled={pending}
              className="folio-focus rounded-chrome bg-accent px-[8px] py-[3px] text-10-5 font-semibold text-accent-ink disabled:opacity-60"
              onClick={() => {
                handlers.onAccept(shot.sceneNodeId, shot.id)
              }}
            >
              Accept
            </button>
            <button
              type="button"
              data-discard-shot
              disabled={pending}
              className="folio-small-button disabled:opacity-60"
              onClick={() => {
                handlers.onDiscard(shot.sceneNodeId, shot.id)
              }}
            >
              Discard
            </button>
          </>
        ) : (
          <button
            type="button"
            data-delete-shot
            disabled={pending}
            title="Remove this shot"
            className="folio-small-button disabled:opacity-60"
            onClick={() => {
              handlers.onDiscard(shot.sceneNodeId, shot.id)
            }}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          data-edit-shot
          disabled={pending}
          className="folio-small-button disabled:opacity-60"
          onClick={() => {
            setEditing(true)
          }}
        >
          <span className="font-glyph text-9 opacity-70">✎</span> Edit
        </button>
        <div className="flex-1" />
        <button
          type="button"
          data-move-shot="up"
          title="Move up"
          disabled={pending || index === 0}
          className="folio-status-button disabled:opacity-40"
          onClick={() => {
            handlers.onMove(shot.id, 'up')
          }}
        >
          ↑
        </button>
        <button
          type="button"
          data-move-shot="down"
          title="Move down"
          disabled={pending || index === count - 1}
          className="folio-status-button disabled:opacity-40"
          onClick={() => {
            handlers.onMove(shot.id, 'down')
          }}
        >
          ↓
        </button>
      </div>
    </div>
  )
}

const Cell = ({ label, children, mono = true }: { readonly label: string; readonly children: string; readonly mono?: boolean }) => (
  <div className="flex min-w-0 flex-col gap-[2px]">
    <span className="text-9 font-semibold uppercase tracking-[.1em] text-ink3">{label}</span>
    <span className={`truncate ${mono ? 'font-mono text-13' : 'font-serif text-[22px] font-medium leading-none'}`}>{children}</span>
  </div>
)

const sceneNo = (number: number): string => String(number).padStart(2, '0')

export const SceneColumn = ({
  scene,
  selected,
  labels,
  book,
  cost,
  available,
  pending,
  handlers,
  onSelect,
  onOpenBoard,
}: {
  readonly scene: StoryboardScene
  readonly selected: boolean
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly cost: number
  readonly available: number
  readonly pending: boolean
  readonly handlers: ShotHandlers
  readonly onSelect: () => void
  readonly onOpenBoard: () => void
}) => {
  const proposals = scene.shots.filter((shot) => shot.state === 'proposed')
  const accepted = scene.shots.length - proposals.length

  return (
    // The column is a selection target; its buttons stop the click from
    // re-selecting, and they are the keyboard path - selecting is a pointer
    // convenience, the same as clicking a card on the Scenes route.
    <div
      data-scene-column={scene.sceneNodeId}
      data-scene-number={scene.number}
      data-selected={selected ? 'true' : 'false'}
      data-column-shots={accepted}
      onClick={onSelect}
      className={`flex w-[322px] flex-none snap-start flex-col overflow-hidden rounded-chrome border bg-sheet ${
        selected ? 'border-accent-line' : 'border-line'
      }`}
    >
      <div className={`h-[3px] flex-none ${selected ? 'bg-accent' : 'bg-ink'}`} />
      <div className="flex flex-col gap-[11px] border-b border-line2 px-[13px] pb-[13px] pt-[12px]">
        <div className="grid grid-cols-2 gap-[10px]">
          <Cell label="Scene" mono={false}>
            {sceneNo(scene.number)}
          </Cell>
          <Cell label="I/E">{scene.ie === null ? ABSENT : scene.ie.toUpperCase()}</Cell>
          <Cell label="Location">{scene.set === '' ? ABSENT : scene.set}</Cell>
          <Cell label="D/N">{scene.timeOfDay ?? ABSENT}</Cell>
        </div>
        <div className="flex gap-[8px]">
          <button
            type="button"
            data-open-board
            className="folio-focus flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line px-[8px] py-[6px] text-11-5 text-ink2 hover:bg-hover hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              onOpenBoard()
            }}
          >
            <span className="font-glyph text-10 opacity-70">⛶</span>Open board
          </button>
          {scene.shots.length > 0 ? (
            <button
              type="button"
              data-auto-board
              disabled={pending}
              className="folio-focus flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-accent-line px-[8px] py-[6px] text-11-5 font-medium text-accent hover:bg-accent-bg disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                handlers.onPropose(scene.sceneNodeId)
              }}
            >
              <span className="font-glyph text-10">✦</span>Auto board
            </button>
          ) : null}
        </div>
        {proposals.length > 0 ? (
          <div className="flex items-center justify-between gap-[8px] rounded-chrome border border-note bg-note-bg px-[8px] py-[5px]" data-proposal-bar>
            <span className="text-10-5 text-note">
              {proposals.length} proposed · accept or edit
            </span>
            <button
              type="button"
              data-accept-all
              disabled={pending}
              className="folio-focus rounded-chrome bg-accent px-[8px] py-[3px] text-10-5 font-semibold text-accent-ink disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                handlers.onAcceptAll(
                  scene.sceneNodeId,
                  proposals.map((shot) => shot.id),
                )
              }}
            >
              Accept all
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[180px] flex-col gap-[11px] p-[12px]">
        {scene.shots.length > 0 ? (
          scene.shots.map((shot, index) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              index={index}
              count={scene.shots.length}
              labels={labels}
              book={book}
              cost={cost}
              available={available}
              pending={pending}
              handlers={handlers}
            />
          ))
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-[12px] px-[12px] pb-[18px] pt-[22px]" data-no-shots>
            <div className="relative aspect-video w-[132px] overflow-hidden rounded-chrome border border-dashed border-line bg-hover">
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, var(--line2) 1px, transparent 1px), linear-gradient(to bottom, var(--line2) 1px, transparent 1px)',
                  backgroundSize: '33.34% 33.34%',
                }}
              />
              <span className="absolute left-1/2 top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-line bg-accent-bg" />
            </div>
            <div className="flex flex-col items-center gap-[3px]">
              <span className="font-serif text-16 font-medium">No shots yet</span>
              <span className="max-w-[24ch] text-center text-10-5 leading-[1.5] text-ink3">
                Auto board reads the scene text and proposes a first shot list.
              </span>
            </div>
            <button
              type="button"
              data-auto-board
              disabled={pending}
              className="folio-focus flex items-center gap-[6px] rounded-chrome bg-accent px-[12px] py-[6px] text-11-5 font-semibold text-accent-ink disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                handlers.onPropose(scene.sceneNodeId)
              }}
            >
              <span className="font-glyph text-10">✦</span>Auto board
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
