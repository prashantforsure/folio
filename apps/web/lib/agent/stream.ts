import type { AgentEvent } from '@folio/contracts'
import { AgentEventSchema } from '@folio/contracts'

/**
 * Reading `POST /api/assistant`'s body in the panel - newline-delimited JSON,
 * one `AgentEvent` per line (ADR 0003 **D7**, roadmap task 2.3).
 *
 * A network chunk ends wherever it ends, so a line can arrive in pieces; the
 * decoder keeps the unfinished tail until the rest of it lands. Every line is
 * parsed against the contract, and a line that does not parse is dropped and
 * counted rather than thrown on - a panel that dies on one bad line loses the
 * answer that was streaming beside it. Pure apart from the reader loop;
 * `tests/agent-stream.test.ts`.
 */
export type NdjsonDecoder = {
  /** Feed a decoded chunk; get back every complete event in it. */
  readonly push: (chunk: string) => readonly AgentEvent[]
  /** The stream ended: whatever complete line is left. */
  readonly end: () => readonly AgentEvent[]
  /** Lines that were not an `AgentEvent`. */
  readonly dropped: () => number
}

export const ndjsonDecoder = (): NdjsonDecoder => {
  let tail = ''
  let dropped = 0
  const parse = (line: string): AgentEvent | null => {
    if (line.trim().length === 0) return null
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      dropped += 1
      return null
    }
    const parsed = AgentEventSchema.safeParse(value)
    if (!parsed.success) {
      dropped += 1
      return null
    }
    return parsed.data
  }
  const drain = (lines: readonly string[]): readonly AgentEvent[] =>
    lines.flatMap((line) => {
      const event = parse(line)
      return event === null ? [] : [event]
    })
  return {
    push: (chunk) => {
      const lines = (tail + chunk).split('\n')
      tail = lines.pop() ?? ''
      return drain(lines)
    },
    end: () => {
      const last = tail
      tail = ''
      return drain([last])
    },
    dropped: () => dropped,
  }
}

/** Read a response body to its end, handing each event over as it completes. */
export const readAgentStream = async (body: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void): Promise<void> => {
  const reader = body.getReader()
  const text = new TextDecoder()
  const decoder = ndjsonDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    for (const event of decoder.push(text.decode(value, { stream: true }))) onEvent(event)
  }
  for (const event of decoder.push(text.decode())) onEvent(event)
  for (const event of decoder.end()) onEvent(event)
}
