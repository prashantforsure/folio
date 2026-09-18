'use client'

import type { TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding } from '@folio/script'
import type { NodeId } from '@folio/script'
import { TEXT_VARIATION_SELECTOR } from '@folio/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { FindingBuckets } from '../../../../../../lib/timeline/view'
import { KIND_LABEL, plural, sceneRef, shortSlug } from '../../../../../../lib/timeline/view'
import type { ScenePath } from '../../../../../../lib/workspace/hrefs'

/**
 * The Continuity view: the findings, one card each, in three groups.
 *
 * The lead: "Where page order and story time disagree, and where the page
 * disagrees with the time. None of these are errors on their own." Then a
 * card per open finding - the mark, the kind as a chip (`Steps back`,
 * `Two places`, `Before introduction`, `Light vs clock`, `Thread goes
 * quiet`), the mono ref and slug, the note the core's fact reads as, the
 * scene it was measured against, `Open →` into the drawer, `Open in Script
 * →`, and `It's deliberate`. With none, one quiet card.
 *
 * Under those, folded: the **notes** - the informational kinds (an
 * unclocked day, a long gap), listed but not counted - and the findings
 * **marked deliberate**, each with `Reopen`. "A finding is a flag, not an
 * error. Flashbacks are legitimate." The flashback and flash-forward
 * findings are not cards: the flag is the writer's answer, and re-asking
 * is the false positive the brief warns against. They are counted in one
 * line at the foot so they are not invisible.
 *
 * `It's deliberate` is the rebuild's answer (ruled 2026-09-18, a
 * `timeline_findings` row) for a finding that is neither a flashback nor
 * a mistake - the first pass's only way to quiet one was the flashback
 * flag, a claim the writer may not have meant.
 */
export const Continuity = ({
  scenes,
  buckets,
  noteOf,
  placed,
  scriptHrefOf,
  onOpen,
  onVerdict,
}: {
  readonly scenes: readonly TimelineSceneRow[]
  readonly buckets: FindingBuckets
  readonly noteOf: (finding: ContinuityFinding) => string
  readonly placed: number
  /** The heading's `#n-<node id>` in its episode's script. */
  readonly scriptHrefOf: (scene: TimelineSceneRow) => ScenePath
  readonly onOpen: (id: NodeId) => void
  readonly onVerdict: (finding: ContinuityFinding, deliberate: boolean) => void
}) => {
  const byId = useMemo(() => new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene])), [scenes])
  const [notesOpen, setNotesOpen] = useState(false)
  const [deliberateOpen, setDeliberateOpen] = useState(false)
  const flashbacks = buckets.flagged.filter((finding) => finding.kind === 'flashback').length
  const forwards = buckets.flagged.length - flashbacks

  const card = (finding: ContinuityFinding, deliberate: boolean) => {
    const scene = byId.get(finding.sceneId)
    if (scene === undefined) return null
    const other = finding.otherId === null ? undefined : byId.get(finding.otherId)
    return (
      <article key={finding.key} data-finding={finding.key} data-finding-kind={finding.kind} data-finding-scene={scene.sceneNodeId} className="flex flex-col gap-[10px] rounded-card border border-line2 bg-s1 px-[15px] py-[13px]">
        <div className="flex items-start gap-[10px]">
          <span aria-hidden="true" className={`folio-mark mt-[2px] flex-none text-12 ${deliberate ? 'text-ink3' : 'text-warn'}`}>
            ⚠{TEXT_VARIATION_SELECTOR}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <span className="flex flex-wrap items-baseline gap-[8px]">
              <span className="folio-cite">{KIND_LABEL[finding.kind]}</span>
              <span className="tabular font-mono text-11 text-ink3">{sceneRef(scene)}</span>
              <span className="min-w-0 truncate font-mono text-11-5 uppercase text-ink">{shortSlug(scene.heading)}</span>
            </span>
            <span className={`text-13 leading-[1.5] ${deliberate ? 'text-ink2' : 'text-ink'}`} style={{ textWrap: 'pretty' }}>
              {noteOf(finding)}
            </span>
            {other === undefined ? null : (
              <span className="text-11-5 text-ink3">
                Against {sceneRef(other)} · {shortSlug(other.heading)}
              </span>
            )}
          </div>
          <div className="flex flex-none flex-wrap items-center justify-end gap-[6px]">
            <button
              type="button"
              data-finding-open={scene.sceneNodeId}
              onClick={() => {
                onOpen(scene.sceneNodeId)
              }}
              className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
            >
              Open →
            </button>
            <Link href={scriptHrefOf(scene)} data-finding-script={scene.sceneNodeId} className="folio-ghost-button flex h-[28px] items-center rounded-[8px] px-[8px] text-11-5 text-ink3 no-underline hover:!text-ink2 hover:no-underline">
              Open in Script →
            </Link>
            <button
              type="button"
              data-finding-verdict={deliberate ? 'reopen' : 'deliberate'}
              onClick={() => {
                onVerdict(finding, !deliberate)
              }}
              className="folio-ghost-button h-[28px] rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2"
            >
              {deliberate ? 'Reopen' : "It's deliberate"}
            </button>
          </div>
        </div>
      </article>
    )
  }

  const fold = (label: string, count: number, open: boolean, toggle: () => void, attr: string) => (
    <button type="button" aria-expanded={open} onClick={toggle} data-continuity-fold={attr} className="folio-ghost-button flex h-[28px] items-center gap-[6px] self-start rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2">
      <span aria-hidden="true" className="folio-mark text-10-5">
        {open ? '▾' : '▸'}
      </span>
      {label} · {count}
    </button>
  )

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto px-[20px] pb-[24px]" data-continuity>
      <div className="flex max-w-[820px] flex-col gap-[12px]">
        <p className="m-0 max-w-[66ch] text-12-5 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
          Where page order and story time disagree, and where the page disagrees with the time. None of these are errors on their own — flashbacks and parallel action look the same to the check.
        </p>

        {buckets.open.length === 0 ? (
          <div className="rounded-card border border-line2 bg-s1 px-[15px] py-[13px] text-12-5 leading-[1.5] text-ink2" data-continuity-clear>
            {placed === 0 ? 'Nothing is placed yet. Give scenes a story time and any disagreement with the page shows here.' : 'Page order and story time agree everywhere both are set.'}
          </div>
        ) : null}

        {buckets.open.map((finding) => card(finding, false))}

        {buckets.notes.length === 0 ? null : (
          <div className="flex flex-col gap-[8px]" data-continuity-notes={buckets.notes.length}>
            {fold('Notes', buckets.notes.length, notesOpen, () => setNotesOpen((value) => !value), 'notes')}
            {notesOpen ? buckets.notes.map((finding) => card(finding, false)) : null}
          </div>
        )}

        {buckets.deliberate.length === 0 ? null : (
          <div className="flex flex-col gap-[8px]" data-continuity-deliberate={buckets.deliberate.length}>
            {fold('Marked deliberate', buckets.deliberate.length, deliberateOpen, () => setDeliberateOpen((value) => !value), 'deliberate')}
            {deliberateOpen ? buckets.deliberate.map((finding) => card(finding, true)) : null}
          </div>
        )}

        {buckets.flagged.length > 0 ? (
          <span className="text-11-5 text-ink3" data-flashback-note>
            {[flashbacks > 0 ? plural(flashbacks, 'flashback') : null, forwards > 0 ? plural(forwards, 'flash-forward') : null].filter((part) => part !== null).join(' and ')}{' '}
            {buckets.flagged.length === 1 ? 'sits' : 'sit'} outside the frame, as flagged. Not listed.
          </span>
        ) : null}
      </div>
    </div>
  )
}
