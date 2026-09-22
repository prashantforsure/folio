'use client'

import type { FieldId, ProductionScene } from '@folio/contracts'
import { PRIORITY_LABELS } from '@folio/contracts'

import type { MenuField } from '../../../../../../lib/production/menus'
import { useProduction } from './production-context'

/**
 * §3.5, the scene-setup row: `SCENE SETUP — applies to every shot`, an
 * auto-fill grid of dropdown buttons, one per visible field - Camera
 * (body · lens), Props, Location, INT/EXT, Shoot day, Priority, Notes
 * (`＋ Add note` when empty). Values default from the scene / its first
 * shot and are overridable per scene; a hidden field leaves the row.
 */
export const SceneSetup = ({ scene }: { readonly scene: ProductionScene }) => {
  const { act, shown, locations } = useProduction()
  const first = scene.reels.flatMap((reel) => reel.shots)[0] ?? null
  const setup = scene.setup
  const body = setup.cameraBody ?? first?.cameraBody ?? 'No camera'
  const lens = setup.lens ?? (first?.lens.trim().length ? first.lens : null) ?? 'No lens'
  const locationName = setup.locationId === null ? (scene.locationName ?? 'No location') : (locations.find((location) => location.id === setup.locationId)?.name ?? scene.locationName ?? 'No location')
  const intExt = setup.intExt ?? scene.intExt ?? 'No INT/EXT'
  const rows: readonly { readonly field: MenuField; readonly show: FieldId; readonly label: string; readonly value: string }[] = [
    { field: 'lens', show: 'lens', label: 'Camera', value: `${body} · ${lens}` },
    { field: 'prop', show: 'prop', label: 'Props', value: setup.prop ?? 'No prop' },
    { field: 'loc', show: 'loc', label: 'Location', value: locationName },
    { field: 'intext', show: 'intext', label: '', value: intExt },
    { field: 'date', show: 'date', label: 'Shoot day', value: setup.shootDate ?? 'No date' },
    { field: 'priority', show: 'priority', label: 'Priority', value: setup.priority === null ? 'No priority' : PRIORITY_LABELS[setup.priority] },
    { field: 'notes', show: 'notes', label: '', value: setup.note === null || setup.note.length === 0 ? '＋ Add note' : setup.note },
  ]
  return (
    <div className="folio-prod-setup" data-scene-setup>
      <div className="flex items-center gap-[9px]">
        <span className="folio-prod-eyebrow whitespace-nowrap">Scene setup</span>
        <span className="whitespace-nowrap text-11-5 text-ink2">applies to every shot</span>
      </div>
      <div className="folio-prod-setup-grid">
        {rows
          .filter((row) => shown(row.show))
          .map((row) => (
            <button
              key={row.field}
              type="button"
              aria-haspopup={row.field === 'date' || row.field === 'notes' ? 'dialog' : 'menu'}
              aria-label={`${row.label.length > 0 ? `${row.label}: ` : ''}${row.value}`}
              data-setup-field={row.field}
              data-empty={/^No |^＋ /.test(row.value) ? 'true' : undefined}
              onClick={(event) => {
                act.openMenu(row.field, { kind: 'scene', id: scene.sceneNodeId }, event)
              }}
              className="folio-prod-setup-btn"
            >
              {row.label.length > 0 ? <span className="whitespace-nowrap text-ink2">{row.label}</span> : null}
              <span className="min-w-0 flex-1 truncate text-left">{row.value}</span>
              <span className="folio-prod-caret">▾</span>
            </button>
          ))}
      </div>
    </div>
  )
}
