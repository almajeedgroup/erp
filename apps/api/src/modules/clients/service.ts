import {
  type Client,
  type Contact,
  type CreateClientInput,
  type ListClientsQuery,
  type Page,
  type UpdateClientInput,
  conflict,
  newId,
  notFound,
} from '@almajeed/shared';
import { clients, contacts, invoices, projects, scope, scopeById } from '@almajeed/db';
import { type SQL, and, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { diffSnapshot, writeAudit } from '../../lib/audit.js';
import { mapPage, likePattern } from '../../lib/query.js';
import { iso } from '../../lib/serialize.js';
import { assertActiveMember, findByIdOrThrow, paginate } from '../../lib/repository.js';

/**
 * Clients.
 *
 * The commercial root of the graph: projects, invoices and most documents hang
 * off a client. Because of that, deletion is a soft delete and is refused while
 * live work or unpaid invoices reference the record — an ERP that lets you
 * delete the counterparty on an outstanding invoice is not a system of record.
 */

export interface ClientRecord {
  id: string;
  name: string;
  legalName: string | null;
  status: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxNumber: string | null;
  billingCurrency: string;
  paymentTermsDays: number;
  acquisitionChannel: string;
  acquiredAt: string | null;
  address: unknown;
  notes: string | null;
  ownerId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const selection = {
  id: clients.id,
  name: clients.name,
  legalName: clients.legalName,
  status: clients.status,
  email: clients.email,
  phone: clients.phone,
  website: clients.website,
  taxNumber: clients.taxNumber,
  billingCurrency: clients.billingCurrency,
  paymentTermsDays: clients.paymentTermsDays,
  acquisitionChannel: clients.acquisitionChannel,
  acquiredAt: clients.acquiredAt,
  address: clients.address,
  notes: clients.notes,
  ownerId: clients.ownerId,
  tags: clients.tags,
  metadata: clients.metadata,
  createdAt: clients.createdAt,
  updatedAt: clients.updatedAt,
};

/**
 * Row -> response. Dates become ISO strings here, at the single boundary,
 * rather than in each route.
 */
function toClient(row: ClientRecord): Client {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    status: row.status as Client['status'],
    email: row.email,
    phone: row.phone,
    website: row.website,
    taxNumber: row.taxNumber,
    billingCurrency: row.billingCurrency,
    paymentTermsDays: row.paymentTermsDays,
    acquisitionChannel: row.acquisitionChannel as Client['acquisitionChannel'],
    acquiredAt: row.acquiredAt,
    address: (row.address ?? null) as Client['address'],
    notes: row.notes,
    ownerId: row.ownerId,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toContact(row: ContactRecord): Contact {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    isPrimary: row.isPrimary,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listClients(
  ctx: RequestContext,
  query: ListClientsQuery,
): Promise<Page<Client>> {
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(clients.status, query.status));
  if (query.tag) filters.push(sql`${clients.tags} @> ARRAY[${query.tag}]::text[]`);
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(clients.name, pattern),
        ilike(clients.legalName, pattern),
        ilike(clients.email, pattern),
      ),
    );
  }

  const page = await paginate<ClientRecord>(
    ctx.db.select(selection).from(clients).$dynamic(),
    clients,
    ctx,
    { limit: query.limit, cursor: query.cursor, filters },
  );
  return mapPage(page, toClient);
}

/** Internal read: keeps the raw row, for services that need the `Date` values. */
async function getClientRow(ctx: RequestContext, id: string): Promise<ClientRecord> {
  return findByIdOrThrow<ClientRecord>(
    ctx.db.select(selection).from(clients).$dynamic(),
    clients,
    ctx,
    id,
    'Client',
  );
}

export async function getClient(ctx: RequestContext, id: string): Promise<Client> {
  return toClient(await getClientRow(ctx, id));
}

export async function createClient(ctx: RequestContext, input: CreateClientInput): Promise<Client> {
  await assertActiveMember(ctx, input.ownerId);

  const id = newId('client');
  const values = {
    id,
    organizationId: ctx.auth.organizationId,
    name: input.name,
    legalName: input.legalName ?? null,
    status: input.status,
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    taxNumber: input.taxNumber ?? null,
    billingCurrency: input.billingCurrency,
    paymentTermsDays: input.paymentTermsDays,
    acquisitionChannel: input.acquisitionChannel,
    acquiredAt: input.acquiredAt ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    ownerId: input.ownerId ?? null,
    tags: input.tags,
    metadata: input.metadata,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };

  await ctx.db.transaction(async (tx) => {
    await tx.insert(clients).values(values);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'client.created',
      resourceType: 'client',
      resourceId: id,
      after: { name: input.name, status: input.status },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getClient(ctx, id);
}

export async function updateClient(
  ctx: RequestContext,
  id: string,
  input: UpdateClientInput,
): Promise<Client> {
  const before = await getClientRow(ctx, id);
  await assertActiveMember(ctx, input.ownerId);

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  const assign = <K extends keyof UpdateClientInput>(key: K, column = key as string) => {
    if (input[key] !== undefined) patch[column] = input[key];
  };

  assign('name');
  assign('legalName');
  assign('status');
  assign('email');
  assign('phone');
  assign('website');
  assign('taxNumber');
  assign('billingCurrency');
  assign('paymentTermsDays');
  assign('acquisitionChannel');
  assign('acquiredAt');
  assign('address');
  assign('notes');
  assign('ownerId');
  assign('tags');
  assign('metadata');

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set(patch)
      .where(scopeById(clients, ctx.auth.organizationId, id));
    const changes = diffSnapshot(before as unknown as Record<string, unknown>, patch);
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'client.updated',
      resourceType: 'client',
      resourceId: id,
      before: changes.before,
      after: changes.after,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  return getClient(ctx, id);
}

/**
 * Soft-delete a client.
 *
 * Refused while an active project or an unsettled invoice still points at it.
 * The alternative — cascading, or orphaning the rows — loses financial history,
 * which is the one thing this system exists to keep.
 */
export async function deleteClient(ctx: RequestContext, id: string): Promise<void> {
  const client = await getClientRow(ctx, id);

  const [activeProjects] = await ctx.db
    .select({ total: count() })
    .from(projects)
    .where(
      scope(
        projects,
        ctx.auth.organizationId,
        eq(projects.clientId, id),
        or(eq(projects.status, 'active'), eq(projects.status, 'on_hold')),
      ),
    );

  if ((activeProjects?.total ?? 0) > 0) {
    throw conflict('This client still has active projects', {
      activeProjects: activeProjects?.total,
    });
  }

  const [openInvoices] = await ctx.db
    .select({ total: count() })
    .from(invoices)
    .where(
      scope(
        invoices,
        ctx.auth.organizationId,
        eq(invoices.clientId, id),
        or(eq(invoices.status, 'issued'), eq(invoices.status, 'partially_paid')),
      ),
    );

  if ((openInvoices?.total ?? 0) > 0) {
    throw conflict('This client still has unpaid invoices', {
      openInvoices: openInvoices?.total,
    });
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set({ deletedAt: ctx.now, updatedAt: ctx.now })
      .where(scopeById(clients, ctx.auth.organizationId, id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'client.deleted',
      resourceType: 'client',
      resourceId: id,
      before: { name: client.name, status: client.status },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });
}

/* -------------------------------------------------------------- contacts -- */

export interface ContactRecord {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const contactSelection = {
  id: contacts.id,
  clientId: contacts.clientId,
  name: contacts.name,
  title: contacts.title,
  email: contacts.email,
  phone: contacts.phone,
  isPrimary: contacts.isPrimary,
  notes: contacts.notes,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
};

export async function listContacts(ctx: RequestContext, clientId: string): Promise<Contact[]> {
  await getClientRow(ctx, clientId); // 404s for another tenant's client id
  const rows = await ctx.db
    .select(contactSelection)
    .from(contacts)
    .where(scope(contacts, ctx.auth.organizationId, eq(contacts.clientId, clientId)))
    .orderBy(contacts.isPrimary, contacts.name);
  return rows.map(toContact);
}

export async function createContact(
  ctx: RequestContext,
  clientId: string,
  input: {
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    isPrimary: boolean;
    notes?: string;
  },
): Promise<Contact> {
  await getClientRow(ctx, clientId);

  const id = newId('contact');

  await ctx.db.transaction(async (tx) => {
    if (input.isPrimary) {
      // A partial unique index enforces one primary per client, so the old one
      // has to step down inside the same transaction.
      await tx
        .update(contacts)
        .set({ isPrimary: false, updatedAt: ctx.now })
        .where(
          and(
            scope(contacts, ctx.auth.organizationId, eq(contacts.clientId, clientId)),
            eq(contacts.isPrimary, true),
          ),
        );
    }

    await tx.insert(contacts).values({
      id,
      organizationId: ctx.auth.organizationId,
      clientId,
      name: input.name,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      isPrimary: input.isPrimary,
      notes: input.notes ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });

    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'contact.created',
      resourceType: 'contact',
      resourceId: id,
      after: { clientId, name: input.name },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  const [created] = await ctx.db
    .select(contactSelection)
    .from(contacts)
    .where(scopeById(contacts, ctx.auth.organizationId, id))
    .limit(1);

  if (!created) throw notFound('Contact', id);
  return toContact(created);
}

export async function deleteContact(
  ctx: RequestContext,
  clientId: string,
  contactId: string,
): Promise<void> {
  await getClientRow(ctx, clientId);

  const updated = await ctx.db
    .update(contacts)
    .set({ deletedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(scopeById(contacts, ctx.auth.organizationId, contactId), eq(contacts.clientId, clientId)),
    )
    .returning({ id: contacts.id });

  if (updated.length === 0) throw notFound('Contact', contactId);

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'contact.deleted',
    resourceType: 'contact',
    resourceId: contactId,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}
