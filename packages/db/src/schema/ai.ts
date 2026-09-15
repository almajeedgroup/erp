import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { idColumn, metadataColumn, softDelete, timestamps } from './columns.js';
import { messageRoleEnum } from './enums.js';
import { organizations, users } from './tenancy.js';

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Conversations are private to their creator, not shared across the org. */
    userId: idColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }),
    model: varchar('model', { length: 80 }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('ai_conversations_user_idx').on(table.userId, table.createdAt.desc()),
    index('ai_conversations_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

/**
 * Messages.
 *
 * `citations` and `tool_calls` are stored alongside the text so an answer can
 * always be traced back to the records it was drawn from — a claim with no
 * citation is a claim the operator should not act on. Token counts are kept
 * per message because cost attribution per organization is a billing input,
 * not an afterthought.
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: idColumn('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<unknown[]>(),
    toolCalls: jsonb('tool_calls').$type<unknown[]>(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** 'up' | 'down' from the reader; the raw signal for offline evaluation. */
    feedback: varchar('feedback', { length: 10 }),
    feedbackComment: text('feedback_comment'),
    metadata: metadataColumn(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('ai_messages_conversation_idx').on(table.conversationId, table.createdAt),
    index('ai_messages_org_idx').on(table.organizationId, table.createdAt.desc()),
  ],
);

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [aiConversations.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  messages: many(aiMessages),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.conversationId],
    references: [aiConversations.id],
  }),
}));
