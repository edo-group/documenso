import {
  isDisposableEmail,
  isEmailDomainAllowedForSignup,
  isSigninEnabledForProvider,
  isSignupEnabledForProvider,
} from '@documenso/lib/constants/auth';
import { EMAIL_VERIFICATION_STATE } from '@documenso/lib/constants/email';
import { AppError } from '@documenso/lib/errors/app-error';
import { jobsClient } from '@documenso/lib/jobs/client';
import { disableTwoFactorAuthentication } from '@documenso/lib/server-only/2fa/disable-2fa';
import { enableTwoFactorAuthentication } from '@documenso/lib/server-only/2fa/enable-2fa';
import { isTwoFactorAuthenticationEnabled } from '@documenso/lib/server-only/2fa/is-2fa-availble';
import { setupTwoFactorAuthentication } from '@documenso/lib/server-only/2fa/setup-2fa';
import { validateTwoFactorAuthentication } from '@documenso/lib/server-only/2fa/validate-2fa';
import { viewBackupCodes } from '@documenso/lib/server-only/2fa/view-backup-codes';
import { verifyCaptchaToken } from '@documenso/lib/server-only/captcha/verify-captcha';
import { acceptOrganisationInvitation } from '@documenso/lib/server-only/organisation/accept-organisation-invitation';
import { getInviteForSignup } from '@documenso/lib/server-only/organisation/get-invite-for-signup';
import { rateLimitResponse } from '@documenso/lib/server-only/rate-limit/rate-limit-middleware';
import {
  forgotPasswordRateLimit,
  loginRateLimit,
  resendVerifyEmailRateLimit,
  resetPasswordRateLimit,
  signupRateLimit,
  verifyEmailRateLimit,
} from '@documenso/lib/server-only/rate-limit/rate-limits';
import { getEmailBlocklistDomains } from '@documenso/lib/server-only/site-settings/get-email-blocklist-domains';
import { createUser } from '@documenso/lib/server-only/user/create-user';
import { forgotPassword } from '@documenso/lib/server-only/user/forgot-password';
import { getMostRecentEmailVerificationToken } from '@documenso/lib/server-only/user/get-most-recent-email-verification-token';
import { getUserByResetToken } from '@documenso/lib/server-only/user/get-user-by-reset-token';
import { resetPassword } from '@documenso/lib/server-only/user/reset-password';
import { deletedServiceAccountEmail } from '@documenso/lib/server-only/user/service-accounts/deleted-account';
import { legacyServiceAccountEmail } from '@documenso/lib/server-only/user/service-accounts/legacy-service-account';
import { updatePassword } from '@documenso/lib/server-only/user/update-password';
import { verifyEmail } from '@documenso/lib/server-only/user/verify-email';
import { isInvitedSignup, isSignupAllowed } from '@documenso/lib/utils/invited-signup';
import { prisma } from '@documenso/prisma';
import { sValidator } from '@hono/standard-validator';
import { compare } from '@node-rs/bcrypt';
import { UserSecurityAuditLogType } from '@prisma/client';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { AuthenticationErrorCode } from '../lib/errors/error-codes';
import { invalidateSessions } from '../lib/session/session';
import { getCsrfCookie } from '../lib/session/session-cookies';
import { onAuthorize } from '../lib/utils/authorizer';
import { getSession } from '../lib/utils/get-session';
import type { HonoAuthContext } from '../types/context';
import {
  ZForgotPasswordSchema,
  ZResendVerifyEmailSchema,
  ZResetPasswordSchema,
  ZSignInSchema,
  ZSignUpSchema,
  ZUpdatePasswordSchema,
  ZVerifyEmailSchema,
} from '../types/email-password';

export const emailPasswordRoute = new Hono<HonoAuthContext>()
  /**
   * Authorize endpoint.
   */
  .post('/authorize', sValidator('json', ZSignInSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    if (!isSigninEnabledForProvider('email')) {
      throw new AppError(AuthenticationErrorCode.SigninDisabled, {
        statusCode: 400,
      });
    }

    const { email, password, totpCode, backupCode, csrfToken, captchaToken } = c.req.valid('json');

    const loginLimitResult = await loginRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
      identifier: email,
    });

    const loginLimited = rateLimitResponse(c, loginLimitResult);

    if (loginLimited) {
      throw new HTTPException(429, {
        res: loginLimited,
      });
    }

    const csrfCookieToken = await getCsrfCookie(c);

    // Todo: (RR7) Add logging here.
    if (csrfToken !== csrfCookieToken || !csrfCookieToken) {
      throw new AppError(AuthenticationErrorCode.InvalidRequest, {
        message: 'Invalid CSRF token',
      });
    }

    await verifyCaptchaToken({
      token: captchaToken,
      ipAddress: requestMetadata.ipAddress,
    });

    if (email.toLowerCase() === legacyServiceAccountEmail() || email.toLowerCase() === deletedServiceAccountEmail()) {
      return c.text('FORBIDDEN', 403);
    }

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
      },
    });

    if (!user || !user.password) {
      throw new AppError(AuthenticationErrorCode.InvalidCredentials, {
        message: 'Invalid email or password',
      });
    }

    const isPasswordsSame = await compare(password, user.password);

    if (!isPasswordsSame) {
      await prisma.userSecurityAuditLog.create({
        data: {
          userId: user.id,
          ipAddress: requestMetadata.ipAddress,
          userAgent: requestMetadata.userAgent,
          type: UserSecurityAuditLogType.SIGN_IN_FAIL,
        },
      });

      throw new AppError(AuthenticationErrorCode.InvalidCredentials, {
        message: 'Invalid email or password',
      });
    }

    const is2faEnabled = isTwoFactorAuthenticationEnabled({ user });

    if (is2faEnabled) {
      const isValid = await validateTwoFactorAuthentication({
        backupCode,
        totpCode,
        user,
      });

      if (!isValid) {
        await prisma.userSecurityAuditLog.create({
          data: {
            userId: user.id,
            ipAddress: requestMetadata.ipAddress,
            userAgent: requestMetadata.userAgent,
            type: UserSecurityAuditLogType.SIGN_IN_2FA_FAIL,
          },
        });

        throw new AppError(AuthenticationErrorCode.InvalidTwoFactorCode);
      }
    }

    if (!user.emailVerified) {
      const mostRecentToken = await getMostRecentEmailVerificationToken({
        userId: user.id,
      });

      if (
        !mostRecentToken ||
        mostRecentToken.expires.valueOf() <= Date.now() ||
        DateTime.fromJSDate(mostRecentToken.createdAt).diffNow('minutes').minutes > -5
      ) {
        await jobsClient.triggerJob({
          name: 'send.signup.confirmation.email',
          payload: {
            email: user.email,
          },
        });
      }

      throw new AppError('UNVERIFIED_EMAIL', {
        message: 'Unverified email',
      });
    }

    // The disabled check now lives inside `onAuthorize` so every sign-in path
    // (password, passkey, OAuth, OIDC) shares the same enforcement.
    await onAuthorize({ userId: user.id }, c);

    return c.text('', 201);
  })
  /**
   * Signup endpoint.
   */
  .post('/signup', sValidator('json', ZSignUpSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    const { name, email, password, signature, captchaToken, inviteToken } = c.req.valid('json');

    // Rate limited before the invite is looked up, not after. Checking the
    // token means a database read, and this endpoint is open to anyone, so
    // doing that first would let someone guess tokens as fast as they can post.
    const signupLimitResult = await signupRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
    });

    const signupLimited = rateLimitResponse(c, signupLimitResult);

    if (signupLimited) {
      throw new HTTPException(429, {
        res: signupLimited,
      });
    }

    // Closing public registration also closed the only door an invited person
    // has: the invite page sends someone without an account to `/signup`, and
    // that page is exactly what the flag turns off. So a real, still-pending
    // invitation for this very address is allowed through. The address must
    // match, otherwise one leaked token would open registration to anyone.
    const invite = await getInviteForSignup({ token: inviteToken });

    if (!isSignupAllowed({ isEmailSignupEnabled: isSignupEnabledForProvider('email'), invite, email })) {
      throw new AppError(AuthenticationErrorCode.SignupDisabled, {
        statusCode: 400,
      });
    }

    await verifyCaptchaToken({
      token: captchaToken,
      ipAddress: requestMetadata.ipAddress,
    });

    if (!isEmailDomainAllowedForSignup(email)) {
      throw new AppError(AuthenticationErrorCode.SignupDisabled, {
        statusCode: 400,
      });
    }

    const additionalBlockedDomains = await getEmailBlocklistDomains();

    if (isDisposableEmail(email, additionalBlockedDomains)) {
      throw new AppError(AuthenticationErrorCode.SignupDisposableEmail, {
        statusCode: 400,
      });
    }

    const user = await createUser({ name, email, password, signature }).catch((err) => {
      console.error(err);
      throw err;
    });

    // Accept the invitation here rather than making them walk back to the link
    // they came from. Membership is only ever created by visiting that page, so
    // without this the account exists and still belongs to no organisation:
    // the same dead end one step further along.
    //
    // Deliberately not fatal. The account has been created by this point, so
    // throwing would report a failed signup for one that actually succeeded,
    // and a retry would then hit ALREADY_EXISTS. Their invitation link still
    // works, and now that the user exists it accepts on sight.
    if (inviteToken && isInvitedSignup({ invite, email })) {
      await acceptOrganisationInvitation({ token: inviteToken }).catch((err) => {
        console.error('Failed to accept organisation invitation during signup', err);
      });
    }

    await jobsClient.triggerJob({
      name: 'send.signup.confirmation.email',
      payload: {
        email: user.email,
      },
    });

    return c.text('OK', 201);
  })
  /**
   * Update password endpoint.
   */
  .post('/update-password', sValidator('json', ZUpdatePasswordSchema), async (c) => {
    const { password, currentPassword } = c.req.valid('json');
    const requestMetadata = c.get('requestMetadata');

    if (!isSigninEnabledForProvider('email')) {
      throw new AppError(AuthenticationErrorCode.SigninDisabled, {
        statusCode: 400,
      });
    }

    const { session, user } = await getSession(c);

    await updatePassword({
      userId: user.id,
      password,
      currentPassword,
      requestMetadata,
    });

    const userSessionIds = await prisma.session
      .findMany({
        where: {
          userId: user.id satisfies number, // Incase we pass undefined somehow.
          id: {
            not: session.id,
          },
        },
        select: {
          id: true,
        },
      })
      .then((sessions) => sessions.map((s) => s.id));

    if (userSessionIds.length > 0) {
      await invalidateSessions({
        userId: user.id,
        sessionIds: userSessionIds,
        metadata: requestMetadata,
        isRevoke: true,
      });
    }

    return c.text('OK', 201);
  })
  /**
   * Verify email endpoint.
   */
  .post('/verify-email', sValidator('json', ZVerifyEmailSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    const { token } = c.req.valid('json');

    const verifyLimitResult = await verifyEmailRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
      identifier: token,
    });

    const verifyLimited = rateLimitResponse(c, verifyLimitResult);

    if (verifyLimited) {
      throw new HTTPException(429, {
        res: verifyLimited,
      });
    }

    const { state, userId } = await verifyEmail({ token });

    // If email is verified, automatically authenticate user.
    if (state === EMAIL_VERIFICATION_STATE.VERIFIED && userId !== null) {
      await onAuthorize({ userId }, c);
    }

    return c.json({
      state,
    });
  })
  /**
   * Resend verification email endpoint.
   */
  .post('/resend-verify-email', sValidator('json', ZResendVerifyEmailSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    const { email } = c.req.valid('json');

    const resendLimitResult = await resendVerifyEmailRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
      identifier: email,
    });

    const resendLimited = rateLimitResponse(c, resendLimitResult);

    if (resendLimited) {
      throw new HTTPException(429, {
        res: resendLimited,
      });
    }

    await jobsClient.triggerJob({
      name: 'send.signup.confirmation.email',
      payload: {
        email,
      },
    });

    return c.text('OK', 201);
  })
  /**
   * Forgot password endpoint.
   */
  .post('/forgot-password', sValidator('json', ZForgotPasswordSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    if (!isSigninEnabledForProvider('email')) {
      throw new AppError(AuthenticationErrorCode.SigninDisabled, {
        statusCode: 400,
      });
    }

    const { email } = c.req.valid('json');

    const forgotLimitResult = await forgotPasswordRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
      identifier: email,
    });

    const forgotLimited = rateLimitResponse(c, forgotLimitResult);

    if (forgotLimited) {
      throw new HTTPException(429, {
        res: forgotLimited,
      });
    }

    if (email.toLowerCase() === legacyServiceAccountEmail() || email.toLowerCase() === deletedServiceAccountEmail()) {
      return c.text('FORBIDDEN', 403);
    }

    await forgotPassword({
      email,
    });

    return c.text('OK', 201);
  })
  /**
   * Reset password endpoint.
   */
  .post('/reset-password', sValidator('json', ZResetPasswordSchema), async (c) => {
    const requestMetadata = c.get('requestMetadata');

    if (!isSigninEnabledForProvider('email')) {
      throw new AppError(AuthenticationErrorCode.SigninDisabled, {
        statusCode: 400,
      });
    }

    const { token, password } = c.req.valid('json');

    const resetLimitResult = await resetPasswordRateLimit.check({
      ip: requestMetadata.ipAddress ?? 'unknown',
      identifier: token,
    });

    const resetLimited = rateLimitResponse(c, resetLimitResult);

    if (resetLimited) {
      throw new HTTPException(429, {
        res: resetLimited,
      });
    }

    const user = await getUserByResetToken({ token });

    if (
      user.email.toLowerCase() === legacyServiceAccountEmail() ||
      user.email.toLowerCase() === deletedServiceAccountEmail()
    ) {
      return c.text('FORBIDDEN', 403);
    }

    const { userId } = await resetPassword({
      token,
      password,
      requestMetadata,
    });

    // Invalidate all sessions after successful password reset
    const userSessionIds = await prisma.session
      .findMany({
        where: {
          userId: userId satisfies number, // Incase we pass undefined somehow.
        },
        select: {
          id: true,
        },
      })
      .then((sessions) => sessions.map((session) => session.id));

    if (userSessionIds.length > 0) {
      await invalidateSessions({
        userId,
        sessionIds: userSessionIds,
        metadata: requestMetadata,
        isRevoke: true,
      });
    }

    return c.text('OK', 201);
  })
  /**
   * Setup two factor authentication.
   */
  .post('/2fa/setup', async (c) => {
    const { user } = await getSession(c);

    const result = await setupTwoFactorAuthentication({
      user,
    });

    return c.json({
      success: true,
      secret: result.secret,
      uri: result.uri,
    });
  })
  /**
   * Enable two factor authentication.
   */
  .post(
    '/2fa/enable',
    sValidator(
      'json',
      z.object({
        code: z.string(),
      }),
    ),
    async (c) => {
      const requestMetadata = c.get('requestMetadata');

      const { user: sessionUser } = await getSession(c);

      const user = await prisma.user.findFirst({
        where: {
          id: sessionUser.id,
        },
        select: {
          id: true,
          email: true,
          twoFactorEnabled: true,
          twoFactorSecret: true,
        },
      });

      if (!user) {
        throw new AppError(AuthenticationErrorCode.InvalidRequest);
      }

      const { code } = c.req.valid('json');

      const result = await enableTwoFactorAuthentication({
        user,
        code,
        requestMetadata,
      });

      return c.json({
        success: true,
        recoveryCodes: result.recoveryCodes,
      });
    },
  )
  /**
   * Disable two factor authentication.
   */
  .post(
    '/2fa/disable',
    sValidator(
      'json',
      z.object({
        totpCode: z.string().trim().optional(),
        backupCode: z.string().trim().optional(),
      }),
    ),
    async (c) => {
      const requestMetadata = c.get('requestMetadata');

      const { user: sessionUser } = await getSession(c);

      const user = await prisma.user.findFirst({
        where: {
          id: sessionUser.id,
        },
        select: {
          id: true,
          email: true,
          twoFactorEnabled: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
        },
      });

      if (!user) {
        throw new AppError(AuthenticationErrorCode.InvalidRequest);
      }

      const { totpCode, backupCode } = c.req.valid('json');

      await disableTwoFactorAuthentication({
        user,
        totpCode,
        backupCode,
        requestMetadata,
      });

      return c.text('OK', 201);
    },
  )
  /**
   * View backup codes.
   */
  .post(
    '/2fa/view-recovery-codes',
    sValidator(
      'json',
      z.object({
        token: z.string(),
      }),
    ),
    async (c) => {
      const { user: sessionUser } = await getSession(c);

      const user = await prisma.user.findFirst({
        where: {
          id: sessionUser.id,
        },
        select: {
          id: true,
          email: true,
          twoFactorEnabled: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
        },
      });

      if (!user) {
        throw new AppError(AuthenticationErrorCode.InvalidRequest);
      }

      const { token } = c.req.valid('json');

      const backupCodes = await viewBackupCodes({
        user,
        token,
      });

      return c.json({
        success: true,
        backupCodes,
      });
    },
  );
