import { z } from 'zod';
import {
  currencySchema,
  id,
  isoDate,
  longText,
  metadataSchema,
  moneySchema,
  paginationQuerySchema,
  shortText,
  tagsSchema,
} from './common.js';

export const PROJECT_STATUSES = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Billing model. This single field decides how revenue is recognised, how an
 * invoice is drafted from time entries, and which margin formula analytics
 * uses — see docs/08-modules/projects.md.
 */
export const BILLING_TYPES = ['fixed_price', 'time_and_materials', 'retainer', 'internal'] as const;
export const billingTypeSchema = z.enum(BILLING_TYPES);
export type BillingType = (typeof BILLING_TYPES)[number];

export const HEALTH_STATUSES = ['on_track', 'at_risk', 'off_track'] as const;
export const healthStatusSchema = z.enum(HEALTH_STATUSES);

export const createProjectSchema = z
  .strictObject({
    name: shortText,
    code: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'must be uppercase alphanumeric with hyphens')
      .optional(),
    clientId: id('client').optional(),
    status: projectStatusSchema.default('draft'),
    billingType: billingTypeSchema.default('time_and_materials'),
    currency: currencySchema.default('SAR'),
    /** Contract value for fixed price / retainer work. */
    budget: moneySchema.optional(),
    /** Blended or default rate used when a time entry has no override. */
    hourlyRate: moneySchema.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    managerId: id('user').optional(),
    health: healthStatusSchema.default('on_track'),
    description: longText.optional(),
    tags: tagsSchema,
    metadata: metadataSchema,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  })
  .refine((v) => v.billingType !== 'fixed_price' || v.budget !== undefined, {
    message: 'fixed_price projects require a budget',
    path: ['budget'],
  });

/** Partial update; the cross-field rules above are re-checked in the service. */
export const updateProjectSchema = z.strictObject({
  name: shortText.optional(),
  code: z.string().trim().min(2).max(24).optional(),
  clientId: id('client').nullable().optional(),
  status: projectStatusSchema.optional(),
  billingType: billingTypeSchema.optional(),
  budget: moneySchema.nullable().optional(),
  hourlyRate: moneySchema.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  managerId: id('user').nullable().optional(),
  health: healthStatusSchema.optional(),
  description: longText.optional(),
  tags: tagsSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  clientId: id('client').optional(),
  health: healthStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const addProjectMemberSchema = z.strictObject({
  userId: id('user'),
  /** Project-scoped role label; org-wide permissions still come from RBAC. */
  role: shortText.default('contributor'),
  allocationPercent: z.number().int().min(0).max(100).default(100),
  /** Overrides the project rate for this person's billable time. */
  hourlyRate: moneySchema.optional(),
});

export const createTimeEntrySchema = z.strictObject({
  projectId: id('project'),
  taskId: id('task').optional(),
  employeeId: id('employee').optional(),
  date: isoDate,
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60, 'a single entry cannot exceed 24 hours'),
  billable: z.boolean().default(true),
  notes: longText.optional(),
});

export const listTimeEntriesQuerySchema = paginationQuerySchema.extend({
  projectId: id('project').optional(),
  employeeId: id('employee').optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  billable: z.stringbool().optional(),
  approved: z.stringbool().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
