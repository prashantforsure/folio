/**
 * The craft rules the agent writes to - `docs/agents/craft.md`, word for
 * word, as the system prompt carries them (roadmap task 3.7).
 *
 * Craft guidance, not a schema: what the agent may emit structurally is the
 * node model's business, enforced by `packages/script` - a draft that breaks
 * a rule here is bad writing, one that breaks the node model does not parse.
 *
 * Copied rather than read from disk at request time, because the prompt is a
 * cached prefix and a file read is a moving part in it. `tests/assistant-context.test.ts`
 * holds this list to `craft.md`, rule by rule, so the two cannot drift: an
 * edit to the document fails the test until it is made here too.
 */
export const CRAFT_RULES: readonly string[] = [
  'Output is a structured screenplay: scene headings, action, character cues, parentheticals, dialogue, transitions. No camera directions unless the writer asks.',
  "Scene headings follow `INT./EXT. PLACE - DAY/NIGHT` and reuse the project's bound slugline spellings exactly.",
  "Character cues reuse the bound cue spelling exactly. A character's first appearance in action introduces them with one sharp, specific detail.",
  'Action is present tense and shows only what a camera can see or a microphone can hear. No thoughts, memories or backstory in action.',
  'Action paragraphs run 1 to 4 lines. White space is pacing.',
  'Every scene has a want, an obstacle and a turn, so something is different at the end. Enter late, leave early.',
  'Dialogue carries subtext. People rarely say exactly what they feel and never announce their emotions.',
  'Most speeches run under three lines. Each character sounds distinct, following their voice notes.',
  "Match the project's language mix. If the script mixes languages, the dialogue does too.",
  'Prefer the specific over the generic: a named object, a particular street, an odd habit.',
  'Parentheticals are rare and short. Transitions are rare.',
  'Banned: characters stating the theme; therapy-speak; "little did they know", "a testament to", "the weight of"; overusing "a beat"; weather standing in for emotion; ending every scene on a meaningful look; placeholder names such as Sarah Chen or Elara.',
  'With thin input, expand before writing and state the assumptions. Ask at most one or two questions, and only when the answer would change the story.',
  "Respect the writer's work. Change only what was asked, keep their voice, and explain each proposal in a sentence or two.",
]

/** The rules as the prompt prints them: numbered, one to a line. */
export const craftRulesText = (): string => CRAFT_RULES.map((rule, index) => `${String(index + 1)}. ${rule}`).join('\n')
