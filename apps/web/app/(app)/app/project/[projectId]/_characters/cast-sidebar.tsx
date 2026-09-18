'use client'

import type { ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import { useState } from 'react'

import type { CastGroup } from '../../../../../../lib/characters/cast'
import { CAST_GROUPS, CAST_GROUP_LABELS, onPageOf, statusTone } from '../../../../../../lib/characters/cast'
import { setDrawerIntent, setNewCharacterOpen, setQueueIntent } from '../../../../../../lib/characters/compose'
import { count } from '../../../../../../lib/workspace/format'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { FindField, useFind } from '../_chrome/find-field'
import { CountsWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'
import { useCharactersView } from './view-state'

/**
 * The Characters sidebar's four slots, on the record routes' shared pieces
 * (`_chrome/record-sidebar.tsx`, `_chrome/find-field.tsx`) since 2026-09-17:
 * the project's name with `+` (`New character`), the recessed `Find a
 * character` field, the grouped list, and the foot widget.
 *
 * ## The groups
 *
 *   `Needs a decision`  the queue's open rows - an amber dot, the mono cue,
 *                       `N cues`; a row switches to the Cast view and
 *                       unfolds the queue
 *   `Principal` · `Supporting` · `Off the page`
 *                       the records, by the threshold in `lib/characters/cast.ts`:
 *                       a 6px status dot (README, "Status as a dot plus a
 *                       pill" - a dot in lists), the name over the role, the
 *                       scene count. An off-page record shows a ghost `×` on
 *                       hover: it opens the drawer on its delete confirm, so
 *                       the write goes through the page's `run` and the
 *                       status bar
 *   `Walk-ons`          the cues the writer said are nobody, collapsed; a
 *                       row unfolds them under the queue where `Actually a
 *                       character` takes the decision back
 *
 * ## The widget
 *
 * `Needs a decision · 3` (amber, a button that opens the queue) and `On the
 * page · 6 of 8` - both derived. The mockup drew `Defined N / M` over a
 * status the writer sets by clicking, in accent blue the README reserves
 * for links, selection and AI; that went with the rebuild (ruled 2026-09-17).
 *
 * ## The find field filters the list it sits above
 *
 * The mockup's field has no behaviour; here it narrows the record groups
 * by name or role, and nothing else - the grid has its own `All characters
 * ▾` filter. The query rides `FindProvider`, which the layout wraps the
 * card in; component state, worth no link.
 *
 * ## Which row is lit
 *
 * The drawer is `/characters/:id`, so the selected record is the URL and
 * `useSelectedLayoutSegment` reads it from under the route's layout.
 */

export type CastSidebarRow = {
  readonly id: string
  readonly name: string
  readonly role: string | null
  readonly appearances: number
  readonly group: CastGroup
  readonly status: 'draft' | 'defined' | 'locked'
  readonly presence: 'present' | 'absent'
}

/** An open cue as the sidebar lists it: the queue's rows and the walk-ons share the shape. */
export type CastSidebarCue = {
  readonly key: string
  readonly cue: string
  readonly occurrences: number
}

export const CastTitleRow = ({ title }: { readonly title: string }) => (
  <RecordTitleRow
    title={title}
    action="New character"
    attr="data-sidebar-new-character"
    onAction={() => {
      setNewCharacterOpen(true)
    }}
  />
)

export const CastFind = () => <FindField placeholder="Find a character" testId="cast-find" />

const matches = (row: CastSidebarRow, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return row.name.toLowerCase().includes(needle) || (row.role ?? '').toLowerCase().includes(needle)
}

const cuesLabel = (n: number): string => (n === 1 ? '1 cue' : `${String(n)} cues`)

const CueRow = ({ cue, attr, onPick }: { readonly cue: CastSidebarCue; readonly attr: `data-${string}`; readonly onPick: () => void }) => (
  <li>
    <button type="button" {...{ [attr]: cue.key }} onClick={onPick} className="folio-record-row w-full text-left">
      <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
      <span className="min-w-0 flex-1 truncate font-mono text-12 text-ink">{cue.cue}</span>
      <span className="tabular flex-none text-11 text-ink3">{cuesLabel(cue.occurrences)}</span>
    </button>
  </li>
)

export const CastGroups = ({
  projectId,
  rows,
  decisions,
  walkOns,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly CastSidebarRow[]
  readonly decisions: readonly CastSidebarCue[]
  readonly walkOns: readonly CastSidebarCue[]
}) => {
  const { query } = useFind()
  const selected = useSelectedLayoutSegment()
  const router = useRouter()
  const { setView } = useCharactersView()
  const [walkOnsOpen, setWalkOnsOpen] = useState(false)
  const groups = CAST_GROUPS.map((group) => ({
    group,
    items: rows.filter((row) => row.group === group && matches(row, query)),
  })).filter((entry) => entry.items.length > 0)

  if (rows.length === 0 && decisions.length === 0) {
    return <SidebarNote attr="data-cast-empty">Characters appear here as the script names them. Nothing to list yet.</SidebarNote>
  }

  const openQueue = (intent: 'rows' | 'walk-ons'): void => {
    setQueueIntent(intent)
    setView('cast')
    if (selected !== null) router.push(`/app/project/${projectId}/characters`)
  }

  return (
    <div className="flex flex-col gap-[16px]" data-cast-groups>
      {decisions.length === 0 ? null : (
        <RecordGroup label="Needs a decision" total={decisions.length} attr={{ 'data-cast-group': 'decisions' }} countAttr="data-decisions-count">
          {decisions.map((cue) => (
            <CueRow
              key={cue.key}
              cue={cue}
              attr="data-decision-row"
              onPick={() => {
                openQueue('rows')
              }}
            />
          ))}
        </RecordGroup>
      )}
      {groups.length === 0 && rows.length > 0 ? <SidebarNote attr="data-cast-no-match">No character matches that.</SidebarNote> : null}
      {groups.map(({ group, items }) => (
        <RecordGroup key={group} label={CAST_GROUP_LABELS[group]} total={items.length} attr={{ 'data-cast-group': group }}>
          {items.map((row) => (
            <li key={row.id} className="group/row relative">
              <Link
                href={characterHref(projectId, row.id)}
                data-cast-row={row.id}
                aria-current={row.id === selected ? 'page' : undefined}
                className="folio-record-row"
              >
                <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} />
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="truncate text-13">{row.name}</span>
                  <span className="truncate text-10-5 text-ink3">{row.role ?? 'No role yet'}</span>
                </span>
                <span className={`tabular flex-none font-mono text-10-5 text-ink3 ${group === 'off-page' ? 'group-hover/row:invisible' : ''}`}>
                  {count(row.appearances)} sc
                </span>
              </Link>
              {group === 'off-page' ? (
                <button
                  type="button"
                  data-cast-delete={row.id}
                  aria-label={`Delete ${row.name}`}
                  title={`Delete ${row.name}`}
                  onClick={() => {
                    setDrawerIntent('delete')
                    router.push(characterHref(projectId, row.id))
                  }}
                  className="folio-ghost-button absolute right-[8px] top-1/2 grid h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-[5px] text-ink3 opacity-0 hover:!text-live focus-visible:opacity-100 group-hover/row:opacity-100"
                >
                  <Icon name="close" size={10} strokeWidth={1.6} />
                </button>
              ) : null}
            </li>
          ))}
        </RecordGroup>
      ))}
      {walkOns.length === 0 ? null : (
        <div className="flex flex-col gap-[2px]" data-cast-group="walk-ons">
          <button
            type="button"
            data-walk-ons-toggle
            aria-expanded={walkOnsOpen}
            onClick={() => {
              setWalkOnsOpen((open) => !open)
            }}
            className="folio-ghost-button flex w-full items-center rounded-[7px] pb-[6px] pl-[10px] pr-[10px] pt-0 text-left hover:!bg-transparent"
          >
            <span className="folio-eyebrow flex-1">Walk-ons</span>
            <span className="tabular text-11 text-ink3" data-walk-ons-count>
              {count(walkOns.length)}
            </span>
            <Icon name="chevron" size={11} strokeWidth={1.5} className={`ml-[6px] text-ink3 transition-transform ${walkOnsOpen ? 'rotate-180' : ''}`} />
          </button>
          {walkOnsOpen ? (
            <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
              {walkOns.map((cue) => (
                <CueRow
                  key={cue.key}
                  cue={cue}
                  attr="data-walk-on-row"
                  onPick={() => {
                    openQueue('walk-ons')
                  }}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The foot widget: `Needs a decision · 3` (a button that opens the queue) and `On the page · 6 of 8`. */
export const CastFootWidget = ({
  projectId,
  rows,
  decisions,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly { readonly presence: 'present' | 'absent' }[]
  readonly decisions: number
}) => {
  const router = useRouter()
  const selected = useSelectedLayoutSegment()
  const { setView } = useCharactersView()
  const { present, total } = onPageOf(rows)
  return (
    <CountsWidget
      attr="cast"
      rows={[
        {
          label: 'Needs a decision',
          value: String(decisions),
          attr: 'data-decisions-total',
          ...(decisions > 0
            ? {
                tone: 'warn' as const,
                onClick: () => {
                  setQueueIntent('rows')
                  setView('cast')
                  if (selected !== null) router.push(`/app/project/${projectId}/characters`)
                },
              }
            : {}),
        },
        { label: 'On the page', value: `${String(present)} of ${String(total)}`, attr: 'data-on-page-count' },
      ]}
    />
  )
}
