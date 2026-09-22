'use client'

import type { ProductionScene, Reel, ReelShot } from '@folio/contracts'
import { PRIORITY_LABELS, SHOT_STATUS_LABELS } from '@folio/contracts'
import { dialogueOf } from '@folio/script'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cameraString, secondsLabel } from '../../../../../../lib/production/camera'
import { sceneFacts, shotStatusOf } from '../../../../../../lib/production/derive'
import type { MenuField } from '../../../../../../lib/production/menus'
import { useFocusTrap } from '../_chrome/use-focus-trap'
import { useProduction } from './production-context'

/**
 * §5.2, the detail drawer: `min(420px, 88vw)` at the right edge over a
 * blurred, click-through glow, sliding in over 280ms. Title `Shot {n}` +
 * the mono crumb `Scene {n} · {reel}`; the rows (Status, Shot type,
 * Duration, Character, Assignee, Priority, Location - the last two read-
 * only); Description (editable), Dialogue (`Add dialogue...` when empty),
 * References (44px thumbs + `＋` = upload), Camera (the full string).
 * Closes on `✕` or Escape; Tab stays inside while it is open.
 */
export const ShotDrawer = ({ scene, reel, shot }: { readonly scene: ProductionScene; readonly reel: Reel; readonly shot: ReelShot }) => {
  const { act, members, storage } = useProduction()
  const [mounted, setMounted] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setMounted(true)
  }, [])
  useFocusTrap(panel, mounted)
  const index = reel.shots.findIndex((candidate) => candidate.id === shot.id)
  const status = shotStatusOf(shot)
  const cast = shot.characters.map((entry) => scene.cast.find((member) => member.id === entry.characterId)?.name).filter((name): name is string => name !== undefined)
  const assignee = shot.assigneeId === null ? 'Unassigned' : (members.find((member) => member.id === shot.assigneeId)?.name ?? 'Unassigned')
  const dialogue = shot.dialogue ?? dialogueOf(shot.parts)
  const rows: readonly { readonly label: string; readonly value: string; readonly field: MenuField | null; readonly dim?: boolean }[] = [
    { label: 'Status', value: SHOT_STATUS_LABELS[status], field: 'status' },
    { label: 'Shot type', value: shot.shotType, field: 'type' },
    { label: 'Duration', value: secondsLabel(shot.durationS), field: null, dim: true },
    { label: 'Character', value: cast.length === 0 ? 'No character' : cast.join(', '), field: 'cast' },
    { label: 'Assignee', value: assignee, field: 'assignee' },
    { label: 'Priority', value: PRIORITY_LABELS[shot.priority], field: 'priority' },
    { label: 'Location', value: `${scene.locationName ?? scene.set} · ${sceneFacts(scene)}`, field: null, dim: true },
  ]
  if (!mounted) return null
  return createPortal(
    <div data-production-root data-shot-drawer-root>
      <span className="folio-prod-drawer-glow" aria-hidden="true" />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={`Shot ${String(index + 1)}`} data-shot-drawer={shot.id} className="folio-prod-drawer">
        <div className="flex flex-none items-center gap-[10px] px-[16px] pb-[12px] pt-[16px]">
          <span className="text-15 font-medium tracking-title">Shot {String(index + 1)}</span>
          <span className="font-mono text-11-5 text-ink3">
            Scene {String(scene.number)} · {reel.name}
          </span>
          <span className="flex-1" />
          <button type="button" title="Close" aria-label="Close" data-drawer-close onClick={act.closeDetail} className="folio-prod-x h-[26px] w-[26px]">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[16px] pb-[22px]">
          <div className="flex flex-col gap-[2px]">
            {rows.map((row) => (
              <button
                key={row.label}
                type="button"
                disabled={row.field === null}
                aria-haspopup={row.field === null ? undefined : 'menu'}
                data-drawer-row={row.label.toLowerCase().replace(' ', '-')}
                onClick={(event) => {
                  if (row.field !== null) act.openMenu(row.field, { kind: 'shot', id: shot.id }, event)
                }}
                className="folio-prod-drow"
              >
                <span className="w-[96px] flex-none text-12 text-ink3">{row.label}</span>
                <span className={`min-w-0 flex-1 text-12-5 ${row.dim === true ? 'text-ink2' : 'text-ink'}`}>{row.value}</span>
              </button>
            ))}
          </div>
          <div className="folio-prod-dsection">
            <span className="folio-prod-dlabel">Description</span>
            <span
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Description"
              title="Click to edit"
              data-drawer-description
              onKeyDown={(event) => {
                if (event.key === 'Escape') (event.target as HTMLElement).blur()
              }}
              onBlur={(event) => {
                act.saveDescription(shot.id, (event.currentTarget.textContent ?? '').trim())
              }}
              className="folio-prod-ddesc"
            >
              {shot.description}
            </span>
          </div>
          <div className="folio-prod-dsection">
            <span className="folio-prod-dlabel">Dialogue</span>
            <span className={`font-mono text-12-5 italic ${dialogue === null ? 'text-ink3' : 'text-read'}`} data-drawer-dialogue>
              {dialogue ?? 'Add dialogue...'}
            </span>
          </div>
          <div className="folio-prod-dsection gap-[8px]">
            <span className="folio-prod-dlabel">References</span>
            <span className="flex items-center gap-[8px]">
              {shot.references.map((asset) => (
                <span key={asset.id} className="folio-prod-ref" role="img" aria-label="Reference image" style={asset.url === null ? undefined : { backgroundImage: `url(${asset.url})` }} />
              ))}
              {shot.frame?.url ? <span className="folio-prod-ref" role="img" aria-label="Drawn frame" style={{ backgroundImage: `url(${shot.frame.url})` }} /> : null}
              <button
                type="button"
                title={storage ? 'Add a reference image' : 'Image storage is not set up on this server yet'}
                aria-label="Add a reference image"
                aria-disabled={!storage}
                data-add-reference
                onClick={() => {
                  if (storage) input.current?.click()
                }}
                className="folio-prod-ref-add"
              >
                ＋
              </button>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                aria-label="Reference image file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file !== undefined) act.uploadReference(shot.id, file)
                  event.target.value = ''
                }}
              />
            </span>
          </div>
          <div className="folio-prod-dsection">
            <span className="folio-prod-dlabel">Camera</span>
            <span className="text-12-5 leading-[1.6] text-ink2" data-drawer-camera>
              {cameraString(shot)}
            </span>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
