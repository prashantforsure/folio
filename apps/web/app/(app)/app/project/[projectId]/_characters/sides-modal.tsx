'use client'

import type { ProjectId, SceneRef } from '@folio/contracts'
import { Icon } from '@folio/ui'
import type { ScreenplayNode } from '@folio/script'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { readSides } from '../../../../../../lib/characters/actions'
import { citeOf } from '../../../../../../lib/characters/figures'
import type { SidesResult } from '../../../../../../lib/characters/result'
import type { LabelFor } from '../../../../../../lib/script/inline'
import { count } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { StaticSheet } from '../_script/sheet/static-sheet'

/**
 * The sides modal - `All 412 lines →` in the drawer's `Voice`: one part's
 * every speech, grouped under the headings they fall in, on the Script
 * route's own static sheet (`_script/sheet/static-sheet.tsx`, the blocks
 * exactly as the editor draws them, read-only). The Scenes reading modal's
 * shape (`_scenes/script-modal.tsx`): portalled to `body`, a scrim, a
 * round ✕, Escape closes; focus returns to the button that opened it.
 *
 * Read on open through `readSides` - a read-only server action over the
 * whole project (`sidesFor`) - so the drawer's load stays what it was;
 * `Reading the script…` until it lands.
 */
export const SidesModal = ({
  projectId,
  shape,
  characterId,
  name,
  lines,
  scenes,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly characterId: string
  readonly name: string
  readonly lines: number
  readonly scenes: number
  readonly onClose: () => void
}) => {
  const [mounted, setMounted] = useState(false)
  const [sides, setSides] = useState<SidesResult | null>(null)
  const headingId = useId()
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    setMounted(true)
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void readSides(projectId, characterId).then((result) => {
      if (!cancelled) setSides(result)
    })
    return () => {
      cancelled = true
    }
  }, [characterId, projectId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!mounted) return null

  const groups: { readonly heading: ScreenplayNode; readonly ref: SceneRef | undefined; readonly nodes: ScreenplayNode[] }[] = []
  const labelFor: LabelFor = (entity, id) => (sides?.status === 'sides' ? sides.labels.find((label) => label.entity === entity && label.id === id)?.label : undefined)
  if (sides?.status === 'sides') {
    for (const node of sides.nodes) {
      if (node.type === 'scene') {
        groups.push({ heading: node, ref: sides.headings.find((ref) => ref.sceneNodeId === node.id), nodes: [] })
        continue
      }
      const last = groups.at(-1)
      if (last === undefined) groups.push({ heading: node, ref: undefined, nodes: [node] })
      else last.nodes.push(node)
    }
  }

  return createPortal(
    <div
      className="folio-modal-scrim"
      data-sides-modal={characterId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-[760px]">
        <button type="button" className="folio-paper-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
        <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="flex max-h-[86vh] flex-col overflow-hidden rounded-panel border border-line bg-bg">
          <div className="flex flex-none flex-col gap-[3px] border-b border-line2 px-[24px] pb-[12px] pt-[16px]">
            <span id={headingId} className="text-15 font-medium tracking-title">
              {name} · sides
            </span>
            <span className="tabular font-mono text-10-5 text-ink3">
              {count(lines)} {lines === 1 ? 'line' : 'lines'} · {count(scenes)} {scenes === 1 ? 'scene' : 'scenes'}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[28px] pt-[14px]">
            {sides === null ? (
              <span className="text-12-5 text-ink3">Reading the script…</span>
            ) : sides.status !== 'sides' ? (
              <span className="text-12-5 text-live" role="alert">
                {sides.message}
              </span>
            ) : groups.length === 0 ? (
              <span className="text-12-5 text-ink3" data-sides="none">
                Not on the page yet
              </span>
            ) : (
              <div className="flex flex-col gap-[18px]" data-sides={groups.length}>
                {groups.map((group) => (
                  <section key={group.heading.id} data-sides-scene={group.heading.id} className="flex flex-col gap-[6px]">
                    <div className="sticky top-0 z-[1] flex items-center gap-[8px] bg-bg py-[4px]">
                      {group.ref === undefined ? null : <CitationChips refs={[citeOf(projectId, shape, group.ref)]} />}
                      <span className="folio-eyebrow min-w-0 truncate">
                        {group.ref?.heading ?? group.heading.content.map((run) => (run.kind === 'text' ? run.text : '')).join('')}
                      </span>
                    </div>
                    <StaticSheet nodes={group.nodes} record={null} paged={false} labelFor={labelFor} />
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
