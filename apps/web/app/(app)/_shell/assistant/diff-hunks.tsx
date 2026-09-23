'use client'

import type { DiffView, DiffViewKind } from '../../../../lib/agent/diff-view'

/**
 * A proposed script or outline change, drawn as hunks (roadmap task 3.3).
 *
 * The lines are the sheet's own - `diffScreenplays` wraps them the way the
 * page does - so a hunk reads like the page it will change. Added lines are
 * marked `+`, deleted `−` and struck through, changed `~`; a node that moved
 * says so. Colour is the `--ok` / `--live` / `--warn` tokens and nothing else,
 * so it survives a theme switch.
 *
 * It lives beside the panel (`_shell/assistant/`) rather than under the
 * project's `_chrome/`: the panel is mounted app-wide since task 2.2, and a
 * component it draws cannot live under one route's folder.
 */

const MARK: Readonly<Record<DiffViewKind, string>> = { same: ' ', added: '+', deleted: '−', changed: '~' }

const TONE: Readonly<Record<DiffViewKind, string>> = {
  same: 'text-ink3',
  added: 'text-ok',
  deleted: 'text-live line-through',
  changed: 'text-warn',
}

const TYPE_LABEL: Readonly<Record<string, string>> = {
  scene: 'Scene heading',
  action: 'Action',
  character: 'Character',
  paren: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  subtitle: 'Subtitle',
  body: 'Body',
  h1: 'Act',
  h2: 'Heading',
  h3: 'Subheading',
  quote: 'Quote',
  rule: 'Rule',
  beat: 'Beat',
}

const sectionLabel = (view: DiffView, section: number): string =>
  section === 0 ? (view.document === 'screenplay' ? 'Before the first scene' : 'Before the first act') : `${view.document === 'screenplay' ? 'Scene' : 'Act'} ${String(section)}`

export const DiffHunks = ({ view }: { readonly view: DiffView }) => {
  if (view.hunks.length === 0) {
    return <p className="m-0 text-12 text-ink3">No change to the {view.document === 'screenplay' ? 'script' : 'outline'}.</p>
  }
  const counts = [
    view.added > 0 ? `${String(view.added)} added` : null,
    view.changed > 0 ? `${String(view.changed)} changed` : null,
    view.deleted > 0 ? `${String(view.deleted)} deleted` : null,
  ].filter((part) => part !== null)
  return (
    <div data-diff-hunks={view.document} className="flex flex-col gap-[6px]">
      <span className="font-mono text-10-5 text-ink3">{counts.join(' · ')}</span>
      {view.hunks.map((hunk, index) => (
        <div key={`${String(hunk.section)}:${String(index)}`} data-diff-hunk className="overflow-hidden rounded-[8px] border border-line2 bg-sunk">
          <div className="border-b border-line2 px-[8px] py-[3px] font-mono text-10-5 text-ink3">{sectionLabel(view, hunk.section)}</div>
          <div className="flex flex-col py-[4px]">
            {hunk.entries.map((entry, position) => (
              <div key={`${entry.id}:${entry.kind}:${String(position)}`} data-diff-entry={entry.kind} className="flex flex-col px-[8px]">
                {entry.kind === 'same' ? null : (
                  <span className="font-mono text-10 text-ink3">
                    {TYPE_LABEL[entry.type] ?? entry.type}
                    {entry.typeBefore === null ? '' : ` · was ${TYPE_LABEL[entry.typeBefore] ?? entry.typeBefore}`}
                    {entry.moved ? ' · moved' : ''}
                  </span>
                )}
                {entry.lines.map((line, at) => (
                  <span key={String(at)} data-diff-line={line.kind} className={`whitespace-pre-wrap font-mono text-11 leading-[1.5] ${TONE[line.kind]}`}>
                    <span aria-hidden="true" className="mr-[6px] inline-block w-[8px] no-underline">
                      {MARK[line.kind]}
                    </span>
                    {line.text.length === 0 ? ' ' : line.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
