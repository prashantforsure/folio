'use client'

import type { ProjectId, StoryThreadId, StoryThreadRow, StoryTimeEdit, TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding } from '@folio/script'
import { formatStoryTime, isStoryClock } from '@folio/script'
import { TEXT_VARIATION_SELECTOR } from '@folio/ui'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { KIND_LABEL, relativeLine, sceneRef, threadColourVar } from '../../../../../../lib/timeline/view'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import type { ProjectRoutePath, ScenePath } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerNotice, SectionHead } from '../_chrome/drawer-parts'
import { DrawerShell, Field, Section } from '../_chrome/drawer-shell'
import { useDismiss } from '../_chrome/use-dismiss'

/** Which field the drawer opens on - the grid's `D` and `C` keys. */
export type DrawerField = 'day' | 'clock'

/**
 * `Place in time` - the drawer for the selected scene, on the shell's
 * frame (`_chrome/drawer-shell.tsx`, 400px, `--sunk`, beside the column
 * through the layout's `#timeline-drawer` slot).
 *
 * Head: the title, `E1 Sc 14 · p. 36`, `Ask` (the assistant, with the
 * scene as its Focus) and `Open in script` (the heading's `#n-<node id>`).
 * Body: the slugline and the gist; **Day** and **Clock**, the **Flashback**
 * toggle, `⇅ Same day as the previous scene` and `+1 day`; the relative
 * block - where the scene sits against the frame story's last placed
 * scene before it (`lib/timeline/view.ts`, `relativeLine`); **What the
 * page says** - the heading's time of day and the first action line that
 * names a time, as citation chips into the script, so the writer decides
 * with the page in view (`@folio/script`'s `time-cues.ts`, read at
 * request time); the **findings** about this scene, each with its kind,
 * its note and `It's deliberate`, and the ones already marked with
 * `Reopen`; **Threads** as chips in the writer's order with `▲ Make row`
 * and `×`, and a `＋` menu; **In this scene** - the cast as pills into
 * `/characters/:id` and the set into `/locations/:id`. Foot: `Open in
 * Script →`, the notice, `Cancel`, solid `Save`.
 *
 * ## The draft is the writer's until Save
 *
 * Day, clock and flashback are a draft, initialised once from the row -
 * the workspace keys this component on the scene id, so a new scene is a
 * new drawer and a refresh of the same scene is not. `⇅`, `+1 day` and
 * `Clear` edit the draft; only `Save` writes, whole (`StoryTimeEditSchema`),
 * through the workspace so the grid takes the patch at once. Threads are
 * not a draft: a link, an unlink or a reorder is one click and one write.
 *
 * `Clear` keeps the flashback flag: the contract allows a flashback with
 * no day ("flagged but unplaced").
 */
export const SceneDrawer = ({
  projectId,
  scene,
  previous,
  findings,
  deliberate,
  noteOf,
  threads,
  scriptHref,
  cueHref,
  charactersHref,
  field,
  busy,
  onSave,
  onThreads,
  onVerdict,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly scene: TimelineSceneRow
  /** The last placed frame-story scene before it on the page, if any. */
  readonly previous: TimelineSceneRow | null
  /** The open findings and notes about this scene. */
  readonly findings: readonly ContinuityFinding[]
  /** The findings about this scene the writer marked deliberate. */
  readonly deliberate: readonly ContinuityFinding[]
  readonly noteOf: (finding: ContinuityFinding) => string
  readonly threads: readonly StoryThreadRow[]
  readonly scriptHref: ScenePath
  /** The script at the action line the cue was read from, when there is one. */
  readonly cueHref: ScenePath | null
  readonly charactersHref: ProjectRoutePath
  readonly field: DrawerField | null
  readonly busy: boolean
  readonly onSave: (edit: StoryTimeEdit) => void
  readonly onThreads: (ids: readonly StoryThreadId[]) => void
  readonly onVerdict: (finding: ContinuityFinding, deliberate: boolean) => void
  readonly onClose: () => void
}) => {
  const ephemeral = useEphemeral()
  const session = useSession()
  const [day, setDay] = useState(scene.storyTime === null ? '' : String(scene.storyTime.day))
  const [clock, setClock] = useState(scene.storyTime?.clock ?? '')
  const [flashback, setFlashback] = useState(scene.flashback)
  const [notice, setNotice] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const dayInput = useRef<HTMLInputElement>(null)
  const clockInput = useRef<HTMLInputElement>(null)
  useDismiss(picking, () => setPicking(false), menu)

  const ref = sceneRef(scene)

  // The assistant's Focus while this scene is open: "why is it flagged" has an "it".
  const { setAssistantFocus } = ephemeral
  useEffect(() => {
    setAssistantFocus({ kind: 'scene', id: scene.sceneNodeId, name: ref })
    return () => {
      setAssistantFocus(null)
    }
  }, [ref, scene.sceneNodeId, setAssistantFocus])

  useEffect(() => {
    if (field === 'day') dayInput.current?.focus()
    if (field === 'clock') clockInput.current?.focus()
  }, [field])

  const parsedDay = day.trim() === '' ? null : Number(day)
  const dayValid = parsedDay === null || Number.isInteger(parsedDay)
  const clockTrimmed = clock.trim()
  const clockValid = clockTrimmed === '' || isStoryClock(clockTrimmed)
  const dirty =
    (scene.storyTime === null ? '' : String(scene.storyTime.day)) !== day.trim() || (scene.storyTime?.clock ?? '') !== clockTrimmed || scene.flashback !== flashback

  const save = (): void => {
    if (!dayValid) {
      setNotice('A day is a whole number.')
      return
    }
    if (!clockValid) {
      setNotice('A clock is HH:MM, 24-hour.')
      return
    }
    if (parsedDay === null && clockTrimmed !== '') {
      setNotice('A clock needs a day.')
      return
    }
    setNotice(null)
    onSave({ day: parsedDay, clock: clockTrimmed === '' ? null : clockTrimmed, flashback })
  }

  const chain = (): void => {
    if (previous?.storyTime === undefined || previous.storyTime === null) return
    setDay(String(previous.storyTime.day))
    setClock('')
    setNotice(null)
  }

  const plusOne = (): void => {
    const from = parsedDay ?? previous?.storyTime?.day ?? 0
    setDay(String(from + 1))
    setClock('')
    setNotice(null)
  }

  const clear = (): void => {
    setDay('')
    setClock('')
    setNotice(null)
  }

  const mine = scene.threads.flatMap((id) => {
    const thread = threads.find((entry) => entry.id === id)
    return thread === undefined ? [] : [thread]
  })
  const linkable = threads.filter((thread) => !scene.threads.includes(thread.id))

  const relative = scene.flashback
    ? { tone: 'warn' as const, glyph: '↺', text: relativeLine(scene, previous) }
    : { tone: 'none' as const, glyph: '◷', text: relativeLine(scene, previous) }

  const cues = scene.cues

  return (
    <DrawerShell
      route="timeline"
      title="Place in time"
      meta={
        <span className="tabular font-mono">
          {ref} · {scene.page === null ? 'unpaged' : `p. ${String(scene.page)}`}
        </span>
      }
      label={`Place ${ref} in time`}
      actions={
        <>
          <button
            type="button"
            data-drawer-ask
            title={`Ask the assistant about ${ref}`}
            onClick={() => {
              ephemeral.setAssistantPrompt(`About ${ref} (${scene.heading}): `)
              session.setAssistantOpen(true)
            }}
            className="folio-ghost-button h-[28px] rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2"
          >
            Ask
          </button>
          <Link
            href={scriptHref}
            data-drawer-open-script
            title="Open the script at this scene"
            className="folio-ghost-button flex h-[28px] items-center rounded-[8px] px-[8px] text-11-5 text-ink3 no-underline hover:!text-ink2 hover:no-underline"
          >
            Open in script
          </Link>
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Link href={scriptHref} data-drawer-script-link className="folio-line-button h-[34px] flex-none rounded-[9px] px-[12px] text-12 no-underline hover:no-underline">
            Open in Script →
          </Link>
          <DrawerNotice notice={notice} />
          <div className="flex-1" />
          <button type="button" data-drawer-cancel disabled={busy} onClick={onClose} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
            Cancel
          </button>
          <button
            type="button"
            data-save-story-time
            disabled={busy || !dirty}
            onClick={save}
            className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-[6px]">
        <span className="font-mono text-12-5 uppercase leading-[1.4] text-ink" data-drawer-heading>
          {scene.heading}
        </span>
        <span className={`text-13 leading-[1.55] ${scene.synopsis === null ? 'text-ink3' : 'text-ink2'}`} style={{ textWrap: 'pretty' }}>
          {scene.synopsis ?? 'No synopsis yet.'}
        </span>
      </div>

      <form
        data-story-time-form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="flex flex-col gap-[12px]"
      >
        <div className="grid gap-[10px]" style={{ gridTemplateColumns: 'minmax(0, 1fr) 104px' }}>
          <Field label="Day">
            <input
              ref={dayInput}
              type="number"
              step={1}
              inputMode="numeric"
              value={day}
              onChange={(event) => {
                setDay(event.target.value)
                setNotice(null)
              }}
              aria-label="Story day"
              placeholder="—"
              data-story-day
              className="folio-drawer-field tabular font-mono"
            />
          </Field>
          <Field label="Clock">
            <input
              ref={clockInput}
              type="text"
              value={clock}
              disabled={parsedDay === null}
              onChange={(event) => {
                setClock(event.target.value)
                setNotice(null)
              }}
              aria-label="Story clock"
              placeholder={parsedDay === null ? '—' : 'HH:MM'}
              maxLength={5}
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
              data-story-clock
              className="folio-drawer-field tabular font-mono disabled:opacity-50"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          <button
            type="button"
            role="switch"
            aria-checked={flashback}
            data-tone="warn"
            data-flashback-toggle
            onClick={() => {
              setFlashback((value) => !value)
              setNotice(null)
            }}
            className="folio-status-tab h-[28px] flex-none rounded-[8px] px-[10px] text-12"
          >
            Flashback
          </button>
          <button
            type="button"
            disabled={previous === null || previous.storyTime === null}
            onClick={chain}
            title={previous === null || previous.storyTime === null ? 'No placed scene before this one' : `Same day as ${sceneRef(previous)}`}
            data-chain-previous
            className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
          >
            <span aria-hidden="true" className="folio-mark text-11">
              ⇅
            </span>
            Same day as the previous
          </button>
          <button type="button" onClick={plusOne} title="One day after the day typed, or after the previous scene" data-plus-day className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12">
            +1 day
          </button>
          <span className="flex-1" />
          {day.trim() !== '' ? (
            <button type="button" onClick={clear} data-clear-story-time className="folio-ghost-button h-[28px] rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2">
              Clear
            </button>
          ) : null}
        </div>
        <div data-relative-block={relative.tone} className={`flex items-start gap-[9px] rounded-[11px] px-[12px] py-[11px] ${relative.tone === 'warn' ? 'text-ink' : 'bg-s1 text-ink2'}`} style={relative.tone === 'warn' ? { background: 'var(--warn-bg)' } : undefined}>
          <span aria-hidden="true" className={`folio-mark mt-[1px] flex-none text-12 ${relative.tone === 'warn' ? 'text-warn' : 'text-ink3'}`}>
            {relative.glyph}
          </span>
          <span className="min-w-0 flex-1 text-12-5 leading-[1.5]" style={{ textWrap: 'pretty' }} data-relative-line>
            {relative.text}
          </span>
        </div>
        {scene.storyTime !== null && previous !== null && previous.storyTime !== null && !scene.flashback ? (
          <span className="text-11 text-ink3">
            Compared with {sceneRef(previous)} · {formatStoryTime(previous.storyTime)}
          </span>
        ) : null}
      </form>

      <Section>
        <SectionHead label="What the page says">
          <span className="text-11 text-ink3">read, not stored</span>
        </SectionHead>
        {cues === null || (cues.timeOfDay === null && cues.action === null) ? (
          <span className="text-12 text-ink3" data-cues="none">
            No time of day on the heading and no line that counts days.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-[6px]" data-cues>
            {cues.timeOfDay === null ? null : (
              <Link href={scriptHref} className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline" data-cue-heading title="The heading's time of day">
                {cues.timeOfDay}
                {cues.bind === 'continuous' ? ' · same moment as the scene before' : cues.bind === 'later' ? ' · later the same day' : ''}
              </Link>
            )}
            {cues.action === null || cueHref === null ? null : (
              <Link href={cueHref} className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline" data-cue-action title="The first action line that names a time">
                “{cues.action.quote}”
                {cues.action.offsetDays === null ? '' : cues.action.offsetDays === 0 ? ' · same day' : ` · ${cues.action.offsetDays > 0 ? '+' : ''}${String(cues.action.offsetDays)} ${Math.abs(cues.action.offsetDays) === 1 ? 'day' : 'days'}`}
              </Link>
            )}
          </div>
        )}
      </Section>

      {findings.length === 0 && deliberate.length === 0 ? null : (
        <Section>
          <SectionHead label="Continuity">
            <span className="text-11 text-ink3">{findings.length === 0 ? 'all marked deliberate' : `${String(findings.length)} open`}</span>
          </SectionHead>
          <div className="flex flex-col gap-[6px]">
            {findings.map((finding) => (
              <div key={finding.key} data-drawer-finding={finding.key} className="flex flex-col gap-[6px] rounded-[11px] px-[12px] py-[10px] text-ink" style={{ background: 'var(--warn-bg)' }}>
                <span className="flex items-center gap-[8px]">
                  <span aria-hidden="true" className="folio-mark flex-none text-12 text-warn">
                    ⚠{TEXT_VARIATION_SELECTOR}
                  </span>
                  <span className="folio-cite" data-finding-kind={finding.kind}>
                    {KIND_LABEL[finding.kind]}
                  </span>
                </span>
                <span className="text-12-5 leading-[1.5]" style={{ textWrap: 'pretty' }}>
                  {noteOf(finding)}
                </span>
                <button
                  type="button"
                  data-finding-deliberate={finding.key}
                  disabled={busy}
                  onClick={() => {
                    onVerdict(finding, true)
                  }}
                  className="folio-line-button h-[26px] self-start rounded-[7px] px-[9px] text-11-5"
                >
                  It's deliberate
                </button>
              </div>
            ))}
            {deliberate.map((finding) => (
              <div key={finding.key} data-drawer-finding-deliberate={finding.key} className="flex items-center gap-[8px] rounded-[11px] bg-s1 px-[12px] py-[8px] text-12 text-ink3">
                <span className="folio-cite">{KIND_LABEL[finding.kind]}</span>
                <span className="min-w-0 flex-1 truncate">deliberate</span>
                <button
                  type="button"
                  data-finding-reopen={finding.key}
                  disabled={busy}
                  onClick={() => {
                    onVerdict(finding, false)
                  }}
                  className="folio-ghost-button h-[24px] rounded-[6px] px-[8px] text-11-5 text-ink3 hover:!text-ink2"
                >
                  Reopen
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <SectionHead label="Threads">
          <span className="text-11 text-ink3">{mine.length === 0 ? 'on no storyline' : 'first is its row'}</span>
        </SectionHead>
        <div className="flex flex-wrap items-center gap-[6px]">
          {mine.map((thread, index) => (
            <span key={thread.id} data-scene-thread={thread.id} className="inline-flex items-center gap-[6px] rounded-[7px] bg-s1 py-[3px] pl-[9px] pr-[5px] text-12">
              <span aria-hidden="true" className="h-[6px] w-[6px] flex-none rounded-full" style={{ background: threadColourVar(thread.colour) }} />
              {thread.name}
              {index === 0 ? null : (
                <button
                  type="button"
                  aria-label={`Make ${thread.name} the row`}
                  title="Make this the row the scene sits in"
                  data-thread-first={thread.id}
                  disabled={busy}
                  onClick={() => {
                    onThreads([thread.id, ...scene.threads.filter((id) => id !== thread.id)])
                  }}
                  className="folio-ghost-button grid h-[18px] w-[18px] place-items-center rounded-[5px] text-10-5 text-ink3"
                >
                  ▲
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove from ${thread.name}`}
                title="Remove from this thread"
                data-unlink-thread={thread.id}
                disabled={busy}
                onClick={() => {
                  onThreads(scene.threads.filter((id) => id !== thread.id))
                }}
                className="folio-ghost-button grid h-[18px] w-[18px] place-items-center rounded-[5px] text-11 text-ink3"
              >
                ×
              </button>
            </span>
          ))}
          <div ref={menu} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={picking}
              aria-label="Add to a thread"
              title={linkable.length === 0 ? (threads.length === 0 ? 'No thread yet - make one in the sidebar' : 'On every thread already') : 'Add to a thread'}
              disabled={linkable.length === 0 || busy}
              onClick={() => {
                setPicking((value) => !value)
              }}
              data-add-to-thread
              className="folio-dashed-button h-[26px] rounded-[7px] px-[9px] text-12"
            >
              ＋
            </button>
            {picking ? (
              <div role="menu" className="folio-menu absolute left-0 top-[30px] w-[200px]">
                {linkable.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    role="menuitem"
                    data-link-thread={thread.id}
                    onClick={() => {
                      setPicking(false)
                      onThreads([...scene.threads, thread.id])
                    }}
                    className="folio-menu-item"
                  >
                    <span aria-hidden="true" className="h-[6px] w-[6px] flex-none rounded-full" style={{ background: threadColourVar(thread.colour) }} />
                    <span className="min-w-0 flex-1 truncate">{thread.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      <Section>
        <SectionHead label="In this scene">
          <Link href={charactersHref} className="text-11 text-accent no-underline hover:underline">
            → Characters
          </Link>
        </SectionHead>
        <div className="flex flex-wrap gap-[6px]">
          {scene.cast.length === 0 ? (
            <span className="text-12 text-ink3">No one speaks or is mentioned.</span>
          ) : (
            scene.cast.map((person) => (
              <Link key={person.id} href={characterHref(projectId, person.id)} data-cast-link={person.id} className="rounded-pill bg-accent-bg px-[10px] py-[3px] text-12 text-accent no-underline hover:underline">
                {person.name}
              </Link>
            ))
          )}
        </div>
        {scene.set === null ? null : (
          <span className="text-12 text-ink2">
            Set ·{' '}
            <Link href={locationHref(projectId, scene.set.id)} data-set-link={scene.set.id} className="text-accent no-underline hover:underline">
              {scene.set.name}
            </Link>
          </span>
        )}
      </Section>
    </DrawerShell>
  )
}
