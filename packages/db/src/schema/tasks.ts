import { relations } from 'drizzle-orm';
import { date, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { idColumn, metadataColumn, softDelete, tagsColumn, timestamps } from './columns.js';
import { taskPriorityEnum, taskStatusEnum } from './enums.js';
import { clients } from './crm.js';
import { projects } from './projects.js';
import { organizations, users } from './tenancy.js';

export const tasks = pgTable(
  'tasks',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    projectId: idColumn('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    clientId: idColumn('client_id').references(() => clients.id, { onDelete: 'set null' }),
    assigneeId: idColumn('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: idColumn('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    parentTaskId: idColumn('parent_task_id'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    dueDate: date('due_date', { mode: 'string' }),
    estimateMinutes: integer('estimate_minutes'),
    /** Sparse board ordering (1000, 2000, ...) so a move rewrites one row. */
    position: integer('position').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('tasks_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('tasks_org_status_idx').on(table.organizationId, table.status),
    index('tasks_assignee_idx').on(table.assigneeId, table.status),
    index('tasks_project_idx').on(table.projectId, table.position),
    index('tasks_due_idx').on(table.organizationId, table.dueDate),
    index('tasks_parent_idx').on(table.parentTaskId),
  ],
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    taskId: idColumn('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorUserId: idColumn('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('task_comments_task_idx').on(table.taskId, table.createdAt.desc()),
    index('task_comments_org_idx').on(table.organizationId),
  ],
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tasks.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  comments: many(taskComments),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [taskComments.authorUserId], references: [users.id] }),
}));
