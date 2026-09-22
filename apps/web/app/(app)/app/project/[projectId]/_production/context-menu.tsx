'use client'

import { PRIORITY_LABELS } from '@folio/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { shotStatusOf } from '../../../../../../lib/production/derive'
import { MENU_MODE, STATUS_TONE, acceptsFreeText, filterItems, menuItems, showsSearch, usedValues } from '../../../../../../lib/production/menus'
import type { MenuItem } from '../../../../../../lib/production/menus'
import { useFocusTrap } from '../_chrome/use-focus-trap'
import { Calendar } from './calendar'
import type { MenuTarget } from './production-context'
import { useProduction } from './production-context'

/**
 * §5.3, the context menu: cursor-positioned, clamped to the viewport, min
 * 200px, max 320px; closes on outside click or Escape; a search field when
 * the list has more than six items. Three modes - single-select (radio,
 * `✓` on the current, a dot on a status), multi-select (the Character
 * menu's checkboxes, `No character` clears), special (`date` a calendar,
 * `notes` a textarea). Arrow keys move through the items; Tab stays inside.
 */
const MENU_WIDTH = 215

const currentValue = (field: string, target: MenuTarget, scenes: ReturnType<typeof useProduction>['scenes']): string | null => {
  if (target.kind === 'bulk') return null
  if (target.kind === 'scene') {
    const scene = scenes.find((candidate) => candidate.sceneNodeId === target.id)
    if (scene === undefined) return null
    switch (field) {
      case 'lens':
        return scene.setup.lens
      case 'prop':
        return scene.setup.prop
      case 'loc':
        return scene.setup.locationId
      case 'intext':
        return scene.setup.intExt
      case 'date':
        return scene.setup.shootDate
      case 'priority':
        return scene.setup.priority
      case 'notes':
        return scene.setup.note
      default:
        return null
    }
  }
  for (const scene of scenes) {
    for (const reel of scene.reels) {
      const shot = reel.shots.find((candidate) => candidate.id === target.id)
      if (shot === undefined) continue
      switch (field) {
        case 'status':
          return shotStatusOf(shot)
        case 'type':
          return shot.shotType
        case 'motion':
          return shot.cameraMotion
        case 'duration':
          return shot.durationS === null ? null : String(shot.durationS)
        case 'prop':
          return shot.prop
        case 'lens':
          return shot.lens.length === 0 ? null : shot.lens
        case 'date':
          return shot.shootDate
        case 'loc':
          return shot.locationId
        case 'intext':
          return shot.intExt
        case 'notes':
          return shot.notes
        case 'assignee':
          return shot.assigneeId
        case 'priority':
          return shot.priority === 'none' ? null : shot.priority
        default:
          return null
      }
    }
  }
  return null
}

export const ContextMenu = () => {
  const { menu, scenes, members, locations, act } = useProduction()
  const root = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const field = menu?.field ?? 'status'
  const target = menu?.target ?? { kind: 'bulk' as const }
  const mode = MENU_MODE[field]
  const cast = useMemo(() => {
    const scene = target.kind === 'scene' ? scenes.find((candidate) => candidate.sceneNodeId === target.id) : scenes.find((candidate) => candidate.reels.some((reel) => reel.shots.some((shot) => shot.id === (target.kind === 'shot' ? target.id : ''))))
    return scene?.cast ?? scenes.flatMap((candidate) => candidate.cast)
  }, [scenes, target])
  const used = useMemo(() => usedValues(scenes), [scenes])
  const items = useMemo(() => menuItems(field, { cast, locations, members, ...used }), [cast, field, locations, members, used])
  const current = menu === null ? null : currentValue(field, target, scenes)
  const [note, setNote] = useState(current ?? '')
  const picked = useMemo(() => {
    if (field !== 'cast' || target.kind !== 'shot') return new Set<string>()
    for (const scene of scenes) for (const reel of scene.reels) for (const shot of reel.shots) if (shot.id === target.id) return new Set(shot.characters.map((entry) => entry.characterId as string))
    return new Set<string>()
  }, [field, scenes, target])
  const search = showsSearch(items)
  const shownItems = filterItems(items, query)
  const free = acceptsFreeText(field) && query.trim().length > 0 && !items.some((item) => item.label.toLowerCase() === query.trim().toLowerCase())

  // Clamped to the viewport from the click's point (§5.3). Only ever rendered after a click, so `window` is there.
  const place = useMemo(() => {
    if (menu === null) return null
    const height = Math.min(320, (mode === 'date' ? 8 : mode === 'notes' ? 5 : items.length) * 32 + 40)
    return { x: Math.min(menu.x, window.innerWidth - MENU_WIDTH), y: Math.max(12, Math.min(menu.y + 8, window.innerHeight - 24 - height)) }
  }, [items.length, menu, mode])

  useFocusTrap(root, menu !== null)

  useEffect(() => {
    if (menu === null) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) act.closeMenu()
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
    }
  }, [act, menu])

  if (menu === null || place === null) return null

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])]
    if (buttons.length === 0) return
    const at = buttons.findIndex((button) => button === document.activeElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
    event.preventDefault()
  }

  const pick = (item: MenuItem): void => {
    if (mode === 'multi') {
      act.toggleCharacter(target, item.value ?? '')
      return
    }
    act.pickValue(field, target, item.value)
  }

  return createPortal(
    <div data-production-root>
      <div
        ref={root}
        role={mode === 'date' || mode === 'notes' ? 'dialog' : 'menu'}
        aria-label={`${field} menu`}
        data-context-menu={field}
        onKeyDown={onKey}
        className="folio-prod-ctx"
        style={{ left: `${String(place.x)}px`, top: `${String(place.y)}px` }}
      >
        {search && mode !== 'date' && mode !== 'notes' ? (
          <label className="folio-prod-search folio-prod-search-sm">
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="8.2" cy="8.2" r="4.8" />
              <path d="M11.8 11.8l3 3" />
            </svg>
            <input
              type="search"
              value={query}
              placeholder="Search..."
              aria-label="Search options"
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && free) {
                  event.preventDefault()
                  act.pickValue(field, target, query.trim())
                }
              }}
            />
          </label>
        ) : null}
        {mode === 'date' ? (
          <Calendar
            value={current}
            onPick={(date) => {
              act.pickValue('date', target, date)
            }}
          />
        ) : null}
        {mode === 'notes' ? (
          <div className="flex w-[236px] flex-col gap-[8px] p-[2px]">
            <textarea
              value={note}
              placeholder="Type a note…"
              aria-label="Note"
              autoFocus
              onChange={(event) => {
                setNote(event.target.value)
              }}
              className="folio-prod-textarea"
            />
            <div className="flex items-center gap-[6px]">
              <button
                type="button"
                data-note-save
                onClick={() => {
                  act.pickValue('notes', target, note.trim().length === 0 ? null : note.trim())
                }}
                className="folio-prod-solid-small flex-1"
              >
                Save note
              </button>
              {current !== null && current.length > 0 ? (
                <button
                  type="button"
                  data-note-remove
                  onClick={() => {
                    act.pickValue('notes', target, null)
                  }}
                  className="folio-prod-line-small h-[30px]"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {mode === 'single' || mode === 'multi'
          ? shownItems.map((item) => {
              const on = mode === 'multi' ? (item.value === null ? picked.size === 0 : picked.has(item.value)) : item.value === current
              return (
                <button
                  key={item.value ?? '∅'}
                  type="button"
                  role={mode === 'multi' ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={on}
                  data-menu-item={item.value ?? ''}
                  onClick={() => {
                    pick(item)
                  }}
                  className="folio-prod-menu-item"
                  data-on={on ? 'true' : undefined}
                >
                  {mode === 'multi' ? <span className="folio-prod-box" data-on={on ? 'true' : undefined} aria-hidden="true">✓</span> : null}
                  {item.tone !== undefined ? <span className="folio-prod-dot" data-tone={STATUS_TONE[item.tone]} aria-hidden="true" /> : null}
                  <span className="min-w-0 flex-1 whitespace-nowrap">{field === 'priority' && item.value !== null ? PRIORITY_LABELS[item.value as keyof typeof PRIORITY_LABELS] : item.label}</span>
                  {mode === 'single' ? (
                    <span className="flex-none text-11" data-check={on ? 'true' : 'false'} aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              )
            })
          : null}
        {free ? (
          <button
            type="button"
            role="menuitem"
            data-menu-item="__free"
            onClick={() => {
              act.pickValue(field, target, query.trim())
            }}
            className="folio-prod-menu-item"
          >
            Use “{query.trim()}”
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
