import type { Assignee, FieldId, ProductionCastMember, ProductionScene, ShotStatus } from '@folio/contracts'
import {
  CAMERA_MOTIONS,
  DURATION_PRESETS,
  INT_EXT,
  PRIORITIES,
  PRIORITY_LABELS,
  SHOT_STATUSES,
  SHOT_STATUS_LABELS,
  SHOT_TYPES,
} from '@folio/contracts'

/**
 * §5.3, the context menu's items per field. Three modes: single-select
 * (radio), multi-select (character), special (`date` is a calendar,
 * `notes` a textarea). Pure over the page's data.
 *
 * The lens presets are the mockup's (ARRI Alexa Mini LF primes); the prop
 * list is what the episode's shots already use, since props are not a
 * table (`schema/index.ts`, "deliberately absent"). Both take a new value
 * through the menu's search box (`Use "…"`) - the spec draws the search
 * and no other way in, so that is where a new prop is typed. Flagged.
 */

export type MenuField = Exclude<FieldId, 'title' | 'desc' | 'dialogue' | 'refs'>

export const MENU_MODE: Readonly<Record<MenuField, 'single' | 'multi' | 'date' | 'notes'>> = {
  status: 'single',
  type: 'single',
  motion: 'single',
  duration: 'single',
  cast: 'multi',
  prop: 'single',
  lens: 'single',
  date: 'date',
  loc: 'single',
  intext: 'single',
  notes: 'notes',
  assignee: 'single',
  priority: 'single',
}

export type MenuItem = {
  /** The stored value; `null` clears the field. */
  readonly value: string | null
  readonly label: string
  /** A status item's dot tone. */
  readonly tone?: ShotStatus
}

export const STATUS_TONE: Readonly<Record<ShotStatus, 'ink3' | 'warn' | 'accent' | 'ok' | 'bad'>> = {
  to_draw: 'ink3',
  proposed: 'warn',
  queued: 'ink3',
  generating: 'accent',
  drawn: 'ok',
  out_of_date: 'warn',
  refused: 'bad',
}

export const LENS_PRESETS = ['24mm T2.8', '35mm T2.0', '50mm T2.0', '85mm T1.8'] as const

export type MenuContext = {
  readonly cast: readonly ProductionCastMember[]
  readonly locations: readonly { readonly id: string; readonly name: string }[]
  readonly members: readonly Assignee[]
  /** Distinct values already on the episode's shots, for prop and lens. */
  readonly usedProps: readonly string[]
  readonly usedLenses: readonly string[]
}

const withUsed = (presets: readonly string[], used: readonly string[]): readonly string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of [...presets, ...used]) {
    const key = value.trim()
    if (key.length === 0 || seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    out.push(key)
  }
  return out
}

export const menuItems = (field: MenuField, context: MenuContext): readonly MenuItem[] => {
  switch (field) {
    case 'status':
      return SHOT_STATUSES.map((status) => ({ value: status, label: SHOT_STATUS_LABELS[status], tone: status }))
    case 'type':
      return SHOT_TYPES.map((value) => ({ value, label: value }))
    case 'motion':
      return CAMERA_MOTIONS.map((value) => ({ value, label: value }))
    case 'duration':
      return [{ value: null, label: 'No duration' }, ...DURATION_PRESETS.map((seconds) => ({ value: String(seconds), label: `${String(seconds)} s` }))]
    case 'cast':
      return [{ value: null, label: 'No character' }, ...context.cast.map((member) => ({ value: member.id, label: member.name }))]
    case 'prop':
      return [{ value: null, label: 'No prop' }, ...withUsed([], context.usedProps).map((value) => ({ value, label: value }))]
    case 'lens':
      return [{ value: null, label: 'No lens' }, ...withUsed(LENS_PRESETS, context.usedLenses).map((value) => ({ value, label: value }))]
    case 'loc':
      return [{ value: null, label: 'No location' }, ...context.locations.map((location) => ({ value: location.id, label: location.name }))]
    case 'intext':
      return [{ value: null, label: 'No INT/EXT' }, ...INT_EXT.map((value) => ({ value, label: value }))]
    case 'assignee':
      return [{ value: null, label: 'Unassigned' }, ...context.members.map((member) => ({ value: member.id, label: member.name }))]
    case 'priority':
      return PRIORITIES.map((value) => ({ value: value === 'none' ? null : value, label: PRIORITY_LABELS[value] }))
    case 'date':
    case 'notes':
      return []
  }
}

/** A field whose list may grow by typing: the search box's `Use "…"` item. */
export const acceptsFreeText = (field: MenuField): boolean => field === 'prop' || field === 'lens'

/** The menu shows a search field when the list has more than six items (§5.3). */
export const showsSearch = (items: readonly MenuItem[]): boolean => items.length > 6

export const filterItems = (items: readonly MenuItem[], query: string): readonly MenuItem[] => {
  const q = query.trim().toLowerCase()
  return q.length === 0 ? items : items.filter((item) => item.label.toLowerCase().includes(q))
}

/** Distinct prop / lens values across an episode, for the menus. */
export const usedValues = (scenes: readonly ProductionScene[]): { readonly usedProps: readonly string[]; readonly usedLenses: readonly string[] } => {
  const props = new Set<string>()
  const lenses = new Set<string>()
  for (const scene of scenes) {
    for (const reel of scene.reels) {
      for (const shot of reel.shots) {
        if (shot.prop !== null && shot.prop.trim().length > 0) props.add(shot.prop.trim())
        if (shot.lens.trim().length > 0) lenses.add(shot.lens.trim())
      }
    }
  }
  return { usedProps: [...props].sort(), usedLenses: [...lenses].sort() }
}
