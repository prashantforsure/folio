import { ask } from '../../../lib/assistant/server'

/**
 * `POST /api/assistant` - one turn of the assistant, streamed.
 *
 * A route handler rather than a server action because an action returns a
 * value and an answer arrives over seconds; the panel appends text as it
 * lands. The body is `AskRequest` (`@folio/contracts`, `AskInputSchema`; `scope` and `focus` are the Characters route's); the response is
 * `text/plain` chunks of the answer, nothing else, so the client needs no
 * event parser - what it reads is what it shows.
 *
 * The gate is inside `ask()`: identity, membership, the role (`ROLE.assistant`,
 * a reader's) and the chat's episode. The proxy protects `/app`, not `/api`,
 * so nothing here is reachable without the gate refusing first. The rate limit
 * is inside `ask()` too, and comes back as a real `429` with a `Retry-After`.
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
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
