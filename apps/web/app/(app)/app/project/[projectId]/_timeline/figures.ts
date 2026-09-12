import type { StoryThreadColour, TimelineSceneRow } from '@folio/contracts'

/**
 * How the Timeline prints a thing. Pure, and small enough to read.
 *
 * Every string a card or a panel shows that is not the writer's own text
 * comes through one of these, so the route cannot print the same fact two
 * ways.
 */

/** `E1 Sc 14`, as the bundle writes every scene reference. */
export const sceneRef = (scene: Pick<TimelineSceneRow, 'episodeOrdinal' | 'number'>): string =>
  `E${String(scene.episodeOrdinal)} Sc ${String(scene.number)}`

/**
 * The card's short slug: `CHAWL CORRIDOR` for `INT. CHAWL CORRIDOR - DAY`.
 * The bundle's own two replacements - the time of day after ` - ` goes, and
 * so does the `INT.` / `EXT.` in front - because the chip below the slug
 * already says when, and the card is 200px wide.
 */
export const shortSlug = (heading: string): string =>
  heading
    .replace(/\s+-\s+.*$/, '')
    .replace(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s*/i, '')
    .trim() || heading

/** The token a thread's colour name resolves to. `packages/ui`, `palette.css`. */
export const threadColourVar = (colour: StoryThreadColour): string => `var(--thread-${colour})`

/** The story-order chip for an unplaced scene; a placed one prints `formatStoryTime`. */
export const NO_TIME = 'no time'

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : many}`
