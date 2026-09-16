import { ask } from '../../../lib/assistant/server'

/**
 * `POST /api/assistant` - one turn of the assistant, streamed.
 *
 * A route handler rather than a server action because an action returns a
 * value and an answer arrives over seconds; the panel appends text as it
 * lands. The body is `AskInput` (`lib/assistant/result.ts`); the response is
 * `text/plain` chunks of the answer, nothing else, so the client needs no
 * event parser - what it reads is what it shows.
 *
 * The gate is inside `ask()`: identity, membership, the chat's episode. The
 * proxy protects `/app`, not `/api`, so nothing here is reachable without
 * the gate refusing first.
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
