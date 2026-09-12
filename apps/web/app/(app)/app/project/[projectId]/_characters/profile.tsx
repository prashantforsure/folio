'use client'

import type { CastRow, CharacterGroup, CharacterProfile, ProjectId, SceneRef } from '@folio/contracts'
import { CHARACTER_GROUPS } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import Link from 'next/link'
import { useState } from 'react'

import {
  addTurn,
  bindAlias,
  removeTurn,
  renameCharacter,
  saveKeyLines,
  saveProfile,
  saveRelationship,
  saveTurn,
  unbindAlias,
} from '../../../../../../lib/characters/actions'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { ElsewhereLinks, Run } from './characters-workspace'
import { CharacterChip } from './chip'
import { Editable } from './editable'
import { KeyLinePicker } from './key-line-picker'
import { ProfilePanel } from './profile-panel'

/**
 * One character's profile: the 820px column and the 264px panel.
 *
 * `Route - Characters.dc.html`, `isProfile`, section by section, and what
 * each is made of:
 *
 *   head            group · age · role, the name in Newsreader 34px (an
 *                   `h2`: the route's `h1` is "Characters", one per page),
 *                   the one-line - all authored, edited in place; the
 *                   name's edit is a **rename** and asks first (below)
 *   cues            the alias table: every counted spelling with its count
 *                   (derived), every bound spelling not in the script at
 *                   `× 0`, `＋ alias` to bind another, `×` to unbind
 *   Wants/Needs/Flaw authored, each with its authored source line
 *   Arc             authored turns, each pointing at a scene or at nothing;
 *                   a turn with no present scene is on `--note-bg` with
 *                   "not on the page" - the unwritten flag, from the join
 *   Voice           authored rules, and key lines picked from the draft
 *                   (`KeyLinePicker`), each read from its node with its
 *                   scene
 *   Relationships   every character sharing a scene, most first, with the
 *                   shared count derived and `what` / `shift` authored
 *   the panel       `ProfilePanel`
 *
 * ## The rename asks first
 *
 * Editing the name shows what it will do before it does it: "Rename
 * everywhere? N cues will be rewritten across the script." Confirming runs
 * `renameCharacter` - the sanctioned write-back, every cue that *is* the
 * name in every episode, a `before_rename` version per script touched -
 * and the diff comes back as the count. AGENTS.md, Entity identity: a
 * record-level rename "rewrites every cue in every episode and keeps bio,
 * portrait, relationships and casting"; the keeping is free, because none
 * of those live on a node.
 */
export const Profile = ({
  projectId,
  profile,
  cast,
  sceneRefs,
  baseHref,
  links,
  run,
}: {
  readonly projectId: ProjectId
  readonly profile: CharacterProfile
  readonly cast: readonly CastRow[]
  readonly sceneRefs: readonly SceneRef[]
  readonly baseHref: ProjectRoutePath
  readonly links: ElsewhereLinks
  readonly run: Run
}) => {
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [renamed, setRenamed] = useState<string | null>(null)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [alias, setAlias] = useState('')
  const [turnDraft, setTurnDraft] = useState('')
  const [ruleDraft, setRuleDraft] = useState('')
  const [picking, setPicking] = useState(false)

  const field = (edit: Record<string, unknown>): void => {
    run(async () => {
      const result = await saveProfile(projectId, profile.id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }

  const rename = (): void => {
    const next = pendingName
    if (next === null) return
    setPendingName(null)
    run(async () => {
      const result = await renameCharacter(projectId, profile.id, next)
      if (result.status !== 'renamed') return result.message
      setRenamed(
        result.cues === 0
          ? 'Renamed. No cue carried the old name.'
          : `Renamed. ${String(result.cues)} ${result.cues === 1 ? 'cue' : 'cues'} rewritten across ${String(result.episodes)} ${
              result.episodes === 1 ? 'episode' : 'episodes'
            }.`,
      )
      return null
    })
  }

  const bind = (): void => {
    const cue = alias.trim()
    if (cue === '') return
    setAlias('')
    setAliasOpen(false)
    run(async () => {
      const result = await bindAlias(projectId, profile.id, cue)
      return result.status === 'bound' ? null : result.message
    })
  }

  const unbind = (cue: string): void => {
    run(async () => {
      const result = await unbindAlias(projectId, profile.id, cue)
      return result.status === 'saved' ? null : result.message
    })
  }

  const rules = (next: readonly string[]): void => {
    field({ voiceRules: next })
  }

  const keyLines = (next: readonly NodeId[]): void => {
    run(async () => {
      const result = await saveKeyLines(projectId, profile.id, next)
      return result.status === 'saved' ? null : result.message
    })
  }

  const counted = new Map(profile.cues.map((cue) => [cue.cue, cue]))
  const uncounted = profile.boundCues.filter((cue) => !counted.has(cue))
  const takenLines = new Set(profile.keyLines.map((line) => line.nodeId))

  return (
    <>
      <div className="min-w-0 flex-1 overflow-auto px-[26px] pb-[60px] pt-[22px]" data-profile={profile.id}>
        <div className="flex max-w-[820px] flex-col gap-[22px]">
          {/* head */}
          <div className="grid grid-cols-[minmax(0,1fr)_150px] items-start gap-[20px]">
            <div className="flex min-w-0 flex-col gap-[8px]">
              <div className="flex items-center gap-[8px] text-11 text-ink3">
                <select
                  value={profile.group}
                  onChange={(event) => {
                    const next = event.target.value
                    if ((CHARACTER_GROUPS as readonly string[]).includes(next)) field({ group: next as CharacterGroup })
                  }}
                  aria-label="Group"
                  data-group
                  className="rounded-chrome border border-line2 bg-transparent px-[6px] py-[1px] text-9-5 font-semibold uppercase tracking-[.06em] text-ink3 outline-none"
                >
                  <option value="principal">Principal</option>
                  <option value="supporting">Supporting</option>
                </select>
                <Editable
                  value={profile.age}
                  placeholder="age"
                  label="Age"
                  onSave={(next) => {
                    field({ age: next })
                  }}
                  className="text-11"
                />
                <span>·</span>
                <Editable
                  value={profile.role}
                  placeholder="Add a role — who they are in one line"
                  label="Role"
                  onSave={(next) => {
                    field({ role: next })
                  }}
                  className="text-11"
                />
              </div>

              {pendingName === null ? (
                <h2 className="m-0 font-serif text-34 font-medium leading-[1.05] tracking-[-.015em]">
                  <Editable
                    value={profile.name}
                    placeholder="Name"
                    label="Name"
                    onSave={(next) => {
                      if (next !== '' && next !== profile.name) setPendingName(next)
                    }}
                    className="font-serif text-34 font-medium leading-[1.05] tracking-[-.015em]"
                  />
                </h2>
              ) : (
                <div className="flex flex-col gap-[6px] rounded-chrome border border-note bg-note-bg px-[12px] py-[10px]" data-rename-confirm>
                  <span className="font-serif text-15">
                    Rename {profile.name} to {pendingName} everywhere?
                  </span>
                  <span className="text-11 text-ink2">
                    {profile.nameCues === 0
                      ? 'No cue in the script carries this name; only the record changes.'
                      : `${String(profile.nameCues)} ${profile.nameCues === 1 ? 'cue' : 'cues'} will be rewritten across the script. Other spellings bound to this record stay as they are.`}
                  </span>
                  <span className="flex gap-[6px]">
                    <button
                      type="button"
                      onClick={rename}
                      data-rename-everywhere
                      className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11-5 font-semibold text-desk"
                    >
                      Rename everywhere
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingName(null)
                      }}
                      className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11-5 text-ink2 hover:bg-hover"
                    >
                      Cancel
                    </button>
                  </span>
                </div>
              )}
              {renamed === null ? null : (
                <span className="text-10-5 text-add" data-renamed>
                  {renamed}
                </span>
              )}

              <p className="m-0 font-serif text-16 leading-[1.5] text-ink2">
                <Editable
                  value={profile.bio}
                  placeholder="One line on who they are. What they do, what they know, what they never say."
                  label="One-line"
                  multiline
                  onSave={(next) => {
                    field({ bio: next })
                  }}
                  className="font-serif text-16 leading-[1.5]"
                />
              </p>

              <div className="mt-[2px] flex flex-wrap items-center gap-[6px]" data-cues>
                <span className="mr-[2px] text-10 text-ink3">Cues that resolve here</span>
                {profile.cues.map((cue) => (
                  <CueChip
                    key={cue.cue}
                    cue={cue.cue}
                    count={cue.occurrences}
                    bound={profile.boundCues.includes(cue.cue)}
                    onUnbind={() => {
                      unbind(cue.cue)
                    }}
                  />
                ))}
                {uncounted.map((cue) => (
                  <CueChip
                    key={cue}
                    cue={cue}
                    count={0}
                    bound
                    onUnbind={() => {
                      unbind(cue)
                    }}
                  />
                ))}
                {aliasOpen ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      bind()
                    }}
                    className="flex items-center gap-[4px]"
                  >
                    <input
                      autoFocus
                      type="text"
                      value={alias}
                      onChange={(event) => {
                        setAlias(event.target.value)
                      }}
                      onBlur={() => {
                        if (alias.trim() === '') setAliasOpen(false)
                      }}
                      placeholder="Another spelling"
                      aria-label="Another spelling"
                      data-alias-input
                      className="w-[150px] rounded-chrome border border-accent-line bg-sheet px-[8px] py-[2px] font-mono text-10-5 text-ink outline-none placeholder:text-ink3"
                    />
                    <button
                      type="submit"
                      className="rounded-chrome border-none bg-ink px-[8px] py-[3px] text-10-5 font-semibold text-desk"
                    >
                      Bind
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAliasOpen(true)
                    }}
                    data-add-alias
                    className="rounded-chrome border border-dashed border-line bg-transparent px-[8px] py-[2px] text-10-5 text-ink3 hover:bg-hover hover:text-ink"
                  >
                    ＋ alias
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-[6px]">
              <div
                title="Portraits need file storage, which is not built yet. Casting lives in Production."
                className="flex aspect-[3/4] flex-col items-center justify-center gap-[3px] rounded-chrome border border-dashed border-line bg-hover p-[10px] text-center"
              >
                <CharacterChip name={profile.name} hue={profile.hue} size={44} className="mb-[4px]" />
                <span className="text-11 text-ink2">Drop a reference</span>
                <span className="text-10 text-ink3">or cast in Production</span>
              </div>
            </div>
          </div>

          {/* want / need / flaw */}
          <div className="grid grid-cols-3 gap-[10px]" data-drives>
            {(
              [
                { k: 'Wants', value: profile.wants, source: profile.wantsSource, field: 'wants', sourceField: 'wantsSource' },
                { k: 'Needs', value: profile.needs, source: profile.needsSource, field: 'needs', sourceField: 'needsSource' },
                { k: 'Flaw', value: profile.flaw, source: profile.flawSource, field: 'flaw', sourceField: 'flawSource' },
              ] as const
            ).map((drive) => (
              <div key={drive.k} className="flex flex-col gap-[5px] rounded-chrome border border-line bg-panel px-[13px] py-[12px]">
                <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">{drive.k}</span>
                <span className="font-serif text-[14.5px] leading-[1.45]">
                  <Editable
                    value={drive.value}
                    placeholder="—"
                    label={drive.k}
                    multiline
                    onSave={(next) => {
                      field({ [drive.field]: next })
                    }}
                    className="font-serif text-[14.5px] leading-[1.45]"
                  />
                </span>
                <span className="text-10-5 text-ink3">
                  <Editable
                    value={drive.source}
                    placeholder="where it is stated, or never"
                    label={`${drive.k} source`}
                    onSave={(next) => {
                      field({ [drive.sourceField]: next })
                    }}
                    className="text-10-5"
                  />
                </span>
              </div>
            ))}
          </div>

          {/* arc */}
          <div className="flex flex-col gap-[8px]" data-arc>
            <div className="flex items-baseline gap-[8px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Arc</span>
              <span className="text-10-5 text-ink3">one line per turn · each points at the scene where it happens</span>
            </div>
            <div className="flex flex-col border-l border-line">
              {profile.arc.map((turn) => (
                <div
                  key={turn.id}
                  data-arc-turn={turn.id}
                  className={`grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-[12px] py-[7px] pl-[14px] ${
                    turn.scene === null ? 'bg-note-bg' : ''
                  }`}
                >
                  <select
                    value={turn.scene?.sceneNodeId ?? ''}
                    onChange={(event) => {
                      const sceneNodeId = event.target.value === '' ? null : event.target.value
                      run(async () => {
                        const result = await saveTurn(projectId, turn.id, { text: turn.text, sceneNodeId })
                        return result.status === 'saved' ? null : result.message
                      })
                    }}
                    aria-label="Scene"
                    className="tabular w-full rounded-chrome border border-transparent bg-transparent px-0 pt-[3px] text-10-5 text-ink3 outline-none hover:border-line2"
                  >
                    <option value="">—</option>
                    {sceneRefs.map((ref) => (
                      <option key={ref.sceneNodeId} value={ref.sceneNodeId}>
                        {formatSceneRef(ref)}
                      </option>
                    ))}
                  </select>
                  <span className="font-serif text-[14.5px] leading-[1.5]">
                    <Editable
                      value={turn.text}
                      placeholder="What turns"
                      label="Turn"
                      multiline
                      onSave={(next) => {
                        if (next === '') return
                        run(async () => {
                          const result = await saveTurn(projectId, turn.id, { text: next, sceneNodeId: turn.scene?.sceneNodeId ?? null })
                          return result.status === 'saved' ? null : result.message
                        })
                      }}
                      className="font-serif text-[14.5px] leading-[1.5]"
                    />
                  </span>
                  <span className="flex items-center gap-[6px] pr-[6px]">
                    {turn.scene === null ? (
                      <span className="mt-[2px] whitespace-nowrap rounded-chrome border border-dashed border-line px-[6px] py-[1px] text-10 text-ink3" data-unwritten>
                        not on the page
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        run(async () => {
                          const result = await removeTurn(projectId, turn.id)
                          return result.status === 'saved' ? null : result.message
                        })
                      }}
                      aria-label="Remove this turn"
                      title="Remove this turn"
                      className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const text = turnDraft.trim()
                  if (text === '') return
                  setTurnDraft('')
                  run(async () => {
                    const result = await addTurn(projectId, profile.id, { text, sceneNodeId: null })
                    return result.status === 'saved' ? null : result.message
                  })
                }}
                className="py-[7px] pl-[14px]"
              >
                <input
                  type="text"
                  value={turnDraft}
                  onChange={(event) => {
                    setTurnDraft(event.target.value)
                  }}
                  placeholder="Add a turn…"
                  aria-label="Add a turn"
                  data-add-turn
                  className="w-full border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
                />
              </form>
            </div>
          </div>

          {/* voice */}
          <div className="flex flex-col gap-[8px]" data-voice>
            <div className="flex items-baseline gap-[8px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Voice</span>
              <span className="text-10-5 text-ink3">how they talk, and lines from the draft that prove it</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-[14px]">
              <div className="flex flex-col gap-[6px]">
                {profile.voiceRules.map((rule, index) => (
                  <div key={`${String(index)}:${rule}`} className="flex gap-[8px] text-12-5 leading-[1.5]" data-voice-rule>
                    <span className="text-ink3">·</span>
                    <span className="flex-1">
                      <Editable
                        value={rule}
                        placeholder="A rule"
                        label="Voice rule"
                        onSave={(next) => {
                          rules(next === '' ? profile.voiceRules.filter((_, at) => at !== index) : profile.voiceRules.map((entry, at) => (at === index ? next : entry)))
                        }}
                        className="text-12-5 leading-[1.5]"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        rules(profile.voiceRules.filter((_, at) => at !== index))
                      }}
                      aria-label="Remove this rule"
                      className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const rule = ruleDraft.trim()
                    if (rule === '') return
                    setRuleDraft('')
                    rules([...profile.voiceRules, rule])
                  }}
                  className="flex gap-[8px] text-12-5"
                >
                  <span className="text-ink3">·</span>
                  <input
                    type="text"
                    value={ruleDraft}
                    onChange={(event) => {
                      setRuleDraft(event.target.value)
                    }}
                    placeholder="Add a rule about how they talk…"
                    aria-label="Add a voice rule"
                    data-add-rule
                    className="min-w-0 flex-1 border-none bg-transparent text-12-5 text-ink outline-none placeholder:text-ink3"
                  />
                </form>
              </div>
              <div className="flex flex-col gap-[6px]">
                {profile.keyLines.map((line) => (
                  <div
                    key={line.nodeId}
                    data-key-line
                    className="group flex flex-col gap-[3px] rounded-chrome border border-line2 bg-sheet px-[11px] py-[8px] hover:border-accent-line"
                  >
                    <span className="font-mono text-11-5 leading-[1.5]">{line.text}</span>
                    <span className="flex items-center text-10 text-ink3">
                      <span className="flex-1">{line.scene === null ? 'outside any scene' : formatSceneRef(line.scene)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          keyLines(profile.keyLines.map((entry) => entry.nodeId).filter((id) => id !== line.nodeId))
                        }}
                        aria-label="Remove this key line"
                        className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:text-del"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                {picking ? (
                  <KeyLinePicker
                    projectId={projectId}
                    characterId={profile.id}
                    taken={takenLines}
                    onPick={(nodeId) => {
                      setPicking(false)
                      keyLines([...profile.keyLines.map((entry) => entry.nodeId), nodeId])
                    }}
                    onClose={() => {
                      setPicking(false)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(true)
                    }}
                    data-add-key-line
                    className="rounded-chrome border border-dashed border-line bg-transparent px-[11px] py-[6px] text-left text-10-5 text-ink3 hover:bg-hover hover:text-ink"
                  >
                    ＋ key line from the draft
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* relationships */}
          <div className="flex flex-col gap-[8px]" data-relationships>
            <div className="flex items-baseline gap-[8px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Relationships</span>
              <span className="text-10-5 text-ink3">shared scenes from the script · the rest is yours</span>
            </div>
            <div className="overflow-hidden rounded-chrome border border-line bg-panel">
              {profile.relationships.length === 0 ? (
                <div className="px-[14px] py-[10px] text-11-5 text-ink3">
                  Nobody shares a scene with {profile.name} yet.
                </div>
              ) : null}
              {profile.relationships.map((relationship) => {
                const pct = Math.round((relationship.shared / Math.max(1, profile.appearances)) * 100)
                return (
                  <div
                    key={relationship.other.id}
                    data-relationship={relationship.other.id}
                    className="grid grid-cols-[150px_minmax(0,1fr)_90px] items-center gap-[12px] border-b border-line2 px-[14px] py-[9px] hover:bg-hover"
                  >
                    <Link
                      href={characterHref(projectId, relationship.other.id)}
                      className="flex items-center gap-[8px] text-ink no-underline hover:no-underline"
                    >
                      <CharacterChip name={relationship.other.name} hue={relationship.other.hue} />
                      <span className="truncate text-12 font-medium">{relationship.other.name}</span>
                    </Link>
                    <span className="flex min-w-0 flex-col gap-[1px]">
                      <span className="truncate text-12">
                        <Editable
                          value={relationship.what}
                          placeholder="What they are to each other"
                          label={`Relationship with ${relationship.other.name}`}
                          onSave={(next) => {
                            run(async () => {
                              const result = await saveRelationship(projectId, profile.id, {
                                otherId: relationship.other.id,
                                what: next,
                                shift: relationship.shift,
                              })
                              return result.status === 'saved' ? null : result.message
                            })
                          }}
                          className="text-12"
                        />
                      </span>
                      <span className="truncate text-10-5 text-ink3">
                        <Editable
                          value={relationship.shift}
                          placeholder="How it moves across the draft"
                          label={`How it moves with ${relationship.other.name}`}
                          onSave={(next) => {
                            run(async () => {
                              const result = await saveRelationship(projectId, profile.id, {
                                otherId: relationship.other.id,
                                what: relationship.what ?? '',
                                shift: next === '' ? null : next,
                              })
                              return result.status === 'saved' ? null : result.message
                            })
                          }}
                          className="text-10-5"
                        />
                      </span>
                    </span>
                    <span className="flex items-center justify-end gap-[6px]">
                      <span className="h-[4px] w-[40px] overflow-hidden rounded-[2px] bg-line2">
                        <span className="block h-full bg-ink2" style={{ width: `${String(pct)}%` }} />
                      </span>
                      <span className="tabular w-[34px] text-right text-10-5 text-ink3">{relationship.shared} sc</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <ProfilePanel projectId={projectId} profile={profile} cast={cast} baseHref={baseHref} links={links} run={run} />
    </>
  )
}

/** One alias-table row as the profile draws it: Courier, the count, and `×` to unbind a bound one. */
const CueChip = ({
  cue,
  count,
  bound,
  onUnbind,
}: {
  readonly cue: string
  readonly count: number
  readonly bound: boolean
  readonly onUnbind: () => void
}) => (
  <span
    data-cue-chip={cue}
    className={`group inline-flex items-center gap-[6px] rounded-chrome border border-line2 bg-sheet px-[8px] py-[2px] font-mono text-10-5 text-ink2 ${
      count === 0 ? 'opacity-70' : ''
    }`}
  >
    {cue}
    <span className="text-ink3">× {count}</span>
    {bound ? (
      <button
        type="button"
        onClick={onUnbind}
        aria-label={`Unbind ${cue}`}
        title="Unbind this spelling"
        className="hidden rounded-chrome border-none bg-transparent px-[2px] font-sans text-10 text-ink3 hover:text-del group-hover:inline"
      >
        ×
      </button>
    ) : null}
  </span>
)
