'use client'

import type { ProjectId, ResearchClipRow, ResearchFilingTarget } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { removeClip, sendClip, unsendClip } from '../../../../../../lib/research/actions'
import type { FilingTargets } from '../../../../../../lib/research/server'
import { filingLabel } from '../../../../../../lib/research/view'
import { useDismiss } from '../_chrome/use-dismiss'
import type { Run } from '../_chrome/use-run'

/**
 * What can be done with one clip: see where it is filed and unfile it,
 * `Send to…` a character, a location or a scene, or remove the clip. One
 * popover, opened from three places - a highlighted line in a source, a
 * clip card's `Send to…` or chip, and the drawer's clip list.
 *
 * `Route - Research v2.dc.html` draws `Send to…` as a dashed button and the
 * filings as accent chips, and nothing else: no picker, no way to unfile,
 * no way to delete a clip. The picker is what `Send to…` has to open, and
 * the two removals are here so a clip is not write-only - the drawer is the
 * edit surface (README, "Drawer"), and this is the clip's edit surface.
 * Flagged in the phase report as the one addition past the mockup.
 *
 * The three lists are the loader's `targets`: present scenes, live
 * characters, live locations. A place the clip is already filed to is not
 * offered again. The find field narrows all three at once.
 */
export const ClipMenu = ({
  projectId,
  clip,
  targets,
  run,
  onClose,
  align = 'left',
}: {
  readonly projectId: ProjectId
  readonly clip: ResearchClipRow
  readonly targets: FilingTargets
  readonly run: Run
  readonly onClose: () => void
  /** Which edge of the anchor the menu hangs from. */
  readonly align?: 'left' | 'right'
}) => {
  const router = useRouter()
  const root = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useDismiss(true, onClose, root)

  const filedScenes = new Set(clip.filings.flatMap((filing) => (filing.kind === 'scene' ? [filing.sceneNodeId] : [])))
  const filedCharacters = new Set(clip.filings.flatMap((filing) => (filing.kind === 'character' ? [filing.characterId] : [])))
  const filedLocations = new Set(clip.filings.flatMap((filing) => (filing.kind === 'location' ? [filing.locationId] : [])))

  const needle = query.trim().toLowerCase()
  const matches = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle)

  const scenes = targets.scenes.filter((ref) => !filedScenes.has(ref.sceneNodeId) && (matches(formatSceneRef(ref)) || matches(ref.heading)))
  const characters = targets.characters.filter((row) => !filedCharacters.has(row.id) && matches(row.name))
  const locations = targets.locations.filter((row) => !filedLocations.has(row.id) && matches(row.name))

  const act = (job: () => Promise<string | null>): void => {
    setBusy(true)
    setNotice(null)
    run(async () => {
      const failure = await job()
      setBusy(false)
      if (failure !== null) setNotice(failure)
      else router.refresh()
      return failure
    })
  }

  const send = (target: ResearchFilingTarget): void => {
    act(async () => {
      const result = await sendClip(projectId, clip.id, target)
      return result.status === 'filed' ? null : result.message
    })
  }

  const unfile = (id: string): void => {
    act(async () => {
      const result = await unsendClip(projectId, id)
      return result.status === 'unfiled' ? null : result.message
    })
  }

  const destroy = (): void => {
    act(async () => {
      const result = await removeClip(projectId, clip.id)
      if (result.status !== 'deleted') return result.message
      onClose()
      return null
    })
  }

  const nothing = scenes.length === 0 && characters.length === 0 && locations.length === 0

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Send this clip"
      data-clip-menu={clip.id}
      className={`folio-menu absolute top-[calc(100%+6px)] w-[280px] gap-0 p-0 ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {clip.filings.length > 0 ? (
        <div className="flex flex-col gap-[7px] border-b border-line2 px-[12px] pb-[10px] pt-[11px]">
          <span className="folio-eyebrow">Filed to</span>
          <div className="flex flex-wrap items-center gap-[6px]">
            {clip.filings.map((filing) => (
              <button
                key={filing.id}
                type="button"
                title="Unfile"
                disabled={busy}
                data-unfile={filing.id}
                onClick={() => {
                  unfile(filing.id)
                }}
                className="folio-filing-chip"
                data-size="small"
              >
                {filingLabel(filing)}
                <Icon name="close" size={9} strokeWidth={1.8} className="opacity-70" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-[6px] px-[12px] pb-[6px] pt-[10px]">
        <span className="folio-eyebrow">Send to</span>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="A scene, a character, a location"
          aria-label="Find a place to send this clip"
          data-clip-menu-find
          className="folio-field w-full rounded-[9px] text-12-5"
        />
      </div>

      <div className="flex max-h-[260px] flex-col gap-[2px] overflow-y-auto px-[8px] pb-[8px]">
        {nothing ? (
          <span className="px-[9px] py-[8px] text-12 text-ink3" data-clip-menu-empty>
            {needle === '' ? 'Nowhere to send it yet - write a scene heading, or add a character or a location.' : 'Nothing matches that.'}
          </span>
        ) : null}
        {scenes.length > 0 ? <span className="px-[9px] pb-[2px] pt-[6px] text-10-5 text-ink3">Scenes</span> : null}
        {scenes.map((ref) => (
          <button
            key={ref.sceneNodeId}
            type="button"
            disabled={busy}
            data-send-scene={ref.sceneNodeId}
            onClick={() => {
              send({ kind: 'scene', sceneNodeId: ref.sceneNodeId })
            }}
            className="folio-menu-item"
          >
            <span className="tabular w-[52px] flex-none font-mono text-10-5 text-ink3">{formatSceneRef(ref)}</span>
            <span className="min-w-0 flex-1 truncate text-12-5 uppercase tracking-[.01em]">{ref.heading === '' ? 'No heading yet' : ref.heading}</span>
          </button>
        ))}
        {characters.length > 0 ? <span className="px-[9px] pb-[2px] pt-[6px] text-10-5 text-ink3">Characters</span> : null}
        {characters.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={busy}
            data-send-character={row.id}
            onClick={() => {
              send({ kind: 'character', characterId: row.id })
            }}
            className="folio-menu-item"
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
          </button>
        ))}
        {locations.length > 0 ? <span className="px-[9px] pb-[2px] pt-[6px] text-10-5 text-ink3">Locations</span> : null}
        {locations.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={busy}
            data-send-location={row.id}
            onClick={() => {
              send({ kind: 'location', locationId: row.id })
            }}
            className="folio-menu-item"
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-[8px] border-t border-line2 px-[12px] py-[9px]">
        <button type="button" disabled={busy} data-remove-clip onClick={destroy} className="folio-delete-button h-[28px] rounded-[8px] px-[10px] text-11-5">
          Remove clip
        </button>
        {notice === null ? null : (
          <span className="min-w-0 flex-1 truncate text-11 text-live" role="alert" data-clip-menu-notice>
            {notice}
          </span>
        )}
      </div>
    </div>
  )
}
