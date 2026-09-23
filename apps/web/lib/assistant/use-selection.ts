'use client'

import type { EditorState } from '@tiptap/pm/state'
import { useCallback, useEffect, useRef } from 'react'

import type { AssistantSelection } from '../state/ephemeral'
import { useEphemeral } from '../state/ephemeral'
import { sameSelection, selectedNodeIds } from './selection'

/**
 * An editor's channel to the assistant's selection (roadmap task 2.6) - the
 * `assistantFocus` pattern: the editor publishes, the panel reads, and
 * unmounting clears it so a selection never outlives its page.
 *
 * Returns a stable `publish(state)` the editor calls from `onSelectionUpdate`.
 * It publishes only when the selected ids change: a keystroke inside one block
 * moves the selection but not its ids, and the ephemeral context re-renders
 * every consumer when it changes.
 */
export const useSelectionPublisher = (kind: AssistantSelection['kind']): ((state: EditorState) => void) => {
  const { setAssistantSelection } = useEphemeral()
  const set = useRef(setAssistantSelection)
  set.current = setAssistantSelection
  const last = useRef<readonly string[] | null>(null)

  useEffect(
    () => () => {
      last.current = null
      set.current(null)
    },
    [],
  )

  return useCallback(
    (state: EditorState) => {
      const ids = selectedNodeIds(state)
      if (sameSelection(last.current, ids)) return
      last.current = ids
      set.current(ids.length === 0 ? null : { kind, nodeIds: ids })
    },
    [kind],
  )
}
