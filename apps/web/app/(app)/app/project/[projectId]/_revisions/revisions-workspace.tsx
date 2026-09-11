'use client'

import type { EpisodeSlug, ProjectId, Revision, RevisionId } from '@folio/contracts'
import type { DiffEntry, DiffKind, ScriptFormat, SheetSpec } from '@folio/script'
import { resolveSheet } from '@folio/script'
import { RevisionSwatch } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { relativeTime } from '../../../../../../lib/format/relative-time'
import { compareDrafts, lockRevisionPages, restoreRevision } from '../../../../../../lib/revisions/actions'
import type { CompareResult, Comparison, DiffPage, DraftHeader } from '../../../../../../lib/revisions/result'
import { useSession } from '../../../../../../lib/state/session'
import { count } from '../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { colourName } from './issue-revision'
import type { RevisionsView } from './revisions-header'

/**
 * The workspace: the compare bar and the diff on the sheet, or the history
 * cards; one footer under both.
 *
 * `Route - Revisions.dc.html` is the pattern, with the tokens in place of its
 * hexes. Where the bundle and the rules disagree, the rules win and the
 * disagreement is in the phase report.
 *
 * ## Which draft is which is component state
 *
 * `?view=` is the sub-view and arrives parsed. The pair being compared is
 * not in the URL - the same reading the Scenes route took for selection
 * (ruled 2026-09-11): a choice made while looking, not an address. Changing
 * either side calls `compareDrafts` and the result replaces the comparison;
 * the page's own default (latest revision -> current) is the first value.
 *
 * ## Nothing on the sheet is computed here
 *
 * Every line arrives with its kind from `diffScreenplays`; every page label
 * from `paginate`. This file decides only where to draw a line and in what
 * colour. The one thing it derives is the "Changes only" cut, which keeps
 * every entry that is not `same` and the heading and cue that place it.
 *
 * ## The asterisk is in the right margin
 *
 * The bundle's copy says "Revised pages carry an asterisk in the right
 * margin" and its markup draws the mark at `left:52px`. The copy is what a
 * production office reads and matches convention, so the mark is drawn at
 * `right:52px` and the copy stands. Flagged in the report as a bundle
 * contradiction resolved in the copy's favour.
 *
 * Zoom and the nav toggle are the session's (`useSession`), as on the Script
 * route: this is a sheet view, and a sheet's zoom is one per window.
 */

type Props = {
  readonly view: RevisionsView
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly routeTag: string
  /** This route's own path, for the switch to `?view=diff` from a history card. */
  readonly href: EpisodeRoutePath
  /** Oldest first, `current` last. */
  readonly drafts: readonly DraftHeader[]
  readonly revisions: readonly Revision[]
  readonly authors: Readonly<Record<string, string>>
  readonly initial: CompareResult | null
  readonly format: ScriptFormat
}

type Filter = 'all' | 'changes'

const VIEW_LABEL: Record<RevisionsView, string> = { diff: 'Compare', history: 'History' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * `07 Sep 2026`, as the bundle prints a draft's date on the sheet. Spelled
 * out rather than `toLocaleDateString`, whose short September is `Sept` in
 * current ICU data and would put a word on the paper the bundle does not.
 */
const longDate = (iso: string): string => {
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()] ?? ''} ${String(date.getFullYear())}`
}

const UPPERCASE: ReadonlySet<DiffEntry['type']> = new Set(['scene', 'character', 'transition'])

const lineBackground: Record<DiffKind, string> = {
  same: '',
  added: 'bg-add-bg',
  deleted: 'bg-del-bg',
  changed: 'bg-note-bg',
}

const markInk: Record<DiffKind, string> = {
  same: '',
  added: 'text-add',
  deleted: 'text-del',
  changed: 'text-note',
}

// ---------------------------------------------------------------------------
// The compare bar
// ---------------------------------------------------------------------------

const DraftPicker = ({
  label,
  drafts,
  value,
  onChange,
  accent,
}: {
  readonly label: string
  readonly drafts: readonly DraftHeader[]
  readonly value: string
  readonly onChange: (key: string) => void
  readonly accent: boolean
}) => {
  const chosen = drafts.find((draft) => draft.key === value)
  return (
    <label
      className={`relative flex items-center gap-[6px] whitespace-nowrap rounded-chrome border px-[8px] py-[3px] text-11 ${
        accent ? 'border-accent-line bg-accent-bg text-accent' : 'border-line text-ink'
      }`}
      title={label}
    >
      {chosen === undefined ? null : <RevisionSwatch colour={chosen.colour} size={7} />}
      <span>{chosen?.name ?? '—'}</span>
      <span aria-hidden="true" className={`text-9 ${accent ? 'opacity-70' : 'text-ink3'}`}>
        ▾
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
        data-draft-picker={label.toLowerCase()}
      >
        {drafts.map((draft) => (
          <option key={draft.key} value={draft.key}>
            {draft.name}
            {draft.locked ? ' · locked' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

const Legend = ({ swatch, children }: { readonly swatch: string; readonly children: ReactNode }) => (
  <span className="flex items-center gap-[5px] whitespace-nowrap">
    <span className={`h-[8px] w-[8px] rounded-sheet border ${swatch}`} />
    {children}
  </span>
)

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * "Changes only": every entry that is not `same`, plus the heading of the
 * scene it is in and the cue above a changed line of speech, so the reader
 * can still tell where they are and who is talking.
 */
const changesOnly = (entries: readonly DiffEntry[]): readonly DiffEntry[] => {
  const keep = new Set<number>()
  let heading: number | null = null
  let cue: number | null = null
  entries.forEach((entry, index) => {
    if (entry.type === 'scene') {
      heading = index
      cue = null
    } else if (entry.type === 'character') {
      cue = index
    }
    if (entry.kind === 'same') return
    keep.add(index)
    if (heading !== null) keep.add(heading)
    if (cue !== null && (entry.type === 'dialogue' || entry.type === 'paren' || entry.type === 'subtitle')) {
      keep.add(cue)
    }
  })
  return entries.filter((_, index) => keep.has(index))
}

const Line = ({
  entry,
  text,
  kind,
  sheet,
}: {
  readonly entry: DiffEntry
  readonly text: string
  readonly kind: DiffKind
  readonly sheet: SheetSpec
}) => {
  const metric = sheet.element[entry.type]
  const style: CSSProperties = {
    paddingLeft: metric.leftPx,
    paddingRight: metric.rightPx,
    minHeight: sheet.lineHeightPx,
  }
  return (
    <div className={`relative flex ${lineBackground[kind]}`} style={style} data-line-kind={kind}>
      {kind === 'same' ? null : (
        <span
          aria-hidden="true"
          className={`absolute top-0 ${markInk[kind]}`}
          style={{ right: 52, fontSize: 16 }}
        >
          *
        </span>
      )}
      <span
        className={`min-w-0 flex-1 ${kind === 'deleted' ? 'text-del line-through' : ''} ${
          entry.type === 'subtitle' ? 'italic' : ''
        }`}
        style={{
          textTransform: UPPERCASE.has(entry.type) ? 'uppercase' : 'none',
          whiteSpace: 'pre',
          overflow: 'hidden',
        }}
      >
        {text === '' ? ' ' : text}
      </span>
    </div>
  )
}

const Sheet = ({
  page,
  entries,
  head,
  totalPages,
  sheet,
}: {
  readonly page: DiffPage
  readonly entries: readonly DiffEntry[]
  readonly head: DraftHeader
  readonly totalPages: number
  readonly sheet: SheetSpec
}) => (
  <article
    className="relative w-[816px] flex-none rounded-sheet border border-sheet-edge bg-sheet font-mono text-sheet-ink"
    style={{
      minHeight: sheet.heightPx,
      paddingTop: sheet.marginTopPx,
      paddingBottom: sheet.marginBottomPx,
      fontSize: 16,
      lineHeight: `${String(sheet.lineHeightPx)}px`,
    }}
    data-page-ordinal={page.ordinal}
    data-page-label={page.label}
    data-page-locked={page.locked ? 'true' : 'false'}
    data-page-changed={page.changed}
  >
    <div
      className="absolute left-[96px] top-[36px] flex items-center gap-[8px] font-sans text-9-5 text-ink3"
      aria-hidden="true"
    >
      <RevisionSwatch colour={head.colour} size={7} />
      {head.name} · {longDate(head.at)}
    </div>
    <div className="absolute right-[96px] top-[36px] text-14 text-ink3" aria-hidden="true">
      {page.label}.{page.changed > 0 ? '*' : ''}
    </div>

    {entries.map((entry, index) => {
      const gap = index === 0 ? 0 : sheet.element[entry.type].blankLinesBefore * sheet.lineHeightPx
      return (
        <div
          key={`${String(entry.id)}-${entry.kind}`}
          style={{ marginTop: gap }}
          data-diff-node={entry.id}
          data-diff-kind={entry.kind}
          data-diff-moved={entry.moved ? 'true' : undefined}
        >
          {entry.lines.map((line, at) => (
            <Line key={at} entry={entry} text={line.text} kind={line.kind} sheet={sheet} />
          ))}
        </div>
      )
    })}

    <div className="absolute bottom-[34px] left-[96px] right-[96px] flex justify-between font-sans text-9-5 text-ink3">
      <span>Revised pages carry an asterisk in the right margin</span>
      <span>
        {head.name} · pg {page.label} of {count(totalPages)}
      </span>
    </div>
  </article>
)

const DiffSheets = ({
  comparison,
  filter,
  sheet,
  zoom,
  onVisiblePage,
}: {
  readonly comparison: Comparison
  readonly filter: Filter
  readonly sheet: SheetSpec
  readonly zoom: number
  readonly onVisiblePage: (ordinal: number | null) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const ratios = useRef(new Map<number, number>())

  const pages = useMemo(
    () =>
      comparison.pages
        .map((page) => ({
          page,
          entries: filter === 'changes' ? changesOnly(page.entries) : page.entries,
        }))
        .filter(({ entries }) => entries.length > 0),
    [comparison, filter],
  )

  useEffect(() => {
    const root = containerRef.current
    if (root === null) return
    const sheets = Array.from(root.querySelectorAll<HTMLElement>('article[data-page-ordinal]'))
    if (sheets.length === 0) {
      onVisiblePage(null)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const ordinal = Number((entry.target as HTMLElement).dataset['pageOrdinal'])
          ratios.current.set(ordinal, entry.intersectionRatio)
        }
        let best: number | null = null
        let bestRatio = 0
        for (const [ordinal, ratio] of ratios.current) {
          if (ratio > bestRatio) {
            best = ordinal
            bestRatio = ratio
          }
        }
        onVisiblePage(best)
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    ratios.current.clear()
    sheets.forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
    }
  }, [pages, onVisiblePage])

  const total = comparison.pages.length

  return (
    <div ref={containerRef} className="flex flex-col items-center pb-[48px] pt-[20px]">
      <div style={{ zoom }} className="flex w-[816px] flex-none flex-col items-center gap-[24px]">
        {pages.length === 0 ? (
          <div
            className="flex w-[816px] flex-col gap-[6px] rounded-chrome border border-line bg-panel p-[18px]"
            data-no-differences
          >
            <span className="font-serif text-15 font-medium tracking-title">
              {filter === 'changes' ? 'No lines differ' : 'Nothing on the paper'}
            </span>
            <span className="text-11-5 leading-[1.5] text-ink2">
              {filter === 'changes'
                ? `${comparison.base.name} and ${comparison.head.name} put the same lines on the sheet. Comments are not on the paper and are not compared.`
                : `${comparison.head.name} has no renderable node.`}
            </span>
          </div>
        ) : (
          pages.map(({ page, entries }) => (
            <Sheet
              key={page.ordinal}
              page={page}
              entries={entries}
              head={comparison.head}
              totalPages={total}
              sheet={sheet}
            />
          ))
        )}
        <div className="flex w-[816px] flex-wrap gap-[16px] px-[2px] text-10-5 text-ink3">
          <span>
            <b className="font-mono font-bold text-ink2">*</b> revised line
          </span>
          <span>
            <b className="font-bold text-del">strike</b> removed since {comparison.base.name}
          </span>
          <span>
            <b className="font-bold text-add">tint</b> added in {comparison.head.name}
          </span>
          <span>Locked pages keep their numbers; new pages become A-pages (4A, 4B)</span>
        </div>
        {comparison.lockIssues.length === 0 ? null : (
          <div
            className="flex w-[816px] flex-col gap-[4px] rounded-chrome border border-line2 bg-note-bg px-[12px] py-[8px] text-10-5 text-ink2"
            data-lock-issues
          >
            <span className="font-semibold text-ink">
              {count(comparison.lockIssues.length)} lock issue
              {comparison.lockIssues.length === 1 ? '' : 's'} on {comparison.head.name}, reported
              and not resolved
            </span>
            {comparison.lockIssues.map((issue, index) => (
              <span key={index} className="font-mono text-10">
                {issue.kind === 'anchor-missing'
                  ? `page ${issue.label}: its anchor node is no longer in the script`
                  : issue.kind === 'locks-collide'
                    ? `page ${String(issue.ordinal)}: locks ${issue.kept} and ${issue.dropped} landed on one page; ${issue.kept} kept`
                    : issue.kind === 'label-collision'
                      ? `label ${issue.label} printed on pages ${issue.ordinals.join(', ')}`
                      : `page ${issue.label}: ${issue.detail}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const HistoryCard = ({
  revision,
  by,
  isHead,
  now,
  busy,
  confirming,
  onSelect,
  onCompareToCurrent,
  onLock,
  onRestore,
  onConfirmRestore,
  onCancelRestore,
}: {
  readonly revision: Revision
  readonly by: string
  readonly isHead: boolean
  readonly now: Date | null
  readonly busy: boolean
  readonly confirming: boolean
  readonly onSelect: () => void
  readonly onCompareToCurrent: () => void
  readonly onLock: () => void
  readonly onRestore: () => void
  readonly onConfirmRestore: () => void
  readonly onCancelRestore: () => void
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect()
      }
    }}
    className={`grid cursor-pointer grid-cols-[150px_minmax(0,1fr)_auto] gap-[18px] rounded-chrome border bg-panel px-[18px] py-[16px] hover:border-ink ${
      isHead ? 'border-accent-line' : 'border-line'
    }`}
    data-revision-card={revision.id}
    data-revision-locked={revision.locked ? 'true' : 'false'}
  >
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-center gap-[7px]">
        <RevisionSwatch colour={revision.colour} size={9} />
        <span className="font-serif text-18 font-medium leading-none">{revision.label}</span>
      </div>
      <span className="text-10-5 text-ink3">
        {now === null ? longDate(revision.createdAt) : relativeTime(revision.createdAt, now)} · {by}
      </span>
      <span className="text-10-5 text-ink3">
        {count(revision.pageCount)} pp · {colourName(revision.colour)} pages
      </span>
    </div>
    <div className="flex min-w-0 flex-col gap-[8px]">
      <span className="text-12-5 leading-[1.5]">
        {revision.note === null || revision.note === '' ? (
          <span className="text-ink3">No note.</span>
        ) : (
          revision.note
        )}
      </span>
      {revision.tags.length === 0 ? null : (
        <div className="flex flex-wrap gap-[6px]">
          {revision.tags.map((tag) => (
            <span
              key={tag}
              className="whitespace-nowrap rounded-chrome border border-line2 px-[7px] py-[2px] text-10 text-ink2"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="tabular flex items-center gap-[10px] text-10-5">
        <span className="whitespace-nowrap text-add">+{count(revision.linesAdded)}</span>
        <span className="whitespace-nowrap text-del">−{count(revision.linesDeleted)}</span>
        <span className="whitespace-nowrap text-ink3">
          {count(revision.scenesTouched)} scene{revision.scenesTouched === 1 ? '' : 's'} touched
        </span>
      </div>
    </div>
    <div
      className="flex flex-col items-end gap-[6px]"
      onClick={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      {revision.locked ? (
        <span className="rounded-chrome bg-note-bg px-[7px] py-[2px] text-10 font-semibold text-note">
          Pages locked
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onLock}
          className="folio-focus flex items-center gap-[6px] whitespace-nowrap rounded-chrome border border-line bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink disabled:opacity-60"
          data-lock-pages
        >
          Lock pages
        </button>
      )}
      <button
        type="button"
        onClick={onCompareToCurrent}
        className="folio-focus flex items-center gap-[6px] whitespace-nowrap rounded-chrome border border-line bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink"
        data-compare-to-current
      >
        Compare to current
      </button>
      {confirming ? (
        <span className="flex items-center gap-[6px] text-10-5 text-ink2" data-restore-confirm>
          Restore {revision.label}?
          <button
            type="button"
            disabled={busy}
            onClick={onConfirmRestore}
            className="folio-focus rounded-chrome border-0 bg-accent px-[9px] py-[4px] text-10-5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
            data-restore-yes
          >
            {busy ? 'Restoring…' : 'Restore'}
          </button>
          <button
            type="button"
            onClick={onCancelRestore}
            className="folio-focus rounded-chrome border border-line bg-transparent px-[9px] py-[4px] text-10-5 text-ink2 hover:bg-hover"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onRestore}
          className="folio-focus flex items-center gap-[6px] whitespace-nowrap rounded-chrome border border-line bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink disabled:opacity-60"
          data-restore
        >
          Restore
        </button>
      )}
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

export const RevisionsWorkspace = ({
  view,
  projectId,
  episode,
  routeTag,
  href,
  drafts,
  revisions,
  authors,
  initial,
  format,
}: Props) => {
  const router = useRouter()
  const session = useSession()

  const initialPair = useMemo(() => {
    if (initial?.status === 'compared') {
      return { base: initial.comparison.base.key, head: initial.comparison.head.key }
    }
    const latest = revisions[revisions.length - 1]
    return { base: latest?.id ?? 'current', head: 'current' }
  }, [initial, revisions])

  const [baseKey, setBaseKey] = useState(initialPair.base)
  const [headKey, setHeadKey] = useState(initialPair.head)
  const [result, setResult] = useState<CompareResult | null>(initial)
  const [filter, setFilter] = useState<Filter>('all')
  const [comparing, startCompare] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)
  const [visiblePage, setVisiblePage] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<RevisionId | null>(null)
  const [confirmId, setConfirmId] = useState<RevisionId | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const requested = useRef(`${initialPair.base}→${initialPair.head}`)

  // Session flags come from sessionStorage and the clock from Date.now():
  // both differ between the server render and the first client render, so
  // neither is read until after hydration.
  const [mounted, setMounted] = useState(false)
  const [viewport, setViewport] = useState(1440)
  useEffect(() => {
    setMounted(true)
    setNow(new Date())
    const read = (): void => {
      setViewport(window.innerWidth)
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
    }
  }, [])
  const navOpen = (mounted ? session.navOpen : null) ?? viewport >= 1000
  const available = viewport - 66 - (navOpen ? 238 : 0) - 48
  const fit = Math.max(0.5, Math.min(1, available / 816))
  const zoomSetting = mounted ? session.zoom : 'fit'
  const zoom = zoomSetting === 'fit' ? Math.round(fit * 1000) / 1000 : zoomSetting
  const zoomLabel =
    zoomSetting === 'fit'
      ? `Fit ${String(Math.round(fit * 100))}%`
      : `${String(Math.round(zoom * 100))}%`

  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  // Re-compare when either side changes. The first pair is the server's.
  useEffect(() => {
    const key = `${baseKey}→${headKey}`
    if (requested.current === key) return
    requested.current = key
    startCompare(async () => {
      const next = await compareDrafts(projectId, episode, baseKey, headKey)
      if (requested.current === key) setResult(next)
    })
  }, [baseKey, headKey, projectId, episode])

  const sheet = useMemo(() => {
    const resolved = resolveSheet(format)
    return resolved.ok ? resolved.value : null
  }, [format])

  const comparison = result?.status === 'compared' ? result.comparison : null
  const baseName = drafts.find((draft) => draft.key === baseKey)?.name ?? '—'
  const headName = drafts.find((draft) => draft.key === headKey)?.name ?? '—'
  const differOnPage =
    comparison === null
      ? 0
      : (comparison.pages.find((page) => page.ordinal === visiblePage)?.changed ??
        comparison.pages[0]?.changed ??
        0)

  const goToDiff = useCallback(() => {
    router.push(`${href}?view=diff`)
  }, [router, href])

  const selectRevision = (revision: Revision): void => {
    if (headKey === revision.id) return
    setBaseKey(headKey)
    setHeadKey(revision.id)
    goToDiff()
  }

  const compareToCurrent = (revision: Revision): void => {
    setBaseKey(revision.id)
    setHeadKey('current')
    goToDiff()
  }

  const lock = (revision: Revision): void => {
    setBusyId(revision.id)
    setNotice(null)
    void lockRevisionPages(projectId, episode, revision.id).then((outcome) => {
      setBusyId(null)
      if (outcome.status === 'locked') {
        setNotice(`${revision.label}: ${count(outcome.pages)} page${outcome.pages === 1 ? '' : 's'} locked`)
        router.refresh()
      } else {
        setNotice(outcome.message)
      }
    })
  }

  const restore = (revision: Revision): void => {
    setBusyId(revision.id)
    setNotice(null)
    void restoreRevision(projectId, episode, revision.id).then((outcome) => {
      setBusyId(null)
      setConfirmId(null)
      if (outcome.status === 'restored') {
        setNotice(
          `Restored ${revision.label} as version ${String(outcome.versionOrdinal)} · ${count(outcome.nodes)} nodes`,
        )
        requested.current = ''
        setBaseKey(revision.id)
        setHeadKey('current')
        router.refresh()
      } else {
        setNotice(outcome.message)
      }
    })
  }

  const onVisiblePage = useCallback((ordinal: number | null) => {
    setVisiblePage(ordinal)
  }, [])

  const revisionDrafts = useMemo(() => [...revisions].reverse(), [revisions])

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-revisions-workspace
      data-revision-count={revisions.length}
      data-mounted={mounted ? 'true' : 'false'}
    >
      {view === 'diff' ? (
        <div
          className="flex min-h-[40px] flex-none flex-wrap items-center gap-[8px] border-b border-line2 bg-panel px-[14px] py-[6px]"
          data-compare-bar
        >
          <span className="text-10 font-semibold uppercase tracking-label text-ink3">Compare</span>
          <DraftPicker label="Base" drafts={drafts} value={baseKey} onChange={setBaseKey} accent={false} />
          <span className="text-11 text-ink3">→</span>
          <DraftPicker label="Head" drafts={drafts} value={headKey} onChange={setHeadKey} accent />
          {comparing ? <span className="text-10-5 text-ink3">comparing…</span> : null}
          <div className="min-w-0 flex-1" />
          <div className="flex items-center gap-[10px] text-10-5 text-ink2" data-compare-counts>
            <Legend swatch="border-add bg-add-bg">
              <span data-count-added>{count(comparison?.totals.added ?? 0)}</span> added
            </Legend>
            <Legend swatch="border-del bg-del-bg">
              <span data-count-removed>{count(comparison?.totals.deleted ?? 0)}</span> removed
            </Legend>
            <Legend swatch="border-note bg-note-bg">
              <span data-count-changed>{count(comparison?.totals.changed ?? 0)}</span> changed
            </Legend>
          </div>
          <div
            role="tablist"
            aria-label="Diff filter"
            className="flex gap-[2px] rounded-chrome border border-line2 p-[2px]"
          >
            {(['all', 'changes'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                onClick={() => {
                  setFilter(id)
                }}
                className={`folio-focus whitespace-nowrap rounded-chrome border-0 px-[8px] py-[3px] text-10-5 ${
                  filter === id ? 'bg-sel text-ink' : 'bg-transparent text-ink2'
                }`}
                data-diff-filter={id}
              >
                {id === 'all' ? 'Full page' : 'Changes only'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'diff' ? (
          comparison !== null && sheet !== null ? (
            <DiffSheets
              comparison={comparison}
              filter={filter}
              sheet={sheet}
              zoom={zoom}
              onVisiblePage={onVisiblePage}
            />
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center p-[24px]">
              <div
                className="flex w-full max-w-[420px] flex-col gap-[8px] rounded-chrome border border-line bg-panel p-[18px]"
                data-compare-unavailable
              >
                <span className="font-serif text-15 font-medium tracking-title">
                  {result === null ? 'Nothing compared' : 'These drafts cannot be compared'}
                </span>
                <span className="text-11-5 leading-[1.5] text-ink2">
                  {result === null || result.status === 'compared'
                    ? 'Pick two drafts above.'
                    : result.message}
                </span>
              </div>
            </div>
          )
        ) : (
          <div className="px-[24px] pb-[48px] pt-[20px]">
            <div className="mx-auto flex max-w-[880px] flex-col gap-[14px]" data-history-list>
              {revisionDrafts.map((revision) => (
                <HistoryCard
                  key={revision.id}
                  revision={revision}
                  by={
                    revision.authorId === null
                      ? '—'
                      : (authors[revision.authorId] ?? '(member gone)')
                  }
                  isHead={headKey === revision.id}
                  now={now}
                  busy={busyId === revision.id}
                  confirming={confirmId === revision.id}
                  onSelect={() => {
                    selectRevision(revision)
                  }}
                  onCompareToCurrent={() => {
                    compareToCurrent(revision)
                  }}
                  onLock={() => {
                    lock(revision)
                  }}
                  onRestore={() => {
                    setConfirmId(revision.id)
                  }}
                  onConfirmRestore={() => {
                    restore(revision)
                  }}
                  onCancelRestore={() => {
                    setConfirmId(null)
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <footer
        data-status-bar
        className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2"
      >
        <span className="flex-none whitespace-nowrap" data-footer-pair>
          {baseName} → <b className="font-semibold text-ink">{headName}</b>
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="flex-none whitespace-nowrap">{VIEW_LABEL[view]}</span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate whitespace-nowrap" data-footer-differ>
          {notice ?? `${count(differOnPage)} lines differ on this page`}
        </span>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          className="folio-status-button"
          onClick={() => {
            session.setNavOpen(!navOpen)
          }}
        >
          {navOpen ? 'Hide nav' : 'Show nav'}
        </button>
        <button
          type="button"
          className="folio-status-button"
          title="View zoom — the page stays fixed in inches"
          onClick={() => {
            session.setZoom(session.zoom === 'fit' ? 1 : session.zoom === 1 ? 0.75 : 'fit')
          }}
        >
          {zoomLabel}
        </button>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeTag}</span>
      </footer>
    </div>
  )
}
