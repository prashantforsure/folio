import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssistantMessage } from '@folio/contracts'

/**
 * The proposal card - roadmap task 3.3, ADR 0003 **D1**.
 *
 * The card's server actions are mocked; what is held is what the writer sees
 * and what each button asks the server for: the summary and each operation in
 * plain language, before and after, hunks, "can't be undone" said before
 * applying, a confirmation step with the reason, the cost and the balance,
 * the states after, and Undo run. Plus the two pure pieces under it: hunks
 * from a diff, and proposal ids read back from stored tool results so a
 * reloaded chat still shows its cards.
 */

const spies = vi.hoisted(() => ({
  readProposalCard: vi.fn(),
  applyProposal: vi.fn(),
  rejectProposal: vi.fn(),
  undoRun: vi.fn(),
  finishEditorApply: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../lib/agent/actions', () => ({
  readProposalCard: (...args: readonly unknown[]) => spies.readProposalCard(...args),
  applyProposal: (...args: readonly unknown[]) => spies.applyProposal(...args),
  rejectProposal: (...args: readonly unknown[]) => spies.rejectProposal(...args),
  undoRun: (...args: readonly unknown[]) => spies.undoRun(...args),
  finishEditorApply: (...args: readonly unknown[]) => spies.finishEditorApply(...args),
}))
const router = { push: (...args: readonly unknown[]) => spies.push(...args), refresh: () => spies.refresh() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const { ProposalCard } = await import('../app/(app)/_shell/assistant/proposal-card')
const { diffViewOf } = await import('../lib/agent/diff-view')
const { registerEditor } = await import('../lib/agent/editor-channel')
const { visibleMessages } = await import('../lib/assistant/result')

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'
const PROPOSAL = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'
const RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'

const op = (over: Record<string, unknown> = {}) => ({
  id: 'op-1',
  tool: 'update_character',
  description: 'Update MEERA: role',
  status: 'pending',
  mode: 'propose',
  reversible: true,
  failure: null,
  changes: [{ field: 'Role', before: 'A nurse', after: 'A night-shift nurse' }],
  diff: null,
  open: { kind: 'record', projectId: PROJECT, entity: 'character', id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d' },
  ...over,
})

const card = (over: Record<string, unknown> = {}) => ({
  id: PROPOSAL,
  runId: RUN,
  status: 'pending',
  summary: 'Update MEERA: role',
  needsConfirmation: false,
  creditCost: null,
  balance: null,
  confirmReasons: [],
  ops: [op()],
  documents: [],
  ...over,
})

const settle = (status: string, over: Record<string, unknown> = {}) => ({ status, proposal: {}, failure: null, derived: null, ...over })

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(cleanup)

const mount = async (auto = false) => {
  render(<ProposalCard projectId={PROJECT} proposalId={PROPOSAL} auto={auto} />)
  await screen.findByText('waiting for you')
}

describe('ProposalCard', () => {
  it('shows the summary, each operation in plain language, and a record change as before and after', async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card() })
    await mount()
    expect(screen.getAllByText('Update MEERA: role')).toHaveLength(2)
    expect(screen.getByText('A nurse')).toBeTruthy()
    expect(screen.getByText('A night-shift nurse')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it("says an operation can't be undone before it is applied", async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card({ ops: [op({ tool: 'merge_entities', description: 'Merge MEERA into MIRA', reversible: false, changes: [] })] }) })
    await mount()
    expect(document.querySelector('[data-proposal-irreversible]')?.textContent).toContain('can’t be undone')
  })

  it('draws a script change as hunks', async () => {
    const diff = diffViewOf('screenplay', [
      { id: 'a', kind: 'same', type: 'action', typeBefore: null, lines: [{ kind: 'same', text: 'The ward is quiet.' }], moved: false, section: 2 },
      { id: 'b', kind: 'added', type: 'dialogue', typeBefore: null, lines: [{ kind: 'added', text: 'You came back.' }], moved: false, section: 2 },
    ])
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card({ ops: [op({ tool: 'propose_script_edit', description: 'Edit the script', changes: [], diff })] }) })
    await mount()
    expect(screen.getByText('Scene 2')).toBeTruthy()
    expect(document.querySelector('[data-diff-line="added"]')?.textContent).toContain('You came back.')
    expect(screen.getByText('1 added')).toBeTruthy()
  })

  it('applies, then shows the applied state and refreshes the page under it', async () => {
    spies.readProposalCard.mockResolvedValueOnce({ status: 'ok', card: card() }).mockResolvedValue({ status: 'ok', card: card({ status: 'applied', ops: [op({ status: 'applied' })] }) })
    spies.applyProposal.mockResolvedValue(settle('applied'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('applied')
    expect(spies.applyProposal).toHaveBeenCalledWith(PROJECT, PROPOSAL, false, [])
    expect(spies.refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo run' })).toBeTruthy()
  })

  it('shows a failure in the writer’s words and the partly applied state', async () => {
    spies.readProposalCard
      .mockResolvedValueOnce({ status: 'ok', card: card() })
      .mockResolvedValue({ status: 'ok', card: card({ status: 'partially_applied', ops: [op({ status: 'applied' }), op({ id: 'op-2', status: 'failed', failure: 'That character could not be found.' })] }) })
    spies.applyProposal.mockResolvedValue(settle('partially_applied', { failure: 'That character could not be found.' }))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('partly applied')
    expect(screen.getAllByText('That character could not be found.').length).toBeGreaterThan(0)
  })

  it('opens a confirmation step with the reason, the cost and the balance, and applies only on Confirm (D1)', async () => {
    spies.readProposalCard.mockResolvedValue({
      status: 'ok',
      card: card({ needsConfirmation: true, creditCost: null, balance: 120, confirmReasons: ['Rename MEERA to MIRA - rewrites 14 cues in 3 episodes'], ops: [op({ mode: 'confirm' })] }),
    })
    spies.applyProposal.mockResolvedValue(settle('applied'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply' }))
    expect(spies.applyProposal).not.toHaveBeenCalled()
    expect(screen.getByText('Rename MEERA to MIRA - rewrites 14 cues in 3 episodes')).toBeTruthy()
    expect(document.querySelector('[data-proposal-cost]')?.textContent).toBe('Costs no credits. You have 120 credits available.')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(spies.applyProposal).toHaveBeenCalledWith(PROJECT, PROPOSAL, true, []))
  })

  it('will not confirm a paid proposal the balance cannot cover', async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card({ needsConfirmation: true, creditCost: 375, balance: 40, confirmReasons: ['Shoot reel 2'], ops: [op({ mode: 'paid' })] }) })
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply' }))
    expect(document.querySelector('[data-proposal-cost]')?.textContent).toBe('Costs 375 credits. You have 40 credits available.')
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hands a script edit to the open editor, and settles on its report (D10 path A)', async () => {
    const DOC = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
    const calls: string[] = []
    const unregister = registerEditor(DOC, {
      kind: 'screenplay',
      flush: () => {
        calls.push('flush')
        return Promise.resolve()
      },
      apply: (ops, run) => {
        calls.push(`apply:${String(run)}:${JSON.stringify(ops)}`)
        return { ok: true }
      },
    })
    spies.readProposalCard.mockResolvedValueOnce({ status: 'ok', card: card({ documents: [DOC] }) }).mockResolvedValue({ status: 'ok', card: card({ status: 'applied', documents: [DOC] }) })
    spies.applyProposal.mockResolvedValue({ status: 'editor', proposal: {}, derived: null, edits: [{ opId: 'op-1', documentId: DOC, kind: 'screenplay', ops: [{ op: 'delete', ids: ['x'] }], runId: RUN }] })
    spies.finishEditorApply.mockResolvedValue(settle('applied'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('applied')
    expect(spies.applyProposal).toHaveBeenCalledWith(PROJECT, PROPOSAL, false, [DOC])
    expect(calls).toEqual(['flush', `apply:${RUN}:[{"op":"delete","ids":["x"]}]`])
    expect(spies.finishEditorApply).toHaveBeenCalledWith(PROJECT, PROPOSAL, [{ opId: 'op-1', ok: true }])
    unregister()
  })

  it('rejects', async () => {
    spies.readProposalCard.mockResolvedValueOnce({ status: 'ok', card: card() }).mockResolvedValue({ status: 'ok', card: card({ status: 'rejected' }) })
    spies.rejectProposal.mockResolvedValue({ status: 'rejected' })
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await screen.findByText('rejected')
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('opens where the change lands', async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card() })
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(spies.push).toHaveBeenCalledWith(`/app/project/${PROJECT}/characters/9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d`)
  })

  it('undoes the run after a confirmation, and says what could not be undone', async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card({ status: 'applied', ops: [op({ status: 'applied' })] }) })
    spies.undoRun.mockResolvedValue({ status: 'undone', undone: 1, skipped: [{ tool: 'merge_entities', description: 'Merge MEERA into MIRA', reason: 'This cannot be undone.' }], failure: null, proposal: null, notes: [], derived: null })
    render(<ProposalCard projectId={PROJECT} proposalId={PROPOSAL} />)
    await screen.findByText('applied')
    fireEvent.click(screen.getByRole('button', { name: 'Undo run' }))
    expect(spies.undoRun).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-proposal-undo-yes]') as HTMLElement)
    await waitFor(() => expect(spies.undoRun).toHaveBeenCalledWith(PROJECT, RUN))
    expect((await screen.findByText(/Put back 1 change\./)).textContent).toContain('1 could not be undone: Merge MEERA into MIRA.')
  })

  it('applies itself under auto, and never a proposal that asks first', async () => {
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card() })
    spies.applyProposal.mockResolvedValue(settle('applied'))
    await mount(true)
    await waitFor(() => expect(spies.applyProposal).toHaveBeenCalledWith(PROJECT, PROPOSAL, false, []))
    cleanup()
    vi.resetAllMocks()
    spies.readProposalCard.mockResolvedValue({ status: 'ok', card: card({ needsConfirmation: true, confirmReasons: ['Delete MEERA'] }) })
    await mount(true)
    expect(spies.applyProposal).not.toHaveBeenCalled()
  })
})

describe('diffViewOf', () => {
  const entry = (id: string, kind: 'same' | 'added' | 'deleted' | 'changed', section: number, moved = false) => ({
    id,
    kind,
    type: 'action',
    typeBefore: null,
    lines: [{ kind, text: id }],
    moved,
    section,
  })

  it('groups runs of changes with one unchanged entry of context, and merges runs that touch', () => {
    const view = diffViewOf('screenplay', [
      entry('a', 'same', 1),
      entry('b', 'same', 1),
      entry('c', 'added', 1),
      entry('d', 'same', 1),
      entry('e', 'changed', 1),
      entry('f', 'same', 2),
      entry('g', 'same', 2),
      entry('h', 'same', 2),
      entry('i', 'deleted', 3),
    ])
    expect(view.hunks.map((hunk) => hunk.entries.map((row) => row.id).join(''))).toEqual(['bcdef', 'hi'])
    expect(view.hunks.map((hunk) => hunk.section)).toEqual([1, 3])
    expect([view.added, view.changed, view.deleted]).toEqual([1, 1, 1])
  })

  it('counts a moved node once, as changed', () => {
    const view = diffViewOf('screenplay', [entry('m', 'deleted', 1, true), entry('x', 'same', 1), entry('m', 'added', 2, true)])
    expect([view.added, view.deleted, view.changed]).toEqual([0, 0, 1])
  })

  it('has no hunks when nothing changed', () => {
    expect(diffViewOf('outline', [entry('a', 'same', 1)]).hunks).toEqual([])
  })
})

describe('proposal ids on a reloaded chat', () => {
  const message = (role: 'user' | 'assistant', body: string, content: readonly Record<string, unknown>[] | null = null): AssistantMessage =>
    ({ id: `${role}-${body}-${String(Math.random())}`, projectId: PROJECT, chatId: RUN, role, body, content, runId: null, createdAt: '2026-09-23T10:00:00.000Z' }) as AssistantMessage

  it('reads them from the stored tool results and puts them on the answer they were made in', () => {
    const rows = visibleMessages([
      message('user', 'Give Meera a job.'),
      message('assistant', 'I will update her role.', [{ type: 'tool_use', id: 'toolu_1', name: 'update_character', input: {} }]),
      message('user', '', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify({ proposed: true, proposalId: PROPOSAL }) }]),
      message('assistant', 'That is ready for you to review.'),
    ])
    expect(rows.map((row) => row.proposals ?? [])).toEqual([[], [PROPOSAL]])
  })

  it('ignores a tool result that is an error or names no proposal', () => {
    const rows = visibleMessages([
      message('user', 'Rename him.'),
      message('user', '', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'That name is taken.', is_error: true }]),
      message('assistant', 'The name is taken.'),
    ])
    expect(rows.at(-1)?.proposals).toBeUndefined()
  })
})
