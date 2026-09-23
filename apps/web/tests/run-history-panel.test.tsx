import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HistoryRun } from '../lib/agent/history'

/**
 * The panel's History tab (roadmap task 5.4): both states - the runs, and
 * the sentence when there are none - each run's tokens and credits, its
 * operations with an Open to what they changed, and Undo run, which says what
 * it put back in the proposal card's words and reads the history again.
 * The server actions and the router are mocked.
 */

const spies = vi.hoisted(() => ({ read: vi.fn(), undo: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

vi.mock('../lib/agent/actions', () => ({
  readRunHistory: (...args: readonly unknown[]) => spies.read(...args),
  undoRun: (...args: readonly unknown[]) => spies.undo(...args),
  applyProposal: vi.fn(),
  finishEditorApply: vi.fn(),
  readProposalCard: vi.fn(),
  rejectProposal: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: spies.push, refresh: spies.refresh }) }))

const { RunHistory } = await import('../app/(app)/_shell/assistant/run-history')

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'

const history = (over: Partial<HistoryRun> = {}): HistoryRun => ({
  id: 'r1',
  title: 'Add Meera to the cast',
  mode: 'interactive',
  kind: 'turn',
  status: 'succeeded',
  note: null,
  chatId: 'c1',
  episode: 'ep_001' as HistoryRun['episode'],
  createdAt: new Date().toISOString(),
  finishedAt: null,
  tokens: { input: 9_000, output: 1_400 },
  credits: { budget: 415, spent: 40 },
  proposals: [
    {
      id: 'p1',
      status: 'applied',
      summary: 'Create the character MEERA',
      creditCost: null,
      ops: [{ id: 'o1', tool: 'create_character', description: 'Create the character MEERA', mode: 'propose', status: 'applied', open: { kind: 'record', projectId: PROJECT as never, entity: 'character', id: 'm1' }, appliedAt: null, undoneAt: null }],
    },
  ],
  undoable: true,
  ...over,
})

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  spies.read.mockReset()
  spies.undo.mockReset()
  spies.push.mockReset()
  spies.refresh.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RunHistory', () => {
  it('says there is nothing yet, and what will be there', async () => {
    spies.read.mockResolvedValue({ status: 'ok', runs: [] })
    render(<RunHistory projectId={PROJECT as never} onOpenChat={vi.fn()} />)
    await settle()
    expect(screen.getByText(/No runs yet\./u)).toBeTruthy()
  })

  it('lists a run with its figures and operations, and opens what an operation changed', async () => {
    spies.read.mockResolvedValue({ status: 'ok', runs: [history()] })
    const onOpenChat = vi.fn()
    const { container } = render(<RunHistory projectId={PROJECT as never} onOpenChat={onOpenChat} />)
    await settle()
    expect(container.querySelector('[data-history-title]')?.textContent).toBe('Add Meera to the cast')
    expect(container.querySelector('[data-history-figures]')?.textContent).toBe('10.4k tokens · 40 of 415 credits')
    expect(container.querySelector('[data-history-op="applied"]')?.textContent).toContain('Create the character MEERA · applied')
    fireEvent.click(container.querySelector('[data-history-open]') as Element)
    expect(spies.push).toHaveBeenCalledWith(`/app/project/${PROJECT}/characters/m1`)
    fireEvent.click(container.querySelector('[data-history-chat]') as Element)
    expect(onOpenChat).toHaveBeenCalledWith('c1', 'ep_001')
  })

  it('undoes a run, says what it put back, and reads the history again', async () => {
    spies.read.mockResolvedValueOnce({ status: 'ok', runs: [history()] }).mockResolvedValueOnce({ status: 'ok', runs: [history({ undoable: false })] })
    spies.undo.mockResolvedValue({ status: 'undone', undone: 1, skipped: [], failure: null, proposal: null, notes: [], derived: null })
    const { container } = render(<RunHistory projectId={PROJECT as never} onOpenChat={vi.fn()} />)
    await settle()
    fireEvent.click(container.querySelector('[data-history-undo]') as Element)
    await settle()
    expect(spies.undo).toHaveBeenCalledWith(PROJECT, 'r1')
    expect(container.querySelector('[data-history-undone]')?.textContent).toBe('Put back 1 change.')
    expect(spies.read).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-history-undo]')).toBeNull()
  })
})
