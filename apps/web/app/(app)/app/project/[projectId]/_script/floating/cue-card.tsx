'use client'

import type { ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { characterHref, projectRouteHref } from '../../../../../../../lib/workspace/hrefs'

/**
 * The cue hover card - the Characters rebuild's one touch on the Script
 * chrome (phase 3, read-only): rest on a cue for 400ms and a small card
 * says who it is - `Meera Pawar · 79 sc` with `Open` (the drawer), or
 * `No record yet` with `Resolve on Characters →` (the queue). It reads the
 * decoration the sheet already draws on the block (`data-character-id`,
 * `data-cue-name`, `data-cue-scenes`, `data-cue-unresolved`;
 * `editor/extensions/sheet-decorations.ts`) - no read, no state beyond
 * which block is under the pointer.
 *
 * One delegated `mouseover` on the editor's root rather than a listener per
 * block: blocks come and go with every keystroke. Positioned from the
 * block's rect below its left edge, inside the viewport; a scroll or a
 * `mouseleave` closes it.
 */
const HOVER_MS = 400

type Target = {
  readonly id: string | null
  readonly name: string | null
  readonly scenes: number
  readonly left: number
  readonly top: number
}

export const CueCard = ({ root, projectId }: { readonly root: HTMLElement | null; readonly projectId: ProjectId }) => {
  const [target, setTarget] = useState<Target | null>(null)

  useEffect(() => {
    if (root === null) return
    let timer: number | null = null
    let over: HTMLElement | null = null
    const clear = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
    const onOver = (event: MouseEvent): void => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-character-id], [data-cue-unresolved]') : null
      if (element === over) return
      over = element
      clear()
      if (element === null) {
        setTarget(null)
        return
      }
      timer = window.setTimeout(() => {
        const rect = element.getBoundingClientRect()
        const id = element.dataset['characterId'] ?? null
        setTarget({
          id,
          name: element.dataset['cueName'] ?? null,
          scenes: Number(element.dataset['cueScenes'] ?? '0'),
          left: Math.min(rect.left, window.innerWidth - 240),
          top: Math.min(rect.bottom + 4, window.innerHeight - 56),
        })
      }, HOVER_MS)
    }
    const onLeave = (): void => {
      over = null
      clear()
      setTarget(null)
    }
    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseleave', onLeave)
    window.addEventListener('scroll', onLeave, true)
    return () => {
      clear()
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('scroll', onLeave, true)
    }
  }, [root])

  if (target === null) return null
  return (
    <div
      data-cue-card={target.id ?? 'unresolved'}
      role="tooltip"
      className="folio-menu fixed z-[9] flex items-center gap-[10px] px-[10px] py-[7px] text-12"
      style={{ left: target.left, top: target.top }}
    >
      {target.id === null ? (
        <>
          <span className="text-ink2">No record yet</span>
          <Link href={projectRouteHref(projectId, 'characters')} className="text-accent no-underline hover:underline">
            Resolve on Characters →
          </Link>
        </>
      ) : (
        <>
          <span className="text-ink">{target.name}</span>
          <span className="tabular font-mono text-10-5 text-ink3">{target.scenes} sc</span>
          <Link href={characterHref(projectId, target.id)} className="text-accent no-underline hover:underline">
            Open
          </Link>
        </>
      )}
    </div>
  )
}
