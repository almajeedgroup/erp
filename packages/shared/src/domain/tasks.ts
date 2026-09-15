import { z } from 'zod';
import {
  id,
  isoDate,
  isoDateTime,
  longText,
  mediumText,
  metadataSchema,
  paginationQuerySchema,
  shortText,
  tagsSchema,
} from './common.js';

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that stop counting toward open work and freeze the burn-down. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export const createTaskSchema = z.strictObject({
  title: shortText,
  description: longText.optional(),
  projectId: id('project').optional(),
  clientId: id('client').optional(),
  assigneeId: id('user').optional(),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default('medium'),
  dueDate: isoDate.optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).optional(),
  parentTaskId: id('task').optional(),
  tags: tagsSchema,
  metadata: metadataSchema,
});

export const updateTaskSchema = z.strictObject({
  title: shortText.optional(),
  description: longText.optional(),
  projectId: id('project').nullable().optional(),
  clientId: id('client').nullable().optional(),
  assigneeId: id('user').nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: isoDate.nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  /** Ordering key within a board column; sparse to avoid rewriting siblings. */
  position: z.number().int().optional(),
  tags: tagsSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  projectId: id('project').optional(),
  assigneeId: id('user').optional(),
  dueBefore: isoDate.optional(),
  openOnly: z.stringbool().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const createCommentSchema = z.strictObject({
  body: mediumText,
});

export const taskSchema = z.object({
  id: id('task'),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  assigneeId: z.string().nullable(),
  projectId: z.string().nullable(),
  createdAt: isoDateTime,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
