'use client'

import Link from 'next/link'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'

/**
 * The Storyboard route's empty states. Two facts told apart, because they
 * are different facts: an episode with no script, and a script derivation
 * found no scene in. Neither can be boarded - a shot hangs off a scene, and
 * a scene comes from a heading - so both point at the Script route. AGENTS.md:
 * every route ships both states, no exceptions.
 *
 * A script *with* scenes and no shots is not an empty state of the route:
 * it is a board of columns each saying "No shots yet", which the bundle
 * draws and `scene-column.tsx` builds.
 */
export const EmptyStoryboard = ({
  state,
  scriptHref,
}: {
  readonly state: 'no-script' | 'no-scenes'
  readonly scriptHref: EpisodeRoutePath
}) => (
  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-[24px]" data-empty-state={state}>
    <div className="flex w-full max-w-[420px] flex-col gap-[10px] rounded-chrome border border-line bg-panel p-[20px]">
      <h2 className="m-0 font-serif text-21 font-medium tracking-title">
        {state === 'no-script' ? 'No script yet' : 'A script, but no scenes'}
      </h2>
      <p className="m-0 text-11-5 leading-[1.55] text-ink2">
        {state === 'no-script'
          ? 'Break each scene into shots, and give each shot a frame. Shots hang off scenes, and scenes are read from the script’s headings — there is no script for this episode, so there is nothing to board yet.'
          : 'Break each scene into shots, and give each shot a frame. Derivation found no heading it could accept in this script, so there is no scene to board. A heading like INT. MEERA’S FLAT - NIGHT is a scene; INTERCUT - PHONE CALL is not, and never becomes one.'}
      </p>
      <Link href={scriptHref} className="text-11-5 text-accent">
        Open the Script route {state === 'no-script' ? 'to start or import one' : ''} &rarr;
      </Link>
    </div>
  </div>
)
