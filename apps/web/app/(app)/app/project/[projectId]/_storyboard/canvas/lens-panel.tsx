'use client'

import type { ShotEdit, ShotRow } from '@folio/contracts'
import {
  CAMERA_ANGLES,
  CAMERA_ANGLE_LABEL,
  SHOT_MOVEMENTS,
  SHOT_MOVEMENT_LABEL,
  SHOT_SIZES,
  SHOT_SIZE_LABEL,
  isCameraAngle,
  isShotMovement,
  isShotSize,
} from '@folio/script'
import type { ReactNode } from 'react'

import { shotEditOf } from '../../../../../../../lib/storyboard/board'

/**
 * The card's `Lens` tab: the lens language, four selects - Size, Angle,
 * Movement, Lens. One change is one save of the whole spec
 * (`ShotEditSchema` is whole, and `shotEditOf` fills the rest from the
 * row), so there is no Save button and nothing to lose. Editing a proposal
 * accepts it, as every edit does.
 *
 * Lens is a free integer in the contract (8-1200mm), not a vocabulary, so
 * the select offers the seven primes a shot list reaches for and keeps
 * whatever the row already says as an option of its own, so a 40mm typed
 * in the long editor is not silently rounded. `—` is no lens.
 */

const LENS_PRESETS = [14, 24, 35, 50, 85, 135, 200] as const

export const LensPanel = ({ shot, pending, onSave }: { readonly shot: ShotRow; readonly pending: boolean; readonly onSave: (edit: ShotEdit) => void }) => {
  const save = (change: Partial<ShotEdit>): void => {
    onSave({ ...shotEditOf(shot), ...change })
  }
  const lenses: readonly number[] = shot.lensMm === null || (LENS_PRESETS as readonly number[]).includes(shot.lensMm) ? LENS_PRESETS : [...LENS_PRESETS, shot.lensMm].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-[9px] px-[12px] pb-[4px] pt-[2px]" data-lens-panel>
      <span className="text-12-5 font-medium">Lens language</span>
      <div className="grid grid-cols-2 gap-[8px]">
        <Field label="Size">
          <select
            data-lens-field="size"
            value={shot.size}
            disabled={pending}
            className="folio-field folio-select"
            onChange={(event) => {
              if (isShotSize(event.target.value)) save({ size: event.target.value })
            }}
          >
            {SHOT_SIZES.map((value) => (
              <option key={value} value={value}>
                {SHOT_SIZE_LABEL[value].name} ({SHOT_SIZE_LABEL[value].short})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Angle">
          <select
            data-lens-field="angle"
            value={shot.angle}
            disabled={pending}
            className="folio-field folio-select"
            onChange={(event) => {
              if (isCameraAngle(event.target.value)) save({ angle: event.target.value })
            }}
          >
            {CAMERA_ANGLES.map((value) => (
              <option key={value} value={value}>
                {CAMERA_ANGLE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Movement">
          <select
            data-lens-field="movement"
            value={shot.movement}
            disabled={pending}
            className="folio-field folio-select"
            onChange={(event) => {
              if (isShotMovement(event.target.value)) save({ movement: event.target.value })
            }}
          >
            {SHOT_MOVEMENTS.map((value) => (
              <option key={value} value={value}>
                {SHOT_MOVEMENT_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lens">
          <select
            data-lens-field="lens"
            value={shot.lensMm === null ? '' : String(shot.lensMm)}
            disabled={pending}
            className="folio-field folio-select"
            onChange={(event) => {
              const value = event.target.value
              save({ lensMm: value === '' ? null : Number.parseInt(value, 10) })
            }}
          >
            <option value="">—</option>
            {lenses.map((value) => (
              <option key={value} value={String(value)}>
                {value}mm
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}

const Field = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-[5px]">
    <span className="text-11 text-ink3">{label}</span>
    {children}
  </label>
)
