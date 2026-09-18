'use client'

import type { CharacterProfile, DraftField, ProjectId, SceneFacts, SceneRef } from '@folio/contracts'
import { CHARACTER_ORIGIN_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import { EpisodeBars, IdentityChip, PresenceStrip } from '@folio/ui'
import type { CharacterId, NodeId } from '@folio/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createCharacter,
  deleteCharacter,
  dismissIntroFinding,
  mergeCharacters,
  previewRename,
  removePortrait,
  renameCharacter,
  saveProfile,
  undoRename,
  uploadPortrait,
} from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { SCENES_SHOWN, breakdownOf, fitsStrip, leastUsedColor, statsLine, stripGroups } from '../../../../../../lib/characters/cast'
import { takeDrawerIntent } from '../../../../../../lib/characters/compose'
import { citeOf } from '../../../../../../lib/characters/figures'
import { draftField } from '../../../../../../lib/characters/model-actions'
import type { RenamePreview } from '../../../../../../lib/characters/result'
import type { UndoOffer } from '../../../../../../lib/characters/undo'
import { offerUndo } from '../../../../../../lib/characters/undo'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import { count, eighths } from '../../../../../../lib/workspace/format'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { ConflictBlock } from '../_chrome/conflict-block'
import { SectionHead } from '../_chrome/drawer-parts'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { AliasTable } from './alias-table'
import { ContinuitySection } from './continuity-section'
import { DrawerShell, Section } from './drawer-shell'
import { IntroSection } from './intro-section'
import type { DraftFrom, DraftState, ProfileDraft } from './profile-fields'
import { NameField, ProfileFields } from './profile-fields'
import { RenameConfirm } from './rename-confirm'
import { SidesModal } from './sides-modal'
import { useCharactersView } from './view-state'
import { VoiceSection } from './voice-section'

/**
 * `/characters/:characterId` - the edit drawer, reordered around the
 * script's evidence (the rebuild, phases 2-4). Head: a 32px thumbnail
 * when there is a portrait, `Edit character`, a meta line whose refs are
 * links into the script (`52 speaks · 27 mentioned · 412 lines · E1 Sc 1 →
 * E3 Sc 30 · minted from the script`), `Ask` and `Open in script`. Then,
 * derived first:
 *
 *   Name · the stats row (`412 lines · 3,180 words · 14% of dialogue · 3 V.O.`)
 *   In the script as   the alias table (\`alias-table.tsx\`)
 *   Voice              first / last / longest line, quoted; \`All N lines →\`
 *   Introduced         the action line that names them, \`Use this\`, the timing finding
 *   Presence           the strip, the span, the longest gap
 *   Scenes             per episode: Sc · INT/EXT · D/N · set → Locations · presence · eighths
 *   Shares scenes with · Talks to
 *   Sets               → Locations
 *   Notes              a fold (\`<details open>\`): the profile fields with \`✦ Draft
 *                      from the script\` rows, the status, the reference image
 *   Continuity         \`✦ Check for contradictions\` and the findings
 *
 * ## The foot
 *
 * On a record the script holds: `In 12 scenes · Merge into…` - delete is
 * refused by the action while a cue is live, so the door it used to name
 * in a tooltip is drawn instead. Off the page: a live `Delete` with a
 * plain confirm. Then the notice, `Cancel`, `Save`.
 *
 * ## Save is one write; a changed name is a rename first, and a rename has an undo
 *
 * The fields are a draft until `Save`, written in one `saveProfile`. A
 * changed name is the sanctioned write-back (AGENTS.md, "Derivation is
 * one-way - except"), so the drawer asks in place with the diff
 * `previewRename` reads and runs `renameCharacter` first on yes; the result
 * carries what each cue read before, offered in the status bar as `Undo`
 * (`lib/characters/undo.ts`, `undoRename`) until another rename or the
 * route is left. `Create a new character instead` keeps this record and
 * makes a new one under the typed name.
 *
 * ## The model writes into the draft, never the row
 *
 * `✦ Draft from the script` calls `draftField` directly - not through
 * `run`, nothing is saved - and puts the answer in the field with its
 * citations under it and `not saved`. Save keeps it; Cancel drops it.
 *
 * ## Focus
 *
 * On mount the drawer tells the assistant which record is open
 * (`useEphemeral().setAssistantFocus`), cleared on unmount, so the panel's
 * `focus` names this person; `Ask` prefills the composer and opens it.
 */
export type Relation = {
  readonly id: string
  readonly short: string
  readonly initial: string
  readonly hue: number
  readonly shared: number
}

type Confirm = 'rename' | 'delete' | 'merge' | null

export const CharacterDrawer = ({
  projectId,
  shape,
  figure,
  profile,
  cast,
  index,
  relations,
  storage,
  assistant,
  baseHref,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly figure: CastFigure
  readonly profile: CharacterProfile
  /** Every record, for `Merge into…`. */
  readonly cast: readonly CastFigure[]
  readonly index: readonly SceneFacts[]
  readonly relations: readonly Relation[]
  readonly storage: boolean
  /** Whether `ANTHROPIC_API_KEY` is set: the model actions' gate. */
  readonly assistant: boolean
  readonly baseHref: ProjectRoutePath
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const router = useRouter()
  const ephemeral = useEphemeral()
  const session = useSession()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ProfileDraft>({
    name: profile.name,
    role: profile.role ?? '',
    age: profile.age ?? '',
    gender: profile.gender ?? '',
    bio: profile.bio ?? '',
    appearance: profile.appearance ?? '',
    color: profile.color,
    status: profile.status,
    wants: profile.wants ?? '',
    needs: profile.needs ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [preview, setPreview] = useState<RenamePreview | null>(null)
  const [winner, setWinner] = useState<CharacterId | null>(null)
  const [sides, setSides] = useState(false)
  const [drafts, setDrafts] = useState<Partial<Record<DraftField, DraftState>>>({})
  const [scenesOpen, setScenesOpen] = useState<ReadonlySet<number>>(new Set())
  const { setView } = useCharactersView()
  const close = useCallback(() => {
    router.push(baseHref)
  }, [baseHref, router])

  useEffect(() => {
    if (takeDrawerIntent() === 'delete' && figure.appearances === 0) setConfirm('delete')
  }, [figure.appearances])

  const { setAssistantFocus } = ephemeral
  useEffect(() => {
    setAssistantFocus({ kind: 'character', id: profile.id, name: profile.name })
    return () => {
      setAssistantFocus(null)
    }
  }, [profile.id, profile.name, setAssistantFocus])

  const renamed = draft.name.trim() !== '' && draft.name.trim() !== profile.name
  const onPage = figure.appearances > 0
  const others = cast.filter((entry) => entry.id !== profile.id)
  const refs = useMemo(() => new Map<NodeId, SceneRef>(index.map((scene) => [scene.sceneNodeId, scene])), [index])
  const projectWords = useMemo(() => index.reduce((total, scene) => total + scene.words, 0), [index])
  const breakdown = useMemo(() => breakdownOf(figure.id, figure.refs), [figure.id, figure.refs])
  const drafting = Object.values(drafts).some((state) => state?.kind === 'drafting')

  const writeProfile = async (): Promise<string | null> => {
    const result = await saveProfile(projectId, profile.id, {
      color: draft.color,
      gender: draft.gender === '' ? null : draft.gender,
      role: draft.role,
      age: draft.age,
      bio: draft.bio,
      appearance: draft.appearance,
      status: draft.status,
      wants: draft.wants,
      needs: draft.needs,
    })
    return result.status === 'saved' ? null : result.message
  }

  const openRename = (): void => {
    setConfirm('rename')
    setPreview(null)
    void previewRename(projectId, profile.id, draft.name.trim()).then(setPreview)
  }

  const offerRenameUndo = (offer: UndoOffer): void => {
    offerUndo(offer)
    toast(`Renamed ${offer.previousName.toUpperCase()} → ${offer.name} · ${count(offer.cues)} ${offer.cues === 1 ? 'cue' : 'cues'}`, {
      label: 'Undo',
      onClick: () => {
        run(async () => {
          const result = await undoRename(projectId, offer.characterId, { previousName: offer.previousName, restores: offer.restores })
          if (result.status !== 'undone') return result.message
          offerUndo(null)
          toast(
            result.skipped === 0
              ? `Rename undone · ${count(result.cues)} ${result.cues === 1 ? 'cue' : 'cues'}`
              : `Rename undone · ${count(result.cues)} of ${count(result.cues + result.skipped)} cues · ${count(result.skipped)} changed since`,
          )
          return null
        })
      },
    })
  }

  const save = (withRename: boolean): void => {
    if (draft.name.trim() === '') {
      setNotice('A character needs a name.')
      return
    }
    if (renamed && !withRename) {
      openRename()
      return
    }
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      let failure: string | null = null
      let offer: UndoOffer | null = null
      if (renamed && withRename) {
        const result = await renameCharacter(projectId, profile.id, draft.name.trim())
        if (result.status === 'renamed') {
          offer = { characterId: profile.id, previousName: result.previousName, name: result.name, cues: result.cues, restores: result.restores }
        } else if (result.status === 'taken') {
          failure = `${result.cue} is already ${result.name}'s cue. Merge the two records instead.`
        } else {
          failure = result.message
        }
      }
      if (failure === null) failure = await writeProfile()
      setBusy(false)
      if (failure !== null) {
        setNotice(failure)
        return failure
      }
      if (offer !== null) offerRenameUndo(offer)
      router.push(baseHref)
      return null
    })
  }

  /** `Create a new character instead`: this record keeps its name; the typed name becomes a new one. */
  const createInstead = (): void => {
    const name = draft.name.trim()
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      const kept = await writeProfile()
      if (kept !== null) {
        setBusy(false)
        setNotice(kept)
        return kept
      }
      const result = await createCharacter(projectId, { name, color: leastUsedColor(cast.map((entry) => entry.hue)) })
      setBusy(false)
      if (result.status !== 'created') {
        setNotice(result.message)
        return result.message
      }
      toast(`Created ${name}; ${profile.name} keeps its cues.`)
      router.push(characterHref(projectId, result.id))
      return null
    })
  }

  const merge = (into: CharacterId): void => {
    const target = cast.find((entry) => entry.id === into)
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      const result = await mergeCharacters(projectId, profile.id, into)
      setBusy(false)
      if (result.status !== 'merged') {
        setNotice(result.message)
        return result.message
      }
      toast(`Merged ${profile.name} into ${target?.name ?? 'the other record'}.`)
      router.push(characterHref(projectId, result.into))
      return null
    })
  }

  const upload = (file: File): void => {
    setBusy(true)
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, profile.id, form)
      setBusy(false)
      if (result.status !== 'saved') {
        setNotice(result.message)
        return result.message
      }
      return null
    })
  }

  const remove = (): void => {
    setBusy(true)
    run(async () => {
      const result = await removePortrait(projectId, profile.id)
      setBusy(false)
      if (result.status !== 'saved') {
        setNotice(result.message)
        return result.message
      }
      return null
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await deleteCharacter(projectId, profile.id)
      setBusy(false)
      if (result.status !== 'deleted') {
        setNotice(result.message)
        return result.message
      }
      router.push(baseHref)
      return null
    })
  }

  // `✦ Draft from the script`: directly, not through `run` - nothing is saved.
  const onDraft = (field: DraftField): void => {
    setDrafts((current) => ({ ...current, [field]: { kind: 'drafting' } }))
    void draftField(projectId, profile.id, field).then((result) => {
      if (result.status === 'drafted') {
        setDraft((current) => ({ ...current, [field]: result.text }))
        setDrafts((current) => ({ ...current, [field]: { kind: 'drafted', refs: result.refs, shown: result.shown, total: result.total } }))
        window.setTimeout(() => {
          const area = document.querySelector<HTMLTextAreaElement>(`[data-field="${field}"]`)
          if (area === null) return
          area.focus()
          area.setSelectionRange(area.value.length, area.value.length)
        }, 0)
        return
      }
      if (result.status === 'nothing') {
        setDrafts((current) => ({ ...current, [field]: { kind: 'nothing', message: result.message } }))
        return
      }
      setDrafts((current) => ({ ...current, [field]: { kind: 'idle' } }))
      setNotice(result.message)
    })
  }
  const draftFrom: DraftFrom = {
    disabled: !onPage ? 'Not on the page yet - nothing to draft from.' : !assistant ? 'The assistant is not connected.' : null,
    state: (field) => drafts[field] ?? { kind: 'idle' },
    onDraft,
    cite: (cites) => <CitationChips refs={cites.map((ref) => citeOf(projectId, shape, ref))} />,
  }

  const first = figure.first === null ? null : citeOf(projectId, shape, figure.first)
  const last = figure.last === null ? null : citeOf(projectId, shape, figure.last)
  const origin = profile.origin === null ? null : CHARACTER_ORIGIN_LABELS[profile.origin]
  const meta = (
    <>
      <span className="tabular">
        {count(figure.speaks)} speaks · {count(figure.mentionedIn)} mentioned · {count(figure.lines)} {figure.lines === 1 ? 'line' : 'lines'}
      </span>
      {first === null || last === null ? (
        <span>· not in the script</span>
      ) : (
        <>
          <span>·</span>
          <Link href={first.href} data-meta-first className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
            {first.label}
          </Link>
          <span>→</span>
          <Link href={last.href} data-meta-last className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
            {last.label}
          </Link>
        </>
      )}
      {origin === null ? null : <span data-drawer-origin={profile.origin}>· {origin}</span>}
    </>
  )
  const winnerName = winner === null ? null : (cast.find((entry) => entry.id === winner)?.name ?? null)
  const introScene = profile.intro?.sceneNodeId ?? null
  const introRef = introScene === null ? undefined : refs.get(introScene)
  const introAge = profile.intro?.age ?? null
  const gap = figure.gap === null ? null : { ...figure.gap, from: citeOf(projectId, shape, figure.gap.from), to: citeOf(projectId, shape, figure.gap.to) }

  return (
    <>
      <DrawerShell
        title="Edit character"
        meta={meta}
        label={`Edit ${profile.name}`}
        lead={
          profile.portraitUrl === null ? undefined : (
            <span className="relative block h-[32px] w-[32px] overflow-hidden rounded-[8px] bg-s1" data-drawer-portrait>
              <img src={profile.portraitUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </span>
          )
        }
        actions={
          <>
            <button
              type="button"
              data-drawer-ask
              title={`Ask the assistant about ${profile.name}`}
              onClick={() => {
                ephemeral.setAssistantPrompt(`About ${profile.name}: `)
                session.setAssistantOpen(true)
              }}
              className="folio-ghost-button h-[28px] rounded-[8px] px-[8px] text-11-5 text-ink3 hover:!text-ink2"
            >
              Ask
            </button>
            {first === null ? null : (
              <Link
                href={first.href}
                data-drawer-open-script
                title="Open the script at their first scene"
                className="folio-ghost-button flex h-[28px] items-center rounded-[8px] px-[8px] text-11-5 text-ink3 no-underline hover:!text-ink2 hover:no-underline"
              >
                Open in script
              </Link>
            )}
          </>
        }
        onClose={close}
        footer={
          confirm === 'delete' ? (
            <>
              <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
                Delete {profile.name}? The record goes; the script is untouched.
              </span>
              <button type="button" data-delete-keep onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
                Keep
              </button>
              <button type="button" data-delete-confirm onClick={destroy} className="folio-line-button h-[34px] flex-none rounded-[9px] border-live px-[14px] text-live hover:border-live hover:bg-live-bg hover:text-live">
                Delete
              </button>
            </>
          ) : confirm === 'rename' ? (
            <RenameConfirm
              from={profile.name}
              to={draft.name.trim()}
              preview={preview}
              busy={busy}
              onConfirm={() => save(true)}
              onKeep={() => setConfirm(null)}
              onCreateInstead={createInstead}
              onMerge={merge}
            />
          ) : confirm === 'merge' ? (
            <div className="flex min-w-0 flex-1 flex-col gap-[8px]" data-merge-confirm-block>
              <div className="flex items-center gap-[8px]">
                <span className="flex-none text-12 text-ink2">Merge into</span>
                <select
                  aria-label="Merge into"
                  data-merge-into
                  value={winner ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setWinner(event.target.value === '' ? null : (event.target.value as CharacterId))
                  }}
                  className="folio-field h-[30px] min-w-0 flex-1 rounded-[8px] py-0 text-12"
                >
                  <option value="">Pick a character…</option>
                  {others.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <button type="button" data-merge-cancel disabled={busy} onClick={() => setConfirm(null)} className="folio-line-button h-[30px] flex-none rounded-[8px] px-[10px] text-12">
                  Keep both
                </button>
              </div>
              {winner === null || winnerName === null ? null : (
                <ConflictBlock
                  title={`Merge ${profile.name} into ${winnerName}?`}
                  detail={`${profile.name}'s ${count(profile.boundCues.length)} ${profile.boundCues.length === 1 ? 'spelling' : 'spellings'} and ${count(figure.appearances)} ${figure.appearances === 1 ? 'scene' : 'scenes'} become ${winnerName}'s. The script is untouched.`}
                  accept="Merge"
                  deliberate="Keep both"
                  busy={busy}
                  onAccept={() => {
                    merge(winner)
                  }}
                  onDeliberate={() => setConfirm(null)}
                />
              )}
            </div>
          ) : (
            <>
              {onPage ? (
                <span className="flex min-w-0 items-center gap-[4px] text-11 text-ink3" data-drawer-in-script>
                  In {count(figure.appearances)} {figure.appearances === 1 ? 'scene' : 'scenes'} ·
                  <button
                    type="button"
                    data-drawer-merge
                    disabled={busy || others.length === 0}
                    title={others.length === 0 ? 'No other character to merge into' : 'Merge this record into another'}
                    onClick={() => {
                      setWinner(null)
                      setConfirm('merge')
                    }}
                    className="folio-ghost-button h-[24px] rounded-[6px] px-[4px] text-11 text-ink3 hover:!text-ink2 disabled:opacity-50"
                  >
                    Merge into…
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  data-drawer-delete
                  disabled={busy}
                  title="Delete this record"
                  onClick={() => setConfirm('delete')}
                  className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5"
                >
                  Delete
                </button>
              )}
              {notice === null ? null : (
                <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-drawer-notice>
                  {notice}
                </span>
              )}
              <div className="flex-1" />
              <button type="button" data-drawer-cancel disabled={busy || drafting} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
                Cancel
              </button>
              <button type="button" data-drawer-save disabled={busy || drafting} onClick={() => save(false)} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-[8px]">
          <NameField
            value={draft.name}
            busy={busy}
            onChange={(name) => {
              setDraft((current) => ({ ...current, name }))
            }}
          />
          <span className="tabular font-mono text-10-5 text-ink3" data-drawer-stats>
            {statsLine(figure, projectWords)}
          </span>
        </div>

        <AliasTable
          projectId={projectId}
          profile={profile}
          busy={busy}
          run={run}
          toast={toast}
          onMerge={(holder) => {
            setWinner(holder)
            setConfirm('merge')
          }}
        />

        <VoiceSection
          projectId={projectId}
          shape={shape}
          profile={profile}
          refs={refs}
          onSides={() => {
            setSides(true)
          }}
        />

        <IntroSection
          projectId={projectId}
          shape={shape}
          profile={profile}
          refs={refs}
          introConflict={figure.introConflict}
          busy={busy}
          onUse={(text) => {
            setDraft((current) => ({ ...current, bio: current.bio.trim() === '' ? text : current.bio.includes(text) ? current.bio : `${current.bio.trimEnd()}\n\n${text}` }))
          }}
          onDeliberate={(nodeId) => {
            run(async () => {
              const result = await dismissIntroFinding(projectId, profile.id, nodeId)
              return result.status === 'saved' ? null : result.message
            })
          }}
        />

        <Section>
          <SectionHead label="Presence">
            <span className="text-11 text-ink3">from the script</span>
          </SectionHead>
          {!onPage ? (
            <span className="text-11 text-ink3" data-drawer-strip="none">
              Not on the page yet
            </span>
          ) : (
            <div className="flex flex-col gap-[8px]" data-drawer-strip={figure.appearances}>
              {fitsStrip('drawer', index.length) ? <PresenceStrip groups={stripGroups(figure.strip, index)} size="drawer" /> : <EpisodeBars counts={figure.perEpisode} />}
              {first === null || last === null ? null : (
                <span className="flex flex-wrap items-center gap-[4px] text-11 text-ink3" data-drawer-span>
                  first
                  <Link href={first.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                    {first.label}
                  </Link>
                  · last
                  <Link href={last.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                    {last.label}
                  </Link>
                </span>
              )}
              {gap === null ? null : (
                <span className="flex flex-wrap items-center gap-[4px] text-11 text-ink3" data-drawer-gap={gap.scenes}>
                  longest gap · {count(gap.scenes)} scenes ·
                  <Link href={gap.from.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                    {gap.from.label}
                  </Link>
                  →
                  <Link href={gap.to.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                    {gap.to.label}
                  </Link>
                </span>
              )}
            </div>
          )}
        </Section>

        <Section>
          <SectionHead label="Scenes">
            <span className="tabular text-11 text-ink3">{onPage ? `${count(figure.appearances)} in the script` : 'from the script'}</span>
          </SectionHead>
          {breakdown.length === 0 ? (
            <span className="text-11 text-ink3" data-drawer-scenes="0">
              Not on the page yet
            </span>
          ) : (
            <div className="-mx-[18px] flex flex-col" data-drawer-scenes={figure.appearances}>
              {breakdown.map((group) => {
                const open = scenesOpen.has(group.ordinal)
                const shown = open ? group.scenes : group.scenes.slice(0, SCENES_SHOWN)
                const rest = group.scenes.length - shown.length
                return (
                  <div key={group.ordinal} className="flex flex-col" data-drawer-episode={group.ordinal}>
                    <div className="sticky top-0 z-[1] flex items-baseline gap-[8px] bg-sunk px-[18px] py-[5px]">
                      <span className="folio-eyebrow">
                        E{group.ordinal} · {count(group.scenes.length)} {group.scenes.length === 1 ? 'scene' : 'scenes'}
                        {group.eighths === null ? '' : ` · ${eighths(group.eighths)}`}
                      </span>
                      <span className="tabular flex-1 text-right text-10-5 text-ink3">
                        {count(group.speaks)} speaks · {count(group.mentioned)} mentioned
                      </span>
                    </div>
                    {shown.map((scene) => {
                      const cite = citeOf(projectId, shape, scene)
                      const speaks = scene.speaking.includes(figure.id)
                      return (
                        <div key={scene.sceneNodeId} data-scene-row={scene.sceneNodeId} className="flex items-center gap-[8px] px-[18px] py-[4px] text-11-5">
                          <Link href={cite.href} data-cite-link className="tabular w-[44px] flex-none font-mono text-10-5 text-ink3 no-underline hover:text-accent hover:no-underline">
                            Sc {scene.number}
                          </Link>
                          <span className="w-[28px] flex-none font-mono text-10 text-ink3">{scene.ie === 'INT/EXT' ? 'I/E' : scene.ie}</span>
                          <span className="w-[12px] flex-none font-mono text-10 text-ink3" title={scene.timeOfDay ?? undefined}>
                            {scene.light === 'day' ? 'D' : scene.light === 'night' ? 'N' : '—'}
                          </span>
                          {scene.set === null ? (
                            <span className="min-w-0 flex-1 truncate text-ink3">—</span>
                          ) : (
                            <Link href={locationHref(projectId, scene.set.id)} className="min-w-0 flex-1 truncate text-ink2 no-underline hover:text-accent hover:no-underline">
                              {scene.set.name}
                            </Link>
                          )}
                          <span className="folio-presence-cell flex-none" data-state={speaks ? 'speaks' : 'mentioned'} style={{ width: 8, height: 8 }} title={speaks ? 'speaks' : 'mentioned'} />
                          <span className="tabular w-[30px] flex-none text-right font-mono text-10 text-ink3">{scene.eighths === null ? '—' : eighths(scene.eighths)}</span>
                        </div>
                      )
                    })}
                    {rest > 0 ? (
                      <button
                        type="button"
                        data-scenes-more={group.ordinal}
                        onClick={() => {
                          setScenesOpen((current) => new Set([...current, group.ordinal]))
                        }}
                        className="self-start px-[18px] py-[4px] text-11 text-ink3 hover:text-ink2 hover:underline"
                      >
                        + {count(rest)} more {rest === 1 ? 'scene' : 'scenes'}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section>
          <SectionHead label="Shares scenes with">
            <button
              type="button"
              data-drawer-presence
              onClick={() => {
                setView('presence')
              }}
              className="text-11 text-accent hover:underline"
            >
              Presence →
            </button>
          </SectionHead>
          {relations.length === 0 ? (
            <span className="text-11 text-ink3" data-relations="none">
              {onPage ? 'Alone in every scene.' : 'Not on the page yet'}
            </span>
          ) : (
            <div className="-mx-[9px] flex flex-col gap-[2px]" data-relations={relations.length}>
              {relations.map((relation) => (
                <Link
                  key={relation.id}
                  href={characterHref(projectId, relation.id)}
                  data-relation={relation.id}
                  className="folio-ghost-button flex w-full items-center gap-[10px] rounded-[9px] px-[9px] py-[6px] text-left text-ink"
                >
                  <IdentityChip initial={relation.initial} hue={relation.hue} size={16} shape="square" />
                  <span className="min-w-0 flex-1 truncate text-12-5">{relation.short}</span>
                  <span className="tabular flex-none font-mono text-10-5 text-ink3">{relation.shared} sc</span>
                </Link>
              ))}
            </div>
          )}
          {onPage ? (
            <span className="flex flex-wrap items-center gap-x-[6px] text-11 text-ink3" data-talks-to={profile.talksTo.length}>
              Talks to ·{' '}
              {profile.talksTo.length === 0
                ? 'no one'
                : profile.talksTo.slice(0, 4).map((row, at) => (
                    <span key={row.id} className="tabular">
                      <Link href={characterHref(projectId, row.id)} className="text-ink2 no-underline hover:text-accent hover:no-underline">
                        {row.name}
                      </Link>{' '}
                      {row.count}
                      {at < Math.min(4, profile.talksTo.length) - 1 ? ' ·' : ''}
                    </span>
                  ))}
            </span>
          ) : null}
        </Section>

        <Section>
          <SectionHead label="Sets">
            <span className="text-11 text-ink3">→ Locations</span>
          </SectionHead>
          {figure.sets.length === 0 ? (
            <span className="text-11 text-ink3" data-drawer-sets="none">
              {onPage ? 'No set named in these scenes.' : 'Not on the page yet'}
            </span>
          ) : (
            <div className="flex flex-col gap-[4px]" data-drawer-sets={figure.sets.length}>
              {figure.sets.map((set) => (
                <Link key={set.id} href={locationHref(projectId, set.id)} data-drawer-set={set.id} className="flex items-center gap-[8px] text-12 no-underline hover:no-underline">
                  <span className="min-w-0 flex-1 truncate text-ink2 hover:text-accent">{set.name}</span>
                  <span className="tabular flex-none font-mono text-10-5 text-ink3">{set.scenes} sc</span>
                  <span className="tabular w-[64px] flex-none text-right font-mono text-10 text-ink3">
                    {set.day} D · {set.night} N
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <details open data-drawer-notes className="group/notes border-t border-line2 pt-[16px]">
          <summary className="flex cursor-pointer list-none items-baseline gap-[8px] [&::-webkit-details-marker]:hidden">
            <span className="flex-1 text-11-5 text-ink2">Notes</span>
            <span className="text-11 text-ink3">not from the script</span>
          </summary>
          <div className="flex flex-col gap-[18px] pt-[12px]">
            <ProfileFields
              draft={draft}
              onChange={setDraft}
              busy={busy}
              draftFrom={draftFrom}
              {...(introAge === null || introRef === undefined ? {} : { ageHint: { age: introAge, cite: <CitationChips refs={[citeOf(projectId, shape, introRef)]} /> } })}
            />
            <Section gap={8}>
              <span className="text-11-5 text-ink2">Reference</span>
              <div className="flex items-center gap-[8px]">
                <button
                  type="button"
                  data-drawer-upload
                  disabled={busy || !storage}
                  title={storage ? 'A reference image for the look sheet' : 'Portrait storage is not set up on this server yet.'}
                  onClick={() => {
                    picker.current?.click()
                  }}
                  className="folio-line-button h-[30px] rounded-[9px] px-[12px] text-12-5"
                >
                  Upload reference
                </button>
                <input
                  ref={picker}
                  type="file"
                  accept={PORTRAIT_TYPES.join(',')}
                  aria-label={`Reference for ${profile.name}`}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file !== undefined) upload(file)
                  }}
                />
                <button
                  type="button"
                  data-drawer-remove-portrait
                  disabled={busy || profile.portraitUrl === null}
                  onClick={remove}
                  className="folio-ghost-button h-[30px] rounded-[9px] px-[10px] text-12 text-ink3 hover:!text-ink2 disabled:cursor-default disabled:opacity-50 disabled:hover:!bg-transparent"
                >
                  Remove
                </button>
              </div>
            </Section>
          </div>
        </details>

        <ContinuitySection projectId={projectId} shape={shape} characterId={profile.id} onPage={onPage} assistant={assistant} findings={profile.findings} run={run} />
      </DrawerShell>
      {sides ? (
        <SidesModal
          projectId={projectId}
          shape={shape}
          characterId={profile.id}
          name={profile.name}
          lines={profile.lines}
          scenes={figure.speaks}
          onClose={() => {
            setSides(false)
          }}
        />
      ) : null}
    </>
  )
}
