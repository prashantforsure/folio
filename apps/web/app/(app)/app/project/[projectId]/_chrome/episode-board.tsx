'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useId, useState } from 'react'

import { countOrAbsent, episodeNumber } from '../../../../../../lib/workspace/format'
import { episodeHref } from '../../../../../../lib/workspace/hrefs'

export type EpisodeBoardEntry = {
  readonly slug: EpisodeSlug
  readonly ordinal: number
  readonly title: string
  /** `measurements.total_pages`, or `null` - the board prints `—`. */
  readonly pages: number | null
}

/**
 * The episode board: a collapsible list of every episode with number, title
 * and page count. Open by default; the open/closed flag is component state
 * and is not persisted - a board someone closed is not a preference they
 * were expressing about the next tab. (An assumption; nothing specifies it.)
 *
 * The count pill is the number of episodes, live. Each row links to the
 * episode's index, which redirects to its script. The current episode is
 * marked `aria-current="page"`.
 */
export const EpisodeBoard = ({
  projectId,
  current,
  rows,
}: {
  readonly projectId: ProjectId
  readonly current: EpisodeSlug
  readonly rows: readonly EpisodeBoardEntry[]
}) => {
  const [open, setOpen] = useState(true)
  const listId = useId()

  return (
    <div data-episode-board>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full cursor-pointer items-center gap-[7px] rounded-chrome border-none bg-transparent pb-[5px] pl-[8px] pr-[8px] pt-[5px] text-left text-12 text-ink2 hover:bg-hover"
      >
        <span
          aria-hidden="true"
          className="text-8 text-ink3"
          style={{ fontFamily: 'var(--font-glyph)' }}
        >
          {open ? '▾' : '▸'}
        </span>
        Episode board
        <span className="tabular ml-auto grid h-[15px] min-w-[15px] place-items-center rounded-chrome bg-sel pl-[4px] pr-[4px] text-9 font-semibold text-ink2">
          {rows.length}
        </span>
      </button>

      {open ? (
        <ul
          id={listId}
          className="m-0 mb-[4px] ml-[15px] mt-[2px] flex list-none flex-col gap-[1px] border-l border-line2 p-0 pl-[6px]"
        >
          {rows.map((row) => (
            <li key={row.slug}>
              <Link
                href={episodeHref(projectId, row.slug)}
                aria-current={row.slug === current ? 'page' : undefined}
                data-board-episode={row.slug}
                className="folio-nav-row items-baseline gap-[7px] pb-[4px] pt-[4px] text-11-5 text-ink2 aria-[current=page]:text-ink"
              >
                <span className="w-[16px] text-10 text-ink3">{episodeNumber(row.ordinal)}</span>
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                <span className="tabular text-9-5 text-ink3">{countOrAbsent(row.pages)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
