'use client'

import { createPortal } from 'react-dom'

import type { ThreadNodeKind, ThreadView } from '../../../../../../../lib/script/panel'
import type { HostMap, Slice } from '../editor/editor-store'
import { useSlice } from '../editor/editor-store'
import { COMPOSER_HOST } from '../editor/extensions'
import { ThreadCardView } from './thread-card'
import { ThreadComposer } from './thread-composer'

/**
 * The thread cards and the composer, portalled into the editor.
 *
 * The decorations plugin creates one host element per thread after the
 * block it anchors to (and one for the composer), registers each in the
 * store's `hosts` slice, and this component portals a card into every host
 * it knows a thread for. The document owns the position; React owns the
 * card. A host whose thread is gone draws nothing; a thread whose host has
 * not been created yet (a node the editor has not rendered) waits.
 *
 * Both editors draw this: the Script's store and the Outline's each carry
 * a `hosts` slice of the same shape, and `kind` says which anchor a new
 * thread is opened with.
 */
export const ThreadCards = ({
  hosts: hostsSlice,
  kind,
  threads,
  composerAt,
  projectId,
  episode,
  onChange,
  onResolved,
  onOpened,
  onCancelComposer,
}: {
  readonly hosts: Slice<HostMap>
  readonly kind: ThreadNodeKind
  readonly threads: readonly ThreadView[]
  readonly composerAt: string | null
  readonly projectId: string
  readonly episode: string
  readonly onChange: (thread: ThreadView) => void
  readonly onResolved: (threadId: string) => void
  readonly onOpened: (thread: ThreadView) => void
  readonly onCancelComposer: () => void
}) => {
  const hosts = useSlice(hostsSlice)
  const composerHost = composerAt === null ? undefined : hosts.get(COMPOSER_HOST)
  return (
    <>
      {threads.map((thread) => {
        const host = hosts.get(thread.id)
        if (host === undefined) return null
        return createPortal(
          <ThreadCardView thread={thread} projectId={projectId} episode={episode} onChange={onChange} onResolved={onResolved} />,
          host,
          thread.id,
        )
      })}
      {composerAt !== null && composerHost !== undefined
        ? createPortal(
            <ThreadComposer
              nodeId={composerAt}
              kind={kind}
              projectId={projectId}
              episode={episode}
              onOpened={onOpened}
              onCancel={onCancelComposer}
            />,
            composerHost,
            COMPOSER_HOST,
          )
        : null}
    </>
  )
}
