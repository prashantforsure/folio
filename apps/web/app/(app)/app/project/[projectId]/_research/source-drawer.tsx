'use client'

import type {
  ProjectId,
  ResearchClipId,
  ResearchClipRow,
  ResearchCollectionId,
  ResearchCollectionRow,
  ResearchSourceEdit,
  ResearchSourceKind,
  ResearchSourceRow,
} from '@folio/contracts'
import { RESEARCH_COLLECTION_NAME_MAX, RESEARCH_SOURCE_KINDS, RESEARCH_SOURCE_KIND_LABELS, RESEARCH_TITLE_MAX } from '@folio/contracts'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { relativeTime } from '../../../../../../lib/format/relative-time'
import { addSource, removeSource, saveSource } from '../../../../../../lib/research/actions'
import type { DrawerTarget } from '../../../../../../lib/research/compose'
import { setResearchDrawer, useResearchDrawer } from '../../../../../../lib/research/compose'
import type { FilingTargets } from '../../../../../../lib/research/server'
import { clipsLabel, drawerMeta, filingLabel } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { researchSourceHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerShell, Field, Section } from '../_chrome/drawer-shell'
import { useRun } from '../_chrome/use-run'
import { ClipMenu } from './clip-menu'
import { KindGlyph } from './kind'

/**
 * The edit drawer - `Route - Research v2.dc.html`: `Edit source` over
 * `Interview · added 3 weeks ago`; the fields - Title, Type and Collection
 * side by side, Origin in mono, Note; `Clips from this source` with its
 * count, one card per clip with its filing chips or `Not filed yet`, or
 * `No clips from this source yet.`; and the foot - `Delete` left, `Cancel`
 * / `Save` right (README, "Drawer").
 *
 * ## One field the mockup does not draw
 *
 * `Text` - the body the source page reads and clips are cut from. The
 * mockup's transcript arrives from nowhere; there is no file ingestion or
 * page fetcher in this repository (either is a dependency and a product
 * call), so the text is typed or pasted here. Flagged.
 *
 * ## Collection is a pick
 *
 * The select lists the project's collections, `No collection`, and `New
 * collection…`, which reveals a name field. The name is created with the
 * save (`ResearchCollectionPick`), so a collection never exists empty; one
 * that empties when a source leaves it is dropped by the same write.
 *
 * ## The same drawer adds a source
 *
 * `＋ Add source` - the toolbar's, the sidebar's `+`, the grid's dashed card,
 * the empty card's - opens it as `Add source` with nothing to edit yet: the
 * fields, then `Cancel` / `Add`; no clips section. On add the router goes
 * to the new source's page. `Paste a link` opens it with the origin filled.
 */

type CollectionChoice = 'none' | 'new' | ResearchCollectionId

type Draft = {
  readonly kind: ResearchSourceKind
  readonly title: string
  readonly origin: string
  readonly note: string
  readonly body: string
  readonly collection: CollectionChoice
  readonly newCollection: string
}

const EMPTY: Draft = { kind: 'article', title: '', origin: '', note: '', body: '', collection: 'none', newCollection: '' }

const draftOf = (source: ResearchSourceRow): Draft => ({
  kind: source.kind,
  title: source.title,
  origin: source.origin ?? '',
  note: source.note ?? '',
  body: source.body,
  collection: source.collection?.id ?? 'none',
  newCollection: '',
})

const editOf = (draft: Draft): ResearchSourceEdit | string => {
  if (draft.title.trim() === '') return 'A source needs a title.'
  if (draft.collection === 'new' && draft.newCollection.trim() === '') return 'Name the new collection, or pick one.'
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    origin: draft.origin.trim() === '' ? null : draft.origin.trim(),
    note: draft.note.trim() === '' ? null : draft.note.trim(),
    body: draft.body,
    collection: draft.collection === 'none' ? null : draft.collection === 'new' ? { name: draft.newCollection.trim() } : { id: draft.collection },
  }
}

export const SourceDrawer = ({
  projectId,
  sources,
  collections,
  clips,
  targets,
  baseHref,
}: {
  readonly projectId: ProjectId
  readonly sources: readonly ResearchSourceRow[]
  readonly collections: readonly ResearchCollectionRow[]
  readonly clips: readonly ResearchClipRow[]
  readonly targets: FilingTargets
  readonly baseHref: ProjectRoutePath
}) => {
  const target = useResearchDrawer()
  if (target === null) return null
  const source = target.kind === 'edit' ? (sources.find((row) => row.id === target.id) ?? null) : null
  if (target.kind === 'edit' && source === null) return null
  const key = target.kind === 'edit' ? target.id : 'new'
  return (
    <SourceForm
      key={key}
      projectId={projectId}
      target={target}
      source={source}
      collections={collections}
      clips={source === null ? [] : clips.filter((clip) => clip.sourceId === source.id)}
      targets={targets}
      baseHref={baseHref}
    />
  )
}

const SourceForm = ({
  projectId,
  target,
  source,
  collections,
  clips,
  targets,
  baseHref,
}: {
  readonly projectId: ProjectId
  readonly target: Exclude<DrawerTarget, null>
  readonly source: ResearchSourceRow | null
  readonly collections: readonly ResearchCollectionRow[]
  readonly clips: readonly ResearchClipRow[]
  readonly targets: FilingTargets
  readonly baseHref: ProjectRoutePath
}) => {
  const router = useRouter()
  const pathname = usePathname()
  const { run } = useRun()
  const originField = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft>(() =>
    source === null ? { ...EMPTY, origin: target.kind === 'new' ? (target.origin ?? '') : '' } : draftOf(source),
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [openClip, setOpenClip] = useState<ResearchClipId | null>(null)
  const close = useCallback(() => {
    setResearchDrawer(null)
  }, [])

  // `Paste a link` lands in the origin field.
  useEffect(() => {
    if (target.kind === 'new' && target.origin !== undefined) originField.current?.focus()
  }, [target])

  const set = <K extends keyof Draft>(field: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const save = (): void => {
    const edit = editOf(draft)
    if (typeof edit === 'string') {
      setNotice(edit)
      return
    }
    setBusy(true)
    setNotice(null)
    run(async () => {
      const result = source === null ? await addSource(projectId, edit) : await saveSource(projectId, source.id, edit)
      setBusy(false)
      if (result.status !== 'saved') {
        setNotice(result.message)
        return result.message
      }
      setResearchDrawer(null)
      if (source === null) router.push(researchSourceHref(projectId, result.id))
      else router.refresh()
      return null
    })
  }

  const destroy = (): void => {
    if (source === null) return
    setBusy(true)
    setConfirm(false)
    run(async () => {
      const result = await removeSource(projectId, source.id)
      setBusy(false)
      if (result.status !== 'deleted') {
        setNotice(result.message)
        return result.message
      }
      setResearchDrawer(null)
      if (pathname === researchSourceHref(projectId, source.id)) router.push(baseHref)
      else router.refresh()
      return null
    })
  }

  const meta = source === null ? 'Not in the library yet' : drawerMeta(source.kind, relativeTime(source.createdAt, new Date()))

  return (
    <DrawerShell
      route="research"
      title={source === null ? 'Add source' : 'Edit source'}
      meta={meta}
      label={source === null ? 'Add source' : `Edit ${source.title}`}
      onClose={close}
      footer={
        confirm && source !== null ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Delete this source? {clips.length === 0 ? 'It has no clips.' : `Its ${clipsLabel(clips.length)} and their filings go with it.`} The script is untouched.
            </span>
            <button type="button" data-delete-keep onClick={() => setConfirm(false)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
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
        ) : (
          <>
            {source === null ? null : (
              <button type="button" data-drawer-delete disabled={busy} onClick={() => setConfirm(true)} className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5">
                Delete
              </button>
            )}
            {notice === null ? null : (
              <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-drawer-notice>
                {notice}
              </span>
            )}
            <div className="flex-1" />
            <button type="button" data-drawer-cancel disabled={busy} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Cancel
            </button>
            <button type="button" data-drawer-save disabled={busy} onClick={save} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
              {busy ? 'Saving…' : source === null ? 'Add' : 'Save'}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-[11px]">
        <Field label="Title">
          <input
            value={draft.title}
            maxLength={RESEARCH_TITLE_MAX}
            disabled={busy}
            autoFocus={target.kind === 'new' && target.origin === undefined}
            onChange={(event) => set('title', event.target.value)}
            placeholder="What this source is"
            data-field="title"
            className="folio-drawer-field leading-[1.45]"
            style={{ padding: '10px 12px' }}
          />
        </Field>
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <Field label="Type">
            <span className="folio-drawer-field flex items-center gap-[7px]" data-field="kind">
              <KindGlyph kind={draft.kind} />
              <select
                value={draft.kind}
                disabled={busy}
                aria-label="Type"
                onChange={(event) => set('kind', event.target.value as ResearchSourceKind)}
                className="folio-select min-w-0 flex-1 border-none bg-transparent text-13 text-ink outline-none"
              >
                {RESEARCH_SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {RESEARCH_SOURCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </span>
          </Field>
          <Field label="Collection">
            <select
              value={draft.collection}
              disabled={busy}
              aria-label="Collection"
              data-field="collection"
              onChange={(event) => set('collection', event.target.value as CollectionChoice)}
              className="folio-drawer-field folio-select truncate"
            >
              <option value="none">No collection</option>
              {collections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
              <option value="new">New collection…</option>
            </select>
          </Field>
        </div>
        {draft.collection === 'new' ? (
          <Field label="New collection">
            <input
              value={draft.newCollection}
              maxLength={RESEARCH_COLLECTION_NAME_MAX}
              disabled={busy}
              autoFocus
              onChange={(event) => set('newCollection', event.target.value)}
              placeholder="Chawl life"
              data-field="new-collection"
              className="folio-drawer-field"
            />
          </Field>
        ) : null}
        <Field label="Origin">
          <input
            ref={originField}
            value={draft.origin}
            disabled={busy}
            onChange={(event) => set('origin', event.target.value)}
            placeholder="A link, a publication, a date - or own"
            data-field="origin"
            className="folio-drawer-field truncate font-mono text-12"
          />
        </Field>
        <Field label="Note">
          <textarea
            value={draft.note}
            disabled={busy}
            onChange={(event) => set('note', event.target.value)}
            placeholder="What matters in it, and for whom"
            data-field="note"
            data-kind="prose"
            className="folio-drawer-field min-h-[72px]"
          />
        </Field>
        <Field label="Text">
          <textarea
            value={draft.body}
            disabled={busy}
            onChange={(event) => set('body', event.target.value)}
            placeholder="The transcript or the copy. Lines you highlight on the source page become clips."
            data-field="body"
            data-kind="prose"
            className="folio-drawer-field min-h-[140px]"
          />
        </Field>
      </div>

      {source === null ? null : (
        <Section gap={10}>
          <div className="flex items-baseline gap-[8px]">
            <span className="flex-1 text-11-5 text-ink2">Clips from this source</span>
            <span className="tabular text-11 text-ink3" data-drawer-clip-count>
              {clipsLabel(clips.length)}
            </span>
          </div>
          <div className="flex flex-col gap-[8px]">
            {clips.map((clip) => (
              <div key={clip.id} className="flex flex-col gap-[7px] rounded-[10px] border border-line2 bg-s1 px-[11px] py-[10px]" data-drawer-clip={clip.id}>
                <span className="text-12-5 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
                  {clip.text}
                </span>
                <span className="relative flex flex-wrap items-center gap-[6px]">
                  {clip.filings.map((filing) => (
                    <span key={filing.id} className="folio-filing-chip cursor-default" data-size="small">
                      {filingLabel(filing)}
                    </span>
                  ))}
                  {clip.filings.length === 0 ? <span className="text-10-5 text-ink3">Not filed yet</span> : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    data-drawer-send-to={clip.id}
                    aria-expanded={openClip === clip.id}
                    onClick={() => {
                      setOpenClip((current) => (current === clip.id ? null : clip.id))
                    }}
                    className="folio-dashed-button h-[22px] rounded-[7px] px-[8px] text-10-5"
                  >
                    {clip.filings.length === 0 ? 'Send to…' : '⋯'}
                  </button>
                  {openClip === clip.id ? <ClipMenu projectId={projectId} clip={clip} targets={targets} run={run} onClose={() => setOpenClip(null)} align="right" /> : null}
                </span>
              </div>
            ))}
            {clips.length === 0 ? (
              <span className="text-12 text-ink3" data-drawer-no-clips>
                No clips from this source yet.
              </span>
            ) : null}
          </div>
        </Section>
      )}
    </DrawerShell>
  )
}
