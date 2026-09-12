'use client'

import type { Project } from '@folio/contracts'
import { memo } from 'react'

import type { OutlineStats } from '../../../../../../lib/outline/server'
import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import type { SideTab } from '../../../../../../lib/state/session'
import { ThreadCardView } from '../_script/panel/right-panel'
import { ViewTab } from '../_script/view-tab'

/**
 * The Outline's right panel. 296px, `--panel`, 1px left border - the Script
 * panel's chrome (`Route - Script.dc.html` wins on chrome) with the Outline
 * bundle's own Info body: an **Outline document** section (Blocks · Type,
 * and the line "The outline is its own document. It reads entities but
 * never edits the script." - the bundle's `Beats linked` row went with the
 * Beats route, which was what linked them), Format and Project type as the
 * Script draws them, and Statistics with the bundle's closing line "Counts
 * come from the script and beats, not from this page."
 *
 * Format is *shown* here, not written: the control writes `projects.format`,
 * an engine input, and the outline is not paginated - so the segment is
 * drawn as the row stands and the Script route's Info panel is where it is
 * changed. Flagged. Project type is shown disabled for the Script panel's
 * reason.
 *
 * The Collaboration tab is the Script's ruling read across: open comments on
 * outline blocks with Reply / Resolve, and the document's history (the
 * `versions` rows `⌘S` writes). No Collaborators section - no presence.
 */

export type OutlinePanelProps = {
  readonly projectId: string
  readonly episode: string
  readonly project: Project
  readonly tab: SideTab
  readonly onPickTab: (tab: SideTab) => void
  readonly blockCount: number
  readonly stats: OutlineStats
  readonly threads: readonly ThreadCard[]
  readonly history: readonly RevisionRow[]
}

const FORMAT_PAGE: Readonly<Record<Project['format'], string>> = {
  hollywood: 'US Letter · Courier 12pt',
  asian: 'A4 · Courier 12pt',
}

const PROJECT_TYPE_NOTE: Readonly<Record<Project['projectType'], string>> = {
  film: 'One document. Routes collapse to /project/{uuid}/outline.',
  series: 'One outline per episode. This route is scoped to one episode.',
}

const OutlinePanelBody = ({
  projectId,
  episode,
  project,
  tab,
  onPickTab,
  blockCount,
  stats,
  threads,
  history,
}: OutlinePanelProps) => (
  <aside data-right-panel data-panel-tab={tab} className="flex min-h-0 w-[296px] flex-none flex-col border-l border-line bg-panel">
    <div className="flex h-[46px] flex-none items-center gap-[8px] border-b border-line2 px-[12px]">
      <span className="flex-1 font-serif text-15 font-medium tracking-title">Writing</span>
      <button
        type="button"
        title="Import / export — export is a queued job and is not built this phase"
        disabled
        className="grid h-[24px] w-[24px] cursor-default place-items-center rounded-chrome font-glyph text-12 text-ink3 opacity-60"
      >
        ⤒
      </button>
      <button
        type="button"
        title="Report — not built this phase"
        disabled
        className="grid h-[24px] w-[24px] cursor-default place-items-center rounded-chrome font-glyph text-12 text-ink3 opacity-60"
      >
        ▤
      </button>
    </div>

    <div className="flex-none px-[12px] pt-[10px]">
      <div className="folio-segment" role="tablist" aria-label="Panel">
        <ViewTab
          active={tab === 'info'}
          onPick={() => {
            onPickTab('info')
          }}
        >
          Info
        </ViewTab>
        <ViewTab
          active={tab === 'collab'}
          onPick={() => {
            onPickTab('collab')
          }}
        >
          Collaboration
        </ViewTab>
      </div>
    </div>

    <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[12px] pb-[24px] pt-[14px]">
      {tab === 'info' ? (
        <>
          <section className="flex flex-col gap-[8px]">
            <span className="folio-panel-label">Outline document</span>
            <div className="flex flex-col gap-[5px] text-11-5">
              <div className="flex items-baseline justify-between">
                <span className="text-ink2">Blocks</span>
                <span data-outline-blocks className="tabular-nums">
                  {blockCount.toLocaleString('en-US')}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-ink2">Type</span>
                <span>Prose · not paginated</span>
              </div>
            </div>
            <span className="text-10 leading-[1.45] text-ink3">
              The outline is its own document. It reads entities but never edits the script.
            </span>
          </section>

          <section className="flex flex-col gap-[8px]">
            <span className="folio-panel-label">Format</span>
            <div className="folio-segment" role="radiogroup" aria-label="Format">
              {(['hollywood', 'asian'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={project.format === entry}
                  aria-pressed={project.format === entry}
                  disabled
                  title="Set on the Script route. The outline is not paginated."
                >
                  {entry === 'hollywood' ? 'Hollywood' : 'Asian'}
                </button>
              ))}
            </div>
            <div className="flex items-baseline justify-between text-11-5">
              <span className="text-ink2">Page</span>
              <span>{FORMAT_PAGE[project.format]}</span>
            </div>
          </section>

          <section className="flex flex-col gap-[8px]">
            <span className="folio-panel-label">Project type</span>
            <div className="folio-segment" role="radiogroup" aria-label="Project type">
              {(['film', 'series'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={project.projectType === entry}
                  aria-pressed={project.projectType === entry}
                  disabled
                  title="Set at creation. Changing it reshapes every URL in the project."
                >
                  {entry === 'film' ? 'Film' : 'Series'}
                </button>
              ))}
            </div>
            <span className="text-10 leading-[1.45] text-ink3">{PROJECT_TYPE_NOTE[project.projectType]}</span>
          </section>

          <section className="flex flex-col gap-[4px]">
            <span className="folio-panel-label mb-[2px]">Statistics</span>
            {(
              [
                ['Scenes', stats.scenes],
                ['Words', stats.words],
                ['Characters', stats.characters],
                ['Locations', stats.locations],
                ['Beats', stats.beats],
                ['Shots', stats.shots],
                ['Relations', stats.relations],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between border-b border-line2 py-[5px]">
                <span className="text-11-5 text-ink2">{label}</span>
                <span className="text-11-5 font-medium tabular-nums" data-stat={label.toLowerCase()}>
                  {value.toLocaleString('en-US')}
                </span>
              </div>
            ))}
            <span className="mt-[4px] text-10 leading-[1.45] text-ink3">
              Counts come from the script and beats, not from this page.
            </span>
          </section>
        </>
      ) : (
        <>
          <section className="flex flex-col gap-[8px]">
            <span className="folio-panel-label">Open comments</span>
            {threads.length === 0 ? (
              <p className="m-0 text-10-5 leading-[1.5] text-ink3">
                No open comments on this outline. Comments anchor to a block and follow it through every edit.
              </p>
            ) : null}
            {threads.map((thread) => (
              <ThreadCardView key={thread.id} thread={thread} projectId={projectId} episode={episode} />
            ))}
          </section>

          <section className="flex flex-col gap-[8px]">
            <span className="folio-panel-label">History</span>
            {history.length === 0 ? (
              <p className="m-0 text-10-5 leading-[1.5] text-ink3">
                No snapshot yet. ⌘S takes one; the outline is saved as you type either way.
              </p>
            ) : (
              <div className="flex flex-col gap-[9px] border-l border-line pl-[9px]">
                {history.map((entry) => (
                  <div key={entry.id} className="flex flex-col">
                    <span className="text-11">{entry.name}</span>
                    <span className="text-10 text-ink3">{entry.meta}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>

    <div className="flex-none border-t border-line2 px-[12px] pb-[12px] pt-[10px]">
      <button
        type="button"
        disabled
        title="The composer is a floating window, reachable everywhere with ⌘J. Not built this phase."
        className="flex w-full cursor-default items-center justify-center gap-[8px] rounded-chrome bg-ink px-[12px] py-[9px] text-12 font-medium text-desk opacity-60"
      >
        <span className="font-glyph text-11 opacity-70">◎</span>Open composer
        <span className="text-10-5 opacity-60">⌘J</span>
      </button>
    </div>
  </aside>
)

export const OutlinePanel = memo(OutlinePanelBody)
