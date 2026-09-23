// @vitest-environment node
import type { AgentEvent, AssistantContent, Episode, Project, UserId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { RunId } from '@folio/script'
import type { ModelMessage } from '../lib/agent/loop'
import Anthropic from '@anthropic-ai/sdk'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * The agent loop (roadmap task 2.3), against a scripted model client.
 *
 * No network and no database: the client is a list of the messages the model
 * "returns", step by step, and the two writes are arrays. What is asserted is
 * what the loop promises - that a tool error goes back to the model as an
 * error it can recover from, that the step, time and token caps each stop the
 * turn (the first two with a summary call that may not use a tool, the third
 * without one), and that what was stored would replay.
 */

const spies = vi.hoisted(() => ({ listSceneIndex: vi.fn() }))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  listSceneIndex: (...args: readonly unknown[]) => spies.listSceneIndex(...args),
}))

const { MAX_STEPS, REFUSAL_NOTE, runAgentLoop } = await import('../lib/agent/loop')
const { defineTool, registerTools } = await import('../lib/agent/registry')
await import('../lib/agent/tools')
const { ROLE_REFUSED } = await import('../lib/auth/roles')

type Step = {
  readonly text?: string
  readonly calls?: readonly { readonly id: string; readonly name: string; readonly input: unknown }[]
  readonly stop?: Anthropic.StopReason
  readonly usage?: { readonly input: number; readonly output: number }
}

/** A client that answers each call with the next scripted step, and records what it was sent. */
const scripted = (steps: readonly Step[] | ((call: number) => Step), options: { readonly throwOn?: number; readonly error?: Error } = {}) => {
  const sent: Anthropic.MessageStreamParams[] = []
  const client = {
    stream: (params: Anthropic.MessageStreamParams) => {
      // The loop mutates its own array; keep a copy as it was at this call.
      sent.push({ ...params, messages: [...params.messages] })
      const call = sent.length
      const step = typeof steps === 'function' ? steps(call) : steps[call - 1]
      if (step === undefined) throw new Error(`No step scripted for call ${String(call)}`)
      const content: Anthropic.ContentBlock[] = [
        ...(step.text === undefined ? [] : [{ type: 'text' as const, text: step.text, citations: null }]),
        ...(step.calls ?? []).map((use) => ({ type: 'tool_use' as const, id: use.id, name: use.name, input: use.input, caller: { type: 'direct' as const } })),
      ]
      const message: ModelMessage = {
        content,
        stop_reason: step.stop ?? ((step.calls ?? []).length > 0 ? 'tool_use' : 'end_turn'),
        usage: { input_tokens: step.usage?.input ?? 10, output_tokens: step.usage?.output ?? 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
      return {
        async *[Symbol.asyncIterator]() {
          if (step.text !== undefined) {
            // Two deltas, so the stream really is incremental.
            const half = Math.ceil(step.text.length / 2)
            for (const piece of [step.text.slice(0, half), step.text.slice(half)]) {
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } as Anthropic.MessageStreamEvent
            }
          }
          if (options.throwOn === call) throw options.error ?? new Error('boom')
        },
        finalMessage: () => Promise.resolve(message),
      }
    },
  }
  return { client, sent }
}

const SCOPE = {} as ProjectScope
const gate = (role: 'reader' | 'writer' | 'owner' = 'reader') => ({
  actor: 'user-1' as UserId,
  scope: SCOPE,
  project: { id: 'project-1', title: 'Harbour Lights' } as Project,
  episode: { id: 'episode-1', slug: 'ep_001', title: 'Pilot' } as Episode,
  role,
})

const run = async (
  steps: Parameters<typeof scripted>[0],
  overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {},
  options: Parameters<typeof scripted>[1] = {},
) => {
  const { client, sent } = scripted(steps, options)
  const events: AgentEvent[] = []
  const stored: { role: 'user' | 'assistant'; body: string; content: AssistantContent | null }[] = []
  const tokens: [number, number][] = []
  const outcome = await runAgentLoop({
    client,
    model: 'test-model',
    maxTokens: 1000,
    system: [{ type: 'text', text: 'You are the assistant.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'How many scenes are there?' }],
    route: 'script',
    context: { gate: gate(), runId: 'run-1' as RunId, emit: (event) => events.push(event) },
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    tokenBudget: 1_000_000,
    recordTokens: (input, output) => {
      tokens.push([input, output])
      return Promise.resolve()
    },
    recordMessage: (role, body, content) => {
      stored.push({ role, body, content })
      return Promise.resolve()
    },
    ...overrides,
  })
  return { outcome, events, stored, tokens, sent }
}

beforeAll(() => {
  registerTools([
    defineTool({
      name: 'boom',
      description: 'A tool that throws, for the test.',
      toolset: 'core',
      minimumRole: 'reader',
      mode: 'read',
      input: z.object({}),
      label: () => 'Exploding',
      run: () => Promise.reject(new Error('the database went away')),
    }),
    defineTool({
      name: 'writer_only',
      description: 'A tool a reader may not call, for the test.',
      toolset: 'core',
      minimumRole: 'writer',
      mode: 'read',
      input: z.object({}),
      label: () => 'Writing',
      run: () => Promise.resolve({ ok: true, content: {}, summary: 'wrote' }),
    }),
  ])
})

beforeEach(() => {
  spies.listSceneIndex.mockResolvedValue([
    { sceneNodeId: 'n1', number: 1, ordinalInEpisode: 1, heading: 'INT. HARBOUR - NIGHT', episode: 'ep_001', episodeOrdinal: 1, lines: 12, words: 80 },
    { sceneNodeId: 'n2', number: 2, ordinalInEpisode: 2, heading: 'EXT. PIER - DAY', episode: 'ep_001', episodeOrdinal: 1, lines: 6, words: 20 },
  ])
})

describe('a turn with no tool call', () => {
  it('streams the answer, stores it with its blocks, and records the tokens', async () => {
    const { outcome, events, stored, tokens } = await run([{ text: 'Two scenes.' }])
    expect(outcome.stopReason).toBe('end_turn')
    const pieces = events.flatMap((event) => (event.type === 'text' ? [event.text] : []))
    expect(pieces).toHaveLength(2)
    expect(pieces.join('')).toBe('Two scenes.')
    expect(stored).toEqual([{ role: 'assistant', body: 'Two scenes.', content: [{ type: 'text', text: 'Two scenes.', citations: null }] }])
    expect(tokens).toEqual([[10, 5]])
    expect(outcome.unsaved).toBe('')
  })

  it('offers the tools with the cache marker on the last definition only', async () => {
    const { sent } = await run([{ text: 'Two scenes.' }])
    const tools = sent[0]?.tools ?? []
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.map((tool) => ('cache_control' in tool ? tool.cache_control : undefined)).filter(Boolean)).toHaveLength(1)
    expect(tools.at(-1)).toHaveProperty('cache_control', { type: 'ephemeral' })
  })
})

describe('a tool call', () => {
  it('runs the tool, reports it as two status events, and answers the call before the next step', async () => {
    const { outcome, events, stored, sent } = await run([
      { text: 'Let me look.', calls: [{ id: 'toolu_1', name: 'list_scenes', input: {} }] },
      { text: 'There are two.' },
    ])
    expect(outcome.stopReason).toBe('end_turn')
    expect(events.filter((event) => event.type.startsWith('tool_'))).toEqual([
      { type: 'tool_started', id: 'toolu_1', name: 'list_scenes', label: 'Reading the scene list' },
      { type: 'tool_finished', id: 'toolu_1', name: 'list_scenes', ok: true, summary: '2 scenes' },
    ])
    // The second call carries the tool call and its result, in that order.
    const second = sent[1]?.messages ?? []
    expect(second.at(-2)?.role).toBe('assistant')
    const answer = second.at(-1)
    expect(answer?.role).toBe('user')
    expect(Array.isArray(answer?.content) ? answer.content[0] : null).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    // Stored: the model's call, the result as a bodiless user turn, the answer.
    expect(stored.map((row) => [row.role, row.body])).toEqual([
      ['assistant', 'Let me look.'],
      ['user', ''],
      ['assistant', 'There are two.'],
    ])
    // The second step's words start a new paragraph.
    expect(outcome.text).toBe('Let me look.\n\nThere are two.')
  })

  it('hands a tool that throws back to the model as an error, and the turn goes on', async () => {
    const { outcome, events, sent } = await run([
      { calls: [{ id: 'toolu_1', name: 'boom', input: {} }] },
      { text: 'That read failed; try again in a moment.' },
    ])
    expect(outcome.stopReason).toBe('end_turn')
    expect(events).toContainEqual({ type: 'tool_finished', id: 'toolu_1', name: 'boom', ok: false, summary: 'boom could not run.' })
    const result = sent[1]?.messages.at(-1)?.content
    expect(Array.isArray(result) ? result[0] : null).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'boom could not run.' })
  })

  it('refuses a tool whose minimum role the caller does not hold, in the gate`s words', async () => {
    const { events } = await run([{ calls: [{ id: 'toolu_1', name: 'writer_only', input: {} }] }, { text: 'I cannot.' }])
    expect(events).toContainEqual({ type: 'tool_finished', id: 'toolu_1', name: 'writer_only', ok: false, summary: ROLE_REFUSED })
  })

  it('answers a call to a tool that does not exist with an error rather than failing the turn', async () => {
    const { outcome, events } = await run([{ calls: [{ id: 'toolu_1', name: 'delete_everything', input: {} }] }, { text: 'Sorry.' }])
    expect(outcome.stopReason).toBe('end_turn')
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_finished', ok: false }))
  })

  it('answers input that does not parse with the schema`s own complaint', async () => {
    const { events } = await run([{ calls: [{ id: 'toolu_1', name: 'list_scenes', input: { episode: 'two' } }] }, { text: 'Sorry.' }])
    const finished = events.find((event) => event.type === 'tool_finished')
    expect(finished).toMatchObject({ ok: false })
    expect(finished?.type === 'tool_finished' ? finished.summary : '').toMatch(/^The input did not read \(episode:/u)
  })
})

describe('the caps', () => {
  it(`stops at ${String(MAX_STEPS)} steps with a summary call that may not use a tool`, async () => {
    const looping = (call: number): Step =>
      call <= MAX_STEPS ? { calls: [{ id: `toolu_${String(call)}`, name: 'list_scenes', input: {} }] } : { text: 'I read the scene list twelve times.' }
    const { outcome, sent, stored } = await run(looping)
    expect(outcome.stopReason).toBe('step_cap')
    expect(sent).toHaveLength(MAX_STEPS + 1)
    const last = sent.at(-1)
    expect(last?.tool_choice).toEqual({ type: 'none' })
    const closing = last?.messages.at(-1)?.content
    expect(Array.isArray(closing) ? closing.at(-1) : null).toMatchObject({ type: 'text', text: expect.stringContaining('limit of 12 steps') })
    expect(stored.at(-1)).toMatchObject({ role: 'assistant', body: 'I read the scene list twelve times.' })
  })

  it('stops at the time limit the same way', async () => {
    let clock = 0
    const { outcome, sent } = await run(
      (call) => (call === 1 ? { calls: [{ id: 'toolu_1', name: 'list_scenes', input: {} }] } : { text: 'Out of time; here is what I have.' }),
      {
        now: () => {
          clock += 70_000
          return clock
        },
      },
    )
    expect(outcome.stopReason).toBe('time_cap')
    expect(sent).toHaveLength(2)
    expect(sent[1]?.tool_choice).toEqual({ type: 'none' })
  })

  it('stops at the daily token cap without spending on a summary', async () => {
    const { outcome, sent, events, stored } = await run(
      [{ calls: [{ id: 'toolu_1', name: 'list_scenes', input: {} }], usage: { input: 900, output: 200 } }, { text: 'never asked' }],
      { tokenBudget: 1_000 },
    )
    expect(outcome.stopReason).toBe('token_cap')
    expect(sent).toHaveLength(1)
    expect(events).toContainEqual({ type: 'error', message: "You have used today's assistant allowance. It resets at midnight UTC." })
    // The call was still answered in the log, so the chat replays cleanly.
    expect(stored.at(-1)).toMatchObject({ role: 'user', body: '' })
    expect(outcome.inputTokens + outcome.outputTokens).toBe(1_100)
  })
})

describe('what is kept of today`s behaviour', () => {
  it('appends the refusal note', async () => {
    const { outcome, events } = await run([{ text: 'I would rather not', stop: 'refusal' }])
    expect(outcome.stopReason).toBe('refusal')
    expect(events.at(-1)).toEqual({ type: 'text', text: REFUSAL_NOTE })
  })

  it('keeps what was shown before an abort as unsaved text for the caller to store', async () => {
    const { outcome, stored } = await run([{ text: 'Half an answ' }], {}, { throwOn: 1, error: new Anthropic.APIUserAbortError() })
    expect(outcome.stopReason).toBe('aborted')
    expect(stored).toEqual([])
    expect(outcome.unsaved).toBe('Half an answ')
  })

  it('reports an API error in the writer`s terms and keeps the note', async () => {
    const { outcome, events } = await run([{ text: 'Partly' }], {}, { throwOn: 1, error: new Error('socket hang up') })
    expect(outcome.stopReason).toBe('error')
    expect(events).toContainEqual({ type: 'error', message: 'The assistant could not answer.' })
    expect(outcome.unsaved).toBe('Partly\n\n[The assistant could not answer.]')
  })
})
