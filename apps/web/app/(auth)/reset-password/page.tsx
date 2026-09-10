import { ResetPasswordForm } from '../_form/forms'
import { firstParam } from '../../../lib/routes'
import { AuthCard, AuthLink, CallbackProblem } from '../_form/shell'

type Search = Record<string, string | string[] | undefined>

/**
 * `/reset-password`. Reached only from a recovery link.
 *
 * By the time this renders, `/auth/callback` has already exchanged the token
 * for a session - so the visitor **is** signed in, and that session is the
 * authorisation for the change. That is why `proxy.ts` deliberately does
 * not bounce signed-in visitors away from this path the way it does for
 * `/sign-in` and `/sign-up`: doing so would make the page unreachable by
 * exactly the people it exists for.
 *
 * Arriving here without a valid session is the expected failure - reset links
 * are single-use and mail clients pre-fetch them - and `updatePassword` returns
 * a plain sentence saying to ask for a new one rather than an error page.
 */
const ResetPasswordPage = async ({ searchParams }: { searchParams: Promise<Search> }) => {
  const params = await searchParams

  return (
    <AuthCard
      title="Choose a new password"
      blurb="This link signed you in. Set a password and it will be the one you use next time."
      footer={
        <>
          Link expired? <AuthLink href="/forgot-password">Ask for another</AuthLink>.
        </>
      }
    >
      <CallbackProblem problem={firstParam(params['problem'])} />
      <ResetPasswordForm />
    </AuthCard>
  )
}

export default ResetPasswordPage
