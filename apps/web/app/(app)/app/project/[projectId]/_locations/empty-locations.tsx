'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { deriveLocationsNow } from '../../../../../../lib/locations/actions'
import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import type { Derivable } from '../../../../../../lib/locations/server'
import { EmptyCard } from '../_chrome/empty-card'
import type { Run } from '../_chrome/use-run'

/**
 * The empty state - `Route - Locations v2.dc.html` on the README's 440px
 * card (`_chrome/empty-card.tsx`): `No locations yet`, `Your script has 15
 * sluglines across 9 distinct places. Derive them and each becomes a record
 * you can scout, photograph and shoot from.`, the mono block of the three
 * busiest headings with `× 6`, `✦ Derive 9 locations` and `＋ By hand`, and
 * the caveat `Sluglines stay as written and point at the record.`
 *
 * Every number is the speculative pass's (`loadLocations`'s `derivable`).
 * With nothing derivable - no script, or a script with no heading - the
 * derive button is not drawn and the paragraph says why; the mono block
 * goes too.
 */
export const EmptyLocations = ({
  projectId,
  derivable,
  run,
}: {
  readonly projectId: ProjectId
  readonly derivable: Derivable
  readonly run: Run
}) => {
  const router = useRouter()
  const derive = (): void => {
    run(async () => {
      const result = await deriveLocationsNow(projectId)
      if (result.status !== 'derived') return result.message
      router.refresh()
      return null
    })
  }

  return (
    <EmptyCard
      attr="data-empty-locations"
      title="No locations yet"
      body={
        derivable.count > 0
          ? `Your script has ${String(derivable.sluglines)} ${derivable.sluglines === 1 ? 'slugline' : 'sluglines'} across ${String(derivable.count)} distinct ${derivable.count === 1 ? 'place' : 'places'}. Derive them and each becomes a record you can scout, photograph and shoot from.`
          : 'Write a scene heading in the script and its place becomes a record here - or add one by hand.'
      }
      mono={derivable.top.map((entry) => ({ key: entry.set, label: entry.set, count: `× ${String(entry.n)}` }))}
      more={derivable.count - derivable.top.length}
      {...(derivable.count > 0
        ? {
            primary: {
              label: (
                <>
                  <span className="folio-mark">✦</span> Derive {derivable.count} {derivable.count === 1 ? 'location' : 'locations'}
                </>
              ),
              attr: 'data-derive-now',
              onClick: derive,
            },
          }
        : {})}
      secondary={{
        label: '＋ By hand',
        attr: 'data-add-by-hand',
        onClick: () => {
          setNewLocationOpen(true)
        },
      }}
      caveat="Sluglines stay as written and point at the record."
    />
  )
}
