'use client'

import { setNewPropOpen } from '../../../../../../lib/props/compose'
import { EmptyCard } from '../_chrome/empty-card'

/**
 * The empty state, on the README's 440px card (`_chrome/empty-card.tsx`).
 *
 * ## There is no `✦ Derive` button here, and that is the point
 *
 * Every other record route's empty card offers one, because a pass can
 * read its records off the node list: a cue is a character, a slugline is
 * a set. Nothing in a screenplay's grammar is a prop - a bat is a noun in
 * a line of action and no pass can tell it from a bench - so there is
 * nothing to derive and no count to promise. Drawing a disabled `✦ Derive`
 * would be a lookalike for a thing that cannot exist; drawing an enabled
 * one would mint records out of prose, which ruling 6 and
 * `packages/script`'s `entities.ts` both refuse.
 *
 * So the card has one action, and the caveat explains the bargain the
 * route is actually offering: name the thing, then tell it what the page
 * calls it, and the script starts quoting itself back.
 */
export const EmptyProps = () => (
  <EmptyCard
    attr="data-empty-props"
    title="No props yet"
    body="A prop is something the film has to put in front of the camera - a ball, a letter, a kit bag. Nothing in a screenplay names one, so this list is yours to write."
    secondary={{
      label: '＋ Add a prop',
      attr: 'data-add-by-hand',
      onClick: () => {
        setNewPropOpen(true)
      },
    }}
    caveat="Bind what the page calls it - “the ball” - and its lines are quoted here."
  />
)
