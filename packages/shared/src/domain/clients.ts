import { z } from 'zod';
import {
  currencySchema,
  emailSchema,
  id,
  isoDate,
  longText,
  mediumText,
  metadataSchema,
  paginationQuerySchema,
  phoneSchema,
  shortText,
  tagsSchema,
  urlSchema,
} from './common.js';

/** Where a client sits in the commercial funnel. Drives the pipeline report. */
export const CLIENT_STATUSES = ['lead', 'prospect', 'active', 'dormant', 'churned'] as const;
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

/** How the client first reached us. The denominator of CAC by channel. */
export const ACQUISITION_CHANNELS = [
  'referral',
  'outbound',
  'inbound',
  'partner',
  'event',
  'marketplace',
  'other',
] as const;
export const acquisitionChannelSchema = z.enum(ACQUISITION_CHANNELS);

export const addressSchema = z.strictObject({
  line1: shortText.optional(),
  line2: shortText.optional(),
  city: shortText.optional(),
  region: shortText.optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z
    .string()
    .trim()
    .length(2, 'must be a two-letter ISO 3166-1 country code')
    .toUpperCase()
    .optional(),
});

export const createClientSchema = z.strictObject({
  name: shortText,
  legalName: shortText.optional(),
  status: clientStatusSchema.default('lead'),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  website: urlSchema.optional(),
  /** VAT / commercial registration number. Printed on every invoice. */
  taxNumber: z.string().trim().max(50).optional(),
  billingCurrency: currencySchema.default('SAR'),
  /** Net terms in days; 0 means due on receipt. Feeds the cash-flow forecast. */
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
  acquisitionChannel: acquisitionChannelSchema.default('other'),
  acquiredAt: isoDate.optional(),
  address: addressSchema.optional(),
  notes: longText.optional(),
  tags: tagsSchema,
  metadata: metadataSchema,
  ownerId: id('user').optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = paginationQuerySchema.extend({
  status: clientStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});

export const createContactSchema = z.strictObject({
  name: shortText,
  title: shortText.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  isPrimary: z.boolean().default(false),
  notes: mediumText.optional(),
});

export const updateContactSchema = createContactSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;

/* ---------------------------------------------------------------- output -- */

/**
 * The client as the API returns it.
 *
 * Declared here, next to the input schemas, so the API validates its own
 * responses against the same definition the web app imports for its types.
 * A response that stops matching this is a serialization error in tests and in
 * CI, not a surprise in the browser.
 */
export const clientSchema = z.object({
  id: id('client'),
  name: z.string(),
  legalName: z.string().nullable(),
  status: clientStatusSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  taxNumber: z.string().nullable(),
  billingCurrency: z.string(),
  paymentTermsDays: z.number().int(),
  acquisitionChannel: acquisitionChannelSchema,
  acquiredAt: z.string().nullable(),
  address: addressSchema.nullable(),
  notes: z.string().nullable(),
  ownerId: z.string().nullable(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const contactSchema = z.object({
  id: id('contact'),
  clientId: id('client'),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Client = z.infer<typeof clientSchema>;
export type Contact = z.infer<typeof contactSchema>;
