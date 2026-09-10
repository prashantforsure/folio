import { ForgotPasswordForm } from '../_form/forms'
import { AuthCard, AuthLink } from '../_form/shell'

/**
 * `/forgot-password`.
 *
 * This page is the entire reason the auth model changed. Under AGENTS.md's
 * original constraint - Google only, no email provider - a forgotten password
 * had no recovery path at all, because there was nothing that could send a
 * link. Choosing Supabase's built-in sender bought exactly this, and the cost
 * is the rate limit the blurb names.
 *
 * The response is always the same sentence, whether or not the address has an
 * account: see `requestPasswordReset` in `lib/auth/actions.ts`.
 */
const ForgotPasswordPage = () => (
  <AuthCard
    title="Reset your password"
    blurb="We will email a link. Folio sends through Supabase's built-in email, which is rate limited, so it can take a few minutes."
    footer={
      <>
        Remembered it? <AuthLink href="/sign-in">Sign in</AuthLink>.
      </>
    }
  >
    <ForgotPasswordForm />
  </AuthCard>
)

export default ForgotPasswordPage
