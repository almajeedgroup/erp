import { z } from 'zod';
import { ROLES } from '../rbac.js';
import { emailSchema, id, shortText, slugSchema } from './common.js';

/**
 * Passwords.
 *
 * Length is the control that matters, so the floor is 12 characters and the
 * ceiling is 128 (a bound on hashing cost, not on entropy). There is no
 * "must contain a symbol" rule: composition rules push people toward
 * `Password1!` and measurably reduce entropy. Breached-password screening is
 * the follow-up control — see docs/03-security/authn.md.
 */
export const passwordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(128, 'must be at most 128 characters')
  .refine((v) => v.trim().length > 0, 'must not be blank');

export const roleSchema = z.enum(ROLES);

export const registerSchema = z.strictObject({
  organizationName: shortText,
  organizationSlug: slugSchema.optional(),
  name: shortText,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(20).max(4096),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const inviteMemberSchema = z.strictObject({
  email: emailSchema,
  name: shortText,
  role: roleSchema,
  password: passwordSchema,
});

export const updateMemberRoleSchema = z.strictObject({
  role: roleSchema,
});

export const sessionUserSchema = z.object({
  id: id('user'),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  organizationId: id('organization'),
  organizationName: z.string(),
  permissions: z.array(z.string()),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
});

export const authResponseSchema = z.object({
  user: sessionUserSchema,
  tokens: tokenPairSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
