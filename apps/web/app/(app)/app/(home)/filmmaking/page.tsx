import { redirect } from 'next/navigation'

/**
 * `/app/filmmaking` - kept as a redirect to `/app/projects`.
 *
 * The three list routes - Recents, Screenwriting and Filmmaking - were three
 * views over one query until the client ruled them into one route with filter
 * chips (2026-09-22, `handoff-account-v2/`). The paths stay because links to
 * them exist outside this app's control - a bookmark, a share, a mail - and
 * because `/app/filmmaking` in particular is named in AGENTS.md as where a
 * filmmaking project lands (open decision 9). The chip the list opens on is
 * client state and not in the URL, so a redirect cannot carry one, and the
 * writer lands on `All`.
 */
const Page = () => {
  redirect('/app/projects')
}

export default Page
