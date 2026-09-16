'use client'

import type { CastRow, ProductionScene, ProjectId, ReelRow, ShotEdit } from '@folio/contracts'
import { CLIP_SECONDS } from '@folio/contracts'
import { memo, useRef, useState } from 'react'

import type { LocationSummary } from '../../../../../../lib/production/server'
import { reelViewOf } from '../../../../../../lib/production/view'
import { useDismiss } from '../_chrome/use-dismiss'
import { ShotEditor } from '../_storyboard/shot-parts'
import { FrameTile } from './frame-tile'
import type { SceneViewProps } from './handlers'
import { InThisReel } from './in-this-reel'
import { Mark } from './mark'
import { ShotRow } from './shot-row'

/**
 * One reel of the scene - `Route - Production v2.dc.html`, a `section`:
 * the header (name, `3 shots · 12 s`, the timing bar and `12 / 15 s`, the
 * clip-length control, the status pill, Render, `⋯`), then three columns
 * - Shots, Frames, In this reel - at `1.45fr 1fr 230px`, two at a middling
 * width, one when narrow (the workspace measures and says which).
 *
 * Everything printed is `reelViewOf` (`lib/production/view.ts`) over the
 * reel's rows: the fold decides what Generate, Finalize and Render may do
 * and the line under them says why. The buttons stay drawn when refused
 * (the mockup's `.55`), with the reason as their title, so a writer can
 * see what the next step is before it is allowed.
 */

const BLANK_SHOT: ShotEdit = {
  size: 'ms',
  movement: 'static',
  angle: 'eye_level',
  lensMm: 50,
  durationSeconds: null,
  description: [],
}

const GRID: Record<SceneViewProps['columns'], string> = {
  3: 'minmax(0,1.45fr) minmax(0,1fr) 230px',
  2: 'minmax(0,1.2fr) minmax(0,1fr)',
  1: 'minmax(0,1fr)',
}

const ReelName = ({ reel, pending, onRename }: { readonly reel: ReelRow; readonly pending: boolean; readonly onRename: (name: string) => void }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(reel.name)
  if (editing) {
    return (
      <form
        className="-ml-[8px] flex items-center"
        onSubmit={(event) => {
          event.preventDefault()
          const name = draft.trim()
          setEditing(false)
          if (name !== '' && name !== reel.name) onRename(name)
          else setDraft(reel.name)
        }}
      >
        <input
          autoFocus
          data-reel-name-field
          value={draft}
          maxLength={80}
          aria-label="Reel name"
          className="folio-field h-[30px] w-[180px] rounded-[8px] px-[8px] py-0 text-14 font-medium tracking-title"
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={() => {
            setEditing(false)
            setDraft(reel.name)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditing(false)
              setDraft(reel.name)
            }
          }}
        />
      </form>
    )
  }
  return (
    <button
      type="button"
      title="Rename reel"
      data-reel-name
      disabled={pending}
      className="folio-ghost-button -ml-[8px] flex items-center gap-[6px] rounded-[8px] px-[8px] py-[4px] text-14 font-medium tracking-title text-ink"
      onClick={() => {
        setDraft(reel.name)
        setEditing(true)
      }}
    >
      {reel.name}
    </button>
  )
}

const ReelMenu = ({
  reel,
  first,
  last,
  pending,
  view,
}: {
  readonly reel: ReelRow
  readonly first: boolean
  readonly last: boolean
  readonly pending: boolean
  readonly view: SceneViewProps
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  const { handlers } = view
  const busy = reel.clip.kind === 'queued' || reel.clip.kind === 'running'
  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        title="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        data-reel-menu
        className="folio-ghost-button grid h-[28px] w-[28px] place-items-center rounded-[8px] text-14 text-ink3"
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[34px] w-[200px]">
          <button
            type="button"
            role="menuitem"
            className="folio-menu-item"
            disabled={pending || first}
            onClick={() => {
              setOpen(false)
              handlers.onMoveReel(reel.id, 'up')
            }}
          >
            Move reel up
          </button>
          <button
            type="button"
            role="menuitem"
            className="folio-menu-item"
            disabled={pending || last}
            onClick={() => {
              setOpen(false)
              handlers.onMoveReel(reel.id, 'down')
            }}
          >
            Move reel down
          </button>
          <button
            type="button"
            role="menuitem"
            data-remove-reel
            className="folio-menu-item !text-live"
            disabled={pending || busy}
            title={busy ? 'A render of this reel is in flight. Cancel it first.' : 'The shots stay in the scene, out of any reel'}
            onClick={() => {
              setOpen(false)
              handlers.onRemoveReel(reel.id)
            }}
          >
            Remove reel…
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const ReelSection = memo(
  ({
    projectId,
    scene,
    reel,
    first,
    last,
    cast,
    location,
    view,
  }: {
    readonly projectId: ProjectId
    readonly scene: ProductionScene
    readonly reel: ReelRow
    readonly first: boolean
    readonly last: boolean
    readonly cast: readonly CastRow[]
    readonly location: LocationSummary | null
    readonly view: SceneViewProps
  }) => {
    const { labels, book, input, pending, handlers, columns } = view
    const model = reelViewOf(reel, input)
    const { gates } = model
    const locked = reel.finalizedAt !== null
    const [adding, setAdding] = useState(false)
    const clipJob = reel.clip.kind === 'queued' || reel.clip.kind === 'running' ? reel.clip.jobId : null

    return (
      <section className="folio-reel" data-reel={reel.id} data-reel-status={gates.status}>
        <div className="flex flex-none flex-wrap items-center gap-[12px] border-b border-line2 px-[16px] py-[14px]">
          <ReelName
            reel={reel}
            pending={pending}
            onRename={(name) => {
              handlers.onRenameReel(reel.id, name)
            }}
          />
          <span className="tabular whitespace-nowrap text-12 text-ink3" data-reel-shot-meta>
            {model.shotMeta}
          </span>

          <div className="flex min-w-[180px] flex-1 items-center gap-[10px]">
            <span className="flex h-[8px] min-w-0 flex-1 overflow-hidden rounded-[5px] bg-s3" data-timing-bar>
              {model.segments.map((segment, index) => (
                <span key={index} className="folio-seg" data-tone={segment.tone} style={{ width: `${String(segment.width)}%` }} />
              ))}
            </span>
            <span className={`tabular flex-none font-mono text-11 ${model.over ? 'text-bad' : 'text-ink3'}`} data-reel-duration>
              {model.durLabel}
            </span>
          </div>

          <div className="flex flex-none items-center gap-[2px] rounded-[9px] border border-line2 bg-s1 p-[3px]" role="group" aria-label="Clip length">
            {CLIP_SECONDS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                title="Clip length"
                aria-pressed={seconds === reel.clipSeconds}
                data-clip-length={seconds}
                className="folio-len-tab"
                disabled={pending || locked}
                onClick={() => {
                  if (seconds !== reel.clipSeconds) handlers.onSetClip(reel.id, seconds)
                }}
              >
                {seconds}
              </button>
            ))}
          </div>

          {model.render.kind === 'view' ? (
            <a
              href={model.render.url}
              target="_blank"
              rel="noreferrer"
              className="folio-tone-pill flex-none no-underline hover:no-underline"
              data-tone={model.status.tone}
              data-reel-status-pill
            >
              {model.status.label}
            </a>
          ) : (
            <span className="folio-tone-pill flex-none" data-tone={model.status.tone} data-reel-status-pill>
              {model.status.label}
            </span>
          )}

          {model.render.kind === 'view' ? (
            <a
              href={model.render.url}
              target="_blank"
              rel="noreferrer"
              data-render-reel
              data-tone="ok"
              className="folio-accent-button h-[32px] flex-none px-[14px]"
            >
              {model.render.label}
            </a>
          ) : model.render.kind === 'rendering' ? (
            <button
              type="button"
              data-render-reel
              data-cancel-job={clipJob ?? undefined}
              disabled={pending || clipJob === null}
              title="Stop the render"
              className="folio-accent-button h-[32px] flex-none px-[14px]"
              onClick={() => {
                if (clipJob !== null) handlers.onCancelJob(scene.sceneNodeId, clipJob)
              }}
            >
              {model.render.label} · stop
            </button>
          ) : (
            <button
              type="button"
              data-render-reel
              data-cost={String(input.renderCost)}
              aria-disabled={!model.render.enabled}
              disabled={pending}
              title={model.render.enabled ? `Reserves ${String(input.renderCost)} credits · ${String(input.available)} available` : model.reason.text}
              className="folio-accent-button h-[32px] flex-none px-[14px]"
              onClick={() => {
                if (model.render.kind === 'render' && model.render.enabled) handlers.onRender(reel.id)
              }}
            >
              <Mark glyph="▶" />
              {model.render.label.replace(/^▶ /, '')}
            </button>
          )}
          <ReelMenu reel={reel} first={first} last={last} pending={pending} view={view} />
        </div>

        <div className="grid items-stretch" style={{ gridTemplateColumns: GRID[columns] }}>
          {/* SHOTS */}
          <div className={`flex min-w-0 flex-col gap-[9px] px-[16px] py-[14px] ${columns > 1 ? 'border-r border-line2' : 'border-b border-line2'}`} data-reel-shots>
            <span className="folio-eyebrow">Shots</span>

            {reel.shots.map((shot, index) => (
              <ShotRow key={shot.id} shot={shot} locked={locked} first={index === 0} last={index === reel.shots.length - 1} view={view} />
            ))}

            {adding ? (
              <div className="folio-shot-row" data-add-shot-form>
                <div className="min-w-0 flex-1">
                  <ShotEditor
                    shot={BLANK_SHOT}
                    title="New shot"
                    labels={labels}
                    book={book}
                    pending={pending}
                    onCancel={() => {
                      setAdding(false)
                    }}
                    onSave={(edit) => {
                      setAdding(false)
                      handlers.onAddShot(reel.id, edit)
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-[8px] pt-[2px]">
              <button
                type="button"
                data-add-shot
                disabled={pending || locked}
                title={locked ? 'Unlock the reel to add a shot' : 'Add a shot at the end of the reel'}
                className="folio-line-button h-[30px] px-[12px]"
                onClick={() => {
                  setAdding(true)
                }}
              >
                ＋ Add shot
              </button>
              <button
                type="button"
                data-propose-shots
                disabled={pending || locked}
                title={locked ? 'Unlock the reel to propose shots' : 'Propose shots from the scene, replacing any proposal still waiting'}
                className="folio-line-button h-[30px] px-[12px]"
                onClick={() => {
                  handlers.onProposeForReel(reel.id)
                }}
              >
                <Mark glyph="✦" /> Propose shots <span className="text-ink3">free</span>
              </button>
            </div>

            <div className="flex flex-col gap-[8px] rounded-[11px] border border-line2 bg-sunk p-[12px]" data-reel-gate>
              <div className="flex flex-wrap items-center gap-[8px]">
                <button
                  type="button"
                  data-generate-frames
                  data-cost={String(gates.cost)}
                  disabled={pending || gates.status === 'needs-credits'}
                  aria-disabled={!model.generate.enabled}
                  title={model.generate.title ?? (model.generate.enabled ? `Reserves ${String(gates.cost)} credits · ${String(input.available)} available` : model.reason.text)}
                  className="folio-accent-button h-[32px] px-[14px]"
                  onClick={() => {
                    if (model.generate.enabled) handlers.onGenerate(reel.id)
                  }}
                >
                  <Mark glyph="✦" />
                  {model.generate.label.replace(/^✦ /, '')}
                </button>
                <button
                  type="button"
                  data-finalize-reel={model.lock.label.toLowerCase()}
                  disabled={pending || !model.lock.enabled}
                  title={model.lock.enabled ? undefined : model.reason.text}
                  className="folio-line-button h-[32px] px-[14px]"
                  data-line="strong"
                  onClick={() => {
                    if (model.lock.label === 'Finalize') handlers.onFinalize(reel.id)
                    else handlers.onUnlock(reel.id)
                  }}
                >
                  {model.lock.label}
                </button>
                {gates.status === 'generating' ? (
                  <button
                    type="button"
                    data-cancel-frames
                    disabled={pending}
                    className="folio-ghost-button h-[32px] rounded-[9px] px-[10px] text-12-5 text-ink3"
                    onClick={() => {
                      for (const shot of reel.shots) {
                        if (shot.frame.kind === 'queued' || shot.frame.kind === 'running') handlers.onCancelJob(scene.sceneNodeId, shot.frame.jobId)
                      }
                    }}
                  >
                    Stop generating
                  </button>
                ) : null}
              </div>
              <span className="folio-tone-ink text-11-5 leading-[1.5]" data-tone={model.reason.tone} data-reel-reason>
                {model.reason.text}
              </span>
            </div>
          </div>

          {/* FRAMES */}
          <div className={`flex min-w-0 flex-col gap-[9px] px-[16px] py-[14px] ${columns === 3 ? 'border-r border-line2' : columns === 1 ? 'border-b border-line2' : ''}`} data-reel-frames>
            <span className="folio-eyebrow">Frames</span>
            {reel.shots.length === 0 ? (
              <span className="text-11-5 text-ink3">One frame per shot appears here.</span>
            ) : (
              <div className="flex flex-col gap-[13px]">
                {reel.shots.map((shot) => (
                  <FrameTile key={shot.id} shot={shot} view={view} />
                ))}
              </div>
            )}
          </div>

          <InThisReel projectId={projectId} scene={scene} cast={cast} location={location} />
        </div>
      </section>
    )
  },
)
ReelSection.displayName = 'ReelSection'
