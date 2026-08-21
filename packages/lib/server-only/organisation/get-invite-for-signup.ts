import { prisma } from '@documenso/prisma';

import type { InviteForSignup } from '../../utils/invited-signup';

export type GetInviteForSignupOptions = {
  /** The token from the invitation link, if the caller supplied one at all. */
  token?: string | null;
};

/**
 * The invite behind a signup attempt, or null when there is nothing to find.
 *
 * Returns null rather than throwing on an unknown token: whether the signup is
 * then allowed is `isSignupAllowed`'s call, and a missing invite is an ordinary
 * answer to this question, not an exception. It also keeps the endpoint from
 * telling a stranger which tokens exist.
 */
export const getInviteForSignup = async ({ token }: GetInviteForSignupOptions): Promise<InviteForSignup | null> => {
  if (!token) {
    return null;
  }

  return await prisma.organisationMemberInvite.findUnique({
    where: {
      token,
    },
    select: {
      email: true,
      status: true,
    },
  });
};
