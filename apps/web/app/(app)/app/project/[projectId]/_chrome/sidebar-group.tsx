'use client'

import type { BoardCoverageRow, EpisodeSceneRow } from '@folio/contracts'
import { useSelectedLayoutSegment } from 'next/navigation'

import type { TocRow } from '../../../../../../lib/outline/toc'
import { TITLE_ROW_ID, tocLevelLabel, useOutlineToc } from '../../../../../../lib/outline/toc'
import { coverageTone, sceneNo, sceneSlug } from '../../../../../../lib/storyboard/board'
import { useBoardCoverage } from '../../../../../../lib/storyboard/coverage'
import { count, eighths } from '../../../../../../lib/workspace/format'

/**
 * The sidebar's second group: what this route lists.
 *
 * The Script and Scenes mockups draw `Scenes` here - one row per scene
 * heading, number, mono heading, eighths; the Outline mockup draws `In this
 * outline` - the title and every heading with its level (`docs/ui
 * design/Route - Outline v2.dc.html`); the Storyboard mockup draws `Boards`
 * - one row per scene with a status dot, `Scene NN`, the mono slug and the
 * shot count, the selected scene on `--s2`. The sidebar is the layout's and
 * cannot see which route renders below it, so this Client Component reads
 * the segment and picks; everything it prints arrives from the server as
 * data.
 *
 * ## The outline's list and the boards are live
 *
 * "Headings appear here as you write them" - so on the Outline route the
 * group reads `lib/outline/toc.ts`, the cell the workspace publishes to on
 * every change, and falls back to the server's list (`initialToc`) until
 * the workspace has mounted. The two agree on the first paint: the server
 * list is the same headings with no caret yet, so the title row is lit in
 * both. The Storyboard's `Boards` group reads `lib/storyboard/coverage.ts`
 * the same way: counts after every write, the lit row on every selection,
 * seeded by `readBoardCoverage`. Before the workspace mounts no row is lit
 * - the selection is the page's, and the page has not said yet.
 */

const TONE_CLASS = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  live: 'bg-live',
  none: 'bg-ink3',
} as const

export const SidebarGroup = ({
  scenes,
  scriptHref,
  title,
  initialToc,
  initialCoverage,
}: {
  readonly scenes: readonly EpisodeSceneRow[]
  readonly scriptHref: string
  /** The title row's text: the episode's title, or the project's for a film. */
  readonly title: string
  /** The outline's headings as the server read them; `null` when there is no outline. */
  readonly initialToc: readonly TocRow[] | null
  /** The board's coverage as the server read it; empty when there is no script. */
  readonly initialCoverage: readonly BoardCoverageRow[]
}) => {
  const segment = useSelectedLayoutSegment()
  const live = useOutlineToc()
  const board = useBoardCoverage()

  if (segment === 'storyboard') {
    const rows = board?.rows ?? initialCoverage
    const selectedId = board?.selectedId ?? null
    return (
      <div className="flex flex-col gap-[3px]" data-boards-group>
        <div className="flex items-center pb-[6px] pl-[10px] pr-[10px]">
          <span className="folio-eyebrow flex-1">Boards</span>
          <span className="tabular text-11 text-ink3" data-boards-count>
            {count(rows.length)}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3">
            Boards appear here as you write scene headings. Nothing to list yet.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
            {rows.map((row) => (
              <li key={row.sceneNodeId}>
                <button
                  type="button"
                  data-board-row={row.sceneNodeId}
                  aria-current={row.sceneNodeId === selectedId ? 'true' : undefined}
                  onClick={() => {
                    board?.onPick(row.sceneNodeId)
                  }}
                  className="folio-board-row"
                >
                  <span className={`h-[6px] w-[6px] flex-none rounded-full ${TONE_CLASS[coverageTone(row)]}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="truncate text-12-5">Scene {sceneNo(row.number)}</span>
                    <span className="truncate font-mono text-10 text-ink3">{sceneSlug(row)}</span>
                  </span>
                  <span className="tabular flex-none text-11 text-ink3">{count(row.shots)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (segment === 'outline') {
    // The workspace's list once it has mounted; the server's until then. A
    // server list with no heading draws the copy, not a lone title row.
    const rows: readonly TocRow[] =
      live !== null
        ? live.rows
        : initialToc === null || initialToc.length === 0
          ? []
          : [{ id: TITLE_ROW_ID, text: title, level: 'title' }, ...initialToc]
    const activeId = live !== null ? live.activeId : rows.length === 0 ? null : TITLE_ROW_ID
    return (
      <div className="flex flex-col gap-[2px]" data-toc-group>
        <div className="flex items-center pb-[6px] pl-[10px] pr-[10px]">
          <span className="folio-eyebrow flex-1">In this outline</span>
          <span className="tabular text-11 text-ink3" data-toc-count>
            {count(rows.length)}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3" data-toc-empty>
            Headings appear here as you write them. Nothing to list yet.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-toc-row={row.id}
                  aria-current={row.id === activeId ? 'true' : undefined}
                  onClick={() => {
                    live?.onPick(row.id)
                  }}
                  className="folio-toc-row"
                >
                  <span className="min-w-0 flex-1 truncate text-12-5">{row.text === '' ? 'Untitled heading' : row.text}</span>
                  <span className="flex-none font-mono text-10 text-ink3">{tocLevelLabel(row.level)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[2px]" data-scenes-group>
      <div className="flex items-center pb-[6px] pl-[10px] pr-[10px]">
        <span className="folio-eyebrow flex-1">Scenes</span>
        <span className="tabular text-11 text-ink3">{count(scenes.length)}</span>
      </div>
      {scenes.length === 0 ? (
        <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3">
          Scenes appear here as you write headings. Nothing to list yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[1px] p-0">
          {scenes.map((scene) => (
            <li key={scene.sceneNodeId}>
              <a
                href={`${scriptHref}#n-${scene.sceneNodeId}`}
                data-scene-row={scene.sceneNodeId}
                className="folio-ghost-button flex w-full items-baseline gap-[8px] rounded-[10px] px-[10px] py-[7px] text-left text-ink2 no-underline hover:no-underline"
              >
                <span className="w-[12px] flex-none font-mono text-10-5 text-ink3">{scene.number}</span>
                <span className="min-w-0 flex-1 truncate text-12 uppercase tracking-[.01em]">{scene.heading}</span>
                <span className="tabular flex-none font-mono text-10 text-ink3">{eighths(scene.eighths)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
