import type { Fixture } from './fixtures'
import type { CraftRule, Judgement } from './rubric'
import { meanScore } from './rubric'
import type { StructuralScore } from './structural'

/**
 * The eval's report - roadmap task 5.5. Markdown, for a person to read: a
 * table of every story's scores, then each story in turn with its structural
 * checks, its rubric scores rule by rule, and its weakest lines quoted - only
 * the quotes code found in the draft. Pure: the harness hands it results and
 * writes what it returns.
 */

export type StoryResult = {
  readonly fixture: Fixture
  /** `done`: the pipeline finished. `stopped`: it failed or ran out of jobs, with why. */
  readonly outcome: 'done' | 'stopped'
  readonly message: string | null
  readonly jobs: number
  readonly tokens: number
  readonly seconds: number
  readonly logline: string | null
  readonly assumptions: readonly string[]
  readonly structural: StructuralScore | null
  readonly judgement: Judgement | null
  /** Quotes the judge gave that code could not find in the draft, and so left out. */
  readonly droppedQuotes: number
  /** The scratch project, so a reader can open the draft. */
  readonly projectId: string | null
}

const yes = (value: boolean): string => (value ? 'yes' : '**no**')

const cell = (text: string): string => text.replace(/\|/gu, '\\|').replace(/\n/gu, ' ')

const lowest = (judgement: Judgement | null, rules: readonly CraftRule[]): string => {
  if (judgement === null || judgement.scores.length === 0) return '—'
  const worst = [...judgement.scores].sort((a, b) => a.score - b.score)[0]
  if (worst === undefined) return '—'
  const rule = rules.find((entry) => entry.number === worst.rule)
  return `${String(worst.rule)} (${String(worst.score)})${rule === undefined ? '' : ` ${cell(rule.text.split(/[.:]/u)[0] ?? '')}`}`
}

export const buildReport = (input: { readonly startedAt: string; readonly model: string; readonly rules: readonly CraftRule[]; readonly results: readonly StoryResult[] }): string => {
  const { results, rules } = input
  const passed = results.filter((result) => result.structural?.pass === true).length
  const means = results.flatMap((result) => {
    const mean = result.judgement === null ? null : meanScore(result.judgement.scores)
    return mean === null ? [] : [mean]
  })
  const overall = means.length === 0 ? null : Math.round((means.reduce((total, mean) => total + mean, 0) / means.length) * 10) / 10

  const lines: string[] = [
    `# Story-to-script evals - ${input.startedAt.slice(0, 10)}`,
    '',
    `Run ${input.startedAt} with \`${input.model}\`, against the craft rules in \`docs/agents/craft.md\` (${String(rules.length)} rules). Structural checks are code's; the rubric is the model's, and every quote below was found in the draft by code.`,
    '',
    `**${String(passed)} of ${String(results.length)}** stories pass every structural check. Mean rubric score **${overall === null ? '—' : String(overall)}** of 5.`,
    '',
    '| Story | Kind | Finished | Parses | Unresolved cues | Headings / planned | Rubric | Weakest rule |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((result) => {
      const s = result.structural
      const mean = result.judgement === null ? null : meanScore(result.judgement.scores)
      return `| ${cell(result.fixture.title)} (\`${result.fixture.id}\`) | ${result.fixture.kind} | ${yes(result.outcome === 'done')} | ${s === null ? '—' : yes(s.parses)} | ${s === null ? '—' : String(s.unresolvedCues.length)} | ${s === null ? '—' : `${String(s.headings)} / ${s.plannedScenes === null ? '?' : String(s.plannedScenes)}`} | ${mean === null ? '—' : String(mean)} | ${lowest(result.judgement, rules)} |`
    }),
    '',
  ]

  for (const result of results) {
    const s = result.structural
    lines.push(`## ${result.fixture.title} - ${result.fixture.kind}`, '')
    lines.push(`> ${result.fixture.story.split('\n')[0] ?? ''}`, '')
    lines.push(`${String(result.jobs)} jobs, ${result.tokens.toLocaleString('en-US')} tokens, ${String(Math.round(result.seconds))} s.${result.projectId === null ? '' : ` Scratch project \`${result.projectId}\`.`}`, '')
    if (result.message !== null) lines.push(`**Stopped:** ${result.message}`, '')
    if (result.logline !== null) lines.push(`**As the pipeline read it:** ${result.logline}`, '')
    if (result.assumptions.length > 0) lines.push('**Assumptions it stated:**', '', ...result.assumptions.map((assumption) => `- ${assumption}`), '')
    if (s !== null) {
      lines.push('**Structure**', '')
      lines.push(`- Parses as a screenplay: ${yes(s.parses)}${s.parseProblem === null ? '' : ` - ${s.parseProblem}`}`)
      lines.push(`- Unresolved cues after derive: ${String(s.unresolvedCues.length)}${s.unresolvedCues.length === 0 ? '' : ` (${s.unresolvedCues.join(', ')})`}`)
      lines.push(`- Opens on a heading: ${yes(s.opensOnHeading)}; ${String(s.headings)} headings for ${s.plannedScenes === null ? 'an unknown number of' : String(s.plannedScenes)} planned scenes${s.unreadableHeadings.length === 0 ? '' : `; unreadable: ${s.unreadableHeadings.join('; ')}`}`)
      lines.push('')
    }
    if (result.judgement !== null) {
      const j = result.judgement
      lines.push('**Rubric**', '', '| Rule | Score | Note |', '| --- | --- | --- |')
      for (const score of [...j.scores].sort((a, b) => a.rule - b.rule)) {
        const rule = rules.find((entry) => entry.number === score.rule)
        lines.push(`| ${String(score.rule)}. ${cell((rule?.text ?? '').slice(0, 70))}${(rule?.text.length ?? 0) > 70 ? '...' : ''} | ${String(score.score)} | ${cell(score.note)} |`)
      }
      lines.push('', `*${j.summary}*`, '')
      if (j.weakSpots.length > 0) {
        lines.push('**Weak spots**', '')
        for (const spot of j.weakSpots) lines.push(`- Rule ${String(spot.rule)}: ${spot.note}`, `  > ${spot.quote.replace(/\n/gu, '\n  > ')}`)
        lines.push('')
      }
      if (result.droppedQuotes > 0) lines.push(`_${String(result.droppedQuotes)} quote(s) the judge gave were not in the draft and were left out._`, '')
    }
  }
  return lines.join('\n')
}
