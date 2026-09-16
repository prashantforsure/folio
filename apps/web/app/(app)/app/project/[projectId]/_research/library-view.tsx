'use client'

import type { ProjectId, ResearchSourceId, ResearchSourceRow } from '@folio/contracts'
import Link from 'next/link'

import { setResearchDrawer } from '../../../../../../lib/research/compose'
import { cardLine, snippetOf } from '../../../../../../lib/research/view'
import { researchSourceHref } from '../../../../../../lib/workspace/hrefs'
import { KindBadge, kindHue } from './kind'

/**
 * The Library - `Route - Research v2.dc.html`: a grid of source cards,
 * `repeat(auto-fill, minmax(268px, 1fr))` at a 14px gap, `0 20px 24px`,
 * and the dashed `+ Add source` card at the end. A card is a link to the
 * source's page: a 3px strip in the kind's hue, the kind badge and the amber
 * `❝ N` clip count (drawn only past zero), the title at 14.5px/500 clamped
 * to two lines, the snippet at 12.5px clamped to two, then the mono
 * `origin · words` line and the collection pill.
 *
 * The snippet, the mono line and the count are the loader's and
 * `lib/research/view.ts`'s; the card composes nothing.
 */
export const LibraryView = ({
  projectId,
  sources,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly sources: readonly ResearchSourceRow[]
  readonly selectedId: ResearchSourceId | null
}) => (
  <div data-library className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
    {sources.length === 0 ? (
      <p className="m-0 pt-[8px] text-13 text-ink3" data-library-no-match>
        No source matches that.
      </p>
    ) : null}
    <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))' }}>
      {sources.map((source) => (
        <Link
          key={source.id}
          href={researchSourceHref(projectId, source.id)}
          data-source-card={source.id}
          aria-current={source.id === selectedId ? 'page' : undefined}
          className="folio-source-card"
        >
          <span aria-hidden="true" className="folio-src-bar" style={kindHue(source.kind)} />
          <span className="flex min-w-0 flex-1 flex-col gap-[10px] p-[13px]">
            <span className="flex min-w-0 items-center gap-[8px]">
              <KindBadge kind={source.kind} />
              <span className="flex-1" />
              {source.clips > 0 ? (
                <span className="flex flex-none items-center gap-[5px] text-11 text-warn" data-card-clips={source.clips}>
                  <span className="folio-mark">❝</span> {source.clips}
                </span>
              ) : null}
            </span>
            <span className="folio-clamp-2 text-14-5 font-medium leading-[1.35] tracking-title" style={{ textWrap: 'pretty' }}>
              {source.title}
            </span>
            {snippetOf(source) === '' ? null : (
              <span className="folio-clamp-2 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                {snippetOf(source)}
              </span>
            )}
            <span className="mt-auto flex min-w-0 items-center gap-[9px]">
              <span className="min-w-0 flex-1 truncate font-mono text-10-5 text-ink3">{cardLine(source)}</span>
              {source.collection === null ? null : (
                <span className="flex-none whitespace-nowrap rounded-pill bg-s2 px-[8px] py-[2px] text-10-5 text-ink3">
                  {source.collection.name}
                </span>
              )}
            </span>
          </span>
        </Link>
      ))}
      <button
        type="button"
        data-add-source-card
        onClick={() => {
          setResearchDrawer({ kind: 'new' })
        }}
        className="folio-add-card"
      >
        <span className="text-18 leading-none">+</span>Add source
      </button>
    </div>
  </div>
)
