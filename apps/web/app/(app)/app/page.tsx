import { SIDEBAR } from '../_shell/nav'

/**
 * `/app` — where a sign-in lands, and the only page inside the shell this
 * phase builds.
 *
 * ## Why this exists when the brief says "no product routes yet"
 *
 * The brief names six routes not to build: `/app/new`, `/app/recents`,
 * `/app/screenwriting`, `/app/filmmaking`, `/app/trash` and `/app/settings`.
 * `/app` itself is not among them, and something has to be: it is the redirect
 * target for sign-in, for the OAuth callback and for the proxy bounce, and
 * without it a successful sign-in lands on a 404 and the shell has no page to
 * render inside.
 *
 * It is deliberately not a product surface. It states what is built and what is
 * not, and it names the four routes as unbuilt rather than drawing empty states
 * for them - AGENTS.md is emphatic that "Both states always" means populated
 * and empty ship *together*, so half of an empty state now would be a route
 * claiming to be finished.
 *
 * The header geometry is the bundles': 46px tall, `0 14px`, 1px bottom border
 * `--line`, route title in Newsreader 21px/500 at `-.01em`.
 */
const AppHome = () => (
  <>
    <header className="flex h-[46px] flex-none items-center border-b border-line px-[14px]">
      <h1 className="m-0 font-serif text-21 font-medium tracking-title">Folio</h1>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[460px] px-[14px] py-[48px]">
        <p className="m-0 text-12-5 leading-[1.6] text-ink2">
          You are signed in. The shell around this page — the sidebar, the theme and the avatar
          menu — is the whole of what this phase built.
        </p>

        <p className="mb-0 mt-[14px] text-12-5 leading-[1.6] text-ink2">
          The four sidebar sections are not built yet and will 404. They arrive next, each with
          both of its states.
        </p>

        <ul className="mt-[18px] list-none border-t border-line2 p-0">
          {SIDEBAR.map((item) => (
            <li
              key={item.href}
              className="flex items-baseline justify-between border-b border-line2 py-[7px] text-11-5 text-ink2"
            >
              <span>{item.label}</span>
              <span className="tabular text-10-5 text-ink3">{item.href}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </>
)

export default AppHome
