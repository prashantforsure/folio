'use client'

import type {
  BibleCounts,
  BibleEntryId,
  BibleEntryView,
  BibleNavEntry,
  CanonConflictRow,
  GlossaryRow,
  ProjectId,
  SceneRef,
} from '@folio/contracts'
import { BIBLE_ENTRY_STATUS_LABEL } from '@folio/script'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import { bibleEntryHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { NewEntryButton } from './bible-nav'
import { CanonCheck } from './canon-check'
import { EmptyBible } from './empty-bible'
import { Entry } from './entry'
import { EntryPanel } from './entry-panel'
import { Glossary } from './glossary'

/**
 * The Bible route's main column: the 46px header (title, the header note,
 * the `Entry / Canon check / Glossary` segment with the conflict badge,
 * `＋ Entry`), the view, and the 28px footer (`N entries · M rules · K
 * terms`, the view's note, `Hide nav`, the save indicator, the route id).
 * `Route - Bible.dc.html`, with the tokens in place of its hexes.
 *
 * ## `?view=` and `:entryId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the tabs are links, and the
 * entry view's entry is the path. The find filter, an open picker, a
 * conflict being recorded: component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator here is the
 * only client-held state a write touches. Nothing here computes a count.
 *
 * ## Not drawn
 *
 * `Export bible · PDF`, `Export pitch · PDF`, `History`: export is a queued
 * job that does not exist yet and entries have no version history, and a
 * button that does nothing is a placeholder (the Scenes precedent). The
 * empty state's `✦ Draft from the script` is a model call, and there is no
 * model in the repository. All flagged in the phase report.
 */

export type BibleView = 'entry' | 'check' | 'glossary'

export type BibleWorkspaceProps = {
  readonly projectId: ProjectId
  readonly view: BibleView
  readonly selected: BibleEntryId | null
  readonly baseHref: ProjectRoutePath
  readonly nav: readonly BibleNavEntry[]
  readonly counts: BibleCounts
  readonly hasPitch: boolean
  readonly entry: BibleEntryView | null
  readonly conflicts: readonly CanonConflictRow[] | null
  readonly glossary: readonly GlossaryRow[] | null
  readonly sceneRefs: readonly SceneRef[]
  readonly episodes: number
  readonly scriptHref: EpisodeRoutePath | null
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

const TABS: readonly { readonly id: BibleView; readonly label: string; readonly glyph: string }[] = [
  { id: 'entry', label: 'Entry', glyph: '▤' },
  { id: 'check', label: 'Canon check', glyph: '⚠' },
  { id: 'glossary', label: 'Glossary', glyph: '≡' },
]

export const BibleWorkspace = ({
  projectId,
  view,
  selected,
  baseHref,
  nav,
  counts,
  hasPitch,
  entry,
  conflicts,
  glossary,
  sceneRefs,
  episodes,
  scriptHref,
}: BibleWorkspaceProps) => {
  const session = useSession()
  const [mounted, setMounted] = useState(false)
  const [viewport, setViewport] = useState(1440)
  useEffect(() => {
    setMounted(true)
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
  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pending = useRef(0)
  const run: Run = useCallback((job) => {
    pending.current += 1
    setSaveState({ kind: 'saving' })
    void (async () => {
      let failure: string | null
      try {
        failure = await job()
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
      } finally {
        pending.current -= 1
      }
      if (failure !== null) setSaveState({ kind: 'error', message: failure })
      else if (pending.current === 0) setSaveState({ kind: 'saved' })
    })()
  }, [])

  const empty = nav.length === 0
  const shown: BibleView | 'empty' = empty && view === 'entry' ? 'empty' : view

  const headerNote =
    shown === 'entry'
      ? 'project-wide · rules cite the scene that establishes them'
      : shown === 'check'
        ? `${String(counts.conflicts)} ${counts.conflicts === 1 ? 'rule' : 'rules'} contradicted by the current draft`
        : shown === 'glossary'
          ? `${String(counts.terms)} ${counts.terms === 1 ? 'term' : 'terms'} the audience has to learn`
          : ''
  const footerNote =
    shown === 'entry' && entry !== null
      ? entry.kind === 'pitch'
        ? `Pitch · ${String(entry.fields.length)} ${entry.fields.length === 1 ? 'field' : 'fields'}`
        : `${entry.title} · ${String(entry.facts.length)} ${entry.facts.length === 1 ? 'rule' : 'rules'} · ${BIBLE_ENTRY_STATUS_LABEL[entry.status]}`
      : shown === 'check'
        ? `${String(counts.conflicts)} open`
        : shown === 'glossary'
          ? 'Glossary'
          : shown === 'empty'
            ? 'Empty'
            : ''
  const routeId = shown === 'entry' && entry !== null ? `/bible/${entry.id}` : '/bible'

  const tabHref = (tab: BibleView) =>
    tab === 'entry'
      ? selected === null
        ? baseHref
        : bibleEntryHref(projectId, selected)
      : (`${baseHref}?view=${tab}` as const)

  return (
    <main
      data-route="bible"
      data-sub-view={view}
      data-bible-state={shown}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        data-bible-header
        data-mounted={mounted ? 'true' : 'false'}
        className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]"
      >
        <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Bible</h1>
        <span className="min-w-0 flex-1 truncate text-11 text-ink3">{headerNote}</span>
        <nav aria-label="Bible views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
          {TABS.map((tab) => {
            const active = tab.id === view
            return (
              <Link
                key={tab.id}
                href={tabHref(tab.id)}
                aria-current={active ? 'page' : undefined}
                data-view-tab={tab.id}
                className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[10px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                  active ? 'bg-accent-bg text-accent' : 'text-ink2'
                }`}
              >
                <span aria-hidden="true" className="text-10 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
                  {tab.glyph}
                </span>
                {tab.label}
                {tab.id === 'check' && counts.conflicts > 0 ? (
                  <span
                    data-check-badge
                    className="tabular grid h-[14px] min-w-[14px] place-items-center rounded-chrome bg-note px-[4px] text-9 font-bold text-rail"
                  >
                    {counts.conflicts}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        <NewEntryButton projectId={projectId} hasPitch={hasPitch} variant="accent" />
      </header>

      <div className="flex min-h-0 flex-1">
        {shown === 'empty' ? (
          <EmptyBible projectId={projectId} run={run} />
        ) : shown === 'entry' ? (
          entry === null ? (
            <div className="flex flex-1 items-center justify-center text-12 text-ink3">Pick an entry from the list.</div>
          ) : (
            <>
              <Entry key={entry.id} projectId={projectId} entry={entry} sceneRefs={sceneRefs} run={run} />
              <EntryPanel
                key={`${entry.id}-panel`}
                projectId={projectId}
                entry={entry}
                scriptHref={scriptHref}
                run={run}
              />
            </>
          )
        ) : shown === 'check' ? (
          <CanonCheck
            projectId={projectId}
            conflicts={conflicts ?? []}
            canonFacts={counts.canonFacts}
            episodes={episodes}
            run={run}
          />
        ) : (
          <Glossary projectId={projectId} rows={glossary ?? []} run={run} />
        )}
      </div>

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap">
          <b className="font-semibold text-ink" data-entry-count>
            {counts.entries}
          </b>{' '}
          {counts.entries === 1 ? 'entry' : 'entries'} · {counts.facts} {counts.facts === 1 ? 'rule' : 'rules'} ·{' '}
          {counts.terms} {counts.terms === 1 ? 'term' : 'terms'}
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate">{footerNote}</span>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => {
            session.setNavOpen(!navOpen)
          }}
          className="flex-none whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[7px] py-[2px] text-10 text-ink2 hover:bg-hover"
        >
          {navOpen ? 'Hide nav' : 'Show nav'}
        </button>
        <span className="flex flex-none items-center gap-[5px] whitespace-nowrap" data-save-state={saveState.kind}>
          <span
            className={`h-[6px] w-[6px] rounded-full ${
              saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saving' ? 'bg-note' : 'bg-add'
            }`}
          />
          {saveState.kind === 'saving'
            ? 'saving…'
            : saveState.kind === 'error'
              ? saveState.message
              : saveState.kind === 'saved'
                ? 'saved'
                : 'authored'}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>
    </main>
  )
}
