'use client'

import type { LocationRow, LocationStatus } from '@folio/contracts'
import { LOCATION_STATUSES, LOCATION_STATUS_LABELS } from '@folio/contracts'

import { kindLabel, statusTone } from '../../../../../../lib/locations/view'
import { ABSENT } from '../../../../../../lib/workspace/format'
import { Field, Section } from '../_chrome/drawer-shell'
import { StatusTabs } from '../_chrome/status-tabs'
import type { StatusOption } from '../_chrome/status-tabs'

/**
 * The fields both drawers author - `Route - Locations v2.dc.html`'s edit
 * drawer, top to bottom: Location name; Int / Ext beside Type (`96px
 * minmax(0,1fr)`); Address (`Actual or fictional address…`); Description
 * (88px min); then the Scouting status segmented control (`Pending ·
 * Scouted · Locked`). The photo tile above and the sluglines and cast below
 * are the edit drawer's alone.
 *
 * Int / Ext and Type are read, not typed: a set is `INT.` in one heading
 * and `EXT.` in the next (`@folio/contracts`, `locations.ts`), and the kind
 * is the tree's and the count's (`lib/locations/view.ts`). The mockup draws
 * both as fields; here they are fields that print. `Part of` is the one
 * field the mockup does not draw: the tree edge (AGENTS.md, Entity
 * identity: "a location is a tree, not a list") has no other surface in
 * the v2 package, so it sits under Type - a primary set, or one of the
 * others. Flagged in `docs/build-decisions.md`.
 *
 * A draft until Save: nothing here writes.
 */
export type LocationDraft = {
  readonly name: string
  readonly address: string
  readonly description: string
  readonly status: LocationStatus
  /** The parent's id, or `''` for a primary set. */
  readonly parentId: string
}

export const STATUS_OPTIONS: readonly StatusOption<LocationStatus>[] = LOCATION_STATUSES.map((status) => ({
  id: status,
  label: LOCATION_STATUS_LABELS[status],
  tone: statusTone(status),
}))

export const LocationFields = ({
  draft,
  onChange,
  busy,
  row,
  parents,
}: {
  readonly draft: LocationDraft
  readonly onChange: (next: LocationDraft) => void
  readonly busy: boolean
  /** The record, for the two read fields; `null` in the New drawer. */
  readonly row: LocationRow | null
  /** The records this one may hang under: every other root, and no descendant of its own. */
  readonly parents: readonly { readonly id: string; readonly name: string }[]
}) => {
  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  return (
    <>
      <div className="flex flex-col gap-[11px]">
        <Field label="Location name">
          <input
            type="text"
            value={draft.name}
            disabled={busy}
            data-field="name"
            placeholder="Kamathi Chawl"
            onChange={(event) => {
              set('name', event.target.value)
            }}
            className="folio-drawer-field"
          />
        </Field>
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: '96px minmax(0, 1fr)' }}>
          <Field label="Int / Ext">
            <span className="folio-drawer-field font-mono text-12" data-field="ie" aria-readonly="true">
              {row?.ie ?? ABSENT}
            </span>
          </Field>
          <Field label="Type">
            <span className="folio-drawer-field truncate" data-field="kind" aria-readonly="true">
              {row === null ? 'Not on the page yet' : kindLabel(row)}
            </span>
          </Field>
        </div>
        <Field label="Part of">
          <select
            value={draft.parentId}
            disabled={busy}
            data-field="parent"
            onChange={(event) => {
              set('parentId', event.target.value)
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
        <Field label="Description">
          <textarea
            value={draft.description}
            disabled={busy}
            data-field="description"
            data-kind="prose"
            rows={4}
            placeholder="No description yet"
            onChange={(event) => {
              set('description', event.target.value)
            }}
            className="folio-drawer-field text-ink2"
            style={{ textWrap: 'pretty' }}
          />
        </Field>
      </div>

      <Section gap={8}>
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
      </Section>
    </>
  )
}
