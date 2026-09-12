'use client'

import type { ProjectId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { useEffect, useMemo, useState } from 'react'

import { listDialogue } from '../../../../../../lib/characters/actions'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { DialogueLine } from '../../../../../../lib/characters/result'

/**
 * Picking a key line from the character's own dialogue.
 *
 * "Key lines with refs" are lines from the draft, so the picker offers only
 * lines the record actually speaks - `listDialogue` walks the script under
 * every spelling bound to it - each with its scene. A filter narrows a long
 * list; a click adds the line. The list is fetched when the picker opens,
 * not on render: it is the one read on the route that walks every node.
 */
export const KeyLinePicker = ({
  projectId,
  characterId,
  taken,
  onPick,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly characterId: string
  readonly taken: ReadonlySet<NodeId>
  readonly onPick: (nodeId: NodeId) => void
  readonly onClose: () => void
}) => {
  const [lines, setLines] = useState<readonly DialogueLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void listDialogue(projectId, characterId).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') setLines(result.lines)
      else setError(result.message)
    })
    return () => {
      cancelled = true
    }
  }, [characterId, projectId])

  const shown = useMemo(() => {
    if (lines === null) return []
    const needle = query.trim().toLowerCase()
    return lines.filter((line) => !taken.has(line.nodeId) && (needle === '' || line.text.toLowerCase().includes(needle)))
  }, [lines, query, taken])

  return (
    <div
      data-key-line-picker
      className="flex flex-col gap-[6px] rounded-chrome border border-line bg-panel p-[8px]"
    >
      <div className="flex items-center gap-[6px]">
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Find a line they say"
          aria-label="Find a line they say"
          className="min-w-0 flex-1 rounded-chrome border border-line2 bg-sheet px-[8px] py-[4px] text-11-5 text-ink outline-none placeholder:text-ink3"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-chrome border border-line2 bg-transparent px-[8px] py-[4px] text-11 text-ink2 hover:bg-hover"
        >
          Close
        </button>
      </div>
      <div className="flex max-h-[240px] flex-col gap-[3px] overflow-y-auto">
        {error !== null ? (
          <span className="px-[4px] py-[6px] text-11 text-del">{error}</span>
        ) : lines === null ? (
          <span className="px-[4px] py-[6px] text-11 text-ink3">Reading the script…</span>
        ) : shown.length === 0 ? (
          <span className="px-[4px] py-[6px] text-11 text-ink3">
            {lines.length === 0 ? 'No dialogue under this character’s cues yet.' : 'No line matches.'}
          </span>
        ) : (
          shown.map((line) => (
            <button
              key={line.nodeId}
              type="button"
              onClick={() => {
                onPick(line.nodeId)
              }}
              data-dialogue-line
              className="flex flex-col items-start gap-[2px] rounded-chrome border border-line2 bg-sheet px-[9px] py-[6px] text-left hover:border-accent-line"
            >
              <span className="font-mono text-11 leading-[1.4] text-ink">{line.text}</span>
              <span className="text-9-5 text-ink3">{line.scene === null ? 'outside any scene' : formatSceneRef(line.scene)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
