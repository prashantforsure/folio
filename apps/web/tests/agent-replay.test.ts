// @vitest-environment node
import type { AssistantContent, AssistantMessage } from '@folio/contracts'
import { assistantChatId, assistantMessageId, projectId } from '@folio/contracts'
import { runId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { replayOf } from '../lib/agent/replay'
import { visibleMessages } from '../lib/assistant/result'

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
