import { OrganisationMemberInviteStatus } from '@prisma/client';

/**
 * The part of an organisation invite this decision needs.
 *
 * Deliberately not the Prisma model: the rule is about a status and an email
 * address, and taking the whole row would drag a database type into something
 * that is pure arithmetic on two values.
 */
export type InviteForSignup = {
  email: string;
  status: OrganisationMemberInviteStatus;
};

export type IsInvitedSignupOptions = {
  /** The invite the supplied token resolved to, or null when there was none. */
  invite: InviteForSignup | null;
  /** The address the person typed into the signup form. */
  email: string;
};

/**
 * Whether this signup rides on a real invitation.
 *
 * Exists because closing public registration also closed the only door an
 * invited person has. `NEXT_PUBLIC_DISABLE_SIGNUP` turns off `/signup`
 * entirely, and the invite page sends someone without an account to exactly
 * that page, so the invitation could never be accepted.
 *
 * Two conditions, and both carry weight:
 *
 * - the invite must still be PENDING, so an accepted or declined one is spent
 *   rather than reusable;
 * - the typed address must be the invited address, because without that a
 *   single leaked token would let anyone create an account under any address.
 *   The token alone proves nothing about who is holding it.
 *
 * Case-insensitive on the address: the rest of the codebase stores and looks
 * users up lowercased, so treating `Tim@` and `tim@` as different people here
 * would refuse a legitimate invitee over their own capitalisation.
 */
export const isInvitedSignup = ({ invite, email }: IsInvitedSignupOptions): boolean => {
  if (!isPendingInvite(invite)) {
    return false;
  }

  return invite.email.toLowerCase() === email.trim().toLowerCase();
};

/**
 * Whether this invitation is still open, without asking who is holding it.
 *
 * Enough to decide that the signup form should be rendered at all: the page
 * fills the address in from the invitation itself, so at that point there is no
 * second address to compare against. The endpoint still checks both.
 */
export const isPendingInvite = (invite: InviteForSignup | null): invite is InviteForSignup =>
  invite !== null && invite.status === OrganisationMemberInviteStatus.PENDING;

export type IsSignupAllowedOptions = IsInvitedSignupOptions & {
  /** Whether ordinary email/password signup is open, per the env flags. */
  isEmailSignupEnabled: boolean;
};

/**
 * The single question the signup endpoint asks: may this registration proceed?
 *
 * Kept as one function so the server route and the page that renders the form
 * cannot drift apart. A page that shows the form while the API refuses it is
 * the same dead end in a nicer outfit.
 */
export const isSignupAllowed = ({ isEmailSignupEnabled, invite, email }: IsSignupAllowedOptions): boolean =>
  isEmailSignupEnabled || isInvitedSignup({ invite, email });
