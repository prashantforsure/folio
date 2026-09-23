import type { DraftLine, StoryBible, StoryBrief, StoryOutline, StoryScene, StorySceneList } from '@folio/contracts'

import { craftRulesText } from '../craft'

/**
 * What each stage of the story pipeline asks the model - roadmap task 4.5.
 *
 * One system block for every call, the craft rules in it (`craft.md`, the
 * same text the assistant carries), and one user message per stage built from
 * what the earlier stages stored. The model answers by calling the one tool it
 * is given (`structured.ts`); these are the words around it. When the writer
 * replied to a checkpoint with changes, the stage is asked again with their
 * words and its last answer (`revising`).
 */

export const PIPELINE_SYSTEM = `You are the writing assistant inside Folio, turning a writer's story into a screenplay one stage at a time: expand the story, create its characters and places, outline it, break it into scenes, and write the scenes. Each message asks for one stage. Answer only by calling the tool you are given, with everything it asks for.

Write to these craft rules at every stage:
${craftRulesText()}`

const list = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n')

export const briefText = (brief: StoryBrief): string =>
  [
    `Logline: ${brief.logline}`,
    `Genre: ${brief.genre}. Tone: ${brief.tone}. Format: ${brief.format}, about ${String(brief.targetPages)} pages.`,
    `Protagonist: ${brief.protagonist.name} - wants ${brief.protagonist.want}; needs ${brief.protagonist.need}.`,
    `Stakes: ${brief.stakes}`,
    `Setting: ${brief.setting}`,
    ...(brief.assumptions.length === 0 ? [] : ['Assumptions:', list(brief.assumptions)]),
  ].join('\n')

export const bibleText = (bible: StoryBible): string =>
  [
    'Characters:',
    list(bible.characters.map((person) => `${person.name} - ${person.role}. Voice: ${person.voice}`)),
    'Locations:',
    list(bible.locations.map((place) => `${place.name} - ${place.description}`)),
  ].join('\n')

export const outlineText = (outline: StoryOutline): string =>
  outline.acts.map((act, index) => [`Act ${String(index + 1)}: ${act.title}`, list(act.beats.map((beat) => `${beat.title}: ${beat.summary}`))].join('\n')).join('\n')

export const sceneHeadingText = (scene: StoryScene): string => `${scene.place}. ${scene.location} - ${scene.time}`

export const sceneListText = (list: StorySceneList): string =>
  list.scenes.map((scene, index) => `${String(index + 1)}. ${sceneHeadingText(scene)} (${scene.beat}) - ${scene.synopsis}`).join('\n')

/** A scene's lines as a writer would read them, for the next scene and the critic. */
export const linesText = (lines: readonly DraftLine[]): string =>
  lines
    .map((line) => {
      switch (line.type) {
        case 'action':
          return line.text
        case 'dialogue':
          return `${line.character}${line.parenthetical === null ? '' : `\n${line.parenthetical}`}\n${line.text}`
        case 'transition':
          return line.text
      }
    })
    .join('\n\n')

/** A stage asked again: the writer's notes, and the answer they were about. */
export const revising = (notes: string | null, previous: string | null): string =>
  notes === null ? '' : `\n\nThe writer read your last answer and said:\n"${notes}"\n\nYour last answer was:\n${previous ?? '(none)'}\n\nRevise it to take their notes, and keep what they did not ask to change.`

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------

export const expandPrompt = (story: string, project: { readonly title: string; readonly projectType: string }, notes: string | null, previous: string | null): string =>
  `The writer's story, for the ${project.projectType === 'series' ? 'series' : 'film'} "${project.title}":

${story}

Stage A: expand it. Decide the genre, the tone, the format and a length in pages; the protagonist, what they want and what they need; the stakes; the setting. The story may be a single line - expand it, and state every assumption you make as its own line, so the writer can overrule it (rule 13).${revising(notes, previous)}`

export const biblePrompt = (brief: StoryBrief, notes: string | null, previous: string | null): string =>
  `The story, expanded:
${briefText(brief)}

Stage B: create the cast and the places. A character for everyone who speaks or matters, each with their role, a voice note - how they talk - and a short description; name each as the script will cue them, in capitals, and never with a placeholder name. Every location the story needs, named as a scene heading names it ("HOSPITAL WARD"), with a line on what it is.${revising(notes, previous)}`

export const outlinePrompt = (brief: StoryBrief, bible: StoryBible, notes: string | null, previous: string | null): string =>
  `The story, expanded:
${briefText(brief)}

${bibleText(bible)}

Stage C: outline it in acts, each with its beats - a beat is one turn of the story, a title and two or three sentences. Build to about ${String(brief.targetPages)} pages.${revising(notes, previous)}`

export const scenesPrompt = (brief: StoryBrief, bible: StoryBible, outline: StoryOutline, notes: string | null, previous: string | null): string =>
  `The story, expanded:
${briefText(brief)}

${bibleText(bible)}

The outline:
${outlineText(outline)}

Stage D: break the outline into scenes, in story order. For each: the beat it plays (a beat title from the outline), INT or EXT, the location (one of the locations above, exactly), the time of day, a synopsis of one or two sentences with its want, obstacle and turn (rule 6), and the characters in it (from the cast above). About ${String(Math.max(1, Math.round(brief.targetPages / 2)))} scenes for ${String(brief.targetPages)} pages.${revising(notes, previous)}`

export type SceneBrief = {
  readonly number: number
  readonly total: number
  readonly scene: StoryScene
  /** The location's bound slugline spelling - what the heading will say. */
  readonly set: string
  /** The beat it plays, as the outline wrote it. */
  readonly beat: string
  /** The cues the scene may use - bound spellings - with each character's voice note, from their record; null when it has none. */
  readonly voices: readonly { readonly cue: string; readonly voice: string | null }[]
  /** The last lines of the scene before, if there is one. */
  readonly previous: readonly DraftLine[]
  readonly brief: StoryBrief
}

export const draftPrompt = (scene: SceneBrief): string =>
  `${briefText(scene.brief)}

Stage E: write scene ${String(scene.number)} of ${String(scene.total)}.
Heading: ${scene.scene.place}. ${scene.set} - ${scene.scene.time.trim().toUpperCase()}
The beat it plays: ${scene.beat}
Synopsis: ${scene.scene.synopsis}
Characters and their voices:
${list(scene.voices.map((voice) => (voice.voice === null ? voice.cue : `${voice.cue} - ${voice.voice}`)))}
${scene.previous.length === 0 ? 'It is the first scene.' : `The end of the scene before:\n${linesText(scene.previous)}`}

Write it as lines: action, dialogue and, rarely, a transition. Folio writes the heading and every cue from the project's bound spellings, so give a speaker only by their cue as listed, and never write a heading, a cue or a camera direction yourself. Enter late, leave early; end on the turn.`

export const critiquePrompt = (scene: SceneBrief, lines: readonly DraftLine[]): string =>
  `Here is scene ${String(scene.number)}, "${sceneHeadingText(scene.scene)}", as drafted:

${linesText(lines)}

Score it against each craft rule that applies to a scene (by its number), 1 when the draft breaks it and 5 when it keeps it, with a note on what to change when the score is low.`

export const rewritePrompt = (scene: SceneBrief, lines: readonly DraftLine[], notes: readonly string[]): string =>
  `${draftPrompt(scene)}

Your draft was:
${linesText(lines)}

The critic's notes:
${list(notes)}

Rewrite the scene to answer the notes, and keep what works.`

export const timePrompt = (list: StorySceneList): string =>
  `The scenes as drafted, in order:
${sceneListText(list)}

Stage F: say on which story day each scene happens - day 1 for the first - and which are flashbacks, reading only what the synopses say, never the time of day alone. Then name the story's threads - a plot line, a relationship - and the scenes that carry each.`
