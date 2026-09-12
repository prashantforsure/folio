'use client'

import type { EpisodeSlug, ProjectId, TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding } from '@folio/script'
import { formatStoryTime } from '@folio/script'
import type { NodeId } from '@folio/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { saveStoryTime } from '../../../../../../lib/timeline/actions'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { plural, sceneRef } from './figures'
import type { EpisodeLinks, Run } from './timeline-workspace'
import { useTimelineState } from './timeline-state'

/**
 * The continuity view: the findings, one card each.
 *
 * `Route - Timeline.dc.html`, `isContinuity`: the paragraph, then a card
 * per finding on `--panel` - a coloured dot, the kind in caps, a
 * Newsreader 16px title, the body, the two scene refs side by side, and
 * the buttons. The bundle's three findings are fixture prose of three
 * kinds; the brief names one - "a scene whose story time precedes the
 * scene before it on the page" - and that is the one drawn. Its buttons
 * become what the two authored things allow: `Retime` opens the scene in
 * story order with the panel on it, `Flashback` sets the flag (the
 * finding stays reported, as a flashback, and leaves this list), `Open in
 * Script` goes to the page. The bundle's `Swap on the page` would be a
 * node write and is not built.
 *
 * "A finding is a flag, not an error. Flashbacks are legitimate." The
 * findings of kind `flashback` are not cards: the flag is the writer's
 * answer, and re-asking is the false positive the brief warns against.
 * They are counted in one line at the foot so they are not invisible.
 */
export const Continuity = ({
  projectId,
  scenes,
  findings,
  placed,
  baseHref,
  links,
  run,
}: {
  readonly projectId: ProjectId
  readonly scenes: readonly TimelineSceneRow[]
  readonly findings: readonly ContinuityFinding[]
  readonly placed: number
  readonly baseHref: ProjectRoutePath
  readonly links: Readonly<Record<EpisodeSlug, EpisodeLinks>>
  readonly run: Run
}) => {
  const router = useRouter()
  const { select } = useTimelineState()
  const byId = new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene]))
  const open = findings.filter((finding) => finding.kind === 'order')
  const flashbacks = findings.length - open.length

  const retime = (id: NodeId): void => {
    select(id)
    router.push(baseHref)
  }

  const markFlashback = (scene: TimelineSceneRow): void => {
    if (scene.storyTime === null) return
    run(async () => {
      const result = await saveStoryTime(projectId, scene.sceneNodeId, {
        day: scene.storyTime?.day ?? null,
        clock: scene.storyTime?.clock ?? null,
        flashback: true,
      })
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-continuity>
      <div className="flex max-w-[820px] flex-col gap-[14px]">
        <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
          Places where page order and story time disagree in a way you may not have meant. Each one is either a
          deliberate choice or a fix. Mark it and it stops appearing.
        </p>

        {open.length === 0 ? (
          <div className="rounded-chrome border border-line bg-panel px-[15px] py-[13px] text-12 leading-[1.5] text-ink2" data-continuity-clear>
            {placed === 0
              ? 'Nothing is placed yet. Give scenes a story time in story order and any disagreement with the page shows here.'
              : 'Page order and story time agree everywhere both are set.'}
          </div>
        ) : null}

        {open.map((finding) => {
          const scene = byId.get(finding.sceneId)
          const previous = byId.get(finding.previousId)
          if (scene === undefined || previous === undefined) return null
          const ref = sceneRef(scene)
          const prevRef = sceneRef(previous)
          return (
            <div
              key={finding.sceneId}
              data-finding={finding.sceneId}
              className="flex flex-col gap-[10px] rounded-chrome border border-line bg-panel px-[15px] py-[13px]"
            >
              <div className="flex items-start gap-[10px]">
                <span aria-hidden="true" className="mt-[4px] h-[7px] w-[7px] flex-none rounded-full bg-note" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Order</span>
                  <span className="font-serif text-16 leading-[1.35]">
                    {ref} happens before {prevRef}, but comes after it on the page.
                  </span>
                  <span className="text-12 leading-[1.5] text-ink2">
                    {ref} is set at {formatStoryTime(finding.sceneTime)}. {prevRef}, the scene before it on the page, is
                    set at {formatStoryTime(finding.previousTime)}. If that is the order you mean, mark {ref} a
                    flashback; otherwise retime one of them.
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-[8px] pl-[17px]">
                {[previous, scene].map((entry) => (
                  <button
                    key={entry.sceneNodeId}
                    type="button"
                    onClick={() => {
                      retime(entry.sceneNodeId)
                    }}
                    className="flex flex-col gap-[2px] rounded-chrome border border-line2 bg-sheet px-[10px] py-[7px] text-left hover:border-accent-line"
                  >
                    <span className="text-10 text-ink3">
                      {sceneRef(entry)} · {entry.storyTime === null ? '—' : formatStoryTime(entry.storyTime)}
                    </span>
                    <span className="truncate font-mono text-11">{entry.heading}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-[6px] pl-[17px]">
                <button
                  type="button"
                  onClick={() => {
                    retime(scene.sceneNodeId)
                  }}
                  data-retime={scene.sceneNodeId}
                  className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11 font-semibold text-desk hover:opacity-90"
                >
                  Retime {ref}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    markFlashback(scene)
                  }}
                  data-mark-flashback={scene.sceneNodeId}
                  className="rounded-chrome border border-line bg-transparent px-[11px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink"
                >
                  Flashback
                </button>
                <Link
                  href={links[scene.episode]?.script ?? baseHref}
                  className="rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11 text-ink3 no-underline hover:bg-hover hover:text-ink hover:no-underline"
                >
                  Open in Script
                </Link>
              </div>
            </div>
          )
        })}

        {flashbacks > 0 ? (
          <span className="text-10-5 text-ink3" data-flashback-note>
            {plural(flashbacks, 'flashback is', 'flashbacks are')} earlier than the scene before{' '}
            {flashbacks === 1 ? 'it' : 'them'} on the page, as flagged. Not listed.
          </span>
        ) : null}
      </div>
    </div>
  )
}
