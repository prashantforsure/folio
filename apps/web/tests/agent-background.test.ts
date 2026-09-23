// @vitest-environment node
import type { AgentRun, AgentRunStatus, AssistantContent, AssistantMessage, Episode, Project } from '@folio/contracts'
import { assistantChatId, assistantMessageId, episodeId, jobId, projectId, userId } from '@folio/contracts'
import type { ClaimedJob, ProjectScope } from '@folio/db'
import { runId } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ModelClient, ModelMessage } from '../lib/agent/loop'

/**
 * A background run on the worker - roadmap task 4.4, ADR 0003 **D4**, **D5**.
 *
 * The database is an in-memory run and its transcript; the model is scripted.
 * What is held is what D4 and the task promise: the run acts as its starter
 * through the actor gate, re-opened before every step; every step is stored
 * before the next, and a job picks the transcript up where it ends - calls a
 * dead worker left unanswered are answered first, with their own ids; it waits
 * for the writer on a confirmation, and stops for a cancel or a lost
 * membership; a shutdown writes nothing, and a transient model error is thrown
 * for the runtime to retry.
 */

const state = vi.hoisted(() => ({
  run: null as AgentRun | null,
  input: null as unknown,
  messages: [] as AssistantMessage[],
  settled: [] as { status: string; error: string | null }[],
  opens: 0,
  openArgs: [] as unknown[][],
  refuseFrom: Number.POSITIVE_INFINITY,
  used: 0,
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  proposals: [] as { needsConfirmation: boolean }[],
}))

const IDS = vi.hoisted(() => ({
  PROJECT: '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10',
  RUN: '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98',
  CHAT: '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21',
  EPISODE: '1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a',
  WRITER: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  let clock = 0
  const fake: Record<string, (...args: readonly unknown[]) => unknown> = {
    openProjectForWorker: () => Promise.resolve({ projectId: IDS.PROJECT }),
    readBackgroundRun: () => Promise.resolve(state.run === null ? null : { run: state.run, input: state.input }),
    readAgentRun: () => Promise.resolve(state.run),
    beginBackgroundRun: () => {
      if (state.run === null || (state.run.status !== 'queued' && state.run.status !== 'running')) return Promise.resolve(false)
      state.run = { ...state.run, status: 'running' }
      return Promise.resolve(true)
    },
    settleBackgroundRun: (_scope: unknown, _id: unknown, status: unknown, error: unknown) => {
      if (state.run === null || state.run.status !== 'running') return Promise.resolve(false)
      state.run = { ...state.run, status: status as AgentRunStatus, error: error as string | null }
      state.settled.push({ status: status as string, error: error as string | null })
      return Promise.resolve(true)
    },
    readEpisode: () => Promise.resolve({ id: IDS.EPISODE, slug: 'ep_001', title: 'Pilot', ordinal: 1 }),
    sessionDatabase: () => Promise.resolve({}),
    tokensTodayFor: () => Promise.resolve(state.used),
    readAgentAutonomy: () => Promise.resolve('review'),
    listMessages: () => Promise.resolve([...state.messages]),
    appendMessage: (_scope: unknown, chatId: unknown, role: unknown, body: unknown, extras: unknown) => {
      clock += 1
      const message = {
        id: `00000000-0000-4000-8000-${String(clock).padStart(12, '0')}`,
        projectId: IDS.PROJECT,
        chatId,
        role,
        body,
        content: (extras as { content?: AssistantContent | null } | undefined)?.content ?? null,
        runId: IDS.RUN,
        createdAt: `2026-09-23T10:00:${String(clock).padStart(2, '0')}.000Z`,
      } as AssistantMessage
      state.messages.push(message)
      return Promise.resolve(message)
    },
    addAgentRunTokens: () => Promise.resolve(),
    readMentionLabels: () => Promise.resolve([]),
    listCharacterRecords: () => Promise.resolve([]),
  }
  for (const name of Object.keys(fake)) state.db[name] = vi.fn(fake[name])
  return { ...real, ...Object.fromEntries(Object.keys(fake).map((name) => [name, (...args: readonly unknown[]) => state.db[name]?.(...args)])) }
})

vi.mock('../lib/script/actor-gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openEpisodeAs: (...args: readonly unknown[]) => {
    state.opens += 1
    state.openArgs.push([...args])
    if (state.opens >= state.refuseFrom) return Promise.resolve({ status: 'refused', message: 'That script could not be found.' })
    return Promise.resolve({
      actor: IDS.WRITER,
      scope: { projectId: IDS.PROJECT } as ProjectScope,
      project: { id: IDS.PROJECT, title: 'Harbour Lights' } as Project,
      episode: { id: IDS.EPISODE, slug: 'ep_001', title: 'Pilot' } as Episode,
      role: 'writer',
    })
  },
}))
vi.mock('../lib/assistant/turn-context', () => ({ turnSystem: () => Promise.resolve([{ type: 'text', text: 'The script.' }]) }))
vi.mock('../lib/agent/proposer', () => ({
  proposalSink: () => ({
    create: (groups: readonly { readonly ops: readonly { readonly op: { readonly mode: string } }[] }[]) =>
      Promise.resolve(
        groups.map((group, index) => {
          const asks = group.ops.some((entry) => entry.op.mode === 'confirm')
          state.proposals.push({ needsConfirmation: asks })
          return { proposalId: `aaaaaaaa-0000-4000-8000-00000000000${String(index + 1)}`, runId: IDS.RUN, summary: 'A proposal', needsConfirmation: asks, auto: false }
        }),
      ),
    applyNow: () => Promise.resolve({ ok: false, message: 'no' }),
  }),
}))

const { runBackgroundJob, abandonBackgroundJob, NOT_CONNECTED, INTERRUPTED, offeredInBackground } = await import('../lib/agent/background')
const { defineTool, registerTools, registeredTools } = await import('../lib/agent/registry')
const { DAILY_TOKENS_PER_USER } = await import('../lib/agent/limits')

type Step = { readonly text?: string; readonly calls?: readonly { readonly id: string; readonly name: string; readonly input: unknown }[] }

/** A model that answers each call with the next step, and records what it was sent. */
const scripted = (steps: readonly Step[], options: { readonly throwOn?: number; readonly error?: Error; readonly before?: (call: number) => void } = {}) => {
  const sent: Anthropic.MessageStreamParams[] = []
  const client: ModelClient = {
    stream: (params) => {
      sent.push({ ...params, messages: [...params.messages] })
      const call = sent.length
      options.before?.(call)
      const step = steps[call - 1] ?? { text: 'Done.' }
      const content: Anthropic.ContentBlock[] = [
        ...(step.text === undefined ? [] : [{ type: 'text' as const, text: step.text, citations: null }]),
        ...(step.calls ?? []).map((use) => ({ type: 'tool_use' as const, id: use.id, name: use.name, input: use.input, caller: { type: 'direct' as const } })),
      ]
      const message: ModelMessage = {
        content,
        stop_reason: (step.calls ?? []).length > 0 ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
      return {
        [Symbol.asyncIterator]: async function* () {
          if (options.throwOn === call) throw options.error ?? new Error('boom')
          yield* []
        },
        finalMessage: () => Promise.resolve(message),
      }
    },
  }
  return { client, sent }
}

const JOB: ClaimedJob = { id: jobId('20000000-0000-4000-8000-000000000001'), projectId: projectId(IDS.PROJECT), kind: 'agent_run', payload: { runId: IDS.RUN }, createdBy: userId(IDS.WRITER), attempts: 1, cost: 0, lease: 'lease' }

const brief = (body: string): AssistantMessage => ({
  id: assistantMessageId('10000000-0000-4000-8000-000000000001'),
  projectId: projectId(IDS.PROJECT),
  chatId: assistantChatId(IDS.CHAT),
  role: 'user',
  body,
  content: null,
  runId: runId(IDS.RUN),
  createdAt: '2026-09-23T09:59:00.000Z',
})

const job = (client: ModelClient | null, signal: AbortSignal = new AbortController().signal) => runBackgroundJob(JOB, signal, { client })

beforeAll(() => {
  registerTools([
    defineTool({
      name: 'bg_echo',
      description: 'A read tool, for the test.',
      toolset: 'core',
      minimumRole: 'reader',
      mode: 'read',
      input: z.object({}),
      label: () => 'Echoing',
      run: () => Promise.resolve({ ok: true, content: { echoed: true }, summary: 'echoed' }),
    }),
    defineTool({
      name: 'bg_confirm',
      description: 'A confirm tool, for the test.',
      toolset: 'core',
      minimumRole: 'writer',
      mode: 'confirm',
      input: z.object({}),
      label: () => 'Proposing',
      run: (ctx) => {
        ctx.proposals.propose({ tool: 'bg_confirm', args: {}, mode: 'confirm', description: 'Rename ARJUN' })
        return Promise.resolve({ ok: true, content: { proposed: 'Rename ARJUN' }, summary: 'Proposed' })
      },
    }),
  ])
})

beforeEach(() => {
  vi.clearAllMocks()
  state.run = {
    id: runId(IDS.RUN),
    projectId: projectId(IDS.PROJECT),
    episodeId: episodeId(IDS.EPISODE),
    chatId: assistantChatId(IDS.CHAT),
    messageId: null,
    createdBy: userId(IDS.WRITER),
    status: 'queued',
    mode: 'background',
    inputTokens: 0,
    outputTokens: 0,
    creditBudget: 0,
    creditsSpent: 0,
    error: null,
    createdAt: '2026-09-23T09:59:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
  state.input = { kind: 'task', title: 'Count the scenes', task: 'Count the scenes.', route: 'script', scope: 'episode' }
  state.messages = [brief('Count the scenes.')]
  state.settled = []
  state.opens = 0
  state.openArgs = []
  state.refuseFrom = Number.POSITIVE_INFINITY
  state.used = 0
  state.proposals = []
})

describe('a background run, one job', () => {
  it('works the brief to an answer as its starter, stores every step, and settles the run done', async () => {
    const { client, sent } = scripted([{ calls: [{ id: 'toolu_1', name: 'bg_echo', input: {} }] }, { text: 'Two scenes.' }])
    const outcome = await job(client)
    expect(outcome).toEqual({ status: 'finished' })
    expect(state.settled).toEqual([{ status: 'succeeded', error: null }])
    // D4: the gate is the starter's, over the session pooler - opened once up front and again before each of the two steps.
    expect(state.openArgs[0]).toEqual([IDS.WRITER, IDS.PROJECT, 'ep_001', 'reader', 'session'])
    expect(state.opens).toBe(3)
    // Every step stored: the call, its results, the answer.
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(state.messages[2]?.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1' })])
    expect(sent[0]?.messages).toEqual([{ role: 'user', content: 'Count the scenes.' }])
    // The background note is the last system block.
    expect(JSON.stringify(sent[0]?.system)).toContain('You are running in the background')
  })

  it('offers no client tool, and not start_background_task itself', async () => {
    const { client, sent } = scripted([{ text: 'Done.' }])
    await job(client)
    const offered = (sent[0]?.tools ?? []).map((tool) => ('name' in tool ? tool.name : ''))
    expect(offered).not.toContain('navigate')
    expect(offered).not.toContain('start_background_task')
    expect(registeredTools().filter((tool) => tool.mode === 'client').every((tool) => !offeredInBackground(tool))).toBe(true)
  })

  it('resumes from its transcript: the calls a dead worker left unanswered are answered first, with their own ids', async () => {
    state.run = state.run === null ? null : { ...state.run, status: 'running' }
    state.messages.push({
      ...brief(''),
      id: assistantMessageId('10000000-0000-4000-8000-000000000002'),
      role: 'assistant',
      body: '',
      content: [{ type: 'tool_use', id: 'toolu_old', name: 'bg_echo', input: {}, caller: { type: 'direct' } }],
    })
    const { client, sent } = scripted([{ text: 'Two scenes.' }])
    await job(client)
    expect(state.messages[2]?.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_old' })])
    const answered = sent[0]?.messages.at(-1)?.content as Anthropic.ToolResultBlockParam[]
    expect(answered.map((block) => block.tool_use_id)).toEqual(['toolu_old'])
    expect(state.settled).toEqual([{ status: 'succeeded', error: null }])
  })

  it('settles a run that had already answered, without a model call', async () => {
    state.messages.push({ ...brief('Two scenes.'), id: assistantMessageId('10000000-0000-4000-8000-000000000003'), role: 'assistant' })
    const { client, sent } = scripted([])
    expect(await job(client)).toEqual({ status: 'finished' })
    expect(sent).toHaveLength(0)
    expect(state.settled).toEqual([{ status: 'succeeded', error: null }])
  })

  it('waits for the writer when a step writes a proposal only they can confirm', async () => {
    const { client, sent } = scripted([{ calls: [{ id: 'toolu_c', name: 'bg_confirm', input: {} }] }, { text: 'never reached' }])
    expect(await job(client)).toEqual({ status: 'finished' })
    expect(sent).toHaveLength(1)
    expect(state.run?.status).toBe('waiting_for_user')
    expect(state.run?.error).toMatch(/confirm/)
    // The step's results are stored, so the reply picks up after them.
    expect(state.messages.at(-1)?.role).toBe('user')
  })

  it('stops when its starter is no longer a member - the gate re-opened before a step refuses', async () => {
    state.refuseFrom = 3
    const { client } = scripted([{ calls: [{ id: 'toolu_1', name: 'bg_echo', input: {} }] }, { text: 'never reached' }])
    expect(await job(client)).toEqual({ status: 'failed', error: 'That script could not be found.' })
    expect(state.settled).toEqual([{ status: 'failed', error: 'That script could not be found.' }])
  })

  it('stops at the next step when the writer cancels, and leaves the run cancelled', async () => {
    const { client, sent } = scripted([{ calls: [{ id: 'toolu_1', name: 'bg_echo', input: {} }] }, { text: 'never reached' }], {
      // The writer's Cancel lands while the first step runs (`cancelBackgroundRun`).
      before: (call) => {
        if (call === 1 && state.run !== null) state.run = { ...state.run, status: 'cancelled' }
      },
    })
    expect(await job(client)).toEqual({ status: 'cancelled' })
    expect(sent).toHaveLength(1)
    expect(state.run?.status).toBe('cancelled')
    expect(state.settled).toEqual([])
  })

  it('writes nothing on a shutdown: the run stays running for the next claim to resume', async () => {
    const controller = new AbortController()
    const { client } = scripted([{ text: 'Half' }], {
      throwOn: 1,
      error: new Anthropic.APIUserAbortError(),
      before: () => {
        controller.abort('shutdown')
      },
    })
    const outcome = await job(client, controller.signal)
    expect(outcome.status).toBe('failed')
    expect(state.settled).toEqual([])
    expect(state.run?.status).toBe('running')
  })

  it('throws on a transient model error, so the runtime retries the job - and fails on one that is not', async () => {
    const overloaded = scripted([{ text: '' }], { throwOn: 1, error: Anthropic.APIError.generate(529, undefined, 'Overloaded', new Headers()) })
    await expect(job(overloaded.client)).rejects.toThrow()
    expect(state.run?.status).toBe('running')
    const bad = scripted([{ text: '' }], { throwOn: 1, error: Anthropic.APIError.generate(400, undefined, 'Bad request', new Headers()) })
    expect((await job(bad.client)).status).toBe('failed')
    expect(state.run?.status).toBe('failed')
  })

  it('fails with the reason when the worker has no model key', async () => {
    expect(await job(null)).toEqual({ status: 'failed', error: NOT_CONNECTED })
  })

  it('waits for tomorrow when today`s allowance is used, rather than failing', async () => {
    state.used = DAILY_TOKENS_PER_USER
    const { client, sent } = scripted([])
    expect(await job(client)).toEqual({ status: 'finished' })
    expect(sent).toHaveLength(0)
    expect(state.run?.status).toBe('waiting_for_user')
    expect(state.run?.error).toMatch(/allowance/)
  })

  it('does nothing for an old job: a run waiting for the writer, or already cancelled', async () => {
    state.run = state.run === null ? null : { ...state.run, status: 'waiting_for_user' }
    const waiting = scripted([])
    expect(await job(waiting.client)).toEqual({ status: 'finished' })
    expect(waiting.sent).toHaveLength(0)
    state.run = state.run === null ? null : { ...state.run, status: 'cancelled' }
    expect(await job(scripted([]).client)).toEqual({ status: 'cancelled' })
  })

  it('fails as interrupted when the runtime gives up on the job', async () => {
    state.run = state.run === null ? null : { ...state.run, status: 'running' }
    await abandonBackgroundJob(JOB)
    expect(state.settled).toEqual([{ status: 'failed', error: INTERRUPTED }])
  })
})
