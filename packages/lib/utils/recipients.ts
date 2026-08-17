import { isSignatureFieldType } from '@documenso/prisma/guards/is-signature-field';
import type { Envelope } from '@prisma/client';
import { type Field, RecipientRole, SigningStatus } from '@prisma/client';

import { NEXT_PUBLIC_WEBAPP_URL } from '../constants/app';
import { AppError, AppErrorCode } from '../errors/app-error';
import type { TRecipientLite } from '../types/recipient';
import { extractLegacyIds } from '../universal/id';
import { zEmail } from './zod';

/**
 * Roles that require fields to be assigned before a document can be distributed.
 *
 * Currently only SIGNER requires a signature field.
 */
export const RECIPIENT_ROLES_THAT_REQUIRE_FIELDS = [RecipientRole.SIGNER] as const;

/**
 * Returns recipients who are missing required fields for their role.
 *
 * Currently only SIGNERs are validated - they must have at least one signature field.
 */
export const getRecipientsWithMissingFields = <T extends Pick<TRecipientLite, 'id' | 'role'>>(
  recipients: T[],
  fields: Pick<Field, 'type' | 'recipientId'>[],
): T[] => {
  return recipients.filter((recipient) => {
    if (recipient.role === RecipientRole.SIGNER) {
      const hasSignatureField = fields.some(
        (field) => field.recipientId === recipient.id && isSignatureFieldType(field.type),
      );

      return !hasSignatureField;
    }

    return false;
  });
};

export const formatSigningLink = (token: string) => `${NEXT_PUBLIC_WEBAPP_URL()}/sign/${token}`;

/**
 * Whether a recipient can be modified by the document owner.
 */
export const canRecipientBeModified = (
  recipient: TRecipientLite,
  fields: Pick<Field, 'recipientId' | 'inserted'>[],
) => {
  if (!recipient) {
    return false;
  }

  // CCers can always be modified (unless document is completed).
  if (recipient.role === RecipientRole.CC) {
    return true;
  }

  // Deny if the recipient has already signed the document.
  if (recipient.signingStatus === SigningStatus.SIGNED) {
    return false;
  }

  // Deny if the recipient has inserted any fields.
  if (fields.some((field) => field.recipientId === recipient.id && field.inserted)) {
    return false;
  }

  return true;
};

/**
 * Whether a recipient can have their fields modified by the document owner.
 *
 * A recipient can their fields modified if all the conditions are met:
 * - They are not a Viewer or CCer
 * - They can be modified (canRecipientBeModified)
 */
export const canRecipientFieldsBeModified = (
  recipient: TRecipientLite,
  fields: Pick<Field, 'recipientId' | 'inserted'>[],
) => {
  if (!canRecipientBeModified(recipient, fields)) {
    return false;
  }

  return recipient.role !== RecipientRole.VIEWER && recipient.role !== RecipientRole.CC;
};

export const mapRecipientToLegacyRecipient = (
  recipient: TRecipientLite,
  envelope: Pick<Envelope, 'type' | 'secondaryId'>,
) => {
  const legacyId = extractLegacyIds(envelope);

  return {
    ...recipient,
    ...legacyId,
  };
};

export const findRecipientByEmail = <T extends { email: string }>({
  recipients,
  userEmail,
  teamEmail,
}: {
  recipients: T[];
  userEmail: string;
  teamEmail?: string | null;
}) => recipients.find((r) => r.email === userEmail || (teamEmail && r.email === teamEmail));

export const isRecipientEmailValidForSending = (recipient: Pick<TRecipientLite, 'email'>) => {
  return zEmail().safeParse(recipient.email).success;
};

/**
 * Works out which saved recipient belongs to which row the editor sent, so the
 * editor can store the id each new recipient was given.
 *
 * A recipient the editor has just created has no id yet, and the server matches
 * recipients on id alone. A row that never learns its id therefore looks new on
 * every save, and the server creates the same person again each time.
 *
 * Pairing is done on the local id the server echoes back, not on the email: the
 * same person can deliberately appear on an envelope more than once, so an
 * email identifies nobody in particular.
 *
 * @param localRecipients The recipients as the editor currently holds them.
 * @param savedRecipients The recipients returned by the server.
 * @returns The index of each row that has just learned its id.
 */
export const getRecipientIdAssignments = <T extends { formId: string; id?: number }>(
  localRecipients: T[],
  savedRecipients: { id: number; clientId?: string | null }[],
): { index: number; id: number }[] => {
  const assignments: { index: number; id: number }[] = [];

  for (const savedRecipient of savedRecipients) {
    if (!savedRecipient.clientId) {
      continue;
    }

    const index = localRecipients.findIndex((localRecipient) => localRecipient.formId === savedRecipient.clientId);

    if (index !== -1 && !localRecipients[index].id) {
      assignments.push({ index, id: savedRecipient.id });
    }
  }

  return assignments;
};

/**
 * Whether the recipient's signing window has expired.
 */
export const isRecipientExpired = (recipient: { expiresAt: Date | null }) => {
  return Boolean(recipient.expiresAt && new Date(recipient.expiresAt) <= new Date());
};

/**
 * Asserts that the recipient's signing window has not expired.
 *
 * Throws an AppError with RECIPIENT_EXPIRED if the expiration date has passed.
 */
export const assertRecipientNotExpired = (recipient: { expiresAt: Date | null }) => {
  if (isRecipientExpired(recipient)) {
    throw new AppError(AppErrorCode.RECIPIENT_EXPIRED, {
      message: 'Recipient signing window has expired',
    });
  }
};
