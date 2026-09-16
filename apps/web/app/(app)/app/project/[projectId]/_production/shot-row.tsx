'use client'

import type { ProductionShot } from '@folio/contracts'
import type { LabelBook } from '@folio/script'
import { memo, useState } from 'react'

import { quotePieces, secondsLabel, shotChips, shotRowTone } from '../../../../../../lib/production/view'
import { ShotEditor } from '../_storyboard/shot-parts'
import type { SceneViewProps } from './handlers'
import { Mark } from './mark'

/**
 * One shot of a reel - `Route - Production v2.dc.html`, the Shots column:
 * the number chip and the seconds field, then the size · movement · angle
 * chips over the description, then `↑ ↓ ✕`. A proposal is the same row on
 * an amber dashed ground with `Proposed from the scene · Accept · Discard`
 * under its text; a refused shot is the row in red with the refusal block
 * and `Suggest rewrite` under it.
 *
 * The description prints the Storyboard's inline content: a mention as an
 * accent chip, a spoken line in full ink italic (`quotePieces`), and the
 * mockup's placeholder in `--ink3` while there is nothing to print. A
 * click on the text or a chip opens the Storyboard's editor in the row -
 * every field of the spec, whole - unless the reel is finalized.
 */

const PLACEHOLDER = 'Describe the shot. Type @ for cast, quote spoken lines.'

export const ShotDescription = ({ shot, book }: { readonly shot: ProductionShot; readonly book: LabelBook }) => (
  <>
    {shot.description.map((run, index) =>
      run.kind === 'text' ? (
        quotePieces(run.text).map((piece, at) =>
          piece.kind === 'quote' ? (
            <span key={`${String(index)}-${String(at)}`} className="folio-shot-quote">
              {piece.text}
            </span>
          ) : (
            <span key={`${String(index)}-${String(at)}`}>{piece.text}</span>
          ),
        )
      ) : (
        <span key={index} className="rounded-[4px] bg-accent-bg px-[5px] py-[1px] text-accent" data-mention={run.target.entity}>
          @{book.labelFor(run.target) ?? '?'}
        </span>
      ),
    )}
  </>
)

export const ShotRow = memo(
  ({
    shot,
    locked,
    first,
    last,
    view,
  }: {
    readonly shot: ProductionShot
    /** The reel is finalized: nothing on the row may change. */
    readonly locked: boolean
    readonly first: boolean
    readonly last: boolean
    readonly view: SceneViewProps
  }) => {
    const { labels, book, pending, handlers } = view
    const [editing, setEditing] = useState(false)
    const tone = shotRowTone(shot)
    const flagged = tone === 'flagged'
    const proposed = shot.state === 'proposed'
    const empty = shot.description.length === 0
    const canEdit = !locked && !pending
    const open = (): void => {
      if (canEdit) setEditing(true)
    }

    if (editing) {
      return (
        <div className="folio-shot-row" data-shot-row={shot.id} data-tone={tone} data-editing>
          <div className="min-w-0 flex-1">
            <ShotEditor
              shot={shot}
              title={`Shot ${shot.number}`}
              labels={labels}
              book={book}
              pending={pending}
              onCancel={() => {
                setEditing(false)
              }}
              onSave={(edit) => {
                setEditing(false)
                handlers.onSaveShot(shot.id, edit)
              }}
            />
          </div>
        </div>
      )
    }

    return (
      <div className="folio-shot-row" data-shot-row={shot.id} data-tone={tone} data-shot-state={shot.state}>
        <span className="folio-shot-no">{shot.number}</span>
        <button type="button" className="folio-shot-secs" title="Duration" data-shot-secs disabled={!canEdit} onClick={open}>
          {secondsLabel(shot.durationSeconds)}
        </button>

        <span className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <span className="flex flex-wrap items-center gap-[5px]">
            {shotChips(shot).map((chip) => (
              <button key={chip} type="button" className="folio-shot-chip" disabled={!canEdit} onClick={open}>
                {chip}
              </button>
            ))}
          </span>

          <p className="folio-shot-desc" data-placeholder={empty ? 'true' : 'false'} data-shot-description onClick={open}>
            {empty ? PLACEHOLDER : <ShotDescription shot={shot} book={book} />}
          </p>

          {proposed ? (
            <span className="flex items-center gap-[8px]" data-proposal-row>
              <span className="flex-1 text-11 text-warn">Proposed from the scene</span>
              <button
                type="button"
                data-accept-shot
                disabled={locked || pending}
                className="h-[24px] cursor-pointer rounded-[7px] border-none bg-warn-bg px-[11px] text-11-5 font-medium text-warn hover:opacity-[.88] disabled:opacity-50"
                onClick={() => {
                  handlers.onAccept(shot.sceneNodeId, shot.id)
                }}
              >
                Accept
              </button>
              <button
                type="button"
                data-discard-shot
                disabled={locked || pending}
                className="folio-ghost-button h-[24px] rounded-[7px] px-[9px] text-11-5 text-ink3 hover:!bg-transparent hover:!text-ink disabled:opacity-50"
                onClick={() => {
                  handlers.onDiscard(shot.sceneNodeId, shot.id)
                }}
              >
                Discard
              </button>
            </span>
          ) : null}

          {flagged && shot.frame.kind === 'blocked' ? (
            <span className="flex flex-col gap-[8px] rounded-[9px] bg-bad-bg px-[11px] py-[10px]" data-refusal role="alert">
              <span className="flex gap-[8px] text-12 leading-[1.5] text-bad">
                <Mark glyph="⚠" className="flex-none" />
                <span className="flex-1">
                  Shot {shot.number}: {shot.frame.reason} It can&apos;t be rendered as a frame. Suggest a rewrite that keeps the beat.
                </span>
              </span>
              <button
                type="button"
                data-suggest-rewrite
                className="h-[26px] cursor-pointer self-start rounded-[7px] border border-bad bg-transparent px-[11px] text-11-5 font-medium text-bad hover:opacity-[.88]"
                onClick={() => {
                  handlers.onSuggestRewrite(shot)
                }}
              >
                Suggest rewrite
              </button>
            </span>
          ) : null}
        </span>

        <span className="flex flex-none items-center gap-[1px]">
          <button
            type="button"
            title="Move up"
            aria-label="Move up"
            data-move-up
            className="folio-shot-tool"
            disabled={!canEdit || first || proposed}
            onClick={() => {
              handlers.onMoveShot(shot.id, 'up')
            }}
          >
            ↑
          </button>
          <button
            type="button"
            title="Move down"
            aria-label="Move down"
            data-move-down
            className="folio-shot-tool"
            disabled={!canEdit || last || proposed}
            onClick={() => {
              handlers.onMoveShot(shot.id, 'down')
            }}
          >
            ↓
          </button>
          <button
            type="button"
            title={proposed ? 'Discard' : 'Remove'}
            aria-label={proposed ? 'Discard' : 'Remove'}
            data-remove-shot
            data-remove
            className="folio-shot-tool"
            disabled={!canEdit}
            onClick={() => {
              handlers.onDiscard(shot.sceneNodeId, shot.id)
            }}
          >
            ✕
          </button>
        </span>
      </div>
    )
  },
)
ShotRow.displayName = 'ShotRow'
