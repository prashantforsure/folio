'use client'

import type { CharacterFinding, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useState } from 'react'

import { checkContradictions, setFindingVerdict } from '../../../../../../lib/characters/model-actions'
import { citeOf } from '../../../../../../lib/characters/figures'
import type { CheckResult } from '../../../../../../lib/characters/result'
import { count } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import { SectionHead } from '../_chrome/drawer-parts'
import type { Run } from '../_chrome/use-run'
import { Section } from './drawer-shell'

/**
 * `Continuity` - the last section before the foot (the rebuild, phase 4):
 * `✦ Check for contradictions` asks the assistant to read the scenes the
 * character is in and return pairs of quotes that cannot both be true of
 * them - the script against itself, never a bible. Each finding is a
 * conflict block with no accept: the claim as the title, the two quotes
 * with linked chips, and `It's deliberate` (`setFindingVerdict`), which is
 * kept as a row so a re-check does not revive it; `N marked deliberate ▾`
 * folds them with `Reopen`. The summary says how many scenes were read and
 * how many answers did not quote the page and were dropped.
 *
 * The findings are state here after a check (the action returns them;
 * nothing revalidates the page under an unsaved draft), seeded from the
 * profile's load. Off the page, or disconnected, the button says why it is
 * off rather than going away.
 */
export const ContinuitySection = ({
  projectId,
  shape,
  characterId,
  onPage,
  assistant,
  findings: initial,
  run,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly characterId: string
  readonly onPage: boolean
  readonly assistant: boolean
  readonly findings: readonly CharacterFinding[]
  readonly run: Run
}) => {
  const [findings, setFindings] = useState<readonly CharacterFinding[]>(initial)
  const [checking, setChecking] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deliberateOpen, setDeliberateOpen] = useState(false)
  const open = findings.filter((finding) => finding.status === 'open')
  const deliberate = findings.filter((finding) => finding.status === 'deliberate')
  const disabled = !onPage ? 'Not on the page yet - nothing to check.' : !assistant ? 'The assistant is not connected.' : null

  const check = (): void => {
    setChecking(true)
    setNotice(null)
    run(async () => {
      const result: CheckResult = await checkContradictions(projectId, characterId)
      setChecking(false)
      if (result.status === 'checked') {
        setFindings(result.findings)
        const opened = result.findings.filter((finding) => finding.status === 'open').length
        const scenes = result.shown < result.total ? `${count(result.shown)} of ${count(result.total)} scenes` : `${count(result.total)} ${result.total === 1 ? 'scene' : 'scenes'}`
        setSummary(
          `Checked ${scenes} · ${opened === 0 ? 'nothing contradicts' : `${count(opened)} ${opened === 1 ? 'finding' : 'findings'}`}${result.dropped > 0 ? ` · ${count(result.dropped)} dropped: ${result.dropped === 1 ? 'it' : 'they'} did not quote the page` : ''}`,
        )
        return null
      }
      if (result.status === 'nothing') {
        setSummary(result.message)
        return null
      }
      setNotice(result.message)
      return result.message
    })
  }

  const verdict = (finding: CharacterFinding, status: 'open' | 'deliberate'): void => {
    run(async () => {
      const result = await setFindingVerdict(projectId, finding.id, status)
      if (result.status !== 'set') {
        setNotice(result.message)
        return result.message
      }
      setFindings((current) => current.map((entry) => (entry.id === finding.id ? result.finding : entry)))
      return null
    })
  }

  const Quote = ({ side }: { readonly side: CharacterFinding['a'] }) => {
    const cite = citeOf(projectId, shape, side.ref)
    return (
      <span className="flex min-w-0 items-start gap-[6px]">
        <Link href={cite.href} data-cite-link className="folio-cite flex-none no-underline hover:border-accent hover:text-accent hover:no-underline">
          {cite.label}
        </Link>
        <span className="min-w-0 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
          “{side.quote}”
        </span>
      </span>
    )
  }

  return (
    <Section>
      <SectionHead label="Continuity">
        <span className="text-11 text-ink3">from the script</span>
      </SectionHead>
      <span className="text-11 leading-[1.45] text-ink3">The script against itself. Nothing is written back.</span>
      <button
        type="button"
        data-check-contradictions
        data-check-state={checking ? 'checking' : 'idle'}
        disabled={checking || disabled !== null}
        title={disabled ?? 'Read the scenes this character is in and list the lines that cannot both be true'}
        onClick={check}
        className="folio-line-button flex h-[30px] w-full items-center justify-center gap-[6px] rounded-[9px] text-12 disabled:cursor-default disabled:opacity-50"
      >
        <span className="folio-mark text-accent">✦</span>
        {checking ? 'Checking…' : 'Check for contradictions'}
      </button>
      {disabled !== null && !onPage ? (
        <span className="text-11 text-ink3" data-continuity="off-page">
          Not on the page yet
        </span>
      ) : null}
      {summary === null ? null : (
        <span className="text-11 text-ink3" data-check-summary>
          {summary}
        </span>
      )}
      {notice === null ? null : (
        <span className="text-11 text-live" role="alert">
          {notice}
        </span>
      )}
      {open.length === 0 ? null : (
        <div className="flex flex-col gap-[8px]" data-findings={open.length}>
          {open.map((finding) => (
            <div key={finding.id} data-finding={finding.id}>
              <ConflictBlock
                title={finding.claim}
                busy={false}
                onDeliberate={() => {
                  verdict(finding, 'deliberate')
                }}
              >
                <span className="mt-[4px] flex flex-col gap-[4px]">
                  <Quote side={finding.a} />
                  <Quote side={finding.b} />
                </span>
              </ConflictBlock>
            </div>
          ))}
        </div>
      )}
      {deliberate.length === 0 ? null : (
        <div className="flex flex-col gap-[6px]" data-findings-deliberate={deliberate.length}>
          <button
            type="button"
            aria-expanded={deliberateOpen}
            onClick={() => {
              setDeliberateOpen((value) => !value)
            }}
            className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
          >
            {count(deliberate.length)} marked deliberate {deliberateOpen ? '▴' : '▾'}
          </button>
          {deliberateOpen
            ? deliberate.map((finding) => (
                <div key={finding.id} data-finding={finding.id} data-finding-status="deliberate" className="flex flex-col gap-[4px] rounded-[9px] border border-line2 px-[10px] py-[8px]">
                  <span className="text-12 text-ink2" style={{ textWrap: 'pretty' }}>
                    {finding.claim}
                  </span>
                  <Quote side={finding.a} />
                  <Quote side={finding.b} />
                  <button
                    type="button"
                    data-finding-reopen
                    onClick={() => {
                      verdict(finding, 'open')
                    }}
                    className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
                  >
                    Reopen
                  </button>
                </div>
              ))
            : null}
        </div>
      )}
    </Section>
  )
}
