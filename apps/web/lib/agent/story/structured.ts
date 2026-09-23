import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { ASSISTANT_MODEL, MAX_OUTPUT_TOKENS } from '../../assistant/model'
import type { ModelClient } from '../loop'
import { tokensOf } from '../loop'

/**
 * One structured answer from the model - roadmap task 4.5.
 *
 * Every stage of the story pipeline asks for data, not prose, so every call
 * is a **forced tool call**: one tool whose input schema is the stage's
 * contract (`z.toJSONSchema`, as the registry converts a tool's input - ADR
 * 0003 D13), `tool_choice` naming it. What comes back is parsed with the same
 * Zod schema. A call that does not read is told why and asked **once more**;
 * a second miss is the caller's failure to report, never a guess.
 *
 * The daily token allowance (D3) is checked before every call and every call's
 * tokens are recorded on the run (`spend`), so a pipeline that crosses the
 * allowance stops between calls rather than past it.
 */

export type Spend = {
  /** Add one call's tokens to the run's meter. */
  readonly record: (input: number, output: number) => Promise<void>
  /** Tokens left of today's allowance. */
  readonly left: () => number
}

export type Structured<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'unreadable' | 'token_cap'; readonly message: string }

export type StructuredCall<T> = {
  /** The tool's name: `submit_scene`. */
  readonly name: string
  readonly description: string
  readonly schema: z.ZodType<T>
  readonly system: string
  readonly prompt: string
}

const inputSchemaOf = (schema: z.ZodType): Anthropic.Tool.InputSchema => {
  const { $schema: _dropped, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  return { ...rest, type: 'object' }
}

const issueOf = (error: z.ZodError): string => {
  const issue = error.issues[0]
  return issue === undefined ? 'its shape' : `${issue.path.join('.') || 'the input'}: ${issue.message}`
}

export const structured = async <T>(client: ModelClient, signal: AbortSignal, spend: Spend, call: StructuredCall<T>): Promise<Structured<T>> => {
  const tool: Anthropic.Tool = { name: call.name, description: call.description, input_schema: inputSchemaOf(call.schema) }
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.prompt }]
  let complaint = 'The model did not answer.'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (spend.left() <= 0) return { ok: false, reason: 'token_cap', message: "Today's assistant allowance is used. It resets at midnight UTC." }
    const stream = client.stream(
      { model: ASSISTANT_MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: call.system, messages, tools: [tool], tool_choice: { type: 'tool', name: call.name } },
      { signal },
    )
    // Nothing is shown as it arrives: the answer is data, read whole.
    for await (const _event of stream) {
      // drained
    }
    const message = await stream.finalMessage()
    const used = tokensOf(message.usage)
    await spend.record(used.input, used.output)
    const use = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === call.name)
    if (use === undefined) {
      complaint = `The model did not call ${call.name}.`
      messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] }, { role: 'user', content: `Call ${call.name} with your answer.` })
      continue
    }
    const parsed = call.schema.safeParse(use.input)
    if (parsed.success) return { ok: true, value: parsed.data }
    complaint = `The answer to ${call.name} did not read (${issueOf(parsed.error)}).`
    messages.push(
      { role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: `${complaint} Call ${call.name} again with it fixed.`, is_error: true }] },
    )
  }
  return { ok: false, reason: 'unreadable', message: complaint }
}
