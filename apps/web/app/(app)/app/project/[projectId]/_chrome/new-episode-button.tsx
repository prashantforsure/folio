'use client'

import type { ProjectId } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import { useActionState } from 'react'

import { createEpisode } from '../../../../../../lib/workspace/actions'
import { IDLE } from '../../../../../../lib/workspace/result'

/**
 * `＋` - "New episode". 22x22, in the nav header, series only.
 *
 * A form posting to a server action, for the same reason sign-out is: adding
 * an episode is a mutation, and it works before hydration. The action
 * refuses for a film; this button is simply not rendered for one.
 *
 * `＋` is U+FF0B, the bundle's own character for this button and the one
 * glyph outside AGENTS.md's eighteen (`UNSPECIFIED_GLYPHS` in `@folio/ui`).
 *
 * The refusal message, when there is one, is announced but not drawn: the
 * header row has no room for a sentence, and a member who can see the
 * button can never trigger the film refusal. It exists for the case the
 * server sees that the client did not.
 */
export const NewEpisodeButton = ({ projectId }: { readonly projectId: ProjectId }) => {
  const [result, action, pending] = useActionState(createEpisode, IDLE)

  return (
    <form action={action} className="contents">
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={pending}
        title="New episode"
        aria-label="New episode"
        className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-chrome border-none bg-transparent text-13 text-ink3 hover:bg-hover disabled:cursor-default"
      >
        <Glyph name="create" />
      </button>
      {result.status === 'error' ? (
        <p role="alert" className="sr-only">
          {result.message}
        </p>
      ) : null}
    </form>
  )
}
