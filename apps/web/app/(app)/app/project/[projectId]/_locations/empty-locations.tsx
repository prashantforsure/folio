'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createLocation, deriveLocationsNow } from '../../../../../../lib/locations/actions'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './locations-workspace'

/**
 * The empty state: no location record at all.
 *
 * `Route - Locations.dc.html`, `isEmpty`: a 460px card on `--panel` -
 * `LOCATIONS · 0`, "No locations yet", the sentence about what a record is,
 * the script's top headings in Courier with their counts, then the two
 * buttons and the line about the script staying as written. The heading
 * list and the count are the speculative pass's output - ids discarded,
 * nothing written - which is the same read the Characters card makes.
 *
 * Two ways out, both real:
 *
 *   `✦ Derive N locations`  runs a project-wide pass, awaited. Derivation
 *                           runs on every save and import already, so this
 *                           state is reached only when nothing has been
 *                           written yet - or a deferred pass failed.
 *   `＋ Add by hand`         creates a record with no heading behind it.
 *
 * With nothing derivable - no script, or a script with no heading - the
 * first button is not drawn; the copy says why. Same card, both themes.
 */
export const EmptyLocations = ({
  projectId,
  derivable,
  run,
}: {
  readonly projectId: ProjectId
  readonly derivable: { readonly count: number; readonly top: readonly { readonly set: string; readonly n: number }[] }
  readonly run: Run
}) => {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const headings = derivable.top.reduce((total, entry) => total + entry.n, 0)
  const more = derivable.count - derivable.top.length

  const derive = (): void => {
    run(async () => {
      const result = await deriveLocationsNow(projectId)
      if (result.status !== 'derived') return result.message
      router.refresh()
      return null
    })
  }

  const add = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    run(async () => {
      const result = await createLocation(projectId, trimmed)
      if (result.status !== 'created') return result.message
      router.push(locationHref(projectId, result.id))
      return null
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center px-[24px] py-[40px]" data-empty-locations>
      <div className="flex w-full max-w-[460px] flex-col gap-[16px] rounded-chrome border border-line bg-panel px-[24px] pb-[24px] pt-[22px]">
        <div className="flex flex-col gap-[5px]">
          <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Locations · 0</span>
          <span className="font-serif text-[22px] font-medium leading-[1.15]">No locations yet</span>
          <span className="text-12 leading-[1.55] text-ink2">
            {derivable.count > 0
              ? `Your script has scene headings in ${String(derivable.count)} distinct ${
                  derivable.count === 1 ? 'place' : 'places'
                }. Derive them and each becomes a record you can describe once and reuse in Production.`
              : 'Your script has no scene headings yet. Write one and it becomes a record you can describe once and reuse in Production.'}
          </span>
        </div>
        {derivable.top.length > 0 ? (
          <div className="flex flex-col gap-[2px] rounded-chrome border border-line2 bg-sheet px-[12px] py-[10px] font-mono text-11 leading-[1.6] text-ink2" data-empty-headings={headings}>
            {derivable.top.map((entry) => (
              <span key={entry.set}>
                {entry.set} <span className="text-ink3">× {entry.n}</span>
              </span>
            ))}
            {more > 0 ? <span className="text-ink3">… {more} more</span> : null}
          </div>
        ) : null}
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
            className="flex gap-[8px]"
          >
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              placeholder="Location name"
              aria-label="Location name"
              className="min-w-0 flex-1 rounded-chrome border border-line2 bg-sheet px-[10px] py-[7px] text-12 text-ink outline-none placeholder:text-ink3"
            />
            <button
              type="submit"
              disabled={name.trim() === ''}
              className="rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-semibold text-accent-ink disabled:opacity-50"
            >
              Create
            </button>
          </form>
        ) : (
          <div className="flex gap-[8px]">
            {derivable.count > 0 ? (
              <button
                type="button"
                onClick={derive}
                data-derive-now
                className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-semibold text-accent-ink hover:opacity-90"
              >
                <span aria-hidden="true" className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
                  ✦
                </span>
                Derive {derivable.count} {derivable.count === 1 ? 'location' : 'locations'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAdding(true)
              }}
              data-add-by-hand
              className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[12px] py-[8px] text-12 text-ink2 hover:bg-hover hover:text-ink"
            >
              <span aria-hidden="true" className="text-11 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
                ＋
              </span>
              Add by hand
            </button>
          </div>
        )}
        <span className="text-10-5 text-ink3">Nothing is renamed in the script. Sluglines stay as written and point at the record.</span>
      </div>
    </div>
  )
}
