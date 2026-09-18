'use client'

import type { LocationRow, ProjectId, SceneRef } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import type { LocationId } from '@folio/script'
import { EpisodeBars, PRESENCE_STRIP_LIMIT, PresenceStrip } from '@folio/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { initialsOf, reasonLabel } from '../../../../../../lib/characters/cast'
import { citeOf } from '../../../../../../lib/characters/figures'
import {
  createLocation,
  decideSimilar,
  deleteLocation,
  mergeLocations,
  previewRename,
  removeLocationPhoto,
  renameLocation,
  saveLocation,
  setParent,
  undoRename,
  uploadLocationPhoto,
} from '../../../../../../lib/locations/actions'
import { subtreeOf } from '../../../../../../lib/locations/figures'
import type { RenamePreview } from '../../../../../../lib/locations/result'
import { daysLabel, longestGap, refLabel, storyTimeLabel, stripGroupsOf } from '../../../../../../lib/locations/view'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import { count, eighths } from '../../../../../../lib/workspace/format'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref, researchSourceHref } from '../../../../../../lib/workspace/hrefs'
import { CastMark } from '../_characters/cast-mark'
import { ConflictBlock } from '../_chrome/conflict-block'
import { DrawerNotice, SectionHead } from '../_chrome/drawer-parts'
import { DrawerShell, Section } from '../_chrome/drawer-shell'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import type { LocationDraft } from './location-fields'
import { NameField, PartOfField, ProductionFields, daysOf } from './location-fields'
import type { EpisodeRow } from './locations-workspace'
import { RenameConfirm } from './rename-confirm'
import { QuadrantBoxes, Thumb } from './set-parts'
import { SluglineTable } from './slugline-table'

/**
 * `/locations/:locationId` - the drawer, as the rebuild draws it
 * (2026-09-18, the plan is the spec): the script's evidence first, the
 * writer's notes last.
 *
 * Head: `Edit location`, a linked meta line (`9 scenes · 41 2/8 pp · E1
 * Sc 1 → E3 Sc 17`), `Ask` (the assistant, with the place named) and
 * `Open in script`. Then: the name; **On the page** - the first action
 * line under any heading at the set, quoted, with `Use as description`;
 * **Presence** - the strip across the script with `first · last` and the
 * longest gap; **Sluglines here** - the alias table (`slugline-table.tsx`);
 * **Scenes** by episode with the quadrant per group; **Who's here** -
 * everyone, with counts; **Inside** - the sub-sets, `+ Add a sub-set`, and
 * `Part of`; **Research** - clips filed here; **Same place?** - a record
 * whose spellings read as this one's. Last, the **Production** fold:
 * status, address, shooting days, description, photo.
 *
 * ## Save is one write; a changed name is a rename first
 *
 * The fields are a draft until `Save`, written in one `saveLocation`
 * (description, address, status, shooting days) plus `setParent` when the
 * edge moved. A changed name is not a field: it is the sanctioned
 * write-back (AGENTS.md, "Derivation is one-way - except"), so the drawer
 * asks in place with `previewRename`'s numbers and runs `renameLocation`
 * first on yes; the status bar then offers `Undo` for a few seconds
 * (`undoRename`).
 *
 * ## Delete, and merge beside it
 *
 * The action refuses a delete while the record is in the script (a record
 * deleted under a live heading is minted again on the next pass). So a
 * present record's foot offers `In N scenes · Merge into…` in Delete's
 * place; an absent one offers `Delete`.
 */
const SCENES_SHOWN = 8

export const LocationDrawer = ({
  projectId,
  shape,
  row,
  rows,
  index,
  episodes,
  storage,
  baseHref,
  charactersHref,
  researchHref,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly row: LocationRow
  /** Every record, for the parent and merge pickers. */
  readonly rows: readonly LocationRow[]
  readonly index: readonly SceneRef[]
  readonly episodes: readonly EpisodeRow[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  readonly charactersHref: ProjectRoutePath
  readonly researchHref: ProjectRoutePath
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const router = useRouter()
  const ephemeral = useEphemeral()
  const session = useSession()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<LocationDraft>({
    name: row.name,
    address: row.address ?? '',
    description: row.description ?? '',
    status: row.status,
    parentId: row.parentId ?? '',
    scheduledDays: String(row.scheduledDays),
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rename' | 'delete' | 'merge' | null>(null)
  const [preview, setPreview] = useState<RenamePreview | null>(null)
  const [winner, setWinner] = useState('')
  const [subSetName, setSubSetName] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const close = useCallback(() => {
    router.push(baseHref)
  }, [baseHref, router])
  // The open record is the assistant's Focus while the drawer is up (ruled
  // 2026-09-18, the Characters shape): published on mount, cleared on unmount.
  const { setAssistantFocus } = ephemeral
  useEffect(() => {
    setAssistantFocus({ kind: 'location', id: row.id, name: row.name })
    return () => {
      setAssistantFocus(null)
    }
  }, [row.id, row.name, setAssistantFocus])

  const renamed = draft.name.trim() !== '' && draft.name.trim() !== row.name
  const onPage = row.presence === 'present' || row.rollup.scenes > 0
  const own = subtreeOf(row.id, rows)
  const parents = rows.filter((entry) => !own.has(entry.id) && entry.parentId === null).map((entry) => ({ id: entry.id, name: entry.name }))
  const others = rows.filter((entry) => entry.id !== row.id)
  const subSets = rows.filter((entry) => entry.parentId === row.id)
  const here = new Set(row.scenes.map((scene) => scene.scene.sceneNodeId))
  const first = row.firstSeen === null ? null : citeOf(projectId, shape, row.firstSeen)
  const last = row.lastSeen === null ? null : citeOf(projectId, shape, row.lastSeen)
  const gap = onPage ? longestGap(here, index) : null

  const finish = (failure: string | null): string | null => {
    setBusy(false)
    if (failure !== null) setNotice(failure)
    return failure
  }

  const openRename = (): void => {
    setConfirm('rename')
    setPreview(null)
    void previewRename(projectId, row.id, draft.name.trim()).then(setPreview)
  }

  const save = (withRename: boolean): void => {
    const name = draft.name.trim()
    if (name === '') {
      setNotice('A location needs a name.')
      return
    }
    const days = daysOf(draft.scheduledDays)
    if (days === null) {
      setNotice('Shooting days is a whole number.')
      return
    }
    if (renamed && !withRename) {
      openRename()
      return
    }
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      let renameToast: (() => void) | null = null
      if (renamed && withRename) {
        const result = await renameLocation(projectId, row.id, name)
        if (result.status === 'taken') return finish(`${result.slugline} already resolves to ${result.name}. Merge the two records instead.`)
        if (result.status !== 'renamed') return finish(result.message)
        const { undo, headings, episodes: touched } = result
        renameToast = () => {
          toast(`Renamed · ${count(headings)} ${headings === 1 ? 'heading' : 'headings'} in ${count(touched)} ${touched === 1 ? 'episode' : 'episodes'} → ${undo.name.toUpperCase()}.`, {
            label: 'Undo',
            onClick: () => {
              run(async () => {
                const undone = await undoRename(projectId, undo)
                if (undone.status !== 'undone') return undone.message
                toast(undone.skipped === 0 ? 'Undone.' : `Undone · ${count(undone.skipped)} ${undone.skipped === 1 ? 'heading' : 'headings'} changed since and stayed.`)
                return null
              })
            },
          })
        }
      }
      const saved = await saveLocation(projectId, row.id, {
        description: draft.description,
        address: draft.address,
        status: draft.status,
        scheduledDays: days,
      })
      if (saved.status !== 'saved') return finish(saved.message)
      if (draft.parentId !== (row.parentId ?? '')) {
        const moved = await setParent(projectId, row.id, draft.parentId === '' ? null : draft.parentId)
        if (moved.status !== 'saved') return finish(moved.message)
      }
      setBusy(false)
      renameToast?.()
      router.push(baseHref)
      return null
    })
  }

  const upload = (file: File): void => {
    setBusy(true)
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadLocationPhoto(projectId, row.id, form)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const removePhoto = (): void => {
    setBusy(true)
    run(async () => {
      const result = await removeLocationPhoto(projectId, row.id)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await deleteLocation(projectId, row.id)
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
      const result = await mergeLocations(projectId, row.id, into)
      if (result.status !== 'merged') return finish(result.message)
      setBusy(false)
      toast(`Merged ${row.name} into ${rows.find((entry) => entry.id === into)?.name ?? 'the other record'}.`)
      router.push(locationHref(projectId, result.into))
      return null
    })
  }

  const differ = (other: LocationId): void => {
    setBusy(true)
    run(async () => {
      const result = await decideSimilar(projectId, row.id, { kind: 'differ', other })
      return finish(result.status === 'saved' || result.status === 'merged' ? null : result.message)
    })
  }

  const addSubSet = (): void => {
    const name = (subSetName ?? '').trim()
    if (name === '') return
    setBusy(true)
    run(async () => {
      const result = await createLocation(projectId, name, row.id)
      if (result.status !== 'created') return finish(result.message)
      setBusy(false)
      setSubSetName(null)
      toast(`${name} is inside ${row.name}.`)
      router.push(locationHref(projectId, result.id))
      return null
    })
  }

  const meta = onPage ? (
    <>
      <span data-meta-scenes>
        {count(row.rollup.scenes)} {row.rollup.scenes === 1 ? 'scene' : 'scenes'}
      </span>
      {row.eighths === null ? null : <span> · {eighths(row.eighths)} pp</span>}
      {first === null || last === null ? null : (
        <>
          <span> · </span>
          <Link href={first.href} data-meta-first className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
            {first.label}
          </Link>
          {first.href === last.href ? null : (
            <>
              <span>→</span>
              <Link href={last.href} data-meta-last className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                {last.label}
              </Link>
            </>
          )}
        </>
      )}
      <span> · {row.ie ?? '—'}</span>
    </>
  ) : (
    'Not on the page yet'
  )

  // The scene list, grouped by episode, eight per group until unfolded.
  const groups = episodes
    .map((episode) => ({ episode, scenes: row.scenes.filter((scene) => scene.scene.episodeOrdinal === episode.ordinal) }))
    .filter((group) => group.scenes.length > 0)

  return (
    <DrawerShell
      title="Edit location"
      meta={meta}
      label={`Edit ${row.name}`}
      route="locations"
      lead={<Thumb id={row.id} name={row.name} photoUrl={row.photoUrl} size={32} />}
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
              title="Open the script at its first scene"
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
              Delete {row.name}? The record goes; the script is untouched.
            </span>
            <button type="button" data-delete-keep onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button type="button" data-delete-confirm onClick={destroy} className="folio-line-button h-[34px] flex-none rounded-[9px] border-live px-[14px] text-live hover:border-live hover:bg-live-bg hover:text-live">
              Delete
            </button>
          </>
        ) : confirm === 'merge' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Merge {row.name} into another location? Its set texts and scenes become the other's; the script is untouched.
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
              <option value="">Pick a location</option>
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
        ) : confirm === 'rename' ? (
          <RenameConfirm
            from={row.name}
            preview={preview}
            busy={busy}
            onConfirm={() => {
              save(true)
            }}
            onKeep={() => {
              setConfirm(null)
              setDraft((current) => ({ ...current, name: row.name }))
            }}
            onMerge={(holder) => {
              setDraft((current) => ({ ...current, name: row.name }))
              merge(holder)
            }}
          />
        ) : (
          <>
            {onPage ? (
              <button
                type="button"
                data-drawer-merge
                disabled={busy}
                title="Still in the script, so it cannot be deleted; merge it into another location instead."
                onClick={() => {
                  setConfirm('merge')
                }}
                className="folio-ghost-button h-[34px] flex-none rounded-[9px] px-[10px] text-12 text-ink3 hover:!text-ink2"
              >
                In {count(row.rollup.scenes)} {row.rollup.scenes === 1 ? 'scene' : 'scenes'} · Merge into…
              </button>
            ) : (
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
            )}
            <DrawerNotice notice={notice} />
            <div className="flex-1" />
            <button type="button" data-drawer-cancel disabled={busy} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Cancel
            </button>
            <button type="button" data-drawer-save disabled={busy} onClick={() => save(false)} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      }
    >
      <NameField
        value={draft.name}
        busy={busy}
        onChange={(name) => {
          setDraft((current) => ({ ...current, name }))
        }}
      />

      <Section>
        <SectionHead label="On the page">
          <span className="text-11 text-ink3">from the script</span>
        </SectionHead>
        {row.intro === null ? (
          <span className="text-11 text-ink3" data-drawer-intro="none">
            {onPage ? 'Nothing written about it yet - the first action under one of its headings would be quoted here.' : 'Not on the page yet'}
          </span>
        ) : (
          <div className="flex flex-col gap-[6px]" data-drawer-intro={row.intro.nodeId}>
            <p className="m-0 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
              {row.intro.text}
            </p>
            <div className="flex items-center gap-[8px]">
              <Link href={citeOf(projectId, shape, row.intro.scene).href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                {refLabel(row.intro.scene)}
              </Link>
              <button
                type="button"
                data-drawer-use-intro
                disabled={busy}
                title="Copy this line into the description; Save keeps it"
                onClick={() => {
                  const text = row.intro?.text ?? ''
                  setDraft((current) => ({ ...current, description: text }))
                  setNotice(null)
                }}
                className="folio-ghost-button rounded-[7px] px-[6px] py-[2px] text-11 text-ink3 hover:!text-ink2"
              >
                Use as description
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section>
        <SectionHead label="Presence">
          <span className="text-11 text-ink3">from the script</span>
        </SectionHead>
        {!onPage ? (
          <span className="text-11 text-ink3" data-drawer-strip="none">
            Not on the page yet
          </span>
        ) : (
          <>
            {index.length <= PRESENCE_STRIP_LIMIT.drawer ? (
              <PresenceStrip groups={stripGroupsOf(here, index, episodes)} size="drawer" />
            ) : (
              <EpisodeBars counts={row.perEpisode} />
            )}
            {first === null || last === null ? null : (
              <span className="flex flex-wrap items-center gap-[6px] text-11 text-ink3" data-drawer-span>
                first
                <Link href={first.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {first.label}
                </Link>
                · last
                <Link href={last.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {last.label}
                </Link>
              </span>
            )}
            {gap === null ? null : (
              <span className="flex flex-wrap items-center gap-[6px] text-11 text-ink3" data-drawer-gap={gap.scenes}>
                longest gap · {gap.scenes} scenes ·
                <Link href={citeOf(projectId, shape, gap.from).href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {refLabel(gap.from)}
                </Link>
                →
                <Link href={citeOf(projectId, shape, gap.to).href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {refLabel(gap.to)}
                </Link>
              </span>
            )}
          </>
        )}
      </Section>

      <Section>
        <SluglineTable projectId={projectId} shape={shape} row={row} busy={busy} run={run} onBusy={setBusy} />
      </Section>

      <Section>
        <SectionHead label="Scenes">
          <span className="text-11 text-ink3" data-drawer-scenes={row.scenes.length}>
            {row.scenes.length === 0 ? 'Not on the page yet' : `${String(row.scenes.length)} in the script`}
          </span>
        </SectionHead>
        {row.scenes.length === 0 ? null : (
          <div className="flex flex-col gap-[6px]">
            <QuadrantBoxes quadrant={row.rollupQuadrant} attr="data-drawer-quadrant" />
            {groups.map(({ episode, scenes }) => {
              const open = expanded.has(episode.ordinal)
              const shown = open ? scenes : scenes.slice(0, SCENES_SHOWN)
              const rest = scenes.length - shown.length
              const pages = scenes.reduce<number | null>((sum, scene) => (scene.eighths === null ? sum : (sum ?? 0) + scene.eighths), null)
              return (
                <div key={episode.ordinal} className="flex flex-col" data-drawer-episode={episode.ordinal}>
                  {episodes.length > 1 ? (
                    <span className="folio-eyebrow sticky top-0 z-[1] flex items-center gap-[6px] bg-sunk py-[4px]">
                      E{episode.ordinal} · {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
                      {pages === null ? null : <span> · {eighths(pages)}</span>}
                    </span>
                  ) : null}
                  {shown.map((scene) => {
                    const ref = citeOf(projectId, shape, scene.scene)
                    const time = storyTimeLabel(scene)
                    return (
                      <div key={scene.scene.sceneNodeId} data-scene-row={scene.scene.sceneNodeId} className="flex min-w-0 items-center gap-[8px] py-[4px]">
                        <Link href={ref.href} data-cite-link className="folio-cite w-[54px] flex-none text-center no-underline hover:border-accent hover:text-accent hover:no-underline">
                          {episodes.length > 1 ? ref.label : `Sc ${String(scene.scene.number)}`}
                        </Link>
                        <span className="tabular w-[26px] flex-none font-mono text-10 text-ink3">{scene.ie}</span>
                        <span
                          className="folio-tone-fill h-[7px] w-[7px] flex-none rounded-[2px]"
                          data-tone={scene.light === 'day' ? 'warn' : scene.light === 'night' ? 'accent' : undefined}
                          title={scene.timeOfDay ?? 'No time of day'}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-11 uppercase text-ink2" title={scene.scene.heading}>
                          {scene.at.id === row.id ? scene.scene.heading : `${scene.scene.heading} · in ${scene.at.name}`}
                        </span>
                        {time === '' ? null : <span className="flex-none font-mono text-10 text-ink3">{time}</span>}
                        <span className="tabular w-[34px] flex-none text-right font-mono text-10-5 text-ink3">{eighths(scene.eighths)}</span>
                      </div>
                    )
                  })}
                  {rest > 0 ? (
                    <button
                      type="button"
                      data-drawer-more={episode.ordinal}
                      onClick={() => {
                        setExpanded((current) => new Set([...current, episode.ordinal]))
                      }}
                      className="folio-ghost-button self-start rounded-[7px] px-[6px] py-[2px] text-11 text-ink3 hover:!text-ink2"
                    >
                      + {rest} more {rest === 1 ? 'scene' : 'scenes'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section>
        <SectionHead label="Who's here">
          <Link href={charactersHref} data-drawer-characters className="text-11 text-accent no-underline hover:underline">
            → Characters
          </Link>
        </SectionHead>
        {row.people.length === 0 ? (
          <span className="text-11 text-ink3" data-people="none">
            {onPage ? 'Nobody named in these scenes.' : 'Not on the page yet'}
          </span>
        ) : (
          <div className="flex flex-col gap-[2px]" data-people={row.people.length}>
            {row.people.map((person) => (
              <Link
                key={person.id}
                href={characterHref(projectId, person.id)}
                className="folio-ghost-button -mx-[9px] flex min-w-0 items-center gap-[10px] rounded-[9px] px-[9px] py-[6px] text-left text-ink no-underline hover:no-underline"
                data-person={person.id}
              >
                <CastMark initial={initialsOf(person.name)} hue={person.hue} size={22} radius={7} fontSize={9} />
                <span className="min-w-0 flex-1 truncate text-12-5">{person.name}</span>
                <span className="tabular flex-none font-mono text-10-5 text-ink3">{person.scenes} sc</span>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <SectionHead label="Inside">
          <span className="text-11 text-ink3" data-drawer-subsets={subSets.length}>
            {subSets.length === 0 ? 'no sub-sets' : `${String(subSets.length)} ${subSets.length === 1 ? 'sub-set' : 'sub-sets'}`}
          </span>
        </SectionHead>
        {subSets.length === 0 ? null : (
          <div className="flex flex-col gap-[2px]">
            {subSets.map((sub) => (
              <Link
                key={sub.id}
                href={locationHref(projectId, sub.id)}
                data-drawer-subset={sub.id}
                className="folio-ghost-button -mx-[9px] flex min-w-0 items-center gap-[10px] rounded-[9px] px-[9px] py-[6px] text-left text-ink no-underline hover:no-underline"
              >
                <span className="min-w-0 flex-1 truncate text-12-5">{sub.name}</span>
                <span className="tabular flex-none font-mono text-10-5 text-ink3">
                  {sub.rollup.scenes} sc{sub.rollup.shootingDays > 0 ? ` · ${daysLabel(sub.scheduledDays, sub.rollup.shootingDays)}` : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
        {subSetName === null ? (
          <button
            type="button"
            data-drawer-add-subset
            disabled={busy}
            onClick={() => {
              setSubSetName('')
            }}
            className="folio-ghost-button self-start rounded-[7px] px-[6px] py-[3px] text-11 text-ink3 hover:!text-ink2"
          >
            + Add a sub-set
          </button>
        ) : (
          <form
            className="flex items-center gap-[6px]"
            onSubmit={(event) => {
              event.preventDefault()
              addSubSet()
            }}
          >
            <input
              autoFocus
              type="text"
              value={subSetName}
              disabled={busy}
              data-subset-input
              placeholder="Corridor"
              aria-label="The sub-set's name"
              onChange={(event) => {
                setSubSetName(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSubSetName(null)
              }}
              className="folio-field h-[26px] w-[190px] rounded-[7px] py-0 text-12"
            />
            <button type="submit" data-subset-create disabled={busy || subSetName.trim() === ''} className="folio-line-button h-[26px] rounded-[7px] px-[8px] text-11">
              Create inside {row.name}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSubSetName(null)
              }}
              className="folio-ghost-button h-[26px] rounded-[7px] px-[6px] text-11 text-ink3"
            >
              Cancel
            </button>
          </form>
        )}
        <PartOfField
          value={draft.parentId}
          parents={parents}
          busy={busy}
          onChange={(parentId) => {
            setDraft((current) => ({ ...current, parentId }))
          }}
        />
      </Section>

      <Section>
        <SectionHead label="Research">
          <Link href={researchHref} data-drawer-research className="text-11 text-accent no-underline hover:underline">
            → Research
          </Link>
        </SectionHead>
        {row.clips.length === 0 ? (
          <span className="text-11 text-ink3" data-clips="none">
            No clip is filed here yet. On Research, a clip's `Send to…` names this place.
          </span>
        ) : (
          <div className="flex flex-col gap-[6px]" data-clips={row.clips.length}>
            {row.clips.map((clip) => (
              <Link
                key={clip.id}
                href={researchSourceHref(projectId, clip.sourceId)}
                data-clip={clip.id}
                className="flex min-w-0 flex-col gap-[2px] rounded-[9px] border border-line2 bg-bg px-[10px] py-[7px] text-ink no-underline hover:border-line hover:no-underline"
              >
                <span className="line-clamp-2 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
                  {clip.text}
                </span>
                <span className="truncate text-10-5 text-ink3">{clip.sourceTitle}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {row.similar.length === 0 ? null : (
        <Section>
          <SectionHead label="Same place?">
            <span className="text-11 text-ink3">from the spellings</span>
          </SectionHead>
          {row.similar.map((other) => (
            <div key={other.id} data-drawer-similar={other.id}>
              <ConflictBlock
                title={`${row.name} and ${other.name} read as one place.`}
                detail={`Their set texts read as one (${reasonLabel(other.reason)}). Merging keeps both spellings on one record; the script is not changed either way.`}
                accept={`Merge into ${other.name}`}
                deliberate="They're different"
                busy={busy}
                onAccept={() => {
                  merge(other.id)
                }}
                onDeliberate={() => {
                  differ(other.id)
                }}
              />
            </div>
          ))}
        </Section>
      )}

      <details open data-drawer-production className="group/fold flex flex-col border-t border-line2 pt-[16px]">
        <summary className="flex cursor-pointer list-none items-baseline gap-[8px] [&::-webkit-details-marker]:hidden">
          <span className="flex-1 text-11-5 text-ink2">Production</span>
          <span className="text-11 text-ink3">not from the script</span>
        </summary>
        <div className="flex flex-col gap-[14px] pt-[10px]">
          <ProductionFields draft={draft} onChange={setDraft} busy={busy} rollupDays={row.rollup.shootingDays} />
          <div className="flex flex-col gap-[6px]">
            <span className="text-11-5 text-ink2">Photo</span>
            <div className="flex items-center gap-[10px]">
              <Thumb id={row.id} name={row.name} photoUrl={row.photoUrl} size={44} />
              <button
                type="button"
                data-drawer-upload
                disabled={busy || !storage}
                title={storage ? 'A photo of the place' : 'Photo storage is not set up on this server yet.'}
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
