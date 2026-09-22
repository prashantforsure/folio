'use client'

import type { ProjectId, PropRow } from '@folio/contracts'
import { useState } from 'react'

import { bindAlias, unbindAlias } from '../../../../../../lib/props/actions'
import { lineLabel } from '../../../../../../lib/props/view'
import { SectionHead } from '../_chrome/drawer-parts'
import type { Run } from '../_chrome/use-run'

/**
 * The alias table - `What the page calls it` - the Locations drawer's
 * `Sluglines here` for a prop, and the single most important control on
 * this route.
 *
 * A record's name is almost never what the script writes. "Game Ball"
 * appears nowhere; "the ball" appears eleven times. A row here is the
 * writer saying the two are one thing, and until one exists the evidence
 * section is empty however much the page says about the thing. So the
 * section is drawn above the description, not folded away with it.
 *
 * A row: the spelling in mono, the `name` pill when it is the record's own
 * name, who bound it in 10px mono, and the count of lines it reads in
 * right. On hover, `✕` to unbind - never the last row, for the reason
 * `unbindSlugline` gives: a record with no spelling at all can never
 * collect a line again.
 *
 * ## There is no conflict block here
 *
 * The Locations version answers a taken set text with `Move it here` /
 * `Keep it there`, because a slugline resolves to exactly one record.
 * `prop_aliases` carries no unique index per project (the ruling: two
 * props may both be "the bag"), so binding a spelling another record holds
 * is not a conflict and there is nothing to ask. The only refusal is
 * binding the same spelling here twice, which the primary key catches.
 */
export const AliasTable = ({
  projectId,
  row,
  busy,
  run,
  onBusy,
}: {
  readonly projectId: ProjectId
  readonly row: PropRow
  readonly busy: boolean
  readonly run: Run
  readonly onBusy: (busy: boolean) => void
}) => {
  const [binding, setBinding] = useState(false)
  const [alias, setAlias] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const finish = (failure: string | null): string | null => {
    onBusy(false)
    return failure
  }

  const bind = (): void => {
    const value = alias.trim()
    if (value === '') return
    onBusy(true)
    setNotice(null)
    run(async () => {
      const result = await bindAlias(projectId, row.id, value)
      if (result.status === 'refused') {
        setNotice(result.message)
        return finish(null)
      }
      if (result.status !== 'bound') return finish(result.message)
      setAlias('')
      setBinding(false)
      return finish(null)
    })
  }

  const unbind = (value: string): void => {
    onBusy(true)
    setNotice(null)
    run(async () => {
      const result = await unbindAlias(projectId, row.id, value)
      if (result.status === 'refused') {
        setNotice(result.message)
        return finish(null)
      }
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <SectionHead label="What the page calls it">
        <span className="text-11 text-ink3" data-alias-count={row.bound.length}>
          {row.bound.length} {row.bound.length === 1 ? 'spelling' : 'spellings'}
        </span>
      </SectionHead>
      <ul className="m-0 flex list-none flex-col p-0" data-alias-table>
        {row.bound.map((entry) => (
          <li key={entry.alias} className="group flex min-w-0 items-center gap-[8px] py-[4px]" data-alias-row={entry.alias}>
            <span
              className={`min-w-0 flex-1 truncate font-mono text-11 ${entry.lines === 0 ? 'border-b border-dashed border-line text-ink3' : 'text-ink2'}`}
              title={entry.lines === 0 ? 'Bound here; no line of action reads as this yet' : `${lineLabel(entry.lines)} in the script`}
            >
              {entry.alias}
            </span>
            {entry.isName ? (
              <span className="folio-cite flex-none" data-alias-name>
                name
              </span>
            ) : null}
            <span className="flex-none font-mono text-10 text-ink3" data-alias-by={entry.provenance}>
              {entry.provenance}
            </span>
            <span className="tabular w-[34px] flex-none text-right font-mono text-10-5 text-ink3" data-alias-lines={entry.lines}>
              × {entry.lines}
            </span>
            <button
              type="button"
              aria-label={`Unbind ${entry.alias}`}
              data-alias-unbind={entry.alias}
              disabled={busy || row.bound.length <= 1}
              title={row.bound.length <= 1 ? 'The only spelling bound here. Rename the prop, or bind another first.' : 'Unbind this spelling'}
              onClick={() => {
                unbind(entry.alias)
              }}
              className="folio-ghost-button grid h-[18px] w-[18px] flex-none place-items-center rounded-[4px] text-10 text-ink3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {notice === null ? null : (
        <span className="text-11 text-live" role="alert" data-alias-notice>
          {notice}
        </span>
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
            placeholder="the ball"
            aria-label="A spelling the page uses"
            onChange={(event) => {
              setAlias(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setBinding(false)
                setNotice(null)
              }
            }}
            className="folio-field h-[26px] w-[190px] rounded-[7px] py-0 font-mono text-10-5"
          />
          <button type="submit" data-bind-submit disabled={busy || alias.trim() === ''} className="folio-line-button h-[26px] rounded-[7px] px-[8px] text-11">
            Bind
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBinding(false)
              setNotice(null)
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
          + bind a spelling
        </button>
      )}
    </div>
  )
}
