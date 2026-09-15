/**
 * The shapes the web app consumes.
 *
 * They are imported from `@almajeed/shared`, which is the same module the API
 * validates its responses against — so a field the server stopped returning is
 * a type error here, not a blank cell in production.
 */
export type {
  Client,
  Contact,
  Employee,
  Expense,
  Invoice,
  InvoiceDetail,
  MoneyDTO,
  Overview,
  Page,
  Payment,
  Project,
  ProjectProfitability,
  ReceivablesAging,
  SessionUser,
  Task,
  TaskComment,
  TimeEntry,
} from '@almajeed/shared';

export interface CashFlowForecast {
  currency: string;
  openingBalance: { amount: string; currency: string };
  weeks: {
    weekStart: string;
    expectedInflow: { amount: string; currency: string };
    expectedOutflow: { amount: string; currency: string };
    closingBalance: { amount: string; currency: string };
  }[];
}

export interface RevenueSeries {
  currency: string;
  granularity: string;
  points: {
    period: string;
    revenue: { amount: string; currency: string };
    expenses: { amount: string; currency: string };
    net: { amount: string; currency: string };
  }[];
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  content: string;
  citations: {
    documentId: string;
    title: string;
    chunkIndex: number;
    score: number;
    excerpt: string;
  }[];
  toolCalls: { name: string; requiresConfirmation: boolean }[];
  usage: { inputTokens: number; outputTokens: number; steps: number };
  truncated: boolean;
}

export interface DocumentRecord {
  id: string;
  title: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  category: string;
  ownerType: string;
  confidential: boolean;
  indexForAi: boolean;
  tags: string[];
  createdAt: string;
}
