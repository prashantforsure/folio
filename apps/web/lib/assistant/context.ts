import type { InlineContent, MentionLabel, ScreenplayNode } from '@folio/script'

import type { LabelFor } from '../script/inline'
import { CONTEXT_CHAR_CAP } from './model'

/**
 * What the model is shown, and what it is told about itself.
 *
 * ## The script, as prose with scene numbers
 *
 * Not Fountain: the serialiser writes `@{character:<uuid>}` tokens where a
 * writer sees MEERA, and a model reading uuids cannot say "Meera". Each node
 * is rendered the way the page reads it - mentions replaced by their labels
 * from the same label book the sheet uses - and every scene heading carries
 * `[Scene N]` so an answer can cite one. Comments (`[[ ]]` notes) are
 * included and marked, because a writer asking "what did I leave myself a
 * note about" expects them; nothing here is an export.
 *
 * ## Read-only, and said so
 *
 * The system prompt tells the model it cannot edit the script. AGENTS.md,
 * The AI agent: "Every write returns a proposal, never a mutation" - and
 * this pass builds no proposal surface, so the honest instruction is that
 * suggestions are text the writer applies by hand.
 *
 * ## Stable first, volatile last
 *
 * The system prompt is one block: instructions, then the cast, then the
 * script. Between turns of one chat only the messages change, so the whole
 * block is a cacheable prefix; `cache_control` goes on it in `route.ts`.
 */

export type AssistantContext = {
  readonly system: string
  /** True when the script was cut to fit `CONTEXT_CHAR_CAP`. */
  readonly truncated: boolean
}

const INSTRUCTIONS = `You are the writing assistant inside Folio, a screenwriting workspace. You are talking to the writer of the screenplay below.

What you can do: read the script and the cast list, answer questions about them, point out continuity gaps, suggest lines, beats, scenes or character notes, and talk through the draft.

What you cannot do: change the script. You have no way to edit it. When you suggest a change, write it out plainly so the writer can put it in themselves; do not claim to have made it.

How to answer:
- Be specific. Cite scenes by their number as "Scene 3" when a claim comes from the page. If something is not on the page, say so rather than inventing it.
- Match the writer's language when quoting dialogue; the script may mix languages.
- Keep answers as short as the question allows. A yes-or-no question gets a short answer; a "punch up this scene" request gets the scene.
- Never summarise the whole script unless asked. The writer wrote it.`

const labelBookOf = (labels: readonly MentionLabel[]): LabelFor => {
  const book = new Map<string, string>()
  for (const label of labels) book.set(`${label.entity}:${label.id}`, label.label)
  return (entity, id) => book.get(`${entity}:${id}`)
}

/** The model's inline runs as text: a mention by its label, an unresolved one as `?`. */
const runsText = (content: InlineContent, labelFor: LabelFor): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target.entity, run.target.id) ?? '?')))
    .join('')

const renderNode = (node: ScreenplayNode, labelFor: LabelFor, sceneNumber: number): string => {
  const text = runsText(node.content, labelFor).trim()
  switch (node.type) {
    case 'scene':
      return `\n[Scene ${String(sceneNumber)}] ${text.toUpperCase()}`
    case 'character':
      return `\n${text.toUpperCase()}${node.modifiers.length > 0 ? ` (${node.modifiers.join(', ')})` : ''}`
    case 'paren':
      return `    ${text}`
    case 'dialogue':
      return `    ${text}`
    case 'subtitle':
      return `    [subtitle] ${text}`
    case 'transition':
      return `\n${' '.repeat(40)}${text.toUpperCase()}`
    case 'comment':
      return `\n[[writer's note: ${text}]]`
    case 'action':
      return `\n${text}`
  }
}

export const renderScript = (
  nodes: readonly ScreenplayNode[],
  labels: readonly MentionLabel[],
): { readonly text: string; readonly truncated: boolean } => {
  const labelFor = labelBookOf(labels)
  const lines: string[] = []
  let scene = 0
  let length = 0
  let truncated = false
  for (const node of nodes) {
    if (node.type === 'scene') scene += 1
    const line = renderNode(node, labelFor, scene)
    if (length + line.length > CONTEXT_CHAR_CAP && node.type === 'scene') {
      truncated = true
      break
    }
    lines.push(line)
    length += line.length + 1
  }
  return { text: lines.join('\n').trim(), truncated }
}

export const buildContext = ({
  projectTitle,
  episodeTitle,
  nodes,
  labels,
  cast,
}: {
  readonly projectTitle: string
  readonly episodeTitle: string
  readonly nodes: readonly ScreenplayNode[]
  readonly labels: readonly MentionLabel[]
  /** Character names, with a short line each when the record has one. */
  readonly cast: readonly { readonly name: string; readonly line: string | null }[]
}): AssistantContext => {
  const script = renderScript(nodes, labels)
  const castLines =
    cast.length === 0
      ? 'No character records yet - the cast is whoever the cues name.'
      : cast.map((person) => (person.line === null ? `- ${person.name}` : `- ${person.name}: ${person.line}`)).join('\n')
  const scriptBlock =
    nodes.length === 0
      ? 'The script is empty. Nothing has been written yet.'
      : `${script.text}${script.truncated ? '\n\n[The script continues; it was cut here to fit. Say so if the writer asks about a later scene.]' : ''}`
  const system = [
    INSTRUCTIONS,
    '',
    `Project: ${projectTitle}`,
    `Episode: ${episodeTitle}`,
    '',
    'Cast:',
    castLines,
    '',
    'Script:',
    scriptBlock,
  ].join('\n')
  return { system, truncated: script.truncated }
}
