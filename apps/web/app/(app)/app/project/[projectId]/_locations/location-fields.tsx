'use client'

import type { LocationStatus } from '@folio/contracts'
import { LOCATION_STATUSES, LOCATION_STATUS_LABELS } from '@folio/contracts'

import { statusTone } from '../../../../../../lib/locations/view'
import { Field } from '../_chrome/drawer-shell'
import { StatusTabs } from '../_chrome/status-tabs'
import type { StatusOption } from '../_chrome/status-tabs'

/**
 * The fields both drawers author, in three pieces since the rebuild
 * (2026-09-18): the name (`NameField`), the tree edge (`PartOfField`,
 * under the drawer's `Inside` section - a primary set of its own, or
 * inside one), and the Production fold (`ProductionFields`): the scouting
 * status segmented control, the address, the shooting days scheduled at
 * this set (with the roll-up printed beside it - AGENTS.md's "how many
 * days in the chawl", authored here at last), and the description. The v2 pass's
 * read-only `Int / Ext` and `Type` "fields" are gone: both are printed
 * where they are read, on the card and in the drawer's head.
 *
 * A draft until Save: nothing here writes. `scheduledDays` is kept as
 * typed so the field can be emptied while editing; the save parses it.
 */
export type LocationDraft = {
  readonly name: string
  readonly address: string
  readonly description: string
  readonly status: LocationStatus
  /** The parent's id, or `''` for a primary set. */
  readonly parentId: string
  /** Shooting days at this set, as typed. */
  readonly scheduledDays: string
}

export const EMPTY_DRAFT: LocationDraft = { name: '', address: '', description: '', status: 'pending', parentId: '', scheduledDays: '0' }

/** The typed days as a count, or null when the field does not read as one. */
export const daysOf = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  if (!/^\d{1,4}$/u.test(trimmed)) return null
  return Number(trimmed)
}

export const STATUS_OPTIONS: readonly StatusOption<LocationStatus>[] = LOCATION_STATUSES.map((status) => ({
  id: status,
  label: LOCATION_STATUS_LABELS[status],
  tone: statusTone(status),
}))

export const NameField = ({ value, busy, onChange }: { readonly value: string; readonly busy: boolean; readonly onChange: (value: string) => void }) => (
  <Field label="Location name">
    <input
      type="text"
      value={value}
      disabled={busy}
      data-field="name"
      placeholder="Kamathi Chawl"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="folio-drawer-field"
    />
  </Field>
)

export const PartOfField = ({
  value,
  parents,
  busy,
  onChange,
}: {
  readonly value: string
  /** The records this one may hang under: every other root, and no descendant of its own. */
  readonly parents: readonly { readonly id: string; readonly name: string }[]
  readonly busy: boolean
  readonly onChange: (value: string) => void
}) => (
  <Field label="Part of">
    <select
      value={value}
      disabled={busy}
      data-field="parent"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="folio-drawer-field folio-select"
    >
      <option value="">A primary set of its own</option>
      {parents.map((parent) => (
        <option key={parent.id} value={parent.id}>
          Inside {parent.name}
        </option>
      ))}
    </select>
  </Field>
)

export const ProductionFields = ({
  draft,
  onChange,
  busy,
  rollupDays,
}: {
  readonly draft: LocationDraft
  readonly onChange: (next: LocationDraft) => void
  readonly busy: boolean
  /** The subtree's shooting days from the last pass, or null in the New drawer. */
  readonly rollupDays: number | null
}) => {
  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  const own = daysOf(draft.scheduledDays)
  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-col gap-[6px]">
        <span className="text-11-5 text-ink2">Scouting status</span>
        <StatusTabs
          label="Scouting status"
          options={STATUS_OPTIONS}
          value={draft.status}
          busy={busy}
          onChange={(status) => {
            set('status', status)
          }}
        />
      </div>
      <Field label="Address">
        <input
          type="text"
          value={draft.address}
          disabled={busy}
          data-field="address"
          placeholder="Actual or fictional address…"
          onChange={(event) => {
            set('address', event.target.value)
          }}
          className="folio-drawer-field truncate"
        />
      </Field>
      <div className="grid gap-[9px]" style={{ gridTemplateColumns: '120px minmax(0, 1fr)' }}>
        <Field label="Shooting days">
          <input
            type="text"
            inputMode="numeric"
            value={draft.scheduledDays}
            disabled={busy}
            data-field="days"
            aria-invalid={own === null ? 'true' : undefined}
            placeholder="0"
            onChange={(event) => {
              set('scheduledDays', event.target.value)
            }}
            className="folio-drawer-field tabular font-mono"
          />
        </Field>
        <span className="flex flex-col justify-end pb-[9px] text-11 leading-[1.5] text-ink3" data-days-rollup={rollupDays ?? ''}>
          {rollupDays === null
            ? 'Scheduled at this set. Sub-sets roll up into the parent.'
            : own !== null && rollupDays > own
              ? `${String(rollupDays)} with its sub-sets, from the last pass.`
              : own === null
                ? 'A whole number of days.'
                : 'At this set alone; its sub-sets roll up into it.'}
        </span>
      </div>
      <Field label="Description">
        <textarea
          value={draft.description}
          disabled={busy}
          data-field="description"
          data-kind="prose"
          rows={4}
          placeholder="The place in a line or two, or what the crew needs to know."
          onChange={(event) => {
            set('description', event.target.value)
          }}
          className="folio-drawer-field text-ink2"
          style={{ textWrap: 'pretty' }}
        />
      </Field>
    </div>
  )
}
