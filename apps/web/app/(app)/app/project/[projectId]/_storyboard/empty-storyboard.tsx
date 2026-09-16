import Link from 'next/link'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'

/**
 * The Storyboard route's empty states. Two facts told apart, because they
 * are different facts: an episode with no script, and a script derivation
 * found no scene in. Neither can be boarded - a shot hangs off a scene, and
 * a scene comes from a heading - so both point at the Script route. AGENTS.md:
 * every route ships both states, no exceptions.
 *
 * Drawn to the README's pattern ("Empty states. A single 440px card:
 * heading, one paragraph of plain explanation, an accent AI action plus a
 * manual alternative, and a one-line caveat. Never an illustration"), with
 * one difference the facts force: there is no AI action to offer over a
 * script that does not exist, so the card has the manual one alone.
 *
 * A script *with* scenes and no shots is not an empty state of the route:
 * it is a board of columns each saying "No shots yet", which the mockup
 * draws and `board-view.tsx` builds.
 */
export const EmptyStoryboard = ({
  state,
  scriptHref,
}: {
  readonly state: 'no-script' | 'no-scenes'
  readonly scriptHref: EpisodeRoutePath
}) => (
  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-[20px] py-[32px]" data-empty-state={state}>
    <div className="flex w-full max-w-[440px] flex-col gap-[16px] rounded-panel border border-line2 bg-s1 p-[24px]">
      <div className="flex flex-col gap-[7px]">
        <h2 className="m-0 text-17 font-medium tracking-title">{state === 'no-script' ? 'No script yet' : 'A script, but no scenes'}</h2>
        <p className="m-0 text-13 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
          {state === 'no-script'
            ? 'Break each scene into shots, and give each shot a frame. Shots hang off scenes, and scenes are read from the script’s headings — there is no script for this episode, so there is nothing to board yet.'
            : 'Break each scene into shots, and give each shot a frame. Derivation found no heading it could accept in this script, so there is no scene to board. A heading like INT. MEERA’S FLAT - NIGHT is a scene; INTERCUT - PHONE CALL is not, and never becomes one.'}
        </p>
      </div>
      <div className="flex gap-[8px]">
        <Link
          href={scriptHref}
          className="folio-solid-button flex h-[36px] flex-1 items-center justify-center gap-[8px] rounded-[10px] text-13 font-medium no-underline hover:no-underline"
        >
          Open the script
        </Link>
      </div>
      <span className="text-11-5 text-ink3">
        {state === 'no-script' ? 'Write or import a script there; the board reads its headings.' : 'Fix the headings there; the board follows the script.'}
      </span>
    </div>
  </div>
)
