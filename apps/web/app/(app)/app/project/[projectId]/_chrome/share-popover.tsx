'use client'

import type { ProjectId, ShareLinkRole } from '@folio/contracts'
import { SHARE_LINK_ROLES } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { useEffect, useRef, useState, useTransition } from 'react'

import { issueShareLink, revokeShareLink } from '../../../../../../lib/share/actions'
import type { ShareLinkView } from '../../../../../../lib/share/result'

/**
 * `Share` - the solid button in every writing header, and the popover
 * behind it: the live link, the role it grants, Copy, and Revoke.
 *
 * AGENTS.md, Constraints: invites are share links copied by the inviter.
 * So the popover is the whole flow: issue a link (which revokes the last),
 * copy it, hand it over yourself. The URL is composed in the browser from
 * `window.location.origin` - the server never guesses its own host.
 *
 * `navigator.clipboard` can be refused (an insecure context, a denied
 * permission); the field is selectable and the button says so if the copy
 * failed, rather than reporting a copy that did not happen.
 */
export const SharePopover = ({ projectId, initial }: { readonly projectId: ProjectId; readonly initial: ShareLinkView }) => {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<ShareLinkView>(initial)
  const [role, setRole] = useState<ShareLinkRole>(initial?.role ?? 'writer')
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [origin, setOrigin] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const url = link === null ? '' : `${origin}/share/${link.token}`

  const issue = (nextRole: ShareLinkRole): void => {
    setNotice(null)
    setCopied('idle')
    startTransition(async () => {
      const result = await issueShareLink(projectId, nextRole)
      if (result.status !== 'issued') {
        setNotice(result.status === 'revoked' ? 'The link was revoked instead of issued.' : result.message)
        return
      }
      setLink({ token: result.link.token, role: result.link.role, createdAt: result.link.createdAt })
      setRole(result.link.role)
    })
  }

  const copy = (): void => {
    if (url.length === 0) return
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied('copied')
      })
      .catch(() => {
        setCopied('failed')
        field.current?.select()
      })
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-share-button
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="folio-solid-button h-[34px] rounded-pill px-[16px] text-13 font-medium"
      >
        Share
      </button>

      {open ? (
        <div role="dialog" aria-label="Share this project" data-share-popover className="folio-menu absolute right-0 top-[40px] w-[340px] p-[14px]">
          <div className="flex flex-col gap-[10px]">
            <span className="text-13-5 font-medium">Share with a link</span>
            <p className="m-0 text-12 leading-[1.55] text-ink2">
              Anyone signed in who opens the link joins this project. Copy it and send it yourself; nothing is emailed.
            </p>

            <div className="flex items-center gap-[6px]">
              <span className="text-12 text-ink2">Joins as</span>
              <div role="radiogroup" aria-label="Role" className="flex items-center gap-[2px] rounded-pill border border-line2 bg-s1 p-[3px]">
                {SHARE_LINK_ROLES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={role === option}
                    disabled={pending}
                    onClick={() => {
                      if (option === role && link !== null) return
                      setRole(option)
                      if (link !== null) issue(option)
                    }}
                    className={`rounded-pill px-[10px] py-[4px] text-12 ${role === option ? 'bg-s2 text-ink' : 'text-ink2'}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {link === null ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  issue(role)
                }}
                className="folio-solid-button h-[32px] rounded-[9px] px-[12px] text-12-5 font-medium"
              >
                {pending ? 'Creating…' : 'Create link'}
              </button>
            ) : (
              <>
                <div className="flex items-center gap-[6px]">
                  <input
                    ref={field}
                    readOnly
                    value={url}
                    aria-label="Share link"
                    data-share-url
                    onFocus={(event) => {
                      event.target.select()
                    }}
                    className="folio-field min-w-0 flex-1 font-mono text-11-5"
                  />
                  <button
                    type="button"
                    onClick={copy}
                    disabled={pending}
                    className="folio-pill-button flex h-[32px] items-center gap-[6px] rounded-[9px] px-[10px] text-12"
                  >
                    {copied === 'copied' ? <Icon name="check" size={13} strokeWidth={1.6} /> : <Icon name="link" size={14} />}
                    {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Select and copy' : 'Copy'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      issue(role)
                    }}
                    className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ink2"
                  >
                    New link
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setNotice(null)
                      startTransition(async () => {
                        const result = await revokeShareLink(projectId)
                        if (result.status === 'revoked') {
                          setLink(null)
                          setCopied('idle')
                        } else if (result.status !== 'issued') setNotice(result.message)
                      })
                    }}
                    className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-live"
                  >
                    Revoke link
                  </button>
                </div>
              </>
            )}
            {notice === null ? null : (
              <p role="alert" className="m-0 text-12 text-live">
                {notice}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
