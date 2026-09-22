import type { FieldId, ViewPreferences } from '@folio/contracts'
import { FIELD_IDS } from '@folio/contracts'

/**
 * §2.4, the 17 metadata fields: which are visible, in what order, and the
 * Columns view's `grid-template-columns` that follows them (§4). Pure.
 */

export const isShown = (prefs: Pick<ViewPreferences, 'fieldVisibility'>, id: FieldId): boolean => prefs.fieldVisibility[id] !== false

/** `Hide all` while any field is shown, `Show all` once none is. */
export const hideAllLabel = (prefs: Pick<ViewPreferences, 'fieldVisibility'>): 'Hide all' | 'Show all' =>
  FIELD_IDS.some((id) => isShown(prefs, id)) ? 'Hide all' : 'Show all'

/** The visibility after `Hide all` / `Show all`. */
export const toggleAll = (prefs: Pick<ViewPreferences, 'fieldVisibility'>): Record<FieldId, boolean> => {
  const anyOn = FIELD_IDS.some((id) => isShown(prefs, id))
  return Object.fromEntries(FIELD_IDS.map((id) => [id, !anyOn])) as Record<FieldId, boolean>
}

/** The order after moving `id` to sit before `beforeId` (or last). */
export const reorderFields = (order: readonly FieldId[], id: FieldId, beforeId: FieldId | null): readonly FieldId[] => {
  if (id === beforeId) return order
  const without = order.filter((field) => field !== id)
  const at = beforeId === null ? without.length : without.indexOf(beforeId)
  const index = at < 0 ? without.length : at
  return [...without.slice(0, index), id, ...without.slice(index)]
}

/** The Columns view's fixed widths, in the spec's order; a hidden field drops its column. */
export const TABLE_COLUMNS: readonly { readonly id: FieldId | '#' | 'preview'; readonly width: string; readonly label: string }[] = [
  { id: '#', width: '56px', label: '#' },
  { id: 'preview', width: '200px', label: 'Preview' },
  { id: 'title', width: '130px', label: 'Title' },
  { id: 'status', width: '140px', label: 'Status' },
  { id: 'desc', width: 'minmax(220px,1.3fr)', label: 'Description' },
  { id: 'type', width: '130px', label: 'Shot type' },
  { id: 'duration', width: '100px', label: 'Duration' },
  { id: 'cast', width: '150px', label: 'Character' },
  /** `prop` has been in `FIELD_IDS` since the v12 build; it gets a column now that it names a record (`0030`). */
  { id: 'prop', width: '140px', label: 'Prop' },
  { id: 'assignee', width: '140px', label: 'Assignee' },
]

export const tableColumns = (prefs: Pick<ViewPreferences, 'fieldVisibility'>): readonly (typeof TABLE_COLUMNS)[number][] =>
  TABLE_COLUMNS.filter((column) => column.id === '#' || column.id === 'preview' || isShown(prefs, column.id))

export const tableTemplate = (prefs: Pick<ViewPreferences, 'fieldVisibility'>): string =>
  tableColumns(prefs)
    .map((column) => column.width)
    .join(' ')

/** The fields with a search box match: label contains the query, case-insensitively. */
export const fieldMatches = (label: string, query: string): boolean =>
  query.trim().length === 0 || label.toLowerCase().includes(query.trim().toLowerCase())
