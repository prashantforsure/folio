import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunView } from '../lib/agent/runs'

/**
 * The run card (roadmap task 4.4, ADR 0003 **D7**): a background run is
 * polled every two seconds while it is queued or running, and not at all once
 * it is not; it says where the run is in figures code computed; **Open** takes
 * the writer to the run's chat - **Open to reply** when it waits on them - and
 * **Cancel run** stops it; at a story checkpoint **Approve** - the starter's,
 * and the only way one moves on - carries it on. The server actions are mocked.
 */

const spies = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn(), approve: vi.fn() }))

vi.mock('../lib/agent/actions', () => ({
  readBackgroundRunView: (...args: readonly unknown[]) => spies.read(...args),
  cancelBackgroundRunAction: (...args: readonly unknown[]) => spies.cancel(...args),
  approveBackgroundRunAction: (...args: readonly unknown[]) => spies.approve(...args),
}))

const { RunCard, runLine } = await import('../app/(app)/_shell/assistant/run-card')

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'
const RUN = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'
const CHAT = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'

const view = (over: Partial<RunView> = {}): RunView => ({
  id: RUN,
  chatId: CHAT,
  title: 'Draft act two',
  status: 'running',
  note: null,
  steps: 3,
  proposals: { pending: 0, applied: 0, toConfirm: 0 },
  mine: true,
  checkpoint: null,
  startedAt: '2026-09-23T10:00:00.000Z',
  finishedAt: null,
  ...over,
})

/** Let the mocked action's promise settle and React re-render. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  spies.read.mockReset()
  spies.cancel.mockReset()
  spies.approve.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RunCard', () => {
  it('reads the run, then polls it every two seconds while it works, and stops once it is done', async () => {
    spies.read.mockResolvedValueOnce({ status: 'ok', run: view() }).mockResolvedValueOnce({ status: 'ok', run: view({ steps: 5 }) }).mockResolvedValue({ status: 'ok', run: view({ status: 'succeeded', steps: 6 }) })
    render(<RunCard projectId={PROJECT} runId={RUN} title="Draft act two" onOpen={() => undefined} />)
    await settle()
    expect(spies.read).toHaveBeenCalledTimes(1)
    expect(screen.getByText('working · 3 steps')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(spies.read).toHaveBeenCalledTimes(2)
    expect(screen.getByText('working · 5 steps')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.getByText('done · 6 steps')).toBeTruthy()
    // Done: no more reads, however long the card stays on screen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(spies.read).toHaveBeenCalledTimes(3)
  })

  it('says when it waits on the writer, and opens its chat to reply', async () => {
    spies.read.mockResolvedValue({ status: 'ok', run: view({ status: 'waiting_for_user', note: 'Waiting for you to confirm a proposal.', proposals: { pending: 1, applied: 0, toConfirm: 1 } }) })
    const opened: string[] = []
    render(<RunCard projectId={PROJECT} runId={RUN} title="Draft act two" onOpen={(chatId) => opened.push(chatId)} />)
    await settle()
    expect(screen.getByText('waiting for you · 3 steps · 1 proposal to confirm')).toBeTruthy()
    expect(screen.getByText('Waiting for you to confirm a proposal.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open to reply' }))
    expect(opened).toEqual([CHAT])
    // Waiting is not live: nothing polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(spies.read).toHaveBeenCalledTimes(1)
  })

  it('cancels the run, and shows the refusal when the writer may not', async () => {
    spies.read.mockResolvedValue({ status: 'ok', run: view() })
    spies.cancel.mockResolvedValueOnce({ status: 'refused', message: 'Only the person who started this run, or the project’s owner, can stop it.' }).mockResolvedValueOnce({ status: 'ok', run: view({ status: 'cancelled' }) })
    render(<RunCard projectId={PROJECT} runId={RUN} title="Draft act two" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    await settle()
    expect(screen.getByText('Only the person who started this run, or the project’s owner, can stop it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    await settle()
    expect(spies.cancel).toHaveBeenCalledWith(PROJECT, RUN)
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
    expect(screen.getByText('cancelled · 3 steps')).toBeTruthy()
  })

  it('approves a story checkpoint with its own button, and hands the queued run back', async () => {
    const waiting = view({ status: 'waiting_for_user', checkpoint: 'outline', note: 'Waiting for you to review the characters, locations and outline, and approve the outline.' })
    spies.approve.mockResolvedValue({ status: 'ok', run: view({ status: 'queued', checkpoint: null }) })
    const changes: RunView[] = []
    render(<RunCard projectId={PROJECT} runId={RUN} title="Night Ward" run={waiting} onChange={(run) => changes.push(run)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await settle()
    expect(spies.approve).toHaveBeenCalledWith(PROJECT, RUN)
    expect(changes.at(-1)?.status).toBe('queued')
  })

  it('shows the refusal when an approval is refused', async () => {
    spies.approve.mockResolvedValue({ status: 'refused', message: 'This run is not waiting at a checkpoint.' })
    render(<RunCard projectId={PROJECT} runId={RUN} title="Night Ward" run={view({ status: 'waiting_for_user', checkpoint: 'expand' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await settle()
    expect(screen.getByText('This run is not waiting at a checkpoint.')).toBeTruthy()
  })

  it('offers Approve only to the starter, only at a checkpoint', () => {
    const { rerender } = render(<RunCard projectId={PROJECT} runId={RUN} title="Night Ward" run={view({ status: 'waiting_for_user', checkpoint: 'scenes', mine: false })} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    // Waiting on proposals (the bible, the batches), not on an approval.
    rerender(<RunCard projectId={PROJECT} runId={RUN} title="Night Ward" run={view({ status: 'waiting_for_user', checkpoint: null })} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    rerender(<RunCard projectId={PROJECT} runId={RUN} title="Night Ward" run={view({ status: 'waiting_for_user', checkpoint: 'scenes' })} />)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('does not poll a run its caller already reads', async () => {
    render(<RunCard projectId={PROJECT} runId={RUN} title="Draft act two" run={view()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(spies.read).not.toHaveBeenCalled()
    expect(screen.getByText('working · 3 steps')).toBeTruthy()
  })

  it('puts the figures in one line, the queue first', () => {
    expect(runLine(view({ status: 'queued', steps: 0 }))).toBe('queued · waiting for the worker')
    expect(runLine(view({ proposals: { pending: 2, applied: 1, toConfirm: 0 } }))).toBe('working · 3 steps · 2 proposals to review · 1 applied')
  })
})
