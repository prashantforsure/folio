'use client'

import { useRef, useState } from 'react'

import { sceneFacts } from '../../../../../../lib/production/derive'
import { filterActive } from '../../../../../../lib/production/filters'
import { useDismiss } from '../_chrome/use-dismiss'
import { FilterSort } from './filter-sort'
import { useProduction } from './production-context'
import { ViewOptions } from './view-options'

/**
 * §2.3, the scene tabs row: one chip per scene - `{n}. {heading}`, its
 * facts as the title, the active one on `--s2` with the two trailing
 * glyphs - and, right of them, the view-options and filter & sort buttons
 * with their popovers (§2.4, §2.5). The row scrolls horizontally.
 */
export const SceneTabs = () => {
  const { scenes, selection, prefs, act } = useProduction()
  const [open, setOpen] = useState<'options' | 'filter' | null>(null)
  const root = useRef<HTMLSpanElement>(null)
  useDismiss(open !== null, () => {
    setOpen(null)
  }, root)
  const active = filterActive(prefs)

  return (
    <div className="folio-prod-tabs" data-production-tabs>
      <span className="folio-prod-tabs-row" role="tablist" aria-label="Scenes">
        {scenes.map((scene) => {
          const on = selection?.sceneNodeId === scene.sceneNodeId
          return (
            <button
              key={scene.sceneNodeId}
              type="button"
              role="tab"
              aria-selected={on}
              aria-current={on ? 'true' : undefined}
              title={sceneFacts(scene)}
              data-scene-tab={scene.number}
              onClick={() => {
                act.selectScene(scene.sceneNodeId)
              }}
              className="folio-prod-tab"
            >
              <span className="folio-prod-tab-num">{String(scene.number)}.</span>
              {scene.heading}
              {on ? (
                <span className="folio-prod-tab-glyphs" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4.5" y="2.8" width="11" height="14.4" rx="1.8" />
                    <path d="M7.4 7h5.2M7.4 10h5.2M7.4 13h3" />
                  </svg>
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
                    <path d="M6.4 3.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9zM13.4 8.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
                  </svg>
                </span>
              ) : null}
            </button>
          )
        })}
      </span>
      <span ref={root} className="relative flex items-center gap-[8px]">
        <button
          type="button"
          title="View options"
          aria-label="View options"
          aria-haspopup="dialog"
          aria-expanded={open === 'options'}
          data-view-options
          data-open={open === 'options' ? 'true' : undefined}
          onClick={() => {
            setOpen(open === 'options' ? null : 'options')
          }}
          className="folio-prod-tool"
        >
          <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M2.6 5.6h12.8M2.6 12.4h12.8" />
            <circle cx="6.6" cy="5.6" r="2" />
            <circle cx="11.4" cy="12.4" r="2" />
          </svg>
        </button>
        <button
          type="button"
          title="Filter and sort"
          aria-label="Filter and sort"
          aria-haspopup="dialog"
          aria-expanded={open === 'filter'}
          data-filter-sort
          data-open={open === 'filter' ? 'true' : undefined}
          data-active={active ? 'true' : undefined}
          onClick={() => {
            setOpen(open === 'filter' ? null : 'filter')
          }}
          className="folio-prod-tool"
        >
          <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.6 4h12.8l-5 5.6V15l-2.8-1.6V9.6z" />
          </svg>
        </button>
        {open === 'filter' ? <FilterSort /> : null}
        {open === 'options' ? (
          <ViewOptions
            onClose={() => {
              setOpen(null)
            }}
          />
        ) : null}
      </span>
    </div>
  )
}
