'use client'

import type { StoryboardScene } from '@folio/contracts'
import type { LabelBook, MentionLabel } from '@folio/script'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL } from '@folio/script'
import { useState } from 'react'

import type { ShotHandlers } from './scene-column'
import { Description, FrameTile, ShotEditor, lensLabel, mentionChips, sizeName } from './shot-parts'

/**
 * The canvas view: one scene's shots as nodes on a dotted ground.
 * `Route - Storyboard.dc.html`, "CANVAS: shot nodes": 290px nodes on a
 * 22px radial grid, a two-port header (`Storyboard` · `Lens`), the frame,
 * the tag chips (shot, size, camera, movement, lens), the description, the
 * `@mention` chips, then `Generate` / `Regenerate` and `⋯`.
 *
 * The bundle's canvas is a sketch of a node graph - the two ports draw
 * nothing. They are kept as the bundle draws them, as labels; nothing here
 * is wired to a lens, which is a later phase's object. `Generate` is the
 * same frame job the board's tile runs, with the same named cost.
 */
export const ShotCanvas = ({
  scene,
  labels,
  book,
  cost,
  available,
  pending,
  handlers,
}: {
  readonly scene: StoryboardScene | null
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly cost: number
  readonly available: number
  readonly pending: boolean
  readonly handlers: ShotHandlers
}) => {
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div
      data-shot-canvas
      className="min-h-0 flex-1 overflow-auto bg-desk"
      style={{
        backgroundImage: 'radial-gradient(var(--grid) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        backgroundPosition: '8px 8px',
      }}
    >
      {scene === null ? (
        <div className="p-[26px] text-11 text-ink3">Select a scene on the board to open its canvas.</div>
      ) : scene.shots.length === 0 ? (
        <div className="flex flex-col items-start gap-[10px] p-[26px]">
          <span className="font-serif text-16 font-medium">No shot nodes for scene {String(scene.number).padStart(2, '0')}</span>
          <span className="text-10-5 text-ink3">Auto board reads the scene text and proposes a first shot list.</span>
          <button
            type="button"
            data-auto-board
            disabled={pending}
            className="folio-focus flex items-center gap-[6px] rounded-chrome bg-accent px-[12px] py-[6px] text-11-5 font-semibold text-accent-ink disabled:opacity-60"
            onClick={() => {
              handlers.onPropose(scene.sceneNodeId)
            }}
          >
            <span className="font-glyph text-10">✦</span>Auto board
          </button>
        </div>
      ) : (
        <div className="flex min-w-min items-start gap-[30px] px-[22px] pb-[40px] pt-[26px]">
          {scene.shots.map((shot) => (
            <div
              key={shot.id}
              data-shot-node={shot.id}
              data-shot-state={shot.state}
              className="flex w-[290px] flex-none flex-col overflow-hidden rounded-chrome border border-line bg-panel hover:border-accent-line"
            >
              <div className="flex border-b border-line2">
                <div className="flex flex-1 items-center gap-[6px] border-r border-line2 px-[10px] py-[7px]">
                  <span className="h-[5px] w-[5px] rounded-full bg-add" />
                  <span className="text-10-5 text-ink2">Storyboard</span>
                </div>
                <div className="flex flex-1 items-center gap-[6px] bg-hover px-[10px] py-[7px]">
                  <span className="h-[5px] w-[5px] rounded-full bg-accent" />
                  <span className="text-10-5 text-ink2">Lens</span>
                </div>
              </div>

              {editing === shot.id ? (
                <div className="p-[11px]">
                  <ShotEditor
                    shot={shot}
                    labels={labels}
                    book={book}
                    pending={pending}
                    onCancel={() => {
                      setEditing(null)
                    }}
                    onSave={(edit) => {
                      handlers.onSave(shot.id, edit)
                      setEditing(null)
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-[10px] p-[11px]">
                    <FrameTile
                      shot={shot}
                      cost={cost}
                      available={available}
                      pending={pending}
                      compact
                      onDraw={() => {
                        handlers.onDraw(shot.id)
                      }}
                      onCancel={handlers.onCancelFrame}
                    >
                      <span className={`font-mono text-8-5 ${shot.frame.kind === 'drawn' ? 'rounded-chrome bg-[rgba(0,0,0,.38)] px-[6px] py-[2px] text-[rgba(255,255,255,.8)]' : 'text-ink3'}`}>
                        SHOT {shot.number}
                      </span>
                    </FrameTile>
                    <div className="flex flex-wrap gap-[5px]">
                      {[
                        `SHOT ${shot.number}`,
                        sizeName(shot),
                        CAMERA_ANGLE_LABEL[shot.angle],
                        SHOT_MOVEMENT_LABEL[shot.movement],
                        lensLabel(shot.lensMm),
                      ].map((tag) => (
                        <span key={tag} className="whitespace-nowrap rounded-chrome border border-line2 px-[7px] py-[2px] text-9-5 text-ink2">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="m-0 text-11-5 leading-[1.55] text-ink2">
                      <Description content={shot.description} book={book} />
                    </p>
                    <div className="flex flex-wrap gap-[6px]">
                      {mentionChips(shot.description, book).map((chip) => (
                        <span key={chip} className="rounded-chrome border border-accent-line bg-accent-bg px-[6px] py-[1px] text-10 text-accent">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-[6px] border-t border-line2 px-[11px] pb-[11px] pt-[10px]">
                    {shot.state === 'proposed' ? (
                      <button
                        type="button"
                        data-accept-shot
                        disabled={pending}
                        className="folio-focus flex flex-1 items-center justify-center gap-[6px] rounded-chrome bg-accent px-[8px] py-[6px] text-11 font-semibold text-accent-ink disabled:opacity-60"
                        onClick={() => {
                          handlers.onAccept(shot.sceneNodeId, shot.id)
                        }}
                      >
                        Accept
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-generate-frame
                        disabled={pending || shot.frame.kind === 'queued' || shot.frame.kind === 'running'}
                        title={`Reserves ${String(cost)} credits · ${String(available)} available`}
                        className="folio-focus flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line px-[8px] py-[6px] text-11 text-ink2 hover:bg-hover disabled:opacity-60"
                        onClick={() => {
                          handlers.onDraw(shot.id)
                        }}
                      >
                        <span className="font-glyph text-10 opacity-70">✎</span>
                        {shot.frame.kind === 'queued' || shot.frame.kind === 'running'
                          ? 'In flight'
                          : `${shot.frame.kind === 'drawn' ? 'Regenerate' : 'Generate'} · ${String(cost)} cr`}
                      </button>
                    )}
                    <button
                      type="button"
                      data-edit-shot
                      title="Edit shot"
                      disabled={pending}
                      className="folio-focus grid w-[30px] flex-none place-items-center rounded-chrome border border-line text-11 text-ink3 hover:bg-hover disabled:opacity-60"
                      onClick={() => {
                        setEditing(shot.id)
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
