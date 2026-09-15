import { describe, expect, it } from 'vitest';
import { loginSchema, passwordSchema, registerSchema } from './auth.js';
import { createClientSchema } from './clients.js';
import { createProjectSchema } from './projects.js';
import { createEmployeeSchema } from './employees.js';
import { canTransitionInvoice, createInvoiceSchema } from './finance.js';
import {
  createDocumentMetadataSchema,
  isAllowedMimeType,
  safeFilenameSchema,
} from './documents.js';
import { createTaskSchema } from './tasks.js';
import { chatRequestSchema } from './ai.js';
import { emailSchema, moneySchema, paginationQuerySchema } from './common.js';

describe('validation schemas', () => {
  describe('strictness (mass-assignment protection)', () => {
    it('rejects keys the schema does not declare', () => {
      const result = createClientSchema.safeParse({ name: 'Acme', role: 'owner' });
      expect(result.success).toBe(false);
    });

    it('rejects a smuggled organizationId on a task', () => {
      const result = createTaskSchema.safeParse({
        title: 'Do the thing',
        organizationId: 'org_00000000000000000000000000000000',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('common primitives', () => {
    it('normalises email case and whitespace', () => {
      expect(emailSchema.parse('  Owner@Example.COM ')).toBe('owner@example.com');
    });

    it('only accepts integer minor units as a string', () => {
      expect(moneySchema.safeParse({ amount: '150000', currency: 'SAR' }).success).toBe(true);
      expect(moneySchema.safeParse({ amount: '1500.00', currency: 'SAR' }).success).toBe(false);
      expect(moneySchema.safeParse({ amount: 150000, currency: 'SAR' }).success).toBe(false);
      expect(moneySchema.safeParse({ amount: '100', currency: 'XYZ' }).success).toBe(false);
      expect(moneySchema.safeParse({ amount: '-100', currency: 'SAR' }).success).toBe(true);
    });

    it('coerces and clamps pagination input', () => {
      expect(paginationQuerySchema.parse({}).limit).toBe(25);
      expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
      expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
      expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    });
  });

  describe('auth', () => {
    it('requires a 12 character minimum and allows a long passphrase', () => {
      expect(passwordSchema.safeParse('short').success).toBe(false);
      expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
      expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
      expect(passwordSchema.safeParse(' '.repeat(20)).success).toBe(false);
    });

    it('does not apply the strength policy to login, only to registration', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'old' }).success).toBe(true);
      expect(
        registerSchema.safeParse({
          organizationName: 'Al-Majeed',
          name: 'Owner',
          email: 'a@b.com',
          password: 'old',
        }).success,
      ).toBe(false);
    });
  });

  describe('projects', () => {
    it('rejects an end date before the start date', () => {
      const result = createProjectSchema.safeParse({
        name: 'Tower',
        startDate: '2026-06-01',
        endDate: '2026-01-01',
      });
      expect(result.success).toBe(false);
    });

    it('requires a budget for fixed-price work', () => {
      expect(
        createProjectSchema.safeParse({ name: 'Tower', billingType: 'fixed_price' }).success,
      ).toBe(false);
      expect(
        createProjectSchema.safeParse({
          name: 'Tower',
          billingType: 'fixed_price',
          budget: { amount: '50000000', currency: 'SAR' },
        }).success,
      ).toBe(true);
    });

    it('applies sensible defaults', () => {
      const project = createProjectSchema.parse({ name: 'Tower' });
      expect(project.status).toBe('draft');
      expect(project.billingType).toBe('time_and_materials');
      expect(project.currency).toBe('SAR');
    });
  });

  describe('employees', () => {
    it('requires a termination date for terminated staff', () => {
      expect(
        createEmployeeSchema.safeParse({
          firstName: 'Sara',
          lastName: 'Ahmed',
          status: 'terminated',
        }).success,
      ).toBe(false);
      expect(
        createEmployeeSchema.safeParse({
          firstName: 'Sara',
          lastName: 'Ahmed',
          status: 'terminated',
          hiredAt: '2024-01-01',
          terminatedAt: '2026-01-01',
        }).success,
      ).toBe(true);
    });
  });

  describe('finance', () => {
    it('requires at least one line on an invoice', () => {
      expect(
        createInvoiceSchema.safeParse({
          clientId: 'cli_00000000000000000000000000000000',
          lines: [],
        }).success,
      ).toBe(false);
    });

    it('rejects a due date before the issue date', () => {
      expect(
        createInvoiceSchema.safeParse({
          clientId: 'cli_00000000000000000000000000000000',
          issueDate: '2026-03-10',
          dueDate: '2026-03-01',
          lines: [
            {
              description: 'Consulting',
              quantity: 1,
              unitPrice: { amount: '100', currency: 'SAR' },
            },
          ],
        }).success,
      ).toBe(false);
    });

    it('permits only the documented status transitions', () => {
      expect(canTransitionInvoice('draft', 'issued')).toBe(true);
      expect(canTransitionInvoice('issued', 'paid')).toBe(true);
      expect(canTransitionInvoice('issued', 'draft')).toBe(false);
      expect(canTransitionInvoice('paid', 'void')).toBe(false);
      expect(canTransitionInvoice('void', 'issued')).toBe(false);
      expect(canTransitionInvoice('cancelled', 'issued')).toBe(false);
    });
  });

  describe('documents', () => {
    it('allows only listed content types', () => {
      expect(isAllowedMimeType('application/pdf')).toBe(true);
      expect(isAllowedMimeType('image/svg+xml')).toBe(false); // SVG can carry script
      expect(isAllowedMimeType('text/html')).toBe(false);
      expect(isAllowedMimeType('application/x-msdownload')).toBe(false);
    });

    it('rejects traversal and separator characters in filenames', () => {
      expect(safeFilenameSchema.safeParse('contract.pdf').success).toBe(true);
      expect(safeFilenameSchema.safeParse('../../etc/passwd').success).toBe(false);
      expect(safeFilenameSchema.safeParse('a/b.pdf').success).toBe(false);
      expect(safeFilenameSchema.safeParse('a\\b.pdf').success).toBe(false);
      expect(safeFilenameSchema.safeParse('..').success).toBe(false);
      expect(safeFilenameSchema.safeParse('.env').success).toBe(false);
      expect(safeFilenameSchema.safeParse('bad\0.pdf').success).toBe(false);
    });

    it('keeps AI indexing opt-in', () => {
      expect(createDocumentMetadataSchema.parse({}).indexForAi).toBe(false);
      expect(createDocumentMetadataSchema.parse({}).confidential).toBe(false);
    });
  });

  describe('ai', () => {
    it('defaults writes to disallowed', () => {
      const parsed = chatRequestSchema.parse({ message: 'How are receivables looking?' });
      expect(parsed.allowWrites).toBe(false);
      expect(parsed.useRetrieval).toBe(true);
    });

    it('bounds message length', () => {
      expect(chatRequestSchema.safeParse({ message: 'x'.repeat(8_001) }).success).toBe(false);
      expect(chatRequestSchema.safeParse({ message: '   ' }).success).toBe(false);
    });
  });
});
