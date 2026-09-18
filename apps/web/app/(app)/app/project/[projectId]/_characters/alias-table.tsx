'use client'

import type { CharacterProfile, ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import type { CharacterId } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { bindAlias, moveAlias, splitOff, unbindAlias } from '../../../../../../lib/characters/actions'
import type { AliasRow } from '../../../../../../lib/characters/cast'
import { aliasRowsOf } from '../../../../../../lib/characters/cast'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import { SectionHead } from '../_chrome/drawer-parts'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { Section } from './drawer-shell'

/**
 * `In the script as` - the alias table, on the drawer since 2026-09-17.
 * AGENTS.md, Entity identity: "Matching goes through an alias table -
 * `MEERA` 79, `MEERA (V.O.)` 3, `YOUNG MEERA` 2 - never by hashing the
 * string." The rows existed in every drawer's load and were drawn nowhere;
 * a writer could not see which spellings the app treats as one person, nor
 * fix a wrong one.
 *
 * One row per bound spelling (`lib/characters/cast.ts`, `aliasRowsOf`):
 * the spelling in mono, its variants with modifiers (`V.O. 3`), the `name`
 * pill on the record's own, who bound it (`derived` · `you` · `member`),
 * the count; on hover `Split off` (a spelling that is somebody else after
 * all - three writes in one statement, then the drawer moves to the new
 * record) and `×` (unbind - refused on the last spelling, with the reason
 * as the button's title). `+ add a spelling` is an inline form; a spelling
 * somebody else holds comes back as a conflict block with `Move it here`
 * (or `Merge into <name>` when it is their last) and `Keep it there`.
 *
 * Nothing here edits the script: an alias changes what the next pass
 * resolves, never a node.
 */
const LAST_SPELLING = 'That is the only spelling bound to this record. Rename the record, or merge it, instead.'

export const AliasTable = ({
  projectId,
  profile,
  busy,
  run,
  toast,
  onMerge,
}: {
  readonly projectId: ProjectId
  readonly profile: CharacterProfile
  readonly busy: boolean
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
  /** A `taken` spelling that is its holder's last: the drawer's merge door. */
  readonly onMerge: (holder: CharacterId, name: string) => void
}) => {
  const router = useRouter()
  const rows = useMemo(() => aliasRowsOf(profile), [profile])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const [taken, setTaken] = useState<{ readonly cue: string; readonly by: CharacterId; readonly name: string; readonly last: boolean } | null>(null)
  const [splitting, setSplitting] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const disabled = busy || working

  const bind = (): void => {
    const cue = draft.trim()
    if (cue === '') return
    setWorking(true)
    setNotice(null)
    setTaken(null)
    run(async () => {
      const result = await bindAlias(projectId, profile.id, cue)
      setWorking(false)
      if (result.status === 'bound') {
        setAdding(false)
        setDraft('')
        return null
      }
      if (result.status === 'taken') {
        setTaken({ cue: result.cue, by: result.by, name: result.name, last: result.last })
        return null
      }
      setNotice(result.message)
      return result.message
    })
  }

  const move = (): void => {
    if (taken === null) return
    setWorking(true)
    run(async () => {
      const result = await moveAlias(projectId, profile.id, taken.cue)
      setWorking(false)
      if (result.status === 'moved') {
        setTaken(null)
        setAdding(false)
        setDraft('')
        return null
      }
      const message = result.status === 'last' ? `${taken.cue} is ${result.name}'s only spelling. Merge the two records instead.` : result.message
      setNotice(message)
      return message
    })
  }

  const unbind = (cue: string): void => {
    setWorking(true)
    setNotice(null)
    run(async () => {
      const result = await unbindAlias(projectId, profile.id, cue)
      setWorking(false)
      if (result.status === 'saved') return null
      setNotice(result.message)
      return result.message
    })
  }

  const split = (row: AliasRow): void => {
    setWorking(true)
    setNotice(null)
    run(async () => {
      const result = await splitOff(projectId, profile.id, row.cue)
      setWorking(false)
      setSplitting(null)
      if (result.status !== 'created') {
        setNotice(result.message)
        return result.message
      }
      toast(`Split ${row.cue} off into its own record.`)
      router.push(characterHref(projectId, result.id))
      return null
    })
  }

  return (
    <Section>
      <SectionHead label="In the script as">
        <span className="text-11 text-ink3" data-alias-count={rows.length}>
          {rows.length} {rows.length === 1 ? 'spelling' : 'spellings'}
        </span>
      </SectionHead>
      {rows.length === 0 ? (
        <span className="text-11 text-ink3" data-alias-rows="none">
          No spelling is bound yet.
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-alias-rows={rows.length}>
          {rows.map((row) => (
            <li key={row.cue} className="group/alias flex flex-col gap-[6px] py-[5px]" data-alias-row={row.cue}>
              <div className="flex min-w-0 items-center gap-[8px]">
                <span
                  className={`min-w-0 truncate font-mono text-12 ${row.counted ? 'text-ink' : 'text-ink3 underline decoration-dashed underline-offset-4'}`}
                  title={row.counted ? undefined : 'Bound; no cue uses it yet'}
                >
                  {row.cue}
                </span>
                {row.variants.map((variant) => (
                  <span key={variant.cue} className="folio-cite flex-none" data-alias-variant title={variant.cue}>
                    {variant.modifiers.join(' ')} {variant.occurrences}
                  </span>
                ))}
                {row.isName ? (
                  <span className="flex-none rounded-pill bg-s2 px-[7px] py-[1px] text-10 text-ink2" data-alias-name>
                    name
                  </span>
                ) : null}
                <span className="flex-none font-mono text-10 text-ink3" data-alias-by={row.provenance}>
                  {row.provenance}
                </span>
                <span className="flex-1" />
                <span className="tabular flex-none font-mono text-11 text-ink3">{row.occurrences}</span>
                {row.isName ? null : (
                  <button
                    type="button"
                    data-alias-split={row.cue}
                    disabled={disabled}
                    onClick={() => {
                      setSplitting(row.cue)
                    }}
                    className="folio-ghost-button h-[20px] flex-none rounded-[6px] px-[6px] text-10-5 text-ink3 opacity-0 hover:!text-ink2 focus-visible:opacity-100 group-hover/alias:opacity-100"
                  >
                    Split off
                  </button>
                )}
                <button
                  type="button"
                  data-alias-unbind={row.cue}
                  aria-label={`Unbind ${row.cue}`}
                  title={rows.length <= 1 ? LAST_SPELLING : `Unbind ${row.cue}`}
                  disabled={disabled || rows.length <= 1}
                  onClick={() => {
                    unbind(row.cue)
                  }}
                  className="folio-ghost-button grid h-[20px] w-[20px] flex-none place-items-center rounded-[6px] text-ink3 opacity-0 hover:!text-live disabled:cursor-default disabled:hover:!text-ink3 focus-visible:opacity-100 group-hover/alias:opacity-100 group-hover/alias:disabled:opacity-40"
                >
                  <Icon name="close" size={10} strokeWidth={1.6} />
                </button>
              </div>
              {splitting === row.cue ? (
                <div className="flex flex-wrap items-center gap-[8px] rounded-[9px] border border-line2 bg-sunk px-[10px] py-[8px]" data-alias-split-confirm>
                  <span className="min-w-0 flex-1 text-11-5 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
                    Split {row.cue} off? Its {row.occurrences} {row.occurrences === 1 ? 'cue becomes' : 'cues become'} a new character named {row.cue}; the script is untouched.
                  </span>
                  <button
                    type="button"
                    data-alias-split-keep
                    disabled={disabled}
                    onClick={() => {
                      setSplitting(null)
                    }}
                    className="folio-line-button h-[26px] flex-none rounded-[7px] px-[9px] text-11"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    data-alias-split-confirm-button
                    disabled={disabled}
                    onClick={() => {
                      split(row)
                    }}
                    className="folio-warn-button h-[26px] flex-none rounded-[7px] px-[9px] text-11 font-medium"
                  >
                    Split off
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
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
            value={draft}
            data-alias-input
            disabled={disabled}
            placeholder="YOUNG MEERA"
            aria-label="A spelling to bind"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAdding(false)
                setDraft('')
                setTaken(null)
              }
            }}
            className="folio-field h-[24px] w-[160px] rounded-[7px] py-0 font-mono text-10-5 uppercase"
          />
          <button type="submit" data-alias-bind disabled={disabled || draft.trim() === ''} className="folio-line-button h-[24px] rounded-[7px] px-[8px] text-11">
            Bind
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => {
              setAdding(false)
              setDraft('')
              setTaken(null)
            }}
            className="folio-ghost-button grid h-[24px] w-[24px] place-items-center rounded-[7px] text-ink3"
          >
            <Icon name="close" size={10} strokeWidth={1.5} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          data-alias-add
          disabled={disabled}
          onClick={() => {
            setAdding(true)
          }}
          className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
        >
          + add a spelling
        </button>
      )}
      {taken === null ? null : (
        <div data-alias-taken={taken.by}>
          <ConflictBlock
            title={`${taken.cue} already resolves to ${taken.name}.`}
            detail={taken.last ? `A spelling binds to one record, and it is ${taken.name}'s only one.` : 'A spelling binds to one record.'}
            accept={taken.last ? `Merge into ${taken.name}` : 'Move it here'}
            deliberate="Keep it there"
            busy={disabled}
            onAccept={() => {
              if (taken.last) onMerge(taken.by, taken.name)
              else move()
            }}
            onDeliberate={() => {
              setTaken(null)
            }}
          />
        </div>
      )}
      {notice === null ? null : (
        <span className="text-11 text-live" role="alert" data-alias-notice>
          {notice}
        </span>
      )}
    </Section>
  )
}
