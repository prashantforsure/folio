import { AGENT_STREAM_MEDIA_TYPE } from '@folio/contracts'

import { ask } from '../../../lib/assistant/server'

/**
 * `POST /api/assistant` - one turn of the assistant, streamed.
 *
 * A route handler rather than a server action because an action returns a
 * value and an answer arrives over seconds; the panel appends text as it
 * lands. The body is `AskRequest` (`@folio/contracts`, `AskInputSchema`); the
 * response is `application/x-ndjson` - one `AgentEvent` per line (ADR 0003
 * **D7**, roadmap task 2.3): the answer's text as it arrives, a status line
 * per tool call, a navigation, a download, and always a closing `done`. The
 * panel tells a sentence from a navigation by the line's `type`, never by
 * parsing prose. It was `text/plain` until the agent loop.
 *
 * The gate is inside `ask()`: identity, membership, the role (`ROLE.assistant`,
 * a reader's) and the chat's episode. The proxy protects `/app`, not `/api`,
 * so nothing here is reachable without the gate refusing first. The rate limit
 * is inside `ask()` too, and comes back as a real `429` with a `Retry-After` -
 * as does the D3 daily token cap, with the seconds to midnight UTC.
 */
export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

export const POST = async (request: Request): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ message: 'Write a question first.' }, { status: 400 })
  }
  const outcome = await ask(body, request.signal)
  if (outcome.status === 'rate-limited') {
    // A real `Retry-After`, in seconds, which is what the header is for. The
    // panel reads the body; anything else in front of this reads the header.
    return Response.json(
      { message: outcome.message, retryAfterSeconds: outcome.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSeconds) } },
    )
  }
  if (outcome.status !== 'streaming') {
    return Response.json({ message: outcome.message }, { status: outcome.code })
  }
  return new Response(outcome.stream, {
    status: 200,
    headers: {
      'Content-Type': `${AGENT_STREAM_MEDIA_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
