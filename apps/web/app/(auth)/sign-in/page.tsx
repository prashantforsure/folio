import { GoogleForm, SignInForm } from '../_form/forms'
import { firstParam, safeNextParam } from '../../../lib/routes'
import { AuthCard, AuthLink, CallbackProblem, OrRule } from '../_form/shell'

type Search = Record<string, string | string[] | undefined>

/**
 * `/sign-in`. Both methods, on one page.
 *
 * Google first, because it is the one that needs no email to be delivered and
 * therefore the one that always works. The password form is below it, and the
 * blurb says out loud that Folio's mail goes through Supabase's built-in sender
 * - the user is the one who waits for those messages, so they are the one who
 * should know why they are slow.
 *
 * A Server Component: `searchParams` is read here and only the two forms ship.
 */
const SignInPage = async ({ searchParams }: { searchParams: Promise<Search> }) => {
  const params = await searchParams
  const next = safeNextParam(params['next'])

  return (
    <AuthCard
      title="Sign in to Folio"
      blurb="The script is the source of truth. Everything else is a view of it."
      footer={
        <>
          No account yet? <AuthLink href="/sign-up">Create one</AuthLink>.
        </>
      }
    >
      <CallbackProblem problem={firstParam(params['problem'])} />
      <GoogleForm next={next} />
      <OrRule />
      <SignInForm next={next} />
    </AuthCard>
  )
}

export default SignInPage
