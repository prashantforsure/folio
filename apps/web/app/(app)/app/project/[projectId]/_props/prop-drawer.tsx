'use client'

import type { ProjectId, PropRow } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import { citeOf } from '../../../../../../lib/characters/figures'
import { deleteProp, mergeProps, removePropPhoto, renameProp, saveProp, uploadPropPhoto } from '../../../../../../lib/props/actions'
import { lineLabel, metaLong, productionLine } from '../../../../../../lib/props/view'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { propHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerNotice, SectionHead } from '../_chrome/drawer-parts'
import { DrawerShell, Section } from '../_chrome/drawer-shell'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { AliasTable } from './alias-table'
import { PropThumb } from './prop-card'
import type { PropDraft } from './prop-fields'
import { CategoryField, NameField, ProductionFields } from './prop-fields'

/**
 * `/props/:propId` - the drawer. The script's evidence first, the writer's
 * notes last, as the Locations drawer is arranged.
 *
 * Head: `Edit prop`, a meta line (`12 lines across 4 scenes · E1 Sc 3`),
 * `Ask` (the assistant, with the prop named) and `Open in script`. Then:
 * the name and category; **What the page calls it** - the alias table, the
 * control this route turns on; **On the page** - the lines of action
 * quoted with their scene as a link; **Production** - what already needs
 * it, then the status, description and photo.
 *
 * ## Save is one write, and a changed name is a second
 *
 * The fields are a draft until `Save`, written in one `saveProp` (category,
 * description, status). A changed name goes through `renameProp` first -
 * which swaps the spelling that *was* the name in the alias table and
 * touches no node, because a prop's name is written nowhere the app owns.
 * There is no confirm dialog and no diff to show: unlike a location
 * rename, this one cannot change the script (AGENTS.md's exception table -
 * ruling 6 keeps it that way).
 *
 * ## Delete says what it clears
 *
 * There is no "still in the script" refusal, because nothing mints a prop
 * back. What a delete *does* take is any Production field pointing at it
 * (`on delete set null`), so the confirm counts them rather than hiding
 * it. Merge is offered beside Delete for the other case: two records that
 * turned out to be one thing.
 */
const EVIDENCE_SHOWN = 8

export const PropDrawer = ({
  projectId,
  shape,
  row,
  rows,
  categories,
  storage,
  baseHref,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly row: PropRow
  /** Every record, for the merge picker. */
  readonly rows: readonly PropRow[]
  readonly categories: readonly string[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const router = useRouter()
  const ephemeral = useEphemeral()
  const session = useSession()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<PropDraft>({
    name: row.name,
    category: row.category ?? '',
    description: row.description ?? '',
    status: row.status,
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'merge' | null>(null)
  const [winner, setWinner] = useState('')
  const [expanded, setExpanded] = useState(false)
  const close = useCallback(() => {
    router.push(baseHref)
  }, [baseHref, router])

  const others = rows.filter((entry) => entry.id !== row.id)
  const first = row.firstSeen === null ? null : citeOf(projectId, shape, row.firstSeen)
  const needed = productionLine(row)
  const uses = row.shots.length + row.sceneSetups
  const shown = expanded ? row.evidence : row.evidence.slice(0, EVIDENCE_SHOWN)

  const finish = (failure: string | null): string | null => {
    setBusy(false)
    if (failure !== null) setNotice(failure)
    return failure
  }

  const save = (): void => {
    const name = draft.name.trim()
    if (name === '') {
      setNotice('A prop needs a name.')
      return
    }
    setBusy(true)
    setNotice(null)
    run(async () => {
      if (name !== row.name) {
        const renamed = await renameProp(projectId, row.id, name)
        if (renamed.status !== 'saved') return finish(renamed.message)
      }
      const saved = await saveProp(projectId, row.id, {
        category: draft.category,
        description: draft.description,
        status: draft.status,
      })
      if (saved.status !== 'saved') return finish(saved.message)
      setBusy(false)
      router.push(baseHref)
      return null
    })
  }

  const upload = (file: File): void => {
    setBusy(true)
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadPropPhoto(projectId, row.id, form)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const removePhoto = (): void => {
    setBusy(true)
    run(async () => {
      const result = await removePropPhoto(projectId, row.id)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await deleteProp(projectId, row.id)
      if (result.status !== 'deleted') return finish(result.message)
      setBusy(false)
      toast(`Deleted ${row.name}.`)
      router.push(baseHref)
      return null
    })
  }

  const merge = (into: string): void => {
    if (into === '') return
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await mergeProps(projectId, row.id, into)
      if (result.status !== 'merged') return finish(result.message)
      setBusy(false)
      toast(`Merged ${row.name} into ${rows.find((entry) => entry.id === into)?.name ?? 'the other record'}.`)
      router.push(propHref(projectId, result.into))
      return null
    })
  }

  return (
    <DrawerShell
      title="Edit prop"
      meta={metaLong(row)}
      label={`Edit ${row.name}`}
      route="props"
      lead={<PropThumb id={row.id} name={row.name} photoUrl={row.photoUrl} size={32} />}
      actions={
        <>
          <button
            type="button"
            data-drawer-ask
            title={`Ask the assistant about ${row.name}`}
            onClick={() => {
              ephemeral.setAssistantPrompt(`About ${row.name}: `)
              session.setAssistantOpen(true)
            }}
            className="folio-ghost-button h-[28px] rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2"
          >
            Ask
          </button>
          {first === null ? null : (
            <Link
              href={first.href}
              data-drawer-open-script
              title="Open the script at its first line"
              className="folio-ghost-button flex h-[28px] items-center rounded-[8px] px-[8px] text-11-5 text-ink3 no-underline hover:!text-ink2 hover:no-underline"
            >
              Open in script
            </Link>
          )}
        </>
      }
      onClose={close}
      footer={
        confirm === 'delete' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Delete {row.name}?{' '}
              {uses === 0
                ? 'Nothing in Production names it. The script is untouched.'
                : `${String(uses)} Production ${uses === 1 ? 'field' : 'fields'} naming it will be cleared. The script is untouched.`}
            </span>
            <button type="button" data-delete-keep onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button
              type="button"
              data-delete-confirm
              onClick={destroy}
              className="folio-line-button h-[34px] flex-none rounded-[9px] border-live px-[14px] text-live hover:border-live hover:bg-live-bg hover:text-live"
            >
              Delete
            </button>
          </>
        ) : confirm === 'merge' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Merge {row.name} into another prop? Its spellings and its Production fields become the other's; the script is untouched.
            </span>
            <select
              aria-label="Merge into"
              data-merge-into
              value={winner}
              onChange={(event) => {
                setWinner(event.target.value)
              }}
              className="folio-field h-[34px] max-w-[150px] rounded-[9px] py-0 text-12"
            >
              <option value="">Pick a prop</option>
              {others.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <button type="button" data-merge-cancel onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button
              type="button"
              data-merge-confirm
              disabled={winner === ''}
              onClick={() => {
                merge(winner)
              }}
              className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[14px] text-12-5 font-medium"
            >
              Merge
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-drawer-delete
              disabled={busy}
              title="Delete this record"
              onClick={() => {
                setConfirm('delete')
              }}
              className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5"
            >
              Delete
            </button>
            {others.length === 0 ? null : (
              <button
                type="button"
                data-drawer-merge
                disabled={busy}
                title="Two records that turned out to be one thing"
                onClick={() => {
                  setConfirm('merge')
                }}
                className="folio-ghost-button h-[34px] flex-none rounded-[9px] px-[10px] text-12 text-ink3 hover:!text-ink2"
              >
                Merge into…
              </button>
            )}
            <DrawerNotice notice={notice} />
            <div className="flex-1" />
            <button type="button" data-drawer-cancel disabled={busy} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Cancel
            </button>
            <button type="button" data-drawer-save disabled={busy} onClick={save} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-[11px]">
        <NameField
          value={draft.name}
          busy={busy}
          onChange={(name) => {
            setDraft((current) => ({ ...current, name }))
          }}
        />
        <CategoryField
          value={draft.category}
          categories={categories}
          busy={busy}
          onChange={(category) => {
            setDraft((current) => ({ ...current, category }))
          }}
        />
      </div>

      <Section>
        <AliasTable projectId={projectId} row={row} busy={busy} run={run} onBusy={setBusy} />
      </Section>

      <Section>
        <SectionHead label="On the page">
          <span className="text-11 text-ink3" data-evidence-count={row.lines}>
            {lineLabel(row.lines)}
          </span>
        </SectionHead>
        {row.evidence.length === 0 ? (
          <span className="text-11 text-ink3" data-drawer-evidence="none">
            {row.bound.length <= 1
              ? 'Nothing yet. Bind what the page calls it above - a prop is almost never written by its record name.'
              : 'No line of action reads as this prop yet.'}
          </span>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-[7px] p-0" data-evidence-list>
              {shown.map((line) => {
                const cite = citeOf(projectId, shape, line.scene)
                return (
                  <li key={line.nodeId} className="flex min-w-0 flex-col gap-[3px]" data-evidence-row={line.nodeId} data-confidence={line.confidence}>
                    <span className="text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                      {line.text}
                    </span>
                    <Link href={cite.href} data-cite-link className="folio-cite self-start no-underline hover:border-accent hover:text-accent hover:no-underline">
                      {cite.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
            {row.evidence.length > EVIDENCE_SHOWN && !expanded ? (
              <button
                type="button"
                data-evidence-more
                onClick={() => {
                  setExpanded(true)
                }}
                className="folio-ghost-button self-start rounded-[7px] px-[6px] py-[3px] text-11 text-ink3 hover:!text-ink2"
              >
                Show all {row.evidence.length}
              </button>
            ) : null}
          </>
        )}
      </Section>

      <details open data-drawer-production className="group/fold flex flex-col border-t border-line2 pt-[16px]">
        <summary className="flex cursor-pointer list-none items-baseline gap-[8px] [&::-webkit-details-marker]:hidden">
          <span className="flex-1 text-11-5 text-ink2">Production</span>
          <span className="text-11 text-ink3">not from the script</span>
        </summary>
        <div className="flex flex-col gap-[14px] pt-[10px]">
          {needed === '' ? null : (
            <span className="text-11-5 text-ink2" data-drawer-needed>
              {needed}
            </span>
          )}
          <ProductionFields draft={draft} onChange={setDraft} busy={busy} />
          <div className="flex flex-col gap-[6px]">
            <span className="text-11-5 text-ink2">Photo</span>
            <div className="flex items-center gap-[10px]">
              <PropThumb id={row.id} name={row.name} photoUrl={row.photoUrl} size={44} />
              <button
                type="button"
                data-drawer-upload
                disabled={busy || !storage}
                title={storage ? 'A photo of the prop' : 'Photo storage is not set up on this server yet.'}
                onClick={() => {
                  picker.current?.click()
                }}
                className="folio-line-button h-[30px] rounded-[9px] px-[12px] text-12"
              >
                {row.photoUrl === null ? 'Upload photo' : 'Replace'}
              </button>
              <input
                ref={picker}
                type="file"
                accept={PORTRAIT_TYPES.join(',')}
                aria-label={`Photo of ${row.name}`}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file !== undefined) upload(file)
                }}
              />
              {row.photoUrl === null ? (
                storage ? null : (
                  <span className="text-11 text-ink3">Photo storage is not set up on this server yet.</span>
                )
              ) : (
                <button type="button" data-drawer-remove-photo disabled={busy} onClick={removePhoto} className="folio-ghost-button h-[30px] rounded-[9px] px-[10px] text-12 text-ink3 hover:!text-ink2">
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </details>
    </DrawerShell>
  )
}
