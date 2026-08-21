import {
  IS_GOOGLE_SSO_ENABLED,
  IS_MICROSOFT_SSO_ENABLED,
  IS_OIDC_SSO_ENABLED,
  isSignupEnabledForProvider,
} from '@documenso/lib/constants/auth';
import { getInviteForSignup } from '@documenso/lib/server-only/organisation/get-invite-for-signup';
import { isPendingInvite } from '@documenso/lib/utils/invited-signup';
import { isValidReturnTo, normalizeReturnTo } from '@documenso/lib/utils/is-valid-return-to';
import { msg } from '@lingui/core/macro';
import { redirect } from 'react-router';

import { SignUpForm } from '~/components/forms/signup';
import { appMetaTags } from '~/utils/meta';

import type { Route } from './+types/signup';

export function meta() {
  return appMetaTags(msg`Sign Up`);
}

export async function loader({ request }: Route.LoaderArgs) {
  const inviteToken = new URL(request.url).searchParams.get('inviteToken');

  // An invitation is a personal key, not an open door: it re-opens email and
  // password signup for the invited address only. Resolved here so the form is
  // shown to exactly the people the endpoint will accept, and never to someone
  // who would be refused after typing everything in.
  const invite = await getInviteForSignup({ token: inviteToken });

  const isEmailPasswordSignupEnabled = isSignupEnabledForProvider('email') || isPendingInvite(invite);
  const isGoogleSignupEnabled = IS_GOOGLE_SSO_ENABLED && isSignupEnabledForProvider('google');
  const isMicrosoftSignupEnabled = IS_MICROSOFT_SSO_ENABLED && isSignupEnabledForProvider('microsoft');
  const isOidcSignupEnabled = IS_OIDC_SSO_ENABLED && isSignupEnabledForProvider('oidc');

  const isAnySignupEnabled =
    isEmailPasswordSignupEnabled || isGoogleSignupEnabled || isMicrosoftSignupEnabled || isOidcSignupEnabled;

  if (!isAnySignupEnabled) {
    throw redirect('/signin');
  }

  let returnTo = new URL(request.url).searchParams.get('returnTo') ?? undefined;

  returnTo = isValidReturnTo(returnTo) ? normalizeReturnTo(returnTo) : undefined;

  return {
    isEmailPasswordSignupEnabled,
    isGoogleSignupEnabled,
    isMicrosoftSignupEnabled,
    isOidcSignupEnabled,
    returnTo,
    // Only a still-open invitation says anything about who is signing up. A
    // spent one would otherwise lock the address field to an account that
    // already exists, for no reason the visitor could see.
    inviteToken: isPendingInvite(invite) ? inviteToken : null,
    invitedEmail: isPendingInvite(invite) ? invite.email : null,
  };
}

export default function SignUp({ loaderData }: Route.ComponentProps) {
  const {
    isEmailPasswordSignupEnabled,
    isGoogleSignupEnabled,
    isMicrosoftSignupEnabled,
    isOidcSignupEnabled,
    returnTo,
    inviteToken,
    invitedEmail,
  } = loaderData;

  return (
    <SignUpForm
      className="w-screen max-w-screen-2xl px-4 md:px-16 lg:-my-16"
      isEmailPasswordSignupEnabled={isEmailPasswordSignupEnabled}
      isGoogleSignupEnabled={isGoogleSignupEnabled}
      isMicrosoftSignupEnabled={isMicrosoftSignupEnabled}
      isOidcSignupEnabled={isOidcSignupEnabled}
      returnTo={returnTo}
      inviteToken={inviteToken}
      invitedEmail={invitedEmail}
    />
  );
}
