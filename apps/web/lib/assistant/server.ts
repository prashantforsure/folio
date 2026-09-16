import { ASSISTANT_MESSAGE_MAX } from '@folio/contracts'
import type { AssistantChatId } from '@folio/contracts'
import { AssistantChatIdSchema } from '@folio/contracts'
import {
  appendMessage,
  listCharacterRecords,
  listMessages,
  readChat,
  readDocumentByKind,
  readMentionLabels,
  readScreenplayNodes,
} from '@folio/db'
import { assistantEnv } from '@folio/db/env'
import type { ScreenplayNode } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { isRefusal, openEpisodeWith } from '../script/gate'
import { buildContext } from './context'
import { ASSISTANT_MODEL, MAX_OUTPUT_TOKENS } from './model'

/**
 * Asking the assistant. Server only - this file holds the API key's reader.
 *
 * `assistantConnected()` is what the shell tells the panel: unset key, no
 * composer. `ask()` is the streaming path `app/api/assistant/route.ts`
 * exposes: gate, read the script beside the gate, append the writer's turn,
 * stream the answer, append the answer when the stream ends.
 *
 * ## The gate is the Script route's
 *
 * `openEpisodeWith` - identity, membership, scope, in one round trip, with
 * the reads a turn needs alongside. A chat that belongs to another episode
 * of the same project is refused as not found; a chat in another project is
 * unreachable by construction, the scope cannot see it.
 *
 * ## What the answer is made of
 *
 * The whole script and the cast, as `context.ts` renders them, in one
 * cached system block; the chat's earlier turns as messages; the new turn
 * last. Adaptive thinking at default effort - a writer's question is not a
 * proof - and text only: no tools, because the assistant may not write.
 */

export const assistantConnected = (): boolean => assistantEnv !== null

const AskSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  chatId: AssistantChatIdSchema,
  message: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX),
})

export type AskOutcome =
  | { readonly status: 'streaming'; readonly stream: ReadableStream<Uint8Array> }
  | { readonly status: 'refused'; readonly message: string; readonly code: 401 | 404 }
  | { readonly status: 'error'; readonly message: string; readonly code: 400 | 503 }

let client: Anthropic | null = null

const clientFor = (apiKey: string): Anthropic => {
  client ??= new Anthropic({ apiKey })
  return client
}

export const ask = async (raw: unknown, signal: AbortSignal): Promise<AskOutcome> => {
  const env = assistantEnv
  if (env === null) {
    return { status: 'error', code: 503, message: 'The assistant is not connected. Set ANTHROPIC_API_KEY on the server.' }
  }
  const parsed = AskSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', code: 400, message: 'Write a question first.' }
  const input = parsed.data

  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    const [chat, labels, records] = await Promise.all([
      readChat(scope, input.chatId as AssistantChatId),
      readMentionLabels(scope),
      listCharacterRecords(scope),
    ])
    return { chat, labels, records }
  })
  if (isRefusal(gate)) return { status: 'refused', code: gate.message.startsWith('Sign in') ? 401 : 404, message: gate.message }
  const { scope, project, episode, extra } = gate
  if (extra.chat === null || extra.chat.episodeId !== episode.id) {
    return { status: 'refused', code: 404, message: 'That chat could not be found.' }
  }
  const chatId = extra.chat.id

  // The script, read after the gate rather than beside it: it needs the
  // document id, which is itself a read. Two round trips for the context of a
  // question that then takes seconds to answer is not the cost that matters.
  const document = await readDocumentByKind(scope, episode.id, 'screenplay')
  let nodes: readonly ScreenplayNode[] = []
  if (document !== null) {
    const read = await readScreenplayNodes(scope, document.id)
    if (read.ok) nodes = read.value.map((entry) => entry.node)
  }
  const history = await listMessages(scope, chatId)
  await appendMessage(scope, chatId, 'user', input.message)

  const context = buildContext({
    projectTitle: project.title,
    episodeTitle: episode.title,
    nodes,
    labels: extra.labels,
    cast: extra.records
      .filter((record) => record.derived === null || record.derived.presence === 'present')
      .map((record) => ({ name: record.name, line: record.role ?? record.bio })),
  })

  const messages: Anthropic.MessageParam[] = [
    ...history.map((turn): Anthropic.MessageParam => ({ role: turn.role, content: turn.body })),
    { role: 'user', content: input.message },
  ]

  const anthropic = clientFor(env.ANTHROPIC_API_KEY)
  const encoder = new TextEncoder()
  let answer = ''

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const events = anthropic.messages.stream(
          {
            model: ASSISTANT_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: [{ type: 'text', text: context.system, cache_control: { type: 'ephemeral' } }],
            messages,
          },
          { signal },
        )
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            answer += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        const final = await events.finalMessage()
        if (final.stop_reason === 'refusal') {
          const note = '\n\n[The assistant declined to answer this one.]'
          answer += note
          controller.enqueue(encoder.encode(note))
        }
      } catch (cause) {
        // A closed tab aborts the fetch; the SDK surfaces it as an error.
        // Whatever was streamed is still worth keeping - a half answer the
        // writer saw is better than a question with no answer in the log.
        if (!(cause instanceof Anthropic.APIUserAbortError) && !signal.aborted) {
          const message = cause instanceof Anthropic.APIError ? `The assistant could not answer (${String(cause.status)}).` : 'The assistant could not answer.'
          const note = answer.length === 0 ? message : `\n\n[${message}]`
          answer += note
          try {
            controller.enqueue(encoder.encode(note))
          } catch {
            // The client has gone; nothing to tell it.
          }
        }
      } finally {
        if (answer.trim().length > 0) {
          try {
            await appendMessage(scope, chatId, 'assistant', answer)
          } catch {
            // The turn was shown; losing it from the log is the lesser failure.
          }
        }
        try {
          controller.close()
        } catch {
          // Already closed by the cancel path.
        }
      }
    },
  })

  return { status: 'streaming', stream }
}
