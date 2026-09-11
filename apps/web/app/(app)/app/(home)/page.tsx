import { redirect } from 'next/navigation'

/**
 * `/app` is where a sign-in, the OAuth callback and the proxy bounce all land,
 * and it has nothing of its own to show. The brief: "/app → redirect to
 * /app/new" - the landing route after login, where every project begins.
 *
 * `requireUser()` has already run in the layout, so an unauthenticated visitor
 * never reaches this line.
 */
const AppHome = () => {
  redirect('/app/new')
}

export default AppHome
