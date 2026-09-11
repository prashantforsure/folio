import type { UnacceptedHeading } from '../../../../../../lib/scenes/excerpt'
import { count } from '../../../../../../lib/workspace/format'

/**
 * Headings derivation refused, shown as refused.
 *
 * AGENTS.md, Derivation: "A malformed heading does not silently become a
 * scene." The refusal already happened - in the parser on import, or in
 * `derive` for a heading typed into a Scene node - and this list is where it
 * is surfaced. It is never a card, never counted, and the reason is the
 * parser's own (`SluglineRejection`), not one formed here.
 *
 * Shared by the empty state and the board, so it has no server import and no
 * `'use client'`: it renders wherever it is placed.
 */

/** The reason a scene-typed node is not a scene, in the parser's own words. */
export const refusalText = (why: UnacceptedHeading['why']): string => {
  switch (why.kind) {
    case 'not-derived':
      return 'not derived yet'
    case 'not-a-heading':
      return 'not heading-shaped'
    case 'rejected':
      switch (why.reason.kind) {
        case 'prefix-not-a-word':
          return `reads ${why.reason.looksLike} + the rest, not a heading`
        case 'no-set':
          return `${why.reason.prefix} with no set`
        case 'forced-but-empty':
          return 'forced heading with nothing behind it'
      }
  }
}

export const UnacceptedList = ({
  unaccepted,
}: {
  readonly unaccepted: readonly UnacceptedHeading[]
}) =>
  unaccepted.length === 0 ? null : (
    <div className="flex flex-col gap-[4px]" data-unaccepted-headings>
      <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">
        {count(unaccepted.length)} heading{unaccepted.length === 1 ? '' : 's'} not read as a scene
      </span>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {unaccepted.map((entry) => (
          <li key={entry.nodeId} className="flex items-baseline gap-[8px] text-11">
            <span className="min-w-0 truncate font-mono uppercase text-ink">{entry.text}</span>
            <span className="flex-none text-10 text-note">{refusalText(entry.why)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
