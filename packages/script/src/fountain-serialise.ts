import { isContinuedLine, isMoreLine, readCue, writeCue } from './generated-text'
import {
  FORCE_ACTION,
  FORCE_CHARACTER,
  FORCE_SCENE,
  FORCE_TRANSITION,
  CENTRE_CLOSE,
  containsMentionToken,
  hasControlCharacter,
  idIsWritable,
  isBoneyardBlock,
  isNaturalCue,
  isNaturalHeading,
  isNaturalTransition,
  isNoteBlock,
  isParentheticalLine,
  isTitlePageBlock,
  renderContent,
} from './fountain-syntax'
import type { NodeId } from './ids'
import type { DeliveryModifier, ScreenplayNode } from './node'

/**
 * A node list to Fountain text.
 *
 * The contract this file exists to keep: **for every node list it does not
 * report, `parseFountain(serialiseFountain(nodes).text)` returns the same
 * nodes, in the same order, with the same types.** It keeps it by never
 * guessing what the parser will do - every decision below is made by calling
 * one of the parser's own predicates from `fountain-syntax.ts` and forcing when
 * the answer is not the one it needs.
 *
 * ## Forcing is the mechanism
 *
 * Fountain infers most elements from shape, so a node whose text happens to
 * have the wrong shape would come back as a different type. An Action node
 * reading `INT. HOUSE - DAY` would return as a Scene; a two-line Action whose
 * first line is uppercase would return as a cue and a line of dialogue, minting
 * a character that does not exist. Both are the failure AGENTS.md names - a
 * derived surface quietly becoming authoritative - so the serialiser writes
 * `!INT. HOUSE - DAY` and the type survives.
 *
 * ## It never repairs, it reports
 *
 * Some node lists cannot be written as Fountain at all: a Dialogue node with no
 * cue before it, a Parenthetical outside a speech, a cue whose *name* contains
 * a `(CONT'D)`. Rather than silently rewriting the writer's document into
 * something expressible, `unrepresentable` names the node and the reason and
 * the text is still produced on a best-effort basis. Nothing throws.
 *
 * The cue case is worth naming: a `CharacterNode` whose content is
 * `MEERA (CONT'D)` is the doubling bug arriving from the other direction - the
 * artefact got into the node stream somehow, and writing it out would have the
 * parser strip it, so the round trip would lose a character. Reporting it makes
 * that visible instead of silent.
 */

export type UnrepresentableReason =
  /** A Scene or Dialogue node with nothing in it has no line to occupy. */
  | { readonly kind: 'empty-content' }
  /** A blank line ends a block, so content cannot contain one. */
  | { readonly kind: 'blank-line-in-content' }
  /** Tabs and other control characters do not survive a line-based format. */
  | { readonly kind: 'control-character' }
  /** Parsing trims every line, so leading or trailing space would be lost. */
  | { readonly kind: 'untrimmed-line' }
  /** This element occupies exactly one line and the content spans several. */
  | { readonly kind: 'multi-line' }
  /** A Scene heading beginning with `.` cannot be forced - `..` is an ellipsis. */
  | { readonly kind: 'leading-dot-in-heading' }
  /** A forced Transition ending in `<` would read back as centred text. */
  | { readonly kind: 'trailing-centre-marker' }
  /** Reading the cue back would not give the same name and modifiers. */
  | { readonly kind: 'cue-not-recoverable'; readonly wrote: string }
  /** A `(MORE)` or `(CONT'D)` in content the parser would strip on the way back. */
  | { readonly kind: 'generated-text-in-content' }
  /** Literal text that would read back as a mention. */
  | { readonly kind: 'mention-token-in-text' }
  /** A record id containing `}` or a newline cannot be written into a token. */
  | { readonly kind: 'unwritable-mention-id'; readonly id: string }
  /** A comment containing `[[` or `]]` cannot be wrapped in them. */
  | { readonly kind: 'note-delimiter-in-content' }
  /** A Parenthetical node whose content is not one balanced `( ... )`. */
  | { readonly kind: 'paren-not-parenthesised' }
  /** A Dialogue line that is wholly parenthesised would read back as a Paren. */
  | { readonly kind: 'parenthetical-line-in-dialogue' }
  /** Dialogue or a Parenthetical with no character cue opening the speech. */
  | { readonly kind: 'orphan-in-dialogue-block' }
  /** Two Dialogue nodes in a row read back as one. */
  | { readonly kind: 'adjacent-dialogue' }

export type Unrepresentable = {
  readonly id: NodeId
  readonly reason: UnrepresentableReason
}

export type FountainSerialise = {
  readonly text: string
  /** Empty means the round trip is an identity. Non-empty names every reason. */
  readonly unrepresentable: readonly Unrepresentable[]
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * A character cue opens a speech; parentheticals, dialogue and notes continue
 * it. Everything else stands alone. This is the same grouping the parser
 * applies to blank-line-separated blocks, run in the other direction.
 */
type SerialBlock = {
  readonly nodes: readonly ScreenplayNode[]
  readonly dialogue: boolean
}

const toSerialBlocks = (nodes: readonly ScreenplayNode[]): readonly SerialBlock[] => {
  const blocks: { nodes: ScreenplayNode[]; dialogue: boolean }[] = []
  let open: { nodes: ScreenplayNode[]; dialogue: boolean } | undefined = undefined
  for (const node of nodes) {
    if (node.type === 'character') {
      open = { nodes: [node], dialogue: true }
      blocks.push(open)
      continue
    }
    const continues =
      open !== undefined &&
      (node.type === 'dialogue' || node.type === 'paren' || node.type === 'comment')
    if (continues && open !== undefined) {
      open.nodes.push(node)
      continue
    }
    open = undefined
    blocks.push({ nodes: [node], dialogue: false })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

const startsWithForcingCharacter = (line: string): boolean => /^[.!@>#=~]/u.test(line)

const sameModifiers = (a: readonly DeliveryModifier[], b: readonly DeliveryModifier[]): boolean =>
  a.length === b.length && a.every((modifier, index) => modifier === b[index])

class Writer {
  readonly unrepresentable: Unrepresentable[] = []

  report(id: NodeId, reason: UnrepresentableReason): void {
    this.unrepresentable.push({ id, reason })
  }

  /** Checks that apply to every node whatever its type. */
  common(node: ScreenplayNode, text: string): void {
    for (const run of node.content) {
      if (run.kind === 'mention') {
        if (!idIsWritable(run.target.id)) {
          this.report(node.id, { kind: 'unwritable-mention-id', id: run.target.id })
        }
        continue
      }
      if (containsMentionToken(run.text)) {
        this.report(node.id, { kind: 'mention-token-in-text' })
      }
    }
    if (hasControlCharacter(text)) this.report(node.id, { kind: 'control-character' })
    if (text.includes('\n\n')) this.report(node.id, { kind: 'blank-line-in-content' })
    for (const line of text.split('\n')) {
      if (line !== line.trim()) {
        this.report(node.id, { kind: 'untrimmed-line' })
        break
      }
    }
  }

  requireSingleLine(node: ScreenplayNode, text: string): void {
    if (text.includes('\n')) this.report(node.id, { kind: 'multi-line' })
  }
}

const sceneLine = (writer: Writer, node: ScreenplayNode, text: string): string => {
  writer.requireSingleLine(node, text)
  if (text === '') {
    writer.report(node.id, { kind: 'empty-content' })
    return FORCE_SCENE
  }
  if (isNaturalHeading(text) && !startsWithForcingCharacter(text)) return text
  if (text.startsWith(FORCE_SCENE)) writer.report(node.id, { kind: 'leading-dot-in-heading' })
  return `${FORCE_SCENE}${text}`
}

const actionNeedsForce = (lines: readonly string[], first: boolean): boolean => {
  const head = lines[0]
  if (head === undefined) return true
  if (startsWithForcingCharacter(head)) return true
  if (isNaturalHeading(head)) return true
  if (isNoteBlock(lines) || isBoneyardBlock(lines)) return true
  if (first && isTitlePageBlock(lines)) return true
  if (isNaturalCue(head, lines.length > 1)) return true
  if (lines.length === 1) {
    if (isNaturalTransition(head)) return true
    if (isMoreLine(head) || isContinuedLine(head)) return true
    if (isParentheticalLine(head)) return true
  }
  return false
}

const actionLines = (text: string, first: boolean): readonly string[] => {
  const lines = text === '' ? [''] : text.split('\n')
  if (!actionNeedsForce(lines, first) && text !== '') return lines
  const head = lines[0] ?? ''
  return [`${FORCE_ACTION}${head}`, ...lines.slice(1)]
}

const cueLine = (
  writer: Writer,
  node: ScreenplayNode,
  text: string,
  modifiers: readonly DeliveryModifier[],
  followedByLine: boolean,
): string => {
  writer.requireSingleLine(node, text)
  const written = writeCue(text, modifiers)
  const back = readCue(written)
  if (back.name !== text || !sameModifiers(back.modifiers, modifiers) || back.dual) {
    writer.report(node.id, { kind: 'cue-not-recoverable', wrote: written })
  }
  if (back.artefacts.length > 0) {
    writer.report(node.id, { kind: 'generated-text-in-content' })
  }
  const needsForce = startsWithForcingCharacter(written) || !isNaturalCue(written, followedByLine)
  // `@{` opens a mention token, so it cannot also be a forcing character. A cue
  // whose name starts with `{` and needs forcing has nowhere to go.
  if (needsForce && written.startsWith('{')) {
    writer.report(node.id, { kind: 'cue-not-recoverable', wrote: `${FORCE_CHARACTER}${written}` })
  }
  return needsForce ? `${FORCE_CHARACTER}${written}` : written
}

const transitionLine = (writer: Writer, node: ScreenplayNode, text: string): string => {
  writer.requireSingleLine(node, text)
  if (isNaturalTransition(text) && !startsWithForcingCharacter(text)) return text
  if (text.endsWith(CENTRE_CLOSE)) writer.report(node.id, { kind: 'trailing-centre-marker' })
  return `${FORCE_TRANSITION}${text}`
}

const subtitleLine = (writer: Writer, node: ScreenplayNode, text: string): string => {
  writer.requireSingleLine(node, text)
  return `${FORCE_TRANSITION} ${text} ${CENTRE_CLOSE}`
}

const commentLines = (writer: Writer, node: ScreenplayNode, text: string): readonly string[] => {
  if (text.includes('[[') || text.includes(']]')) {
    writer.report(node.id, { kind: 'note-delimiter-in-content' })
  }
  return `[[${text}]]`.split('\n')
}

const parenLine = (writer: Writer, node: ScreenplayNode, text: string): string => {
  writer.requireSingleLine(node, text)
  if (!isParentheticalLine(text)) writer.report(node.id, { kind: 'paren-not-parenthesised' })
  if (isMoreLine(text) || isContinuedLine(text)) {
    writer.report(node.id, { kind: 'generated-text-in-content' })
  }
  return text
}

const dialogueLines = (writer: Writer, node: ScreenplayNode, text: string): readonly string[] => {
  if (text === '') {
    writer.report(node.id, { kind: 'empty-content' })
    return ['']
  }
  const lines = text.split('\n')
  for (const line of lines) {
    if (isParentheticalLine(line)) {
      writer.report(node.id, { kind: 'parenthetical-line-in-dialogue' })
      break
    }
  }
  for (const line of lines) {
    if (isMoreLine(line) || isContinuedLine(line)) {
      writer.report(node.id, { kind: 'generated-text-in-content' })
      break
    }
  }
  return lines
}

export const serialiseFountain = (nodes: readonly ScreenplayNode[]): FountainSerialise => {
  const writer = new Writer()
  const blocks = toSerialBlocks(nodes)
  const rendered: string[] = []

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]
    if (block === undefined) continue
    const isFirstBlock = blockIndex === 0
    const lines: string[] = []
    let previousType: ScreenplayNode['type'] | undefined = undefined

    for (let index = 0; index < block.nodes.length; index += 1) {
      const node = block.nodes[index]
      if (node === undefined) continue
      const text = renderContent(node.content)
      writer.common(node, text)

      switch (node.type) {
        case 'scene':
          lines.push(sceneLine(writer, node, text))
          break
        case 'action':
          lines.push(...actionLines(text, isFirstBlock))
          break
        case 'character': {
          // The cue is natural only if a line follows it in this same block.
          lines.push(cueLine(writer, node, text, node.modifiers, block.nodes.length > 1))
          break
        }
        case 'paren':
          if (!block.dialogue) writer.report(node.id, { kind: 'orphan-in-dialogue-block' })
          lines.push(parenLine(writer, node, text))
          break
        case 'dialogue':
          if (!block.dialogue) writer.report(node.id, { kind: 'orphan-in-dialogue-block' })
          if (previousType === 'dialogue') writer.report(node.id, { kind: 'adjacent-dialogue' })
          lines.push(...dialogueLines(writer, node, text))
          break
        case 'transition':
          lines.push(transitionLine(writer, node, text))
          break
        case 'comment':
          if (block.dialogue) writer.requireSingleLine(node, text)
          lines.push(...commentLines(writer, node, text))
          break
        case 'subtitle':
          lines.push(subtitleLine(writer, node, text))
          break
      }
      previousType = node.type
    }

    rendered.push(lines.join('\n'))
  }

  return { text: rendered.join('\n\n'), unrepresentable: writer.unrepresentable }
}
