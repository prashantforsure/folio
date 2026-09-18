'use client'

import type { BoundSetView, LocationRow, ProjectId, SluglineVariantRow } from '@folio/contracts'
import { canonicalKey, readSlugline } from '@folio/script'
import Link from 'next/link'
import { useState } from 'react'

import { citeOf } from '../../../../../../lib/characters/figures'
import { bindSluglineAlias, moveAlias, unbindSluglineAlias } from '../../../../../../lib/locations/actions'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import { SectionHead } from '../_chrome/drawer-parts'
import type { Run } from '../_chrome/use-run'

/**
 * The alias table - `Sluglines here` - as the rebuild draws it (2026-09-18):
 * one row per bound set text, because the bound set texts are what make
 * `THE CHAWL` and `KAMATHI CHAWL` one place and this is the only surface a
 * writer can see and change that on. A row: the set text in mono (a link
 * into the script at its first heading when a heading uses it; dashed and
 * `--ink3` when nothing does yet), the `name` pill on the record's own
 * name, who bound it (`derived` - a pass; `you`; `member`) in 10px mono,
 * and the count of headings right. On hover: `×` to unbind (never the
 * last row). Under the rows, the counted heading spellings the sub-sets
 * bring in, so a primary set still shows `INT. CHAWL CORRIDOR × 6`.
 *
 * `+ bind a set text` opens an inline input: Enter binds, Escape cancels.
 * A set text another record holds comes back as a conflict block - `Move
 * it here` (`moveAlias`, one statement) or `Keep it there`. Every change
 * re-derives; the script is never edited.
 */
export const SluglineTable = ({
  projectId,
  shape,
  row,
  busy,
  run,
  onBusy,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly row: LocationRow
  readonly busy: boolean
  readonly run: Run
  readonly onBusy: (busy: boolean) => void
}) => {
  const [binding, setBinding] = useState(false)
  const [alias, setAlias] = useState('')
  const [taken, setTaken] = useState<{ readonly set: string; readonly message: string } | null>(null)
  const nameKey = canonicalKey(row.name)
  const ownKeys = new Set(row.bound.map((entry) => canonicalKey(entry.slugline)))
  // Heading spellings the sub-sets bring in: counted here or below, not one of this record's own set texts.
  const below: readonly SluglineVariantRow[] = row.children === 0 ? [] : row.sluglines.filter((entry) => !ownKeys.has(setKeyOfHeading(entry.slugline)))
  const total = row.sluglines.reduce((sum, entry) => sum + entry.occurrences, 0)

  const finish = (failure: string | null): string | null => {
    onBusy(false)
    return failure
  }

  const bind = (): void => {
    const set = alias.trim()
    if (set === '') return
    onBusy(true)
    setTaken(null)
    run(async () => {
      const result = await bindSluglineAlias(projectId, row.id, set)
      if (result.status === 'refused') {
        setTaken({ set, message: result.message })
        return finish(null)
      }
      if (result.status !== 'bound') return finish(result.message)
      setAlias('')
      setBinding(false)
      return finish(null)
    })
  }

  const move = (set: string): void => {
    onBusy(true)
    run(async () => {
      const result = await moveAlias(projectId, row.id, set)
      if (result.status !== 'moved') return finish(result.message)
      setTaken(null)
      setAlias('')
      setBinding(false)
      return finish(null)
    })
  }

  const unbind = (set: string): void => {
    onBusy(true)
    run(async () => {
      const result = await unbindSluglineAlias(projectId, row.id, set)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <SectionHead label="Sluglines here">
        <span className="text-11 text-ink3" data-slugline-note>
          {total === 0 ? 'Not on the page yet' : `${String(total)} in the script`}
          <span className="text-ink3"> · </span>
          <span data-alias-count={row.bound.length}>
            {row.bound.length} {row.bound.length === 1 ? 'spelling' : 'spellings'}
          </span>
        </span>
      </SectionHead>
      <ul className="m-0 flex list-none flex-col p-0" data-alias-table>
        {row.bound.map((entry) => (
          <AliasRow
            key={entry.slugline}
            entry={entry}
            isName={canonicalKey(entry.slugline) === nameKey}
            last={row.bound.length <= 1}
            busy={busy}
            projectId={projectId}
            shape={shape}
            onUnbind={() => {
              unbind(entry.slugline)
            }}
          />
        ))}
        {below.map((entry) => (
          <li key={entry.slugline} className="flex items-center gap-[8px] py-[4px]" data-alias-below={entry.slugline}>
            <span className="min-w-0 flex-1 truncate font-mono text-11 uppercase text-ink3" title="A heading under one of this set's sub-sets">
              {entry.slugline}
            </span>
            <span className="tabular flex-none font-mono text-10-5 text-ink3">× {entry.occurrences}</span>
          </li>
        ))}
      </ul>
      {taken === null ? null : (
        <div data-alias-taken>
          <ConflictBlock
            title={taken.message}
            detail="A set text binds to one record."
            accept="Move it here"
            deliberate="Keep it there"
            busy={busy}
            onAccept={() => {
              move(taken.set)
            }}
            onDeliberate={() => {
              setTaken(null)
            }}
          />
        </div>
      )}
      {binding ? (
        <form
          className="flex items-center gap-[6px]"
          onSubmit={(event) => {
            event.preventDefault()
            bind()
          }}
        >
          <input
            autoFocus
            type="text"
            value={alias}
            disabled={busy}
            data-bind-input
            placeholder="THE CHAWL"
            aria-label="A set text to bind"
            onChange={(event) => {
              setAlias(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setBinding(false)
                setTaken(null)
              }
            }}
            className="folio-field h-[26px] w-[190px] rounded-[7px] py-0 font-mono text-10-5 uppercase"
          />
          <button type="submit" data-bind-submit disabled={busy || alias.trim() === ''} className="folio-line-button h-[26px] rounded-[7px] px-[8px] text-11">
            Bind
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBinding(false)
              setTaken(null)
            }}
            className="folio-ghost-button h-[26px] rounded-[7px] px-[6px] text-11 text-ink3"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          data-bind-open
          disabled={busy}
          onClick={() => {
            setBinding(true)
          }}
          className="folio-ghost-button self-start rounded-[7px] px-[6px] py-[3px] text-11 text-ink3 hover:!text-ink2"
        >
          + bind a set text
        </button>
      )}
    </div>
  )
}

/** A counted heading's set key, read the way the pass reads it. */
const setKeyOfHeading = (heading: string): string => {
  const reading = readSlugline(heading)
  return canonicalKey(reading.ok ? reading.value.set : heading)
}

const AliasRow = ({
  entry,
  isName,
  last,
  busy,
  projectId,
  shape,
  onUnbind,
}: {
  readonly entry: BoundSetView
  readonly isName: boolean
  readonly last: boolean
  readonly busy: boolean
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly onUnbind: () => void
}) => {
  const first = entry.firstRef === null ? null : citeOf(projectId, shape, entry.firstRef)
  return (
    <li className="group flex min-w-0 items-center gap-[8px] py-[4px]" data-alias-row={entry.slugline}>
      {first === null ? (
        <span
          className="min-w-0 flex-1 truncate border-b border-dashed border-line font-mono text-11 uppercase text-ink3"
          title="Bound to this record; no heading uses it yet"
          data-alias-unused
        >
          {entry.slugline}
        </span>
      ) : (
        <Link
          href={first.href}
          data-cite-link
          title={`Open the script at ${first.label}`}
          className="min-w-0 flex-1 truncate font-mono text-11 uppercase text-ink2 no-underline hover:text-accent hover:no-underline"
        >
          {entry.slugline}
        </Link>
      )}
      {isName ? (
        <span className="folio-cite flex-none" data-alias-name>
          name
        </span>
      ) : null}
      <span className="flex-none font-mono text-10 text-ink3" data-alias-by={entry.provenance}>
        {entry.provenance}
      </span>
      <span className="tabular w-[34px] flex-none text-right font-mono text-10-5 text-ink3" data-alias-occurrences={entry.occurrences}>
        × {entry.occurrences}
      </span>
      <button
        type="button"
        aria-label={`Unbind ${entry.slugline}`}
        data-alias-unbind={entry.slugline}
        disabled={busy || last}
        title={last ? 'The only set text bound here. Rename the record, or merge it, instead.' : 'Unbind this set text'}
        onClick={onUnbind}
        className="folio-ghost-button grid h-[18px] w-[18px] flex-none place-items-center rounded-[4px] text-10 text-ink3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
      >
        ✕
      </button>
    </li>
  )
}
