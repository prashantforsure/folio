# There is no browser Supabase client, and that is deliberate

`lib/auth/` holds three ways to reach Supabase Auth and **none of them runs in the browser**:

| File | Runtime | Cookie store |
| --- | --- | --- |
| [server.ts](server.ts) | Node, Server Components and Server Actions | `cookies()` — reads; cannot write |
| [edge.ts](edge.ts) | Edge, [`proxy.ts`](../../proxy.ts) | the request/response pair — the only place a refreshed token persists |
| [actions.ts](actions.ts) | Node, Server Actions | via `server.ts` |

A `createBrowserClient` wrapper was written first and then deleted, because nothing needed it:

- **Google** — `signInWithOAuth({ skipBrowserRedirect: true })` on the server, then `redirect()`. The
  PKCE code verifier is then a cookie our own server wrote, which is stricter than letting the
  browser hold it.
- **Email and password** — server actions.
- **Password reset** — `/auth/callback` exchanges the recovery token for a session before
  `/reset-password` renders, so by the time the form appears the visitor is signed in and
  `updateUser` is an ordinary server action.
- **Sign-out** — a `<form action={signOut}>`, so it works before hydration.

The consequence is worth stating plainly: **no Supabase SDK and no `NEXT_PUBLIC_SUPABASE_*` value is
in the client bundle at all.** The anon key is public by design and would be harmless there, but not
shipping it is smaller, faster, and leaves one fewer thing for
[`scripts/assert-no-server-secrets.mjs`](../../scripts/assert-no-server-secrets.mjs) to reason about.

Add a browser client when something genuinely needs one — a realtime subscription, or a
direct-to-Storage upload that should not pass through the server. Put it in this directory, because
`eslint.config.mjs` confines `@supabase/*` imports to `lib/auth/**` and `lib/storage/**`; mark it
`'use client'`; and do not import `@folio/db/env` from it, which throws in a browser on purpose.
