import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'

/**
 * The app-wide assistant (roadmap task 2.2).
 *
 * The Playwright walk (`e2e/assistant-panel.spec.ts`) proves it against the
 * real app and needs an account; this proves the host's own rules with the
 * server actions mocked: outside a project it draws the launcher, inside one
 * the chat panel, and closing the panel or leaving the project **hides** it
 * rather than unmounting it - so the turns on screen, and the draft in the
 * session store, are still there when it comes back.
 */

const spies = vi.hoisted(() => ({
  listAssistantChats: vi.fn(),
  openAssistantChat: vi.fn(),
  startAssistantChat: vi.fn(),
  listRecentProjects: vi.fn(),
  startStoryProject: vi.fn(),
  push: vi.fn(),
  continueRun: vi.fn(),
}))

vi.mock('../lib/assistant/actions', () => ({
  listAssistantChats: (...args: readonly unknown[]) => spies.listAssistantChats(...args),
  openAssistantChat: (...args: readonly unknown[]) => spies.openAssistantChat(...args),
  startAssistantChat: (...args: readonly unknown[]) => spies.startAssistantChat(...args),
}))
// The proposal card's actions (roadmap task 3.3) - server actions, never run here.
vi.mock('../lib/agent/actions', () => ({
  applyProposal: vi.fn(),
  readProposalCard: vi.fn(),
  rejectProposal: vi.fn(),
  undoRun: vi.fn(),
  // A background run's card and its reply (roadmap task 4.4).
  readBackgroundRunView: vi.fn(),
  cancelBackgroundRunAction: vi.fn(),
  approveBackgroundRunAction: vi.fn(),
  continueBackgroundRunAction: (...args: readonly unknown[]) => spies.continueRun(...args),
}))
vi.mock('../lib/projects/actions', () => ({
  listRecentProjects: () => spies.listRecentProjects(),
  startStoryProject: (...args: readonly unknown[]) => spies.startStoryProject(...args),
}))
const router = { push: (...args: readonly unknown[]) => spies.push(...args), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { readonly href: string; readonly children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { AssistantHost } = await import('../app/(app)/_shell/assistant/assistant-host')
const { publishAssistantProject } = await import('../lib/assistant/project-cell')
const { EphemeralProvider } = await import('../lib/state/ephemeral')
const { assistantChatKey, useSession } = await import('../lib/state/session')

const PROJECT_A = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10' as ProjectId
const CHAT = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'

const inside = (projectId: ProjectId) => ({
  projectId,
  shape: 'collapsed' as const,
  episode: 'ep_001' as EpisodeSlug,
  episodeCount: 1,
  reading: null,
  section: 'writing' as const,
  route: 'script' as const,
})

const host = () =>
  render(
    <EphemeralProvider>
      <AssistantHost connected />
    </EphemeralProvider>,
  )

beforeEach(() => {
  useSession.setState({ assistantOpen: true, assistantChats: {}, assistantDraft: '', assistantPending: null })
  spies.listAssistantChats.mockResolvedValue({ status: 'ok', chats: [] })
  spies.listRecentProjects.mockResolvedValue({
    status: 'ok',
    projects: [{ id: PROJECT_A, title: 'Harbour Lights', kind: 'Screenwriting · Film', stats: '12 scenes · 18pp' }],
  })
  spies.openAssistantChat.mockResolvedValue({
    status: 'ok',
    chat: { id: CHAT, title: 'Who is Meera?', updatedAt: '2026-09-23T10:00:00.000Z' },
    messages: [
      { id: 'm1', role: 'user', body: 'Who is Meera?', createdAt: '2026-09-23T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', body: 'The harbourmaster, first seen in Scene 2.', createdAt: '2026-09-23T10:00:01.000Z' },
    ],
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    publishAssistantProject(null)
  })
  vi.clearAllMocks()
})

describe('outside a project', () => {
  it('draws the launcher: recent projects as links, and Start from a story', async () => {
    host()
    const link = await screen.findByText('Harbour Lights')
    expect(link.closest('a')?.getAttribute('href')).toBe(`/app/project/${PROJECT_A}`)
    expect(screen.getByRole('button', { name: /Start from a story/u }).hasAttribute('disabled')).toBe(false)
    // No composer: the launcher runs no model turn (ruled 2026-09-23).
    expect(screen.queryByLabelText('Ask the assistant')).toBeNull()
  })

  it('starts a project from a story only after a confirmation, then opens it with the story waiting (task 3.6)', async () => {
    spies.startStoryProject.mockResolvedValue({ status: 'created', projectId: PROJECT_A, title: 'Tide Line', href: `/app/project/${PROJECT_A}/script` })
    host()
    fireEvent.click(await screen.findByRole('button', { name: /Start from a story/u }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tide Line' } })
    fireEvent.change(screen.getByLabelText('The story'), { target: { value: 'A lighthouse keeper finds a letter.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // The confirmation names what will be made; nothing has been created yet.
    expect(screen.getByText(/Create “Tide Line”, a film/u)).toBeTruthy()
    expect(spies.startStoryProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(spies.push).toHaveBeenCalledWith(`/app/project/${PROJECT_A}/script`))
    expect(spies.startStoryProject).toHaveBeenCalledWith({ title: 'Tide Line', projectType: 'film', format: 'hollywood', story: 'A lighthouse keeper finds a letter.' })
    expect(useSession.getState().assistantPending).toEqual({ projectId: PROJECT_A, message: 'A lighthouse keeper finds a letter.' })
  })

  it('puts the waiting story in the composer inside the new project when no assistant is connected', async () => {
    useSession.setState({ assistantPending: { projectId: PROJECT_A, message: 'A lighthouse keeper finds a letter.' } })
    render(
      <EphemeralProvider>
        <AssistantHost connected={false} />
      </EphemeralProvider>,
    )
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    await waitFor(() => expect(useSession.getState().assistantDraft).toBe('A lighthouse keeper finds a letter.'))
    expect(useSession.getState().assistantPending).toBeNull()
  })
})

describe('inside a project', () => {
  it('reopens the chat the session store remembers for this episode', async () => {
    useSession.setState({ assistantChats: { [assistantChatKey(PROJECT_A, 'ep_001')]: CHAT } })
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    host()
    expect(await screen.findByText(/The harbourmaster/u)).toBeTruthy()
    expect(spies.openAssistantChat).toHaveBeenCalledWith(PROJECT_A, 'ep_001', CHAT)
  })

  it('hides the panel on close and keeps its turns and draft in place', async () => {
    useSession.setState({ assistantChats: { [assistantChatKey(PROJECT_A, 'ep_001')]: CHAT } })
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    const { container } = host()
    await screen.findByText(/The harbourmaster/u)
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'And her brother?' } })

    act(() => {
      useSession.getState().setAssistantOpen(false)
    })
    const panel = container.querySelector('[data-assistant-panel]')
    expect(panel).not.toBeNull()
    expect(panel?.hasAttribute('hidden')).toBe(true)

    act(() => {
      useSession.getState().setAssistantOpen(true)
    })
    expect(container.querySelector('[data-assistant-panel]')?.hasAttribute('hidden')).toBe(false)
    expect(screen.getByText(/The harbourmaster/u)).toBeTruthy()
    expect((screen.getByLabelText('Ask the assistant') as HTMLTextAreaElement).value).toBe('And her brother?')
    // Read once: showing it again is not a reload.
    expect(spies.openAssistantChat).toHaveBeenCalledTimes(1)
  })

  it('keeps the chat mounted and hidden while the launcher shows, and shows it again on return', async () => {
    useSession.setState({ assistantChats: { [assistantChatKey(PROJECT_A, 'ep_001')]: CHAT } })
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    const { container } = host()
    await screen.findByText(/The harbourmaster/u)

    act(() => {
      publishAssistantProject(null)
    })
    await waitFor(() => {
      expect(container.querySelector('[data-assistant-launcher]')).not.toBeNull()
    })
    const chat = container.querySelector('[data-assistant-panel]:not([data-assistant-launcher])')
    expect(chat?.hasAttribute('hidden')).toBe(true)

    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    await waitFor(() => {
      expect(container.querySelector('[data-assistant-launcher]')).toBeNull()
    })
    expect(screen.getByText(/The harbourmaster/u)).toBeTruthy()
    expect(spies.openAssistantChat).toHaveBeenCalledTimes(1)
  })

  it('keeps an open conversation when the page moves to another episode of the same project', async () => {
    // Roadmap task 2.5: the agent's `navigate` can take the writer to another
    // episode's scene mid-answer; the answer they were reading stays.
    useSession.setState({ assistantChats: { [assistantChatKey(PROJECT_A, 'ep_001')]: CHAT } })
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
    host()
    await screen.findByText(/The harbourmaster/u)
    act(() => {
      publishAssistantProject({ ...inside(PROJECT_A), episode: 'ep_002' as EpisodeSlug })
    })
    await waitFor(() => {
      expect(spies.listAssistantChats).toHaveBeenCalledWith(PROJECT_A, 'ep_002')
    })
    expect(screen.getByText(/The harbourmaster/u)).toBeTruthy()
    expect(spies.openAssistantChat).toHaveBeenCalledTimes(1)
  })

  it('toggles open and closed with ⌘J from anywhere', () => {
    useSession.setState({ assistantOpen: false })
    host()
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
    expect(useSession.getState().assistantOpen).toBe(true)
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(useSession.getState().assistantOpen).toBe(false)
  })
})

describe('a background run`s own chat (roadmap task 4.4)', () => {
  const RUN = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'
  const runView = (over: Record<string, unknown> = {}) => ({
    id: RUN,
    chatId: CHAT,
    title: 'Draft act two',
    status: 'running',
    note: null,
    steps: 2,
    proposals: { pending: 0, applied: 0, toConfirm: 0 },
    mine: true,
    checkpoint: null,
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: null,
    ...over,
  })
  const runChat = (run: ReturnType<typeof runView>) => ({
    status: 'ok',
    chat: { id: CHAT, title: 'Draft act two', updatedAt: '2026-09-23T10:00:00.000Z' },
    messages: [{ id: 'm1', role: 'user', body: 'Draft act two.', createdAt: '2026-09-23T10:00:00.000Z' }],
    run,
  })
  const flush = async (ms = 0): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    useSession.setState({ assistantChats: { [assistantChatKey(PROJECT_A, 'ep_001')]: CHAT } })
    act(() => {
      publishAssistantProject(inside(PROJECT_A))
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns the composer off while the run works, re-reads the chat every two seconds, and sends the reply as the run`s continuation', async () => {
    spies.openAssistantChat.mockResolvedValueOnce(runChat(runView())).mockResolvedValue(runChat(runView({ status: 'waiting_for_user', note: 'Waiting for you to confirm a proposal.' })))
    spies.continueRun.mockResolvedValue({ status: 'ok', run: runView({ status: 'queued' }) })
    host()
    await flush()
    const composer = screen.getByLabelText('Ask the assistant') as HTMLTextAreaElement
    expect(composer.disabled).toBe(true)
    expect(composer.placeholder).toMatch(/The run is working/u)
    expect(document.querySelector('[data-chat-run] [data-run-card]')?.getAttribute('data-run-status')).toBe('running')

    await flush(2_000)
    expect(spies.openAssistantChat).toHaveBeenCalledTimes(2)
    // Waiting for its starter, who is reading: the composer replies to the run.
    expect(composer.disabled).toBe(false)
    expect(composer.placeholder).toMatch(/Reply to the run/u)
    expect(screen.getByText('Waiting for you to confirm a proposal.')).toBeTruthy()

    fireEvent.change(composer, { target: { value: 'Go on to act three.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()
    expect(spies.continueRun).toHaveBeenCalledWith(PROJECT_A, RUN, 'Go on to act three.')
    expect(screen.getByText('Go on to act three.')).toBeTruthy()
    // Queued again: working, so the composer is off until it waits or ends.
    expect(composer.disabled).toBe(true)
  })

  it('sends nothing on an empty reply at a story checkpoint, and offers Approve on the card', async () => {
    spies.openAssistantChat.mockResolvedValue(runChat(runView({ status: 'waiting_for_user', checkpoint: 'expand' })))
    host()
    await flush()
    const composer = screen.getByLabelText('Ask the assistant') as HTMLTextAreaElement
    expect(composer.disabled).toBe(false)
    expect(composer.placeholder).toMatch(/press Approve/u)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(composer, { key: 'Enter' })
    await flush()
    expect(spies.continueRun).not.toHaveBeenCalled()
    expect(document.querySelector('[data-chat-run] [data-run-approve]')).not.toBeNull()
    // Words still go: they ask the stage again.
    spies.continueRun.mockResolvedValue({ status: 'ok', run: runView({ status: 'queued' }) })
    fireEvent.change(composer, { target: { value: 'Make it a comedy.' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await flush()
    expect(spies.continueRun).toHaveBeenCalledWith(PROJECT_A, RUN, 'Make it a comedy.')
  })

  it('does not let anyone but its starter reply - the run acts as them', async () => {
    spies.openAssistantChat.mockResolvedValue(runChat(runView({ status: 'waiting_for_user', mine: false })))
    host()
    await flush()
    const composer = screen.getByLabelText('Ask the assistant') as HTMLTextAreaElement
    expect(composer.disabled).toBe(true)
    expect(composer.placeholder).toMatch(/Only the person who started this run/u)
  })

  it('is an ordinary chat once the run is over', async () => {
    spies.openAssistantChat.mockResolvedValue(runChat(runView({ status: 'succeeded' })))
    host()
    await flush()
    const composer = screen.getByLabelText('Ask the assistant') as HTMLTextAreaElement
    expect(composer.disabled).toBe(false)
    expect(composer.placeholder).toBe('Ask, or @ to add context…')
    await flush(10_000)
    expect(spies.openAssistantChat).toHaveBeenCalledTimes(1)
  })
})
