// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ndjsonDecoder, readAgentStream } from '../lib/agent/stream'

/**
 * The panel's reader for `POST /api/assistant` (roadmap task 2.3): one
 * `AgentEvent` per line, arriving in whatever pieces the network cut it into.
 */

describe('ndjsonDecoder', () => {
  it('holds a line split across chunks until it is whole', () => {
    const decoder = ndjsonDecoder()
    expect(decoder.push('{"type":"te')).toEqual([])
    expect(decoder.push('xt","text":"Two"}\n{"type":"refresh"}\n')).toEqual([{ type: 'text', text: 'Two' }, { type: 'refresh' }])
  })

  it('reads a last line with no newline when the stream ends', () => {
    const decoder = ndjsonDecoder()
    expect(decoder.push('{"type":"done","runId":null,"status":"failed","stopReason":"error"}')).toEqual([])
    expect(decoder.end()).toEqual([{ type: 'done', runId: null, status: 'failed', stopReason: 'error' }])
  })

  it('drops and counts a line that is not an event, and keeps reading', () => {
    const decoder = ndjsonDecoder()
    const events = decoder.push('not json\n{"type":"nonsense"}\n{"type":"text","text":"ok"}\n')
    expect(events).toEqual([{ type: 'text', text: 'ok' }])
    expect(decoder.dropped()).toBe(2)
  })
})

describe('readAgentStream', () => {
  it('hands over every event of a body, in order', async () => {
    const encoder = new TextEncoder()
    const lines = ['{"type":"text","text":"Hel', 'lo"}\n{"type":"tool_started","id":"t1","name":"list_scenes","label":"Reading"}\n', '{"type":"refresh"}']
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    })
    const seen: string[] = []
    await readAgentStream(body, (event) => seen.push(event.type))
    expect(seen).toEqual(['text', 'tool_started', 'refresh'])
  })
})
