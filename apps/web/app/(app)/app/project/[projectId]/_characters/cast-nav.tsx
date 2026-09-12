'use client'

import type { CastRow, ProjectId, WalkOnRow } from '@folio/contracts'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { createCharacter } from '../../../../../../lib/characters/actions'
import { characterHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { CharacterChip, WalkOnChip } from './chip'

/**
 * The cast column: the record list beside the Characters route.
 *
 * `Route - Characters.dc.html`, the `<aside>`: a find input on `--sheet`
 * with a `⌕`, then the groups - `PRINCIPAL 3`, `SUPPORTING 3`, `WALK-ONS 5`
 * - each row a 20px chip, the name (12px) over the role (10px `--ink3`),
 * one 5×12px presence tick per episode (`--ink2` in, `--line` absent), and
 * the scene count right-aligned in tabular 10.5px. Then the standing
 * `Unmatched names in script` row with an amber dot and the pending count,
 * which opens the resolve view; on that view it sits on `--note-bg` with a
 * `--note` border. The footer legend - `in episode` · `absent` · `from
 * cues` - is `CastNavFooter`, drawn by the column outside the list.
 *
 * Which row is selected is the URL: `/characters/:characterId` names one,
 * `/characters` alone names the first in nav order, which is what the
 * route shows for it. The find filter is component state - a filter is
 * not a sub-view.
 *
 * Walk-ons are one row: cues the writer said are nobody, "N unnamed", the
 * cue texts as the role line, their scene count summed. They have no
 * record and no profile, so the row goes nowhere.
 */

const GROUPS = [
  { id: 'principal', label: 'Principal' },
  { id: 'supporting', label: 'Supporting' },
] as const

export const CastNav = ({
  projectId,
  cast,
  walkOns,
  pending,
}: {
  readonly projectId: ProjectId
  readonly cast: readonly CastRow[]
  readonly walkOns: readonly WalkOnRow[]
  /** Open queue rows with a proposal - the rail badge's number. */
  readonly pending: number
}) => {
  const params = useParams<{ characterId?: string }>()
  const search = useSearchParams()
  const view = search.get('view') ?? 'profile'
  const [query, setQuery] = useState('')

  const first = cast[0]?.id ?? null
  const selected = view === 'profile' ? (params.characterId ?? first) : (params.characterId ?? null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return cast
    return cast.filter(
      (row) => row.name.toLowerCase().includes(needle) || (row.role ?? '').toLowerCase().includes(needle),
    )
  }, [cast, query])

  const resolveHref = `${projectRouteHref(projectId, 'characters')}?view=resolve` as const

  return (
    <>
      <div className="pb-[10px] pl-[4px] pr-[4px]">
        <label className="flex items-center gap-[7px] rounded-chrome border border-line2 bg-sheet pb-[5px] pl-[9px] pr-[9px] pt-[5px]">
          <span aria-hidden="true" className="text-11 text-ink3" style={{ fontFamily: 'var(--font-glyph)' }}>
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Find a character"
            aria-label="Find a character"
            className="min-w-0 flex-1 border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
          />
        </label>
      </div>

      {GROUPS.map((group) => {
        const rows = shown.filter((row) => row.group === group.id)
        if (rows.length === 0) return null
        return (
          <div key={group.id} className="flex flex-col gap-[1px]" data-cast-group={group.id}>
            <div className="flex items-center pb-[3px] pl-[8px] pr-[8px]">
              <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">{group.label}</span>
              <span className="tabular text-9-5 text-ink3">{rows.length}</span>
            </div>
            {rows.map((row) => {
              const active = row.id === selected && view === 'profile'
              return (
                <Link
                  key={row.id}
                  href={characterHref(projectId, row.id)}
                  aria-current={active ? 'page' : undefined}
                  data-cast-row={row.id}
                  className={`flex items-center gap-[8px] rounded-chrome border px-[8px] py-[6px] text-ink no-underline hover:bg-hover hover:no-underline ${
                    active ? 'border-accent-line bg-accent-bg' : 'border-transparent'
                  }`}
                >
                  <CharacterChip name={row.name} hue={row.hue} />
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="truncate text-12">{row.name}</span>
                    <span className="truncate text-10 text-ink3">
                      {row.role ?? (row.presence === 'absent' ? '0 appearances · record kept' : 'No role yet')}
                    </span>
                  </span>
                  <span className="flex flex-none gap-[2px]" aria-label={`In ${String(row.inEpisode.filter(Boolean).length)} of ${String(row.inEpisode.length)} episodes`}>
                    {row.inEpisode.map((present, index) => (
                      <span
                        key={index}
                        className={`h-[12px] w-[5px] rounded-bar ${present ? 'bg-ink2' : 'bg-line'}`}
                      />
                    ))}
                  </span>
                  <span className="tabular w-[18px] flex-none text-right text-10-5 text-ink3">{row.appearances}</span>
                </Link>
              )
            })}
          </div>
        )
      })}

      {walkOns.length > 0 && query === '' ? (
        <div className="flex flex-col gap-[1px]" data-cast-group="walk-ons">
          <div className="flex items-center pb-[3px] pl-[8px] pr-[8px]">
            <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">Walk-ons</span>
            <span className="tabular text-9-5 text-ink3">{walkOns.length}</span>
          </div>
          <div className="flex items-center gap-[8px] rounded-chrome border border-transparent px-[8px] py-[6px]">
            <WalkOnChip />
            <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="truncate text-12 text-ink2">{walkOns.length} unnamed</span>
              <span className="truncate text-10 text-ink3">{walkOns.map((row) => row.cue).join(', ')}</span>
            </span>
            <span className="tabular w-[18px] flex-none text-right text-10-5 text-ink3">
              {walkOns.reduce((total, row) => total + row.scenes, 0)}
            </span>
          </div>
        </div>
      ) : null}

      {pending > 0 ? (
        <Link
          href={resolveHref}
          data-unmatched-row
          className={`mt-[4px] flex items-center gap-[8px] rounded-chrome border px-[9px] py-[7px] no-underline hover:bg-hover hover:no-underline ${
            view === 'resolve' ? 'border-note bg-note-bg' : 'border-line2'
          }`}
        >
          <span className="h-[6px] w-[6px] flex-none rounded-full bg-note" />
          <span className="flex-1 text-11-5 text-ink">Unmatched names in script</span>
          <span className="tabular flex-none text-10-5 font-semibold text-note">{pending}</span>
        </Link>
      ) : null}
    </>
  )
}

/** The legend under the list: `in episode` · `absent` · `from cues`. */
export const CastNavFooter = () => (
  <div className="flex items-center gap-[8px] border-t border-line2 px-[10px] pb-[10px] pt-[8px] text-10 text-ink3">
    <span className="inline-flex items-center gap-[4px]">
      <span className="h-[10px] w-[5px] rounded-bar bg-ink2" />
      in episode
    </span>
    <span className="inline-flex items-center gap-[4px]">
      <span className="h-[10px] w-[5px] rounded-bar bg-line" />
      absent
    </span>
    <span className="flex-1" />
    <span>from cues</span>
  </div>
)

/**
 * The header's `＋`: "New character". Opens a one-field form in place; the
 * record is created by hand, its name bound as its first cue, and the
 * profile opened. AGENTS.md's "Add by hand" - a person who never speaks
 * has no cue to mint from, so the record is authored here once.
 */
export const NewCharacterButton = ({
  projectId,
  variant = 'icon',
}: {
  readonly projectId: ProjectId
  /** The column's 22px `＋`, or the header's accent `＋ New character`. */
  readonly variant?: 'icon' | 'accent'
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (name.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    const result = await createCharacter(projectId, name)
    setBusy(false)
    if (result.status !== 'created') {
      setError(result.message)
      return
    }
    setOpen(false)
    setName('')
    router.push(characterHref(projectId, result.id))
  }

  return (
    <span className="relative flex-none">
      {variant === 'icon' ? (
        <button
          type="button"
          title="New character"
          aria-label="New character"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="grid h-[22px] w-[22px] place-items-center rounded-chrome border-none bg-transparent text-14 text-ink3 hover:bg-hover"
          style={{ fontFamily: 'var(--font-glyph)' }}
        >
          ＋
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border-none bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink hover:opacity-90"
        >
          <span aria-hidden="true" className="text-11 opacity-75" style={{ fontFamily: 'var(--font-glyph)' }}>
            ＋
          </span>
          New character
        </button>
      )}
      {open ? (
        <form
          data-new-character-form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="absolute right-0 top-[26px] z-10 flex w-[220px] flex-col gap-[6px] rounded-chrome border border-line bg-panel p-[8px] shadow-[0_6px_18px_var(--scrim)]"
        >
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            placeholder="Character name"
            aria-label="Character name"
            className="w-full rounded-chrome border border-line2 bg-sheet px-[8px] py-[5px] text-11-5 text-ink outline-none placeholder:text-ink3"
          />
          {error === null ? null : <span className="text-10-5 text-del">{error}</span>}
          <span className="flex gap-[6px]">
            <button
              type="submit"
              disabled={busy || name.trim() === ''}
              className="flex-1 rounded-chrome border-none bg-accent px-[9px] py-[4px] text-11 font-semibold text-accent-ink disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[4px] text-11 text-ink2 hover:bg-hover"
            >
              Cancel
            </button>
          </span>
        </form>
      ) : null}
    </span>
  )
}
