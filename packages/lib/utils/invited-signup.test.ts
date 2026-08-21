import { OrganisationMemberInviteStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { isInvitedSignup, isPendingInvite, isSignupAllowed } from './invited-signup';

const pending = (email: string) => ({
  email,
  status: OrganisationMemberInviteStatus.PENDING,
});

describe('isInvitedSignup', () => {
  it('accepts a pending invite for the same address', () => {
    expect(isInvitedSignup({ invite: pending('tim@edomatch.com'), email: 'tim@edomatch.com' })).toBe(true);
  });

  it('refuses when there is no invite at all', () => {
    expect(isInvitedSignup({ invite: null, email: 'tim@edomatch.com' })).toBe(false);
  });

  /**
   * The load-bearing one. Without the address check a single leaked token
   * would let anyone register under any address, and closing signup would
   * have bought nothing.
   */
  it('refuses a valid token used with a different address', () => {
    expect(isInvitedSignup({ invite: pending('tim@edomatch.com'), email: 'aanvaller@elders.com' })).toBe(false);
  });

  it('ignores capitalisation, because users are stored lowercased', () => {
    expect(isInvitedSignup({ invite: pending('Tim@Edomatch.com'), email: 'tim@edomatch.com' })).toBe(true);
    expect(isInvitedSignup({ invite: pending('tim@edomatch.com'), email: '  TIM@edomatch.com  ' })).toBe(true);
  });

  it('refuses an invite that was already accepted', () => {
    const invite = { email: 'tim@edomatch.com', status: OrganisationMemberInviteStatus.ACCEPTED };

    expect(isInvitedSignup({ invite, email: 'tim@edomatch.com' })).toBe(false);
  });

  it('refuses an invite that was declined', () => {
    const invite = { email: 'tim@edomatch.com', status: OrganisationMemberInviteStatus.DECLINED };

    expect(isInvitedSignup({ invite, email: 'tim@edomatch.com' })).toBe(false);
  });

  /** A near miss is a miss: no prefix or suffix matching on the address. */
  it('refuses an address that merely resembles the invited one', () => {
    expect(isInvitedSignup({ invite: pending('tim@edomatch.com'), email: 'tim@edomatch.com.evil.com' })).toBe(false);
    expect(isInvitedSignup({ invite: pending('tim@edomatch.com'), email: 'im@edomatch.com' })).toBe(false);
  });
});

describe('isPendingInvite', () => {
  it('accepts an open invitation', () => {
    expect(isPendingInvite(pending('tim@edomatch.com'))).toBe(true);
  });

  it('refuses nothing at all', () => {
    expect(isPendingInvite(null)).toBe(false);
  });

  /** A spent invitation must not re-open the signup form. */
  it('refuses one that is already accepted or declined', () => {
    expect(isPendingInvite({ email: 'tim@edomatch.com', status: OrganisationMemberInviteStatus.ACCEPTED })).toBe(false);
    expect(isPendingInvite({ email: 'tim@edomatch.com', status: OrganisationMemberInviteStatus.DECLINED })).toBe(false);
  });
});

describe('isSignupAllowed', () => {
  it('lets an ordinary signup through while registration is open', () => {
    expect(isSignupAllowed({ isEmailSignupEnabled: true, invite: null, email: 'wie@dan.ook' })).toBe(true);
  });

  /** The whole point of the env flag: no invite, no account. */
  it('refuses an ordinary signup once registration is closed', () => {
    expect(isSignupAllowed({ isEmailSignupEnabled: false, invite: null, email: 'wie@dan.ook' })).toBe(false);
  });

  /** The bug this change exists for: Tim, invited, with registration closed. */
  it('lets an invited person through even though registration is closed', () => {
    expect(
      isSignupAllowed({
        isEmailSignupEnabled: false,
        invite: pending('t.vandedonk@edomatch.com'),
        email: 't.vandedonk@edomatch.com',
      }),
    ).toBe(true);
  });

  it('still refuses a mismatched address once registration is closed', () => {
    expect(
      isSignupAllowed({
        isEmailSignupEnabled: false,
        invite: pending('t.vandedonk@edomatch.com'),
        email: 'iemand@anders.com',
      }),
    ).toBe(false);
  });
});
