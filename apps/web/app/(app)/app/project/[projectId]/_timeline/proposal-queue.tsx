'use client'

import type { ProjectId, TimelineSceneRow } from '@folio/contracts'
import type { NodeId, PlacementProposal } from '@folio/script'
import { formatStoryTime } from '@folio/script'
import { useMemo, useState } from 'react'

import { plural, proposalLine, sceneRef, shortSlug } from '../../../../../../lib/timeline/view'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { sceneHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'

/** How many proposal rows show before the fold. */
const QUEUE_FOLD = 6

/**
 * The proposal queue - what the toolbar's `Place N scenes`, the banner's
 * `Place them` and the empty card open (the rebuild, phase 2; the
 * Characters resolve queue's shape). One row per unplaced scene with the
 * story time the core proposes for it and *why*, in the writer's terms:
 *
 *   `CONTINUOUS → same day and clock as E1 Sc 4`
 *   `LATER → Day 2, later the same day`
 *   `"the next morning" → Day 3`
 *   `no cue → Day 3, carried from E1 Sc 9`
 *
 * and the evidence as a citation chip into the script - the line the cue
 * came from, or the heading. `Accept` is the drawer's own write for that
 * scene; `Skip` hides the row for the visit and writes nothing; `Accept
 * all` is one write over every row still showing, undoable from the
 * status bar. Every proposal is `@folio/script`'s `proposePlacements`
 * over the scenes as they stand - accepting one re-counts the rows below
 * it from the day just written, which is what a carry means.
 *
 * This is what replaced the first pass's `Assume continuous`: the same
 * carry for a scene with no cue, but shown as a proposal with its reason,
 * accepted one at a time or whole, and taken back the same way.
 */
export const ProposalQueue = ({
  projectId,
  shape,
  proposals,
  scenes,
  onAccept,
  onSkip,
  onAcceptAll,
  onOpen,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly proposals: readonly PlacementProposal[]
  readonly scenes: readonly TimelineSceneRow[]
  readonly onAccept: (proposal: PlacementProposal) => void
  readonly onSkip: (id: NodeId) => void
  readonly onAcceptAll: () => void
  readonly onOpen: (id: NodeId) => void
  readonly onClose: () => void
}) => {
  const [expanded, setExpanded] = useState(false)
  const byId = useMemo(() => new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene])), [scenes])
  const folded = proposals.length > QUEUE_FOLD && !expanded
  const rows = folded ? proposals.slice(0, QUEUE_FOLD) : proposals
  const withCues = proposals.filter((proposal) => proposal.reason !== 'carried').length

  return (
    <section data-proposal-queue data-open={folded ? 'false' : 'true'} className="mx-[20px] mb-[12px] flex flex-col rounded-card border border-line2 bg-s1">
      <div className="flex items-center gap-[12px] px-[14px] py-[10px]">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-12-5 text-ink2" data-proposal-count={proposals.length}>
            {proposals.length === 0 ? 'Every scene has a story time, or was skipped' : `${plural(proposals.length, 'scene')} to place`}
          </span>
          <span className="text-11 text-ink3">
            {proposals.length === 0
              ? 'Nothing to propose.'
              : `${String(withCues)} read from the page - a heading's CONTINUOUS or LATER, a line that counts days - the rest carried from the scene before. Accepting writes the day; skipping writes nothing.`}
          </span>
        </span>
        {proposals.length > QUEUE_FOLD ? (
          <button
            type="button"
            data-proposal-fold
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((value) => !value)
            }}
            className="folio-line-button h-[28px] flex-none rounded-[8px] px-[12px] text-12"
          >
            {expanded ? 'Show fewer' : `Show all ${String(proposals.length)}`}
          </button>
        ) : null}
        {proposals.length === 0 ? null : (
          <button type="button" data-proposal-accept-all onClick={onAcceptAll} className="folio-solid-button h-[28px] flex-none rounded-[8px] px-[12px] text-12 font-medium">
            Accept all
          </button>
        )}
        <button type="button" title="Close" aria-label="Close the queue" data-proposal-close onClick={onClose} className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[6px] text-12 text-ink3">
          ✕
        </button>
      </div>
      {rows.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
          {rows.map((proposal) => {
            const scene = byId.get(proposal.sceneNodeId)
            if (scene === undefined) return null
            // The scene it was counted from: the nearest unflagged scene before it on the page - placed by the writer, or proposed above.
            const at = scenes.indexOf(scene)
            const previous = scenes.slice(0, at).reverse().find((entry) => !entry.flashback) ?? null
            const evidenceNode = proposal.cueNodeId ?? (proposal.reason === 'carried' ? null : scene.sceneNodeId)
            return (
              <li key={proposal.sceneNodeId} data-proposal-row={proposal.sceneNodeId} data-proposal-ref={sceneRef(scene)} data-proposal-reason={proposal.reason} className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-line2 px-[14px] py-[10px] last:border-b-0">
                <button
                  type="button"
                  data-proposal-open
                  onClick={() => {
                    onOpen(scene.sceneNodeId)
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start gap-[3px] border-none bg-transparent p-0 text-left"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-[8px]">
                    <span className="tabular font-mono text-11 text-ink3">{sceneRef(scene)}</span>
                    <span className="min-w-0 truncate font-mono text-11-5 uppercase text-ink">{shortSlug(scene.heading)}</span>
                  </span>
                  <span className="text-12-5 text-ink" data-proposal-line>
                    {proposalLine(proposal, previous)}
                  </span>
                </button>
                <CitationChips
                  refs={evidenceNode === null ? [] : [{ label: proposal.quote ?? sceneRef(scene), href: sceneHref({ projectId, shape, episode: scene.episode }, evidenceNode) }]}
                  className="flex-none"
                />
                <span className="flex flex-none items-center gap-[6px]">
                  <button
                    type="button"
                    data-proposal-accept
                    title={`Write ${formatStoryTime(proposal.time)}`}
                    onClick={() => {
                      onAccept(proposal)
                    }}
                    className={proposal.reason === 'carried' ? 'folio-line-button h-[28px] rounded-[8px] px-[12px] text-12' : 'folio-solid-button h-[28px] rounded-[8px] px-[12px] text-12 font-medium'}
                  >
                    {formatStoryTime(proposal.time)}
                  </button>
                  <button
                    type="button"
                    data-proposal-skip
                    onClick={() => {
                      onSkip(proposal.sceneNodeId)
                    }}
                    className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
                  >
                    Skip
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
