'use client'

import type { BeatRow, BeatScene } from '@folio/contracts'
import { readBeatHeadline } from '@folio/script'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

/**
 * The Beats sheet: the prose sheet with one numbered beat after another,
 * `Route - Beats.dc.html`'s document view. Each beat is its number in a
 * ring, its name in Newsreader 21px over its one-line in Courier 16px, a
 * placement label (`6'–16' · 10m`, or `unplaced · 6m`), the chips of the
 * scenes that deliver it, and - while it is off the timeline - the amber
 * `Not on the timeline yet`.
 *
 * ## What is editable here, and how it writes
 *
 * The name and the line are fields drawn as the sheet's type; a change is
 * written on blur (`onHeadline`) as one block of outline text, `Name: line`.
 * The minutes in the placement label are a field too (`onDuration`). Scene
 * links are chips with an `×` and a `＋ Scene` picker over the episode's
 * present scenes (`onLink` / `onUnlink`). `⌥↑` / `⌥↓` on any field moves
 * the beat (`onMove`) - the bundle's own hint - and `Delete beat` retires
 * the block.
 *
 * The caret line at the foot is a field: type a name and press Enter to add
 * a beat. The bundle's ghost also offers "/ for a template"; templates are
 * not built and the promise is not drawn - flagged.
 *
 * Nothing here computes a number: the ordinal, the page, the scene number
 * all arrive on the row.
 */

export type BeatSheetProps = {
  readonly beats: readonly BeatRow[]
  readonly scenes: readonly BeatScene[]
  readonly selected: string | null
  readonly title: string
  readonly date: string
  readonly onSelect: (beatNodeId: string) => void
  readonly onHeadline: (beatNodeId: string, name: string, line: string) => void
  readonly onDuration: (beatNodeId: string, minutes: number | null) => void
  readonly onMove: (beatNodeId: string, direction: 'up' | 'down') => void
  readonly onDelete: (beatNodeId: string) => void
  readonly onLink: (beatNodeId: string, sceneNodeId: string) => void
  readonly onUnlink: (beatNodeId: string, sceneNodeId: string) => void
  readonly onAdd: (name: string, line: string) => void
}

export const placementLabel = (beat: BeatRow): string => {
  const minutes = beat.timing.durationMinutes
  const duration = minutes === null ? '—' : `${String(minutes)}m`
  const at = beat.timing.placedAtMinute
  if (at === null) return `unplaced · ${duration}`
  return `${String(at)}'–${String(at + (minutes ?? 0))}' · ${duration}`
}

const BeatEntry = ({
  beat,
  scenes,
  selected,
  onSelect,
  onHeadline,
  onDuration,
  onMove,
  onDelete,
  onLink,
  onUnlink,
}: Omit<BeatSheetProps, 'beats' | 'title' | 'date' | 'onAdd' | 'selected'> & { readonly beat: BeatRow; readonly selected: boolean }) => {
  const headline = readBeatHeadline(beat.text)
  const [name, setName] = useState(headline.name)
  const [line, setLine] = useState(headline.line)
  const [minutes, setMinutes] = useState(beat.timing.durationMinutes === null ? '' : String(beat.timing.durationMinutes))
  const [picking, setPicking] = useState(false)
  const lineRef = useRef<HTMLTextAreaElement | null>(null)

  // The row is the truth: a save that came back, a reorder, a reload of the
  // list all arrive as a new row, and the fields follow it.
  useEffect(() => {
    setName(headline.name)
    setLine(headline.line)
  }, [headline.name, headline.line])
  useEffect(() => {
    setMinutes(beat.timing.durationMinutes === null ? '' : String(beat.timing.durationMinutes))
  }, [beat.timing.durationMinutes])

  useEffect(() => {
    const area = lineRef.current
    if (area === null) return
    area.style.height = '0px'
    area.style.height = `${String(area.scrollHeight)}px`
  }, [line])

  const commitHeadline = (): void => {
    if (name === headline.name && line === headline.line) return
    onHeadline(beat.beatNodeId, name, line)
  }
  const commitMinutes = (): void => {
    const trimmed = minutes.trim()
    const next = trimmed === '' ? null : Number.parseInt(trimmed, 10)
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setMinutes(beat.timing.durationMinutes === null ? '' : String(beat.timing.durationMinutes))
      return
    }
    if (next === beat.timing.durationMinutes) return
    onDuration(beat.beatNodeId, next)
  }
  const onFieldKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onMove(beat.beatNodeId, event.key === 'ArrowUp' ? 'up' : 'down')
    }
  }

  const unplaced = beat.timing.placedAtMinute === null
  const linked = new Set(beat.scenes.map((scene) => scene.sceneNodeId as string))
  const choices = scenes.filter((scene) => !linked.has(scene.sceneNodeId as string))

  return (
    <div
      data-beat={beat.beatNodeId}
      data-beat-ordinal={beat.ordinal}
      data-selected={selected ? 'true' : 'false'}
      className="relative px-[96px] pb-[26px]"
      onFocusCapture={() => {
        onSelect(beat.beatNodeId)
      }}
    >
      <span className="folio-prose-dot" data-caret={selected ? 'true' : 'false'} style={{ left: 74, top: 8 }} />
      <div className="flex items-start gap-[14px]">
        <span className="folio-beat-number">{beat.ordinal}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <div className="flex flex-wrap items-baseline gap-[10px]">
            <input
              data-beat-name
              aria-label={`Beat ${String(beat.ordinal)} name`}
              className="folio-beat-field font-serif text-21 font-medium leading-[1.25]"
              style={{ width: `${String(Math.max(6, name.length + 1))}ch` }}
              value={name}
              placeholder="Untitled beat"
              onChange={(event) => {
                setName(event.target.value)
              }}
              onBlur={commitHeadline}
              onKeyDown={(event) => {
                onFieldKey(event)
                if (event.key === 'Enter') {
                  event.preventDefault()
                  lineRef.current?.focus()
                }
              }}
            />
            <span className="flex items-baseline gap-[4px] font-sans text-10 text-ink3" data-beat-placement>
              {unplaced ? 'unplaced' : `${String(beat.timing.placedAtMinute)}'–${String((beat.timing.placedAtMinute ?? 0) + (beat.timing.durationMinutes ?? 0))}'`}
              <span>·</span>
              <input
                data-beat-duration
                aria-label={`Beat ${String(beat.ordinal)} duration in minutes`}
                inputMode="numeric"
                className="folio-beat-field w-[3ch] text-right font-sans text-10 text-ink2"
                value={minutes}
                placeholder="—"
                onChange={(event) => {
                  setMinutes(event.target.value.replace(/[^0-9]/gu, ''))
                }}
                onBlur={commitMinutes}
                onKeyDown={(event) => {
                  onFieldKey(event)
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                }}
              />
              m
            </span>
          </div>
          <textarea
            ref={lineRef}
            data-beat-line
            aria-label={`Beat ${String(beat.ordinal)} line`}
            rows={1}
            className="folio-beat-field font-mono text-16 leading-[1.9] text-sheet-ink"
            value={line}
            placeholder="One line on what happens."
            onChange={(event) => {
              setLine(event.target.value)
            }}
            onBlur={commitHeadline}
            onKeyDown={onFieldKey}
          />
          <div className="flex flex-wrap items-center gap-[7px] font-sans">
            {beat.scenes.map((scene) => (
              <span key={scene.sceneNodeId} data-beat-scene={scene.sceneNodeId} className="flex items-center gap-[6px]">
                <span className="folio-beat-chip">Scene {scene.number}</span>
                <span className="folio-beat-chip">{scene.page === null ? 'pg —' : `pg ${String(scene.page)}`}</span>
                <button
                  type="button"
                  data-unlink-scene
                  title={`Take ${scene.heading} off this beat`}
                  aria-label={`Unlink scene ${String(scene.number)}`}
                  className="folio-focus grid h-[18px] w-[18px] place-items-center rounded-chrome text-10 text-ink3 hover:bg-hover hover:text-ink"
                  onClick={() => {
                    onUnlink(beat.beatNodeId, scene.sceneNodeId)
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <span className="relative">
              <button
                type="button"
                data-link-scene
                className="folio-small-button !py-[2px] !text-10"
                disabled={scenes.length === 0}
                title={scenes.length === 0 ? 'No scenes yet - scenes come from the script’s headings.' : 'Name a scene that delivers this beat'}
                onClick={() => {
                  setPicking((open) => !open)
                }}
              >
                ＋ Scene
              </button>
              {picking ? (
                <div
                  data-scene-picker
                  role="listbox"
                  aria-label="Scenes that deliver this beat"
                  className="absolute left-0 top-[24px] z-30 flex max-h-[240px] min-w-[280px] flex-col gap-[1px] overflow-y-auto rounded-chrome border border-line bg-panel p-[3px] font-sans text-11 text-ink"
                >
                  {choices.length === 0 ? (
                    <span className="px-[8px] py-[5px] text-10-5 text-ink3">Every scene already delivers this beat.</span>
                  ) : null}
                  {choices.map((scene) => (
                    <button
                      key={scene.sceneNodeId}
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-scene-option={scene.sceneNodeId}
                      className="flex items-baseline gap-[8px] rounded-chrome px-[8px] py-[5px] text-left hover:bg-hover"
                      onClick={() => {
                        setPicking(false)
                        onLink(beat.beatNodeId, scene.sceneNodeId)
                      }}
                    >
                      <span className="tabular w-[18px] text-9-5 text-ink3">{scene.number}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-11 uppercase">{scene.heading}</span>
                      <span className="text-9-5 text-ink3">{scene.page === null ? '—' : `pg ${String(scene.page)}`}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              data-delete-beat
              className="folio-small-button !py-[2px] !text-10"
              title="Delete this beat. Its block leaves the outline; its timing is kept for undo."
              onClick={() => {
                onDelete(beat.beatNodeId)
              }}
            >
              Delete beat
            </button>
          </div>
          {unplaced ? (
            <span className="folio-beat-unplaced" data-beat-unplaced>
              Not on the timeline yet
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export const BeatSheet = ({
  beats,
  scenes,
  selected,
  title,
  date,
  onSelect,
  onHeadline,
  onDuration,
  onMove,
  onDelete,
  onLink,
  onUnlink,
  onAdd,
}: BeatSheetProps) => {
  const [draft, setDraft] = useState('')
  return (
    <div className="folio-prose-sheet" data-sheet style={{ paddingTop: 52 }}>
      <div className="relative flex flex-col gap-[6px] px-[96px]">
        <span className="folio-prose-dot" style={{ left: 74, top: 9 }} />
        <span className="font-serif text-34 leading-[1.1] tracking-[-.015em]">{title}</span>
        <span className="text-14 text-ink3">{date}</span>
      </div>
      <div className="h-[34px]" />

      {beats.map((beat) => (
        <BeatEntry
          key={beat.beatNodeId}
          beat={beat}
          scenes={scenes}
          selected={selected === beat.beatNodeId}
          onSelect={onSelect}
          onHeadline={onHeadline}
          onDuration={onDuration}
          onMove={onMove}
          onDelete={onDelete}
          onLink={onLink}
          onUnlink={onUnlink}
        />
      ))}

      <div className="relative px-[96px]">
        <span className="folio-prose-dot" data-caret="true" style={{ left: 74, top: 8 }} />
        <input
          data-add-beat-line
          aria-label="Add a beat"
          className="folio-beat-field font-mono text-16 leading-[1.9]"
          placeholder="Type to add a beat"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const headline = readBeatHeadline(draft)
            if (headline.name === '' && headline.line === '') return
            onAdd(headline.name, headline.line)
            setDraft('')
          }}
        />
      </div>
    </div>
  )
}
