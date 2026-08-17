import { ZRecipientActionAuthTypesSchema } from '@documenso/lib/types/document-auth';
import { ZRecipientEmailSchema, ZRecipientLiteSchema } from '@documenso/lib/types/recipient';
import { EnvelopeType, RecipientRole } from '@prisma/client';
import { z } from 'zod';

export const ZSetEnvelopeRecipientSchema = z.object({
  id: z.number().optional(),
  /**
   * The editor's local identifier for a recipient that has not been saved yet.
   *
   * Echoed back on the response so the editor can attach the id it was given.
   * Without it the editor keeps sending the same recipient with no id, and each
   * save creates another copy of them.
   */
  clientId: z.string().optional(),
  email: ZRecipientEmailSchema,
  name: z.string().max(255),
  role: z.nativeEnum(RecipientRole),
  signingOrder: z.number().optional(),
  actionAuth: z.array(ZRecipientActionAuthTypesSchema).optional().default([]),
});

export const ZSetEnvelopeRecipientsRequestSchema = z.object({
  envelopeId: z.string(),
  envelopeType: z.nativeEnum(EnvelopeType),
  recipients: ZSetEnvelopeRecipientSchema.array(),
});

export const ZSetEnvelopeRecipientsResponseSchema = z.object({
  data: ZRecipientLiteSchema.omit({
    documentId: true,
    templateId: true,
  })
    .extend({
      clientId: z.string().nullish(),
    })
    .array(),
});

export type TSetEnvelopeRecipientsRequest = z.infer<typeof ZSetEnvelopeRecipientsRequestSchema>;
export type TSetEnvelopeRecipientsResponse = z.infer<typeof ZSetEnvelopeRecipientsResponseSchema>;
