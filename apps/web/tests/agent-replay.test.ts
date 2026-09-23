// @vitest-environment node
import type { AssistantContent, AssistantMessage } from '@folio/contracts'
import { assistantChatId, assistantMessageId, projectId } from '@folio/contracts'
import { runId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { replayOf, resumeOf } from '../lib/agent/replay'
import { runsIn, visibleMessages } from '../lib/assistant/result'

/**
 * A stored chat, replayed to the API and printed in the panel (roadmap task 2.3).
 *
 * The two readers of `assistant_messages` want different things from the same
 * rows: the API wants every block back, tool calls and results included, in a
 * shape it will accept; the writer wants their questions and one answer per
 * turn. Both are asserted on the rows an aborted turn leaves behind, because
 * that is where they come apart.
 */

let clock = 0
const row = (role: 'user' | 'assistant', body: string, content: AssistantContent | null = null): AssistantMessage => {
  clock += 1
  return {
    id: assistantMessageId(`00000000-0000-4000-8000-${String(clock).padStart(12, '0')}`),
    projectId: projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'),
    chatId: assistantChatId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'),
    role,
    body,
    content,
    runId: content === null ? null : runId('3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'),
    createdAt: `2026-09-23T10:00:${String(clock).padStart(2, '0')}.000Z`,
  }
}

const call = (id: string): AssistantContent => [
  { type: 'text', text: 'Let me look.', citations: null },
  { type: 'tool_use', id, name: 'list_scenes', input: {}, caller: { type: 'direct' } },
]
const result = (id: string): AssistantContent => [{ type: 'tool_result', tool_use_id: id, content: '{"count":2}' }]

describe('replayOf', () => {
  it('replays a turn written before the loop as the plain text it always was', () => {
    expect(replayOf([row('user', 'Who is Meera?'), row('assistant', 'The harbourmaster.')])).toEqual([
      { role: 'user', content: 'Who is Meera?' },
      { role: 'assistant', content: 'The harbourmaster.' },
    ])
  })

  it('replays a tool call and its answer, with only the fields a request carries', () => {
    const replayed = replayOf([
      row('user', 'How many scenes?'),
      row('assistant', 'Let me look.', call('toolu_1')),
      row('user', '', result('toolu_1')),
      row('assistant', 'Two.', [{ type: 'text', text: 'Two.', citations: null }]),
    ])
    expect(replayed).toEqual([
      { role: 'user', content: 'How many scenes?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_use', id: 'toolu_1', name: 'list_scenes', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"count":2}' }] },
      { role: 'assistant', content: 'Two.' },
    ])
  })

  it('drops a tool call an aborted turn never answered, and merges the two questions it leaves adjacent', () => {
    const replayed = replayOf([
      row('user', 'How many scenes?'),
      row('assistant', '', [{ type: 'tool_use', id: 'toolu_1', name: 'list_scenes', input: {} }]),
      row('user', 'Never mind - who is Meera?'),
    ])
    expect(replayed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'How many scenes?' },
          { type: 'text', text: 'Never mind - who is Meera?' },
        ],
      },
    ])
  })

  it('drops a tool result whose call is gone', () => {
    const replayed = replayOf([row('user', 'Hello'), row('user', '', result('toolu_9')), row('assistant', 'Hi.')])
    expect(replayed).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi.' },
    ])
  })

  it('keeps an error result marked as one', () => {
    const replayed = replayOf([
      row('user', 'Go'),
      row('assistant', '', [{ type: 'tool_use', id: 'toolu_1', name: 'boom', input: {} }]),
      row('user', '', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom could not run.', is_error: true }]),
    ])
    expect(replayed.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom could not run.', is_error: true }],
    })
  })
})

describe('visibleMessages', () => {
  it('shows the questions and one answer per turn, never a tool result', () => {
    const shown = visibleMessages([
      row('user', 'How many scenes?'),
      row('assistant', 'Let me look.', call('toolu_1')),
      row('user', '', result('toolu_1')),
      row('assistant', 'Two.', [{ type: 'text', text: 'Two.' }]),
    ])
    expect(shown.map((message) => [message.role, message.body])).toEqual([
      ['user', 'How many scenes?'],
      ['assistant', 'Let me look.\n\nTwo.'],
    ])
  })
})

describe('resumeOf - a background run picking up its transcript (roadmap task 4.4)', () => {
  it('answers the calls a dead worker left unanswered, keeping them in the last model message', () => {
    const resumed = resumeOf([row('user', 'Count the scenes.'), row('assistant', 'Let me look.', call('toolu_9'))])
    expect(resumed.finished).toBe(false)
    expect(resumed.pending).toEqual([{ id: 'toolu_9', name: 'list_scenes', input: {} }])
    // Kept, where replayOf drops an unanswered call: the loop answers it next.
    expect(resumed.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_9', name: 'list_scenes', input: {} },
      ],
    })
    expect(replayOf([row('user', 'Count the scenes.'), row('assistant', 'Let me look.', call('toolu_9'))]).at(-1)).toEqual({ role: 'assistant', content: 'Let me look.' })
  })

  it('picks up from a user turn - the brief, a step`s results, or the writer`s reply', () => {
    const afterResults = resumeOf([row('user', 'Count the scenes.'), row('assistant', '', call('toolu_1')), row('user', '', result('toolu_1'))])
    expect(afterResults).toMatchObject({ finished: false, pending: [] })
    expect(afterResults.messages.at(-1)?.role).toBe('user')
    expect(resumeOf([row('user', 'Draft act two.')])).toMatchObject({ finished: false, pending: [], messages: [{ role: 'user', content: 'Draft act two.' }] })
  })

  it('knows a run that had finished and only lost its status', () => {
    expect(resumeOf([row('user', 'Count the scenes.'), row('assistant', 'There are two.')]).finished).toBe(true)
  })

  it('joins two model messages in a row into one, as the API takes it', () => {
    const resumed = resumeOf([row('user', 'Go.'), row('assistant', 'Thinking.'), row('assistant', '', call('toolu_2'))])
    expect(resumed.messages).toHaveLength(2)
    expect(resumed.messages[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Thinking.' }, { type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'toolu_2' }] })
  })
})

describe('runsIn - a run card, read back after a reload (roadmap task 4.4)', () => {
  const RUN = '4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a'
  const CHAT = '5e4d3c2b-1a0f-4e9d-9c8b-7a6f5e4d3c2b'
  const started: AssistantContent = [
    { type: 'tool_result', tool_use_id: 'toolu_s', content: JSON.stringify({ done: 'Start a background run: Draft act two', proposalId: '6f5e4d3c-2b1a-4f0e-8d9c-8b7a6f5e4d3c', result: { runId: RUN, chatId: CHAT, title: 'Draft act two' } }) },
  ]

  it('finds the run a start_background_task result names, and nothing in an error or another tool`s result', () => {
    expect(runsIn(started)).toEqual([{ runId: RUN, chatId: CHAT, title: 'Draft act two' }])
    expect(runsIn([{ type: 'tool_result', tool_use_id: 'x', content: 'This project already has 2 background runs working.', is_error: true }])).toEqual([])
    expect(runsIn(result('toolu_1'))).toEqual([])
    expect(runsIn(null)).toEqual([])
  })

  it('attaches the run to the answer that started it', () => {
    const rows = visibleMessages([row('user', 'Draft act two in the background.'), row('assistant', '', call('toolu_s')), row('user', '', started), row('assistant', 'Started it.')])
    expect(rows.at(-1)).toMatchObject({ role: 'assistant', body: 'Started it.', runs: [{ runId: RUN, chatId: CHAT, title: 'Draft act two' }] })
  })
})
