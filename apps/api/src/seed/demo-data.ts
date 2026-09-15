import { permissionsFor, type Role } from '@almajeed/shared';
import type { Database } from '@almajeed/db';
import type { AppServices, RequestContext } from '../context.js';
import { register } from '../modules/auth/service.js';
import { createClient } from '../modules/clients/service.js';
import { uploadDocument } from '../modules/documents/service.js';
import { createEmployee } from '../modules/employees/service.js';
import {
  createExpense,
  createInvoice,
  issueInvoice,
  recordPayment,
  reviewExpense,
} from '../modules/finance/service.js';
import { inviteMember } from '../modules/organizations/service.js';
import { createProject, createTimeEntry } from '../modules/projects/service.js';
import { createTask } from '../modules/tasks/service.js';

/**
 * Demo data.
 *
 * Builds one organization with a believable shape: five people across five
 * roles, four clients at different funnel stages, three projects on different
 * billing models, timesheets, paid/part-paid/overdue/draft invoices, approved
 * expenses, tasks and an indexed document — enough that every dashboard tile
 * and every report has something real to show on first run.
 *
 * Everything goes through the same service functions the API uses, so seeding
 * exercises the same validation, the same tenant scoping and the same audit
 * trail as a real request. A seed script with its own INSERT statements
 * silently drifts from the application and stops being a useful smoke test —
 * and because this is a plain function, `seed.test.ts` runs the whole thing
 * against in-process Postgres on every CI run.
 */

export const DEMO_PASSWORD = 'correct horse battery staple';

export interface SeedOptions {
  db: Database;
  services: AppServices;
  /** Pinned in tests so the generated dataset is reproducible. */
  now?: Date;
  /** Silence progress output when running inside a test. */
  log?: (message: string) => void;
}

export interface SeedResult {
  organizationId: string;
  ownerUserId: string;
  accounts: { email: string; role: Role }[];
}

export async function seedDemoData(options: SeedOptions): Promise<SeedResult> {
  const { db: database, services } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => undefined);

  function contextFor(userId: string, organizationId: string, role: Role): RequestContext {
    return {
      db: database,
      auth: {
        userId,
        organizationId,
        membershipId: 'seed',
        role,
        permissions: new Set(permissionsFor(role)),
      },
      requestId: 'seed',
      ipAddress: null,
      userAgent: 'seed-script',
      now,
      services,
    };
  }

  /** Relative dates, so a freshly seeded database always looks current. */
  const daysAgo = (days: number): string =>
    new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  log('seeding demo data...');

  const { user } = await register(
    {
      db: database,
      services,
      requestId: 'seed',
      ipAddress: null,
      userAgent: 'seed-script',
      now,
    },
    {
      organizationName: 'Al-Majeed Contracting',
      organizationSlug: 'almajeed',
      name: 'Khalid Al-Majeed',
      email: 'owner@almajeed.test',
      password: DEMO_PASSWORD,
    },
  );

  const owner = contextFor(user.id, user.organizationId, 'owner');
  log(`  organization ${user.organizationName} (${user.organizationId})`);

  /* -- people ------------------------------------------------------------ */

  const finance = await inviteMember(owner, {
    email: 'finance@almajeed.test',
    name: 'Noura Al-Harbi',
    role: 'finance',
    password: DEMO_PASSWORD,
  });

  const manager = await inviteMember(owner, {
    email: 'manager@almajeed.test',
    name: 'Omar Siddiqui',
    role: 'manager',
    password: DEMO_PASSWORD,
  });

  const engineer = await inviteMember(owner, {
    email: 'engineer@almajeed.test',
    name: 'Sara Ahmed',
    role: 'member',
    password: DEMO_PASSWORD,
  });

  await inviteMember(owner, {
    email: 'auditor@almajeed.test',
    name: 'External Auditor',
    role: 'viewer',
    password: DEMO_PASSWORD,
  });

  const financeCtx = contextFor(finance.userId, user.organizationId, 'finance');
  const engineerCtx = contextFor(engineer.userId, user.organizationId, 'member');

  const engineerRecord = await createEmployee(owner, {
    firstName: 'Sara',
    lastName: 'Ahmed',
    userId: engineer.userId,
    email: 'engineer@almajeed.test',
    jobTitle: 'Senior Structural Engineer',
    department: 'Engineering',
    employmentType: 'full_time',
    status: 'active',
    hiredAt: daysAgo(600),
    compensation: { amount: '2800000', currency: 'SAR' }, // 28,000.00 / month
    payPeriod: 'monthly',
    costRate: { amount: '18000', currency: 'SAR' }, // 180.00 / hour, loaded
    billableRate: { amount: '45000', currency: 'SAR' }, // 450.00 / hour
    weeklyHours: 40,
    tags: ['engineering'],
    metadata: {},
  });

  const projectManagerRecord = await createEmployee(owner, {
    firstName: 'Omar',
    lastName: 'Siddiqui',
    userId: manager.userId,
    jobTitle: 'Delivery Manager',
    department: 'Delivery',
    employmentType: 'full_time',
    status: 'active',
    hiredAt: daysAgo(900),
    costRate: { amount: '22000', currency: 'SAR' },
    billableRate: { amount: '50000', currency: 'SAR' },
    payPeriod: 'monthly',
    weeklyHours: 40,
    tags: ['delivery'],
    metadata: {},
  });

  log('  5 members, 2 employee records');

  /* -- clients ----------------------------------------------------------- */

  const metro = await createClient(owner, {
    name: 'Riyadh Metro Authority',
    legalName: 'Riyadh Metro Development Authority',
    status: 'active',
    email: 'procurement@metro.example',
    taxNumber: '300012345600003',
    billingCurrency: 'SAR',
    paymentTermsDays: 45,
    acquisitionChannel: 'referral',
    acquiredAt: daysAgo(720),
    address: { line1: 'King Abdullah Financial District', city: 'Riyadh', country: 'SA' },
    tags: ['infrastructure', 'government'],
    metadata: {},
  });

  const gulf = await createClient(owner, {
    name: 'Gulf Logistics Co.',
    status: 'active',
    billingCurrency: 'SAR',
    paymentTermsDays: 30,
    acquisitionChannel: 'inbound',
    acquiredAt: daysAgo(400),
    tags: ['logistics'],
    metadata: {},
  });

  await createClient(owner, {
    name: 'Najd Property Group',
    status: 'prospect',
    acquisitionChannel: 'outbound',
    billingCurrency: 'SAR',
    paymentTermsDays: 30,
    tags: ['real-estate'],
    metadata: {},
  });

  await createClient(owner, {
    name: 'Coastal Developments',
    status: 'lead',
    acquisitionChannel: 'event',
    billingCurrency: 'SAR',
    paymentTermsDays: 30,
    tags: [],
    metadata: {},
  });

  log('  4 clients');

  /* -- projects ---------------------------------------------------------- */

  const phase2 = await createProject(owner, {
    name: 'Metro Phase 2 — Structural Review',
    code: 'METRO-P2',
    clientId: metro.id,
    status: 'active',
    billingType: 'time_and_materials',
    currency: 'SAR',
    hourlyRate: { amount: '45000', currency: 'SAR' },
    startDate: daysAgo(120),
    managerId: manager.userId,
    health: 'on_track',
    description: 'Independent structural review of the Phase 2 station boxes.',
    tags: ['structural'],
    metadata: {},
  });

  const warehouse = await createProject(owner, {
    name: 'Warehouse Fit-out',
    code: 'GULF-WH1',
    clientId: gulf.id,
    status: 'active',
    billingType: 'fixed_price',
    currency: 'SAR',
    budget: { amount: '85000000', currency: 'SAR' }, // 850,000.00
    startDate: daysAgo(60),
    managerId: manager.userId,
    health: 'at_risk',
    tags: ['fit-out'],
    metadata: {},
  });

  await createProject(owner, {
    name: 'Internal — Tooling',
    status: 'active',
    billingType: 'internal',
    currency: 'SAR',
    managerId: manager.userId,
    health: 'on_track',
    tags: ['internal'],
    metadata: {},
  });

  log('  3 projects');

  /* -- time -------------------------------------------------------------- */

  for (let week = 0; week < 8; week += 1) {
    for (const day of [1, 2, 3]) {
      await createTimeEntry(engineerCtx, {
        projectId: phase2.id,
        employeeId: engineerRecord.id,
        date: daysAgo(week * 7 + day),
        minutes: 8 * 60,
        billable: true,
        notes: 'Station box calculations',
      });
    }
    await createTimeEntry(engineerCtx, {
      projectId: warehouse.id,
      employeeId: projectManagerRecord.id,
      date: daysAgo(week * 7 + 4),
      minutes: 4 * 60,
      billable: true,
    });
    await createTimeEntry(engineerCtx, {
      projectId: phase2.id,
      employeeId: engineerRecord.id,
      date: daysAgo(week * 7 + 5),
      minutes: 2 * 60,
      billable: false,
      notes: 'Internal review meeting',
    });
  }

  log('  40 time entries');

  /* -- invoices ---------------------------------------------------------- */

  const march = await createInvoice(financeCtx, {
    clientId: metro.id,
    projectId: phase2.id,
    currency: 'SAR',
    issueDate: daysAgo(75),
    lines: [
      {
        description: 'Structural review — 96 hours',
        quantity: 96,
        unitPrice: { amount: '45000', currency: 'SAR' },
        taxRate: 15,
        discountRate: 0,
      },
    ],
    tags: [],
    metadata: {},
  });
  await issueInvoice(financeCtx, march.id);
  await recordPayment(financeCtx, march.id, {
    amount: march.total,
    paidAt: daysAgo(40),
    method: 'bank_transfer',
    reference: 'TRF-88213',
  });

  const april = await createInvoice(financeCtx, {
    clientId: metro.id,
    projectId: phase2.id,
    currency: 'SAR',
    issueDate: daysAgo(35),
    lines: [
      {
        description: 'Structural review — 72 hours',
        quantity: 72,
        unitPrice: { amount: '45000', currency: 'SAR' },
        taxRate: 15,
        discountRate: 0,
      },
      {
        description: 'Site visits',
        quantity: 3,
        unitPrice: { amount: '120000', currency: 'SAR' },
        taxRate: 15,
        discountRate: 0,
      },
    ],
    tags: [],
    metadata: {},
  });
  const issuedApril = await issueInvoice(financeCtx, april.id);
  await recordPayment(financeCtx, issuedApril.id, {
    amount: { amount: '1500000', currency: 'SAR' },
    paidAt: daysAgo(10),
    method: 'bank_transfer',
  });

  // Deliberately overdue, so the receivables-aging report has something to show.
  const overdue = await createInvoice(financeCtx, {
    clientId: gulf.id,
    projectId: warehouse.id,
    currency: 'SAR',
    issueDate: daysAgo(95),
    dueDate: daysAgo(65),
    lines: [
      {
        description: 'Fit-out milestone 1',
        quantity: 1,
        unitPrice: { amount: '25000000', currency: 'SAR' },
        taxRate: 15,
        discountRate: 0,
      },
    ],
    tags: [],
    metadata: {},
  });
  await issueInvoice(financeCtx, overdue.id);

  // And one still in draft.
  await createInvoice(financeCtx, {
    clientId: gulf.id,
    projectId: warehouse.id,
    currency: 'SAR',
    lines: [
      {
        description: 'Fit-out milestone 2',
        quantity: 1,
        unitPrice: { amount: '30000000', currency: 'SAR' },
        taxRate: 15,
        discountRate: 0,
      },
    ],
    tags: [],
    metadata: {},
  });

  log('  4 invoices (1 paid, 1 part-paid, 1 overdue, 1 draft)');

  /* -- expenses ---------------------------------------------------------- */

  const expenses: {
    description: string;
    amount: string;
    category: 'software' | 'subcontractor' | 'travel';
    days: number;
  }[] = [
    {
      description: 'Structural analysis software licence',
      amount: '480000',
      category: 'software',
      days: 70,
    },
    {
      description: 'Subcontracted geotechnical survey',
      amount: '3200000',
      category: 'subcontractor',
      days: 55,
    },
    { description: 'Site travel — Riyadh', amount: '145000', category: 'travel', days: 20 },
  ];

  for (const expense of expenses) {
    const filed = await createExpense(engineerCtx, {
      description: expense.description,
      category: expense.category,
      amount: { amount: expense.amount, currency: 'SAR' },
      incurredAt: daysAgo(expense.days),
      projectId: phase2.id,
      employeeId: engineerRecord.id,
      billable: false,
      tags: [],
      metadata: {},
    });
    // Approved by finance, not by the person who filed it.
    await reviewExpense(financeCtx, filed.id, true);
  }

  log('  3 approved expenses');

  /* -- tasks ------------------------------------------------------------- */

  const managerCtx = contextFor(manager.userId, user.organizationId, 'manager');

  const taskDefinitions = [
    { title: 'Issue Phase 2 interim report', status: 'in_progress', priority: 'high', due: -7 },
    {
      title: 'Chase Gulf Logistics on INV milestone 1',
      status: 'todo',
      priority: 'urgent',
      due: 14,
    },
    {
      title: 'Review warehouse load calculations',
      status: 'in_review',
      priority: 'medium',
      due: 3,
    },
    { title: 'Update structural templates', status: 'todo', priority: 'low', due: 30 },
    { title: 'Close out Phase 1 documentation', status: 'done', priority: 'medium', due: -30 },
  ] as const;

  for (const task of taskDefinitions) {
    await createTask(managerCtx, {
      title: task.title,
      projectId: phase2.id,
      assigneeId: engineer.userId,
      status: task.status,
      priority: task.priority,
      dueDate: task.due >= 0 ? daysAgo(-task.due) : daysAgo(Math.abs(task.due)),
      tags: [],
      metadata: {},
    });
  }

  log('  5 tasks');

  /* -- documents --------------------------------------------------------- */

  const handbook = [
    '# Al-Majeed Contracting — Delivery Handbook',
    '',
    '## Billing',
    'Time-and-materials projects are invoiced monthly in arrears. Fixed-price projects are',
    'invoiced on milestone completion. Default payment terms are 30 days; Riyadh Metro',
    'Authority is on 45 days by contract.',
    '',
    '## Structural review process',
    'Every station box review requires an independent second check before the interim report',
    'is issued. The Phase 2 contract completes in December 2027.',
    '',
    '## Expenses',
    'Expenses over 5,000.00 SAR need a purchase order raised beforehand. Expenses are',
    'approved by finance, never by the person who filed them.',
  ].join('\n');

  await uploadDocument(owner, {
    title: 'Delivery Handbook',
    filename: 'delivery-handbook.md',
    declaredContentType: 'text/markdown',
    body: Buffer.from(handbook, 'utf8'),
    category: 'policy',
    ownerType: 'organization',
    description: 'Internal reference, indexed for the assistant.',
    indexForAi: true,
    confidential: false,
    tags: ['handbook'],
    metadata: {},
  });

  log('  1 indexed document');

  log('\ndone. sign in with:');
  log('  owner@almajeed.test     (owner)');
  log('  finance@almajeed.test   (finance)');
  log('  manager@almajeed.test   (manager)');
  log('  engineer@almajeed.test  (member)');
  log('  auditor@almajeed.test   (viewer)');
  log(`  password: ${DEMO_PASSWORD}`);

  return {
    organizationId: user.organizationId,
    ownerUserId: user.id,
    accounts: [
      { email: 'owner@almajeed.test', role: 'owner' },
      { email: 'finance@almajeed.test', role: 'finance' },
      { email: 'manager@almajeed.test', role: 'manager' },
      { email: 'engineer@almajeed.test', role: 'member' },
      { email: 'auditor@almajeed.test', role: 'viewer' },
    ],
  };
}
