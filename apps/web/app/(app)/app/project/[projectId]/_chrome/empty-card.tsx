'use client'

import type { ReactNode } from 'react'

/**
 * The empty state - `docs/ui design/README.md`, "Empty states": "A single
 * 440px card: heading, one paragraph of plain explanation, an accent AI
 * action plus a manual alternative, and a one-line caveat. Never an
 * illustration." The record routes' mockups add a mono block between the
 * paragraph and the buttons - the three busiest cues or sluglines with
 * their counts and `… n more`.
 *
 * `primary` is the accent AI action (`✦ Derive 9 locations`); absent when
 * there is nothing to derive, and the manual alternative takes the row.
 * `_characters/empty-characters.tsx` draws the same card inline.
 */
export const EmptyCard = ({
  attr,
  title,
  body,
  mono,
  more,
  primary,
  secondary,
  caveat,
}: {
  readonly attr: `data-${string}`
  readonly title: string
  readonly body: string
  /** The mono rows: a label and a `--ink3` count each. */
  readonly mono?: readonly { readonly key: string; readonly label: string; readonly count: string }[]
  /** `… n more` under the mono rows. */
  readonly more?: number
  readonly primary?: { readonly label: ReactNode; readonly attr: `data-${string}`; readonly onClick: () => void }
  readonly secondary: { readonly label: string; readonly attr: `data-${string}`; readonly onClick: () => void }
  readonly caveat: string
}) => (
  <div {...{ [attr]: '' }} className="flex min-h-0 flex-1 items-center justify-center px-[20px] py-[32px]">
    <div className="flex w-full max-w-[440px] flex-col gap-[16px] rounded-panel border border-line2 bg-s1 p-[24px]">
      <div className="flex flex-col gap-[7px]">
        <span className="text-17 font-medium tracking-title">{title}</span>
        <span className="text-13 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
          {body}
        </span>
      </div>
      {mono !== undefined && mono.length > 0 ? (
        <div className="flex flex-col gap-[3px] rounded-[11px] border border-line2 bg-sunk px-[13px] py-[12px] font-mono text-11-5 leading-[1.6] text-ink2" data-derivable-top>
          {mono.map((row) => (
            <span key={row.key}>
              {row.label} <span className="text-ink3">{row.count}</span>
            </span>
          ))}
          {more !== undefined && more > 0 ? <span className="text-ink3">… {more} more</span> : null}
        </div>
      ) : null}
      <div className="flex gap-[8px]">
        {primary === undefined ? null : (
          <button type="button" onClick={primary.onClick} {...{ [primary.attr]: '' }} className="folio-accent-button h-[36px] flex-1 justify-center rounded-[10px] text-13">
            {primary.label}
          </button>
        )}
        <button
          type="button"
          {...{ [secondary.attr]: '' }}
          onClick={secondary.onClick}
          className={`folio-line-button h-[36px] justify-center rounded-[10px] px-[15px] text-13 ${primary === undefined ? 'flex-1' : 'flex-none'}`}
          data-line="strong"
        >
          {secondary.label}
        </button>
      </div>
      <span className="text-11-5 text-ink3">{caveat}</span>
    </div>
  </div>
)
