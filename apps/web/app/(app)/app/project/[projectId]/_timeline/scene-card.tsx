'use client'

import type { StoryThreadRow, TimelineSceneRow } from '@folio/contracts'
import type { StoryJump } from '@folio/script'
import { TEXT_VARIATION_SELECTOR } from '@folio/ui'
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react'

import type { GridView } from '../../../../../../lib/timeline/view'
import { chipOf, sceneRef, shortSlug, threadColourVar } from '../../../../../../lib/timeline/view'

/** The MIME type a dragged card carries its scene id under. One string, both ends. */
export const SCENE_DRAG_TYPE = 'application/x-folio-scene'

/** The mark at the card's top right: what the scene is, or what the check found. */
export type CardMark = { readonly kind: 'flashback' | 'flashforward' | 'flag'; readonly text: string }

/**
 * One scene on the lanes grid. Top line: the mono ref (`E1 Sc 14`) and,
 * at the right, a mark in `--warn` - `↺` for a flashback, `↻` for a
 * flash-forward, `⚠` for an open finding, each with its text for a screen
 * reader. Then the short slug - the set as the core reads the heading.
 * Then the chip that says *when* in story order (`Day 2 · 06:40`, `Day -3
 * · flashback`, a dashed `no time`) and *where on the page* in chronology
 * (`E1 · p.36`), the jump arrow after it in story order (`↶` earlier
 * than the scene before it, `↷` skips ahead), and a 6px dot per further
 * thread the scene is on, in that thread's colour.
 *
 * A **ghost** is the same scene drawn in a further thread's row - dashed,
 * `--ink3`, the threads phase's answer to "where threads run in
 * parallel". It opens the same drawer.
 *
 * The card is a button with `aria-pressed` while it is the drawer's, and
 * it is draggable: the grid's cells and the unplaced strip are the drop
 * targets, and the id rides under `SCENE_DRAG_TYPE`. The roving tabindex
 * is the grid's (`tabbable`); the thread's colour rides in as
 * `--lane-colour` for the 3px bar (`.folio-lane-card::before`,
 * `globals.css`). Both marks are text in `--font-glyph` (`folio-mark`),
 * as `✦` is everywhere else; `⚠` has an emoji form and carries the text
 * selector (`@folio/ui`'s `glyphs.ts`).
 */
export const SceneCard = ({
  scene,
  view,
  colour,
  selected,
  mark,
  jump,
  also,
  ghost = false,
  dimmed = false,
  tabbable = true,
  onOpen,
  onFocus,
  onKeyDown,
}: {
  readonly scene: TimelineSceneRow
  readonly view: GridView
  /** The row's thread colour token, or null on a row with none. */
  readonly colour: string | null
  readonly selected: boolean
  readonly mark: CardMark | null
  readonly jump: StoryJump | null
  /** The scene's further threads, for the dots. */
  readonly also: readonly StoryThreadRow[]
  readonly ghost?: boolean
  readonly dimmed?: boolean
  readonly tabbable?: boolean
  readonly onOpen: () => void
  readonly onFocus?: (() => void) | undefined
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined
}) => {
  const style = { '--lane-colour': colour ?? 'var(--line)' } as CSSProperties
  const glyph = mark === null ? null : mark.kind === 'flashback' ? '↺' : mark.kind === 'flashforward' ? '↻' : `⚠${TEXT_VARIATION_SELECTOR}`
  const onDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    event.dataTransfer.setData(SCENE_DRAG_TYPE, scene.sceneNodeId)
    event.dataTransfer.setData('text/plain', sceneRef(scene))
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <button
      type="button"
      data-scene-card={ghost ? undefined : scene.sceneNodeId}
      data-scene-ghost={ghost ? scene.sceneNodeId : undefined}
      data-scene-ref={sceneRef(scene)}
      data-flashback={scene.flashback ? 'true' : undefined}
      data-flagged={mark?.kind === 'flag' ? 'true' : undefined}
      aria-pressed={selected}
      tabIndex={dimmed || !tabbable ? -1 : 0}
      draggable={!ghost}
      onDragStart={onDragStart}
      onClick={onOpen}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="folio-lane-card"
      style={style}
    >
      <span className="flex items-baseline gap-[6px]">
        <span className="tabular min-w-0 flex-1 truncate font-mono text-10-5 text-ink3">{sceneRef(scene)}</span>
        {mark === null || glyph === null ? null : (
          <span className="flex-none text-11 text-warn" title={mark.text} data-scene-mark={mark.kind}>
            <span aria-hidden="true" className="folio-mark">
              {glyph}
            </span>
            <span className="sr-only">{mark.text}</span>
          </span>
        )}
      </span>
      <span className="truncate text-12-5 leading-[1.3] text-ink" title={scene.heading}>
        {shortSlug(scene.heading)}
      </span>
      <span className="flex items-center gap-[5px]">
        <span
          className="folio-lane-chip"
          data-scene-chip
          data-tone={scene.flashback ? 'warn' : undefined}
          data-dashed={scene.storyTime === null && view === 'story' ? 'true' : undefined}
        >
          {chipOf(scene, view)}
        </span>
        {jump === null ? null : (
          <span data-scene-jump={jump} title={jump === 'back' ? 'Earlier than the scene before it' : 'Skips ahead'} className="text-10-5 text-warn">
            <span aria-hidden="true" className="folio-mark">
              {jump === 'back' ? '↶' : '↷'}
            </span>
            <span className="sr-only">{jump === 'back' ? 'Earlier than the scene before it' : 'Skips ahead'}</span>
          </span>
        )}
        <span className="flex-1" />
        {also.map((thread) => (
          <span key={thread.id} title={thread.name} data-scene-also={thread.id} className="h-[6px] w-[6px] flex-none rounded-full" style={{ background: threadColourVar(thread.colour) }}>
            <span className="sr-only">Also on {thread.name}</span>
          </span>
        ))}
      </span>
    </button>
  )
}
