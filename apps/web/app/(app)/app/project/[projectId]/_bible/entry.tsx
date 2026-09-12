'use client'

import type { BibleEntryView, BibleFactRow, BiblePitchFieldRow, BibleQuestionRow, ProjectId, SceneRef } from '@folio/contracts'
import { BIBLE_ENTRY_STATUS_LABEL, BIBLE_SECTION_LABEL } from '@folio/script'
import { Editable } from '@folio/ui'
import { useState } from 'react'

import {
  addFact,
  addField,
  addQuestion,
  decideConflict,
  recordConflict,
  removeFact,
  removeField,
  removeQuestion,
  saveEntry,
  saveFact,
  saveField,
  setQuestionResolved,
} from '../../../../../../lib/bible/actions'
import { editedLabel } from '../../../../../../lib/bible/figures'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { Run } from './bible-workspace'

/**
 * The entry view: the entry, its rules, its notes, its open questions.
 * `Route - Bible.dc.html`, `isEntry`, the main column: the section ·
 * status · edited line, the 34px Newsreader title, the 16px lede; then
 * for a rules entry `RULES · each cites the scene that establishes it` with
 * the numbered facts, `NOTES`, and for the Pitch `ONE PAGE · reads as a
 * document when exported` with the key/value fields; then `OPEN QUESTIONS`.
 *
 * Every line of text is `Editable` in place: the title, the lede, a rule,
 * a field's key and value, the notes. A rule's cites are chips - `E1 Sc 4`
 * - added from a picker of the present scenes and removed with `×`; a rule
 * with none reads "not yet on the page". The amber box under a rule is its
 * recorded conflict, with the bundle's two buttons: `Update rule` opens the
 * rule for its rewrite and decides the conflict on save; `Fix scene` leaves
 * a comment thread on the contradicting scene and decides it. Recording a
 * conflict in the first place is the `conflict…` affordance on the row -
 * the bundle shows conflicts as fixture data and no way to make one, so
 * this is an addition, and it is flagged.
 *
 * `Export pitch · PDF` is not drawn: export is a job that does not exist.
 */
export const Entry = ({
  projectId,
  entry,
  sceneRefs,
  run,
}: {
  readonly projectId: ProjectId
  readonly entry: BibleEntryView
  readonly sceneRefs: readonly SceneRef[]
  readonly run: Run
}) => {
  const statusInk =
    entry.status === 'canon' ? 'text-add' : entry.status === 'retired' ? 'text-del' : 'text-ink3'
  const statusDot = entry.status === 'canon' ? 'bg-add' : entry.status === 'retired' ? 'bg-del' : 'bg-ink3'

  const saveText = (edit: { readonly title?: string; readonly lede?: string | null; readonly notes?: string | null }): void => {
    run(async () => {
      const result = await saveEntry(projectId, entry.id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[26px] pb-[60px] pt-[22px]" data-entry={entry.id} data-entry-kind={entry.kind}>
      <div className="flex max-w-[720px] flex-col gap-[22px]">
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[8px] text-11 text-ink3">
            <span data-entry-section>{BIBLE_SECTION_LABEL[entry.section]}</span>
            <span>·</span>
            <span className={`inline-flex items-center gap-[5px] ${statusInk}`} data-entry-status={entry.status}>
              <span className={`h-[6px] w-[6px] rounded-full ${statusDot}`} />
              {BIBLE_ENTRY_STATUS_LABEL[entry.status]}
            </span>
            <span>·</span>
            <span>edited {editedLabel(entry.updatedAt, Date.now())}</span>
          </div>
          <h1 className="m-0 font-serif text-34 font-medium leading-[1.05] tracking-title" style={{ textWrap: 'pretty' }}>
            <Editable
              value={entry.title}
              placeholder="Untitled"
              label="Title"
              onSave={(next) => {
                if (next === '') return
                saveText({ title: next })
              }}
              className="font-serif text-34 font-medium leading-[1.05] tracking-title"
            />
          </h1>
          <p className="m-0 font-serif text-16 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
            <Editable
              value={entry.lede}
              placeholder={entry.kind === 'pitch' ? 'What this page is for, in a sentence.' : 'One sentence on what this entry establishes.'}
              label="Lede"
              multiline
              onSave={(next) => {
                saveText({ lede: next === '' ? null : next })
              }}
              className="font-serif text-16 leading-[1.55] text-ink2"
            />
          </p>
        </div>

        {entry.kind === 'pitch' ? (
          <PitchFields projectId={projectId} entryId={entry.id} fields={entry.fields} run={run} />
        ) : (
          <>
            <Rules projectId={projectId} entryId={entry.id} facts={entry.facts} sceneRefs={sceneRefs} run={run} />
            <div className="flex flex-col gap-[8px]" data-notes>
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Notes</span>
              <p className="m-0 whitespace-pre-wrap font-serif text-15 leading-[1.6] text-ink" style={{ textWrap: 'pretty' }}>
                <Editable
                  value={entry.notes}
                  placeholder="How these rules play on the page - what they should feel like, what is not yet dramatised."
                  label="Notes"
                  multiline
                  onSave={(next) => {
                    saveText({ notes: next === '' ? null : next })
                  }}
                  className="whitespace-pre-wrap font-serif text-15 leading-[1.6]"
                />
              </p>
            </div>
          </>
        )}

        <Questions projectId={projectId} entryId={entry.id} questions={entry.questions} run={run} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const Rules = ({
  projectId,
  entryId,
  facts,
  sceneRefs,
  run,
}: {
  readonly projectId: ProjectId
  readonly entryId: BibleEntryView['id']
  readonly facts: readonly BibleFactRow[]
  readonly sceneRefs: readonly SceneRef[]
  readonly run: Run
}) => {
  const [draft, setDraft] = useState('')

  return (
    <div className="flex flex-col gap-[10px]" data-rules>
      <div className="flex items-baseline gap-[8px]">
        <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Rules</span>
        <span className="text-10-5 text-ink3">each cites the scene that establishes it</span>
      </div>
      <div className="flex flex-col border-t border-line">
        {facts.map((fact, at) => (
          <Rule key={fact.id} projectId={projectId} fact={fact} number={at + 1} sceneRefs={sceneRefs} run={run} />
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (text === '') return
            setDraft('')
            run(async () => {
              const result = await addFact(projectId, entryId, { text, cites: [] })
              return result.status === 'saved' ? null : result.message
            })
          }}
          className="py-[10px] pl-[34px]"
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            placeholder="Add a rule…"
            aria-label="Add a rule"
            data-add-rule
            className="w-full border-none bg-transparent font-serif text-[15.5px] text-ink outline-none placeholder:font-sans placeholder:text-12 placeholder:text-ink3"
          />
        </form>
      </div>
    </div>
  )
}

const Rule = ({
  projectId,
  fact,
  number,
  sceneRefs,
  run,
}: {
  readonly projectId: ProjectId
  readonly fact: BibleFactRow
  readonly number: number
  readonly sceneRefs: readonly SceneRef[]
  readonly run: Run
}) => {
  const [recording, setRecording] = useState(false)
  const [conflictScene, setConflictScene] = useState('')
  const [conflictNote, setConflictNote] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewrite, setRewrite] = useState(fact.text)

  const cited = new Set(fact.cites.map((ref) => ref.sceneNodeId))
  const citable = sceneRefs.filter((ref) => !cited.has(ref.sceneNodeId))

  // The picker's value is a string; the action parses it as a node id.
  const saveCites = (cites: readonly string[]): void => {
    run(async () => {
      const result = await saveFact(projectId, fact.id, { text: fact.text, cites })
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <div
      data-rule={fact.id}
      className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-[12px] border-b border-line2 py-[11px] ${
        fact.conflict === null ? '' : 'bg-note-bg'
      }`}
    >
      <span className="tabular pt-[3px] text-11 text-ink3">{number}</span>
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="font-serif text-[15.5px] leading-[1.45]" style={{ textWrap: 'pretty' }}>
          <Editable
            value={fact.text}
            placeholder="The rule"
            label={`Rule ${String(number)}`}
            multiline
            onSave={(next) => {
              if (next === '') return
              run(async () => {
                const result = await saveFact(projectId, fact.id, { text: next, cites: fact.cites.map((ref) => ref.sceneNodeId) })
                return result.status === 'saved' ? null : result.message
              })
            }}
            className="font-serif text-[15.5px] leading-[1.45]"
          />
        </span>

        {fact.conflict === null ? null : (
          <div className="flex flex-col gap-[6px]" data-rule-conflict>
            <div className="flex items-start gap-[8px] rounded-chrome border border-note bg-note-bg px-[10px] py-[7px]">
              <span aria-hidden="true" className="flex-none text-11 text-note" style={{ fontFamily: 'var(--font-glyph)' }}>
                ⚠
              </span>
              <span className="flex-1 text-11-5 leading-[1.5]">
                <span className="text-ink3">{formatSceneRef(fact.conflict.scene)} · </span>
                {fact.conflict.note}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRewrite(fact.text)
                  setRewriting((value) => !value)
                }}
                data-update-rule
                className="flex-none whitespace-nowrap rounded-chrome border border-line bg-transparent px-[8px] py-[2px] text-10-5 text-ink2 hover:bg-hover"
              >
                Update rule
              </button>
              <button
                type="button"
                onClick={() => {
                  run(async () => {
                    const result = await decideConflict(projectId, fact.id, { choice: 'rule' })
                    return result.status === 'decided' ? null : result.message
                  })
                }}
                title="Rule is right: leave a note on the scene and decide the conflict"
                data-fix-scene
                className="flex-none whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[8px] py-[2px] text-10-5 text-ink3 hover:bg-hover"
              >
                Fix scene
              </button>
            </div>
            {rewriting ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const text = rewrite.trim()
                  if (text === '') return
                  setRewriting(false)
                  run(async () => {
                    const result = await decideConflict(projectId, fact.id, { choice: 'scene', text })
                    return result.status === 'decided' ? null : result.message
                  })
                }}
                className="flex flex-col gap-[6px]"
                data-rewrite-form
              >
                <textarea
                  autoFocus
                  value={rewrite}
                  onChange={(event) => {
                    setRewrite(event.target.value)
                  }}
                  rows={3}
                  aria-label="The rule, updated"
                  className="w-full rounded-chrome border border-accent-line bg-sheet px-[6px] py-[4px] font-serif text-[15.5px] leading-[1.45] text-ink outline-none"
                />
                <span className="flex gap-[6px]">
                  <button
                    type="submit"
                    className="rounded-chrome border-none bg-ink px-[9px] py-[3px] text-10-5 font-semibold text-desk hover:opacity-90"
                  >
                    Scene is right · update rule
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRewriting(false)
                    }}
                    className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[3px] text-10-5 text-ink2 hover:bg-hover"
                  >
                    Cancel
                  </button>
                </span>
              </form>
            ) : null}
          </div>
        )}

        {recording ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const note = conflictNote.trim()
              if (conflictScene === '' || note === '') return
              setRecording(false)
              setConflictNote('')
              setConflictScene('')
              run(async () => {
                const result = await recordConflict(projectId, fact.id, { sceneNodeId: conflictScene, note })
                return result.status === 'saved' ? null : result.message
              })
            }}
            className="flex flex-col gap-[6px] rounded-chrome border border-line2 bg-sheet p-[8px]"
            data-conflict-form
          >
            <span className="text-10 text-ink3">Which scene contradicts this rule, and how?</span>
            <select
              value={conflictScene}
              onChange={(event) => {
                setConflictScene(event.target.value)
              }}
              aria-label="Contradicting scene"
              className="tabular w-full rounded-chrome border border-line2 bg-sheet px-[6px] py-[4px] text-11 text-ink outline-none"
            >
              <option value="">Pick a scene</option>
              {sceneRefs.map((ref) => (
                <option key={ref.sceneNodeId} value={ref.sceneNodeId}>
                  {formatSceneRef(ref)} · {ref.heading}
                </option>
              ))}
            </select>
            <textarea
              value={conflictNote}
              onChange={(event) => {
                setConflictNote(event.target.value)
              }}
              rows={2}
              placeholder="What the scene says that the rule forbids"
              aria-label="What the scene says that the rule forbids"
              className="w-full rounded-chrome border border-line2 bg-sheet px-[6px] py-[4px] text-11-5 text-ink outline-none placeholder:text-ink3"
            />
            <span className="flex gap-[6px]">
              <button
                type="submit"
                disabled={conflictScene === '' || conflictNote.trim() === ''}
                data-conflict-record
                className="rounded-chrome border-none bg-note px-[9px] py-[3px] text-10-5 font-semibold text-rail disabled:opacity-50"
              >
                Record conflict
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecording(false)
                }}
                className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[3px] text-10-5 text-ink2 hover:bg-hover"
              >
                Cancel
              </button>
            </span>
          </form>
        ) : null}
      </div>

      <div className="flex max-w-[190px] flex-wrap items-start justify-end gap-[4px] pr-[4px]">
        {fact.cites.map((ref) => (
          <span
            key={ref.sceneNodeId}
            data-cite={ref.sceneNodeId}
            title={ref.heading}
            className="inline-flex items-center gap-[4px] whitespace-nowrap rounded-chrome border border-line2 bg-sheet px-[6px] py-[1px] text-10 text-ink2"
          >
            {formatSceneRef(ref)}
            <button
              type="button"
              onClick={() => {
                saveCites(fact.cites.filter((entry) => entry.sceneNodeId !== ref.sceneNodeId).map((entry) => entry.sceneNodeId))
              }}
              aria-label={`Remove the cite ${formatSceneRef(ref)}`}
              className="border-none bg-transparent p-0 text-10 text-ink3 hover:text-del"
            >
              ×
            </button>
          </span>
        ))}
        {fact.cites.length === 0 ? (
          <span
            data-uncited
            className="whitespace-nowrap rounded-chrome border border-dashed border-line px-[6px] py-[1px] text-10 text-ink3"
          >
            not yet on the page
          </span>
        ) : null}
        {citable.length > 0 ? (
          <select
            value=""
            onChange={(event) => {
              if (event.target.value === '') return
              saveCites([...fact.cites.map((entry) => entry.sceneNodeId), event.target.value])
            }}
            aria-label={`Cite a scene for rule ${String(number)}`}
            data-add-cite
            className="tabular max-w-[64px] rounded-chrome border border-transparent bg-transparent px-[2px] py-[1px] text-10 text-ink3 outline-none hover:border-line2"
          >
            <option value="">＋ cite</option>
            {citable.map((ref) => (
              <option key={ref.sceneNodeId} value={ref.sceneNodeId}>
                {formatSceneRef(ref)} · {ref.heading}
              </option>
            ))}
          </select>
        ) : null}
        {fact.conflict === null && !recording && sceneRefs.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setRecording(true)
            }}
            title="Record a conflict with the current draft"
            data-record-conflict
            className="whitespace-nowrap rounded-chrome border border-transparent bg-transparent px-[4px] py-[1px] text-10 text-ink3 hover:border-line2 hover:text-note"
          >
            conflict…
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            run(async () => {
              const result = await removeFact(projectId, fact.id)
              return result.status === 'saved' ? null : result.message
            })
          }}
          aria-label={`Remove rule ${String(number)}`}
          title="Remove this rule"
          className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The Pitch
// ---------------------------------------------------------------------------

const PitchFields = ({
  projectId,
  entryId,
  fields,
  run,
}: {
  readonly projectId: ProjectId
  readonly entryId: BibleEntryView['id']
  readonly fields: readonly BiblePitchFieldRow[]
  readonly run: Run
}) => {
  const [draft, setDraft] = useState('')

  const save = (field: BiblePitchFieldRow, edit: { readonly key: string; readonly value: string }): void => {
    run(async () => {
      const result = await saveField(projectId, field.id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <div className="flex flex-col gap-[10px]" data-pitch-fields>
      <div className="flex items-baseline gap-[8px]">
        <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">One page</span>
        <span className="text-10-5 text-ink3">reads as a document when exported</span>
      </div>
      <div className="flex flex-col border-t border-line">
        {fields.map((field) => (
          <div
            key={field.id}
            data-pitch-field={field.key}
            className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-start gap-[16px] border-b border-line2 py-[12px]"
          >
            <span className="pt-[4px] text-10-5 font-semibold uppercase tracking-[.06em] text-ink3">
              <Editable
                value={field.key}
                placeholder="Field"
                label={`${field.key} field name`}
                onSave={(next) => {
                  if (next === '') return
                  save(field, { key: next, value: field.value })
                }}
                className="uppercase tracking-[.06em]"
              />
            </span>
            <span className="font-serif text-[15.5px] leading-[1.5]" style={{ textWrap: 'pretty' }}>
              <Editable
                value={field.value === '' ? null : field.value}
                placeholder="—"
                label={field.key}
                multiline
                onSave={(next) => {
                  save(field, { key: field.key, value: next })
                }}
                className="font-serif text-[15.5px] leading-[1.5]"
              />
            </span>
            <button
              type="button"
              onClick={() => {
                run(async () => {
                  const result = await removeField(projectId, field.id)
                  return result.status === 'saved' ? null : result.message
                })
              }}
              aria-label={`Remove the ${field.key} field`}
              title="Remove this field"
              className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
            >
              ×
            </button>
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const key = draft.trim()
            if (key === '') return
            setDraft('')
            run(async () => {
              const result = await addField(projectId, entryId, { key, value: '' })
              return result.status === 'saved' ? null : result.message
            })
          }}
          className="py-[10px]"
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            placeholder="Add a field…"
            aria-label="Add a field"
            data-add-field
            className="w-full border-none bg-transparent text-12 text-ink outline-none placeholder:text-ink3"
          />
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------

const Questions = ({
  projectId,
  entryId,
  questions,
  run,
}: {
  readonly projectId: ProjectId
  readonly entryId: BibleEntryView['id']
  readonly questions: readonly BibleQuestionRow[]
  readonly run: Run
}) => {
  const [draft, setDraft] = useState('')

  return (
    <div className="flex flex-col gap-[8px]" data-questions>
      <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Open questions</span>
      {questions.map((question) => (
        <div
          key={question.id}
          data-question={question.id}
          data-resolved={question.resolved ? 'true' : 'false'}
          className="flex items-start gap-[10px] border-b border-line2 py-[8px]"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={question.resolved}
            aria-label={question.resolved ? 'Reopen this question' : 'Mark this question answered'}
            onClick={() => {
              run(async () => {
                const result = await setQuestionResolved(projectId, question.id, !question.resolved)
                return result.status === 'saved' ? null : result.message
              })
            }}
            className={`mt-[4px] grid h-[12px] w-[12px] flex-none place-items-center rounded-[2px] border p-0 text-8 ${
              question.resolved ? 'border-add bg-add text-rail' : 'border-line bg-transparent'
            }`}
          >
            {question.resolved ? '✓' : ''}
          </button>
          <span className={`flex-1 text-13 leading-[1.5] ${question.resolved ? 'text-ink3 line-through' : ''}`}>
            {question.text}
          </span>
          <span className="flex-none text-10-5 text-ink3" title={question.author.name}>
            {question.author.initials}
          </span>
          <button
            type="button"
            onClick={() => {
              run(async () => {
                const result = await removeQuestion(projectId, question.id)
                return result.status === 'saved' ? null : result.message
              })
            }}
            aria-label="Remove this question"
            title="Remove this question"
            className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
          >
            ×
          </button>
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft.trim()
          if (text === '') return
          setDraft('')
          run(async () => {
            const result = await addQuestion(projectId, entryId, { text })
            return result.status === 'saved' ? null : result.message
          })
        }}
        className="py-[6px]"
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          placeholder="Ask a question…"
          aria-label="Ask a question"
          data-add-question
          className="w-full border-none bg-transparent text-12 text-ink outline-none placeholder:text-ink3"
        />
      </form>
    </div>
  )
}
