'use client'

import type { GlossaryRow, ProjectId } from '@folio/contracts'
import { Editable } from '@folio/ui'
import { useState } from 'react'

import { addTerm, removeTerm, saveTerm } from '../../../../../../lib/bible/actions'
import { FEW_USES } from '../../../../../../lib/bible/figures'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { Run } from './bible-workspace'

/**
 * The glossary: term, meaning, first said, uses. `Route - Bible.dc.html`,
 * `isGlossary`: the sentence, then the table on `--panel` with its four
 * columns - `150px · 1fr · 90px · 60px` - the term in 15px Newsreader, the
 * meaning in 12px `--ink2`, and the uses in `--note` under four.
 *
 * The term and its meaning are authored, in place. `First said` and `Uses`
 * are derived - `termUsage` over the script, whole-word and
 * case-insensitive, comments never counted - and are never stored, so a
 * term the script does not say yet reads `—` and `0` and turns amber, the
 * bundle's "terms used once may need a second landing".
 */

const GRID = 'grid grid-cols-[150px_minmax(0,1fr)_90px_60px_auto] items-start gap-[12px] px-[14px]'

export const Glossary = ({
  projectId,
  rows,
  run,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly GlossaryRow[]
  readonly run: Run
}) => {
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')

  const save = (row: GlossaryRow, edit: { readonly term: string; readonly definition: string }): void => {
    run(async () => {
      const result = await saveTerm(projectId, row.id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-glossary data-term-count={rows.length}>
      <div className="flex max-w-[820px] flex-col gap-[12px]">
        <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
          Words the audience has to learn. Each shows where it is first said and how often it recurs; terms used once
          may need a second landing.
        </p>
        <div className="overflow-hidden rounded-chrome border border-line bg-panel">
          <div className={`${GRID} items-center border-b border-line py-[9px] text-9-5 font-semibold uppercase tracking-label text-ink3`}>
            <span>Term</span>
            <span>Meaning in this story</span>
            <span>First said</span>
            <span>Uses</span>
            <span />
          </div>
          {rows.map((row) => (
            <div key={row.id} data-term={row.term} className={`${GRID} border-b border-line2 py-[10px] hover:bg-hover`}>
              <span className="font-serif text-15 font-medium leading-[1.3]">
                <Editable
                  value={row.term}
                  placeholder="Term"
                  label={`${row.term} term`}
                  onSave={(next) => {
                    if (next === '') return
                    save(row, { term: next, definition: row.definition })
                  }}
                  className="font-serif text-15 font-medium leading-[1.3]"
                />
              </span>
              <span className="text-12 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                <Editable
                  value={row.definition === '' ? null : row.definition}
                  placeholder="What it means here"
                  label={`${row.term} meaning`}
                  multiline
                  onSave={(next) => {
                    save(row, { term: row.term, definition: next })
                  }}
                  className="text-12 leading-[1.5] text-ink2"
                />
              </span>
              <span className="tabular pt-[2px] text-11 text-ink2" data-first-said>
                {row.firstSaid === null ? '—' : formatSceneRef(row.firstSaid)}
              </span>
              <span className={`tabular pt-[2px] text-11 ${row.uses < FEW_USES ? 'text-note' : 'text-ink'}`} data-uses>
                {row.uses}
              </span>
              <button
                type="button"
                onClick={() => {
                  run(async () => {
                    const result = await removeTerm(projectId, row.id)
                    return result.status === 'saved' ? null : result.message
                  })
                }}
                aria-label={`Remove the term ${row.term}`}
                title="Remove this term"
                className="rounded-chrome border-none bg-transparent px-[4px] text-11 text-ink3 hover:bg-hover hover:text-del"
              >
                ×
              </button>
            </div>
          ))}
          {rows.length === 0 ? (
            <div className="px-[14px] py-[10px] text-11-5 text-ink3" data-no-terms>
              No terms yet. Add the first word the audience has to learn.
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const next = term.trim()
              if (next === '') return
              const meaning = definition.trim()
              setTerm('')
              setDefinition('')
              run(async () => {
                const result = await addTerm(projectId, { term: next, definition: meaning })
                return result.status === 'saved' ? null : result.message
              })
            }}
            className={`${GRID} py-[10px]`}
            data-add-term-form
          >
            <input
              type="text"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value)
              }}
              placeholder="Add a term…"
              aria-label="Add a term"
              data-add-term
              className="w-full border-none bg-transparent font-serif text-15 text-ink outline-none placeholder:font-sans placeholder:text-12 placeholder:text-ink3"
            />
            <input
              type="text"
              value={definition}
              onChange={(event) => {
                setDefinition(event.target.value)
              }}
              placeholder="What it means here"
              aria-label="What the term means"
              data-add-term-definition
              className="w-full border-none bg-transparent text-12 text-ink outline-none placeholder:text-ink3"
            />
            <span />
            <span />
            <button
              type="submit"
              disabled={term.trim() === ''}
              className="rounded-chrome border border-line2 bg-transparent px-[8px] py-[2px] text-10-5 text-ink2 hover:bg-hover disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
