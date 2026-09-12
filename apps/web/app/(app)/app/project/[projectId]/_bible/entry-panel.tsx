'use client'

import type { BibleEntryView, ProjectId } from '@folio/contracts'
import type { BibleEntryStatus } from '@folio/script'
import { BIBLE_ENTRY_STATUSES, BIBLE_ENTRY_STATUS_LABEL } from '@folio/script'
import Link from 'next/link'

import { setStatus } from '../../../../../../lib/bible/actions'
import { bibleEntryHref, characterHref, locationHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './bible-workspace'

/**
 * The entry's right-hand column, 264px: `STATUS` - the `Canon / Draft /
 * Retired` segment and the sentence each status means - then `LINKED`
 * (characters, locations, also see), `IN THE SCRIPT` (scenes that touch
 * this, the per-episode bars, the link into the Script), and `Retire` at
 * the foot. `Route - Bible.dc.html`, the `<aside>`.
 *
 * The three status sentences are specified copy and are the gate's
 * consequence in the writer's words; the write itself is one column, and
 * what makes it a permission is the repository read the context builder
 * uses. Linked chips are read off the cited scenes (`figures.ts`), so an
 * entry with no cite has none - the bundle's chips are fixture.
 *
 * `History` is not drawn: entries keep no versions. Flagged.
 */

const STATUS_NOTE: Readonly<Record<BibleEntryStatus, string>> = {
  canon: 'Canon rules are checked against every draft and readable by Insights.',
  draft: 'Drafts aren’t checked or read by Insights until promoted.',
  retired: 'Retired entries stay for history but are ignored.',
}

const LABEL = 'border-b border-line2 px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3'

export const EntryPanel = ({
  projectId,
  entry,
  scriptHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly entry: BibleEntryView
  readonly scriptHref: EpisodeRoutePath | null
  readonly run: Run
}) => {
  const move = (status: BibleEntryStatus): void => {
    if (status === entry.status) return
    run(async () => {
      const result = await setStatus(projectId, entry.id, status)
      return result.status === 'saved' ? null : result.message
    })
  }
  const most = Math.max(1, ...entry.perEpisode.map((bar) => bar.scenes))

  return (
    <aside
      data-entry-panel
      className="flex w-[264px] flex-none flex-col overflow-auto border-l border-line bg-panel"
      aria-label="Entry status and links"
    >
      <div className={LABEL}>Status</div>
      <div className="flex flex-col gap-[12px] border-b border-line2 px-[14px] py-[12px]">
        <div className="flex gap-[2px] rounded-chrome border border-line2 p-[2px]" role="radiogroup" aria-label="Entry status">
          {BIBLE_ENTRY_STATUSES.map((status) => {
            const active = status === entry.status
            return (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={active}
                data-status-tab={status}
                onClick={() => {
                  move(status)
                }}
                className={`flex-1 rounded-chrome border-none px-[6px] py-[4px] text-11 hover:text-ink ${
                  active ? 'bg-sel text-ink' : 'bg-transparent text-ink3'
                }`}
              >
                {BIBLE_ENTRY_STATUS_LABEL[status]}
              </button>
            )
          })}
        </div>
        <span className="text-10-5 leading-[1.5] text-ink3" data-status-note>
          {STATUS_NOTE[entry.status]}
        </span>
      </div>

      <div className={LABEL}>Linked</div>
      <div className="flex flex-col gap-[10px] border-b border-line2 px-[14px] py-[12px]">
        <div className="flex flex-col gap-[5px]">
          <span className="text-10 text-ink3">Characters</span>
          <div className="flex flex-wrap gap-[5px]" data-linked-characters>
            {entry.links.characters.length === 0 ? (
              <span className="text-10-5 text-ink3">—</span>
            ) : (
              entry.links.characters.map((person) => (
                <Link
                  key={person.id}
                  href={characterHref(projectId, person.id)}
                  className="rounded-chrome bg-sel px-[8px] py-[2px] text-10-5 text-ink no-underline hover:bg-hover hover:no-underline"
                >
                  {person.name}
                </Link>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-col gap-[5px]">
          <span className="text-10 text-ink3">Locations</span>
          <div className="flex flex-wrap gap-[5px]" data-linked-locations>
            {entry.links.locations.length === 0 ? (
              <span className="text-10-5 text-ink3">—</span>
            ) : (
              entry.links.locations.map((place) => (
                <Link
                  key={place.id}
                  href={locationHref(projectId, place.id)}
                  className="rounded-chrome bg-sel px-[8px] py-[2px] text-10-5 text-ink no-underline hover:bg-hover hover:no-underline"
                >
                  {place.name}
                </Link>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-col gap-[5px]">
          <span className="text-10 text-ink3">Also see</span>
          {entry.links.related.length === 0 ? (
            <span className="text-10-5 text-ink3">—</span>
          ) : (
            entry.links.related.map((other) => (
              <Link key={other.id} href={bibleEntryHref(projectId, other.id)} className="text-11-5">
                {other.title} →
              </Link>
            ))
          )}
        </div>
      </div>

      <div className={LABEL}>In the script</div>
      <div className="flex flex-col gap-[8px] px-[14px] py-[12px]">
        <div className="flex justify-between text-11-5">
          <span className="text-ink2">Scenes that touch this</span>
          <span className="tabular font-medium" data-mentions>
            {entry.mentions}
          </span>
        </div>
        <div className="flex h-[36px] items-end gap-[4px]" data-per-episode>
          {entry.perEpisode.map((bar) => (
            <div key={bar.episode} className="flex h-full flex-1 flex-col items-center justify-end gap-[3px]">
              <span
                className={`w-full rounded-t-[2px] ${bar.scenes > 0 ? 'bg-ink2' : 'bg-line'}`}
                style={{ height: bar.scenes > 0 ? `${String(Math.max(10, Math.round((bar.scenes / most) * 100)))}%` : '3%' }}
                title={`${String(bar.scenes)} ${bar.scenes === 1 ? 'scene' : 'scenes'}`}
              />
              <span className="text-9 text-ink3">E{bar.ordinal}</span>
            </div>
          ))}
        </div>
        {scriptHref === null ? null : (
          <Link href={scriptHref} className="text-11">
            Show mentions in Script →
          </Link>
        )}
      </div>

      <div className="flex-1" />
      <div className="flex gap-[6px] border-t border-line2 px-[14px] py-[10px]">
        <button
          type="button"
          onClick={() => {
            move('retired')
          }}
          disabled={entry.status === 'retired'}
          data-retire
          className="flex-none rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink3 hover:bg-del-bg hover:text-del disabled:opacity-50"
        >
          Retire
        </button>
      </div>
    </aside>
  )
}
