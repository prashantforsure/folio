import { GoogleForm, SignUpForm } from '../_form/forms'
import { safeNextParam } from '../../../lib/routes'
import { AuthCard, AuthLink, OrRule } from '../_form/shell'

type Search = Record<string, string | string[] | undefined>

/**
 * `/sign-up`.
 *
 * The blurb states the confirmation step before the form is filled in, rather
 * than after it is submitted. Somebody who signs up with a work address they
 * cannot read for an hour should find that out first, and this project sends
 * through Supabase's built-in email, which is both slow and rate limited.
 */
const SignUpPage = async ({ searchParams }: { searchParams: Promise<Search> }) => {
  const params = await searchParams
  const next = safeNextParam(params['next'])

  return (
    <AuthCard
      title="Create a Folio account"
      blurb="Signing up with an email sends a confirmation link before you can sign in. Google needs no confirmation."
      footer={
        <>
          Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>.
        </>
      }
    >
      <GoogleForm next={next} />
      <OrRule />
      <SignUpForm next={next} />
    </AuthCard>
  )
}

export default SignUpPage
