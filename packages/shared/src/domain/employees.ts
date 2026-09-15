import { z } from 'zod';
import {
  emailSchema,
  id,
  isoDate,
  longText,
  metadataSchema,
  moneySchema,
  paginationQuerySchema,
  phoneSchema,
  shortText,
  tagsSchema,
} from './common.js';

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contractor',
  'intern',
  'temporary',
] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'] as const;
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

export const PAY_PERIODS = ['monthly', 'biweekly', 'weekly', 'hourly'] as const;
export const payPeriodSchema = z.enum(PAY_PERIODS);

/**
 * Sensitive fields (`compensation`, `nationalId`, `bankAccount`) are gated
 * behind the `employee:read_sensitive` permission and are stripped from every
 * response for roles that lack it — the API never relies on the client to hide
 * them. They are also excluded from AI retrieval by default.
 */
export const createEmployeeSchema = z
  .strictObject({
    firstName: shortText,
    lastName: shortText,
    /** Links the HR record to a login. Optional: not every employee has one. */
    userId: id('user').optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    jobTitle: shortText.optional(),
    department: shortText.optional(),
    managerId: id('employee').optional(),
    employmentType: employmentTypeSchema.default('full_time'),
    status: employeeStatusSchema.default('active'),
    hiredAt: isoDate.optional(),
    terminatedAt: isoDate.optional(),
    /** Gross pay for one `payPeriod`. */
    compensation: moneySchema.optional(),
    payPeriod: payPeriodSchema.default('monthly'),
    /** Fully-loaded internal cost per hour; drives project margin. */
    costRate: moneySchema.optional(),
    /** Default external billing rate for this person's time. */
    billableRate: moneySchema.optional(),
    weeklyHours: z.number().int().min(0).max(80).default(40),
    nationalId: z.string().trim().max(40).optional(),
    bankAccount: z.string().trim().max(64).optional(),
    notes: longText.optional(),
    tags: tagsSchema,
    metadata: metadataSchema,
  })
  .refine((v) => !v.hiredAt || !v.terminatedAt || v.hiredAt <= v.terminatedAt, {
    message: 'terminatedAt must not be before hiredAt',
    path: ['terminatedAt'],
  })
  .refine((v) => v.status !== 'terminated' || v.terminatedAt !== undefined, {
    message: 'a terminated employee requires terminatedAt',
    path: ['terminatedAt'],
  });

export const updateEmployeeSchema = z.strictObject({
  firstName: shortText.optional(),
  lastName: shortText.optional(),
  userId: id('user').nullable().optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  jobTitle: shortText.optional(),
  department: shortText.optional(),
  managerId: id('employee').nullable().optional(),
  employmentType: employmentTypeSchema.optional(),
  status: employeeStatusSchema.optional(),
  hiredAt: isoDate.nullable().optional(),
  terminatedAt: isoDate.nullable().optional(),
  compensation: moneySchema.nullable().optional(),
  payPeriod: payPeriodSchema.optional(),
  costRate: moneySchema.nullable().optional(),
  billableRate: moneySchema.nullable().optional(),
  weeklyHours: z.number().int().min(0).max(80).optional(),
  nationalId: z.string().trim().max(40).optional(),
  bankAccount: z.string().trim().max(64).optional(),
  notes: longText.optional(),
  tags: tagsSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const listEmployeesQuerySchema = paginationQuerySchema.extend({
  status: employeeStatusSchema.optional(),
  department: z.string().trim().max(200).optional(),
  employmentType: employmentTypeSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/* ---------------------------------------------------------------- output -- */

/**
 * The employee as the API returns it.
 *
 * The three sensitive fields are `.nullable()` because they are **stripped**
 * for callers without `employee:read_sensitive` — the same endpoint returns a
 * narrower record rather than a different status code, so a UI can render what
 * the reader is entitled to see without branching on role.
 */
export const employeeSchema = z.object({
  id: id('employee'),
  employeeNumber: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  managerId: z.string().nullable(),
  employmentType: employmentTypeSchema,
  status: employeeStatusSchema,
  hiredAt: z.string().nullable(),
  terminatedAt: z.string().nullable(),
  weeklyHours: z.number().int(),
  billableRate: moneySchema.nullable(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),

  // Present only with `employee:read_sensitive`.
  compensation: moneySchema.nullable(),
  payPeriod: payPeriodSchema.nullable(),
  costRate: moneySchema.nullable(),
  nationalId: z.string().nullable(),
  bankAccount: z.string().nullable(),
});

export type Employee = z.infer<typeof employeeSchema>;
