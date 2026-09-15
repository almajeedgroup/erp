'use server';

import { ApiError, apiFetch } from '@/lib/api';
import type { ChatResponse } from '@/lib/types';

export interface AskResult {
  answer?: ChatResponse;
  error?: string;
}

/**
 * Ask the assistant.
 *
 * A server action, so the access token stays on the server and the browser
 * never learns the API's address. `allowWrites` is passed through from an
 * explicit checkbox — the default is off, and even when on the agent returns a
 * proposal rather than performing the change.
 */
export async function ask(
  conversationId: string | null,
  message: string,
  allowWrites: boolean,
): Promise<AskResult> {
  const trimmed = message.trim();
  if (!trimmed) return { error: 'Ask a question first.' };

  try {
    const answer = await apiFetch<ChatResponse>('/api/v1/ai/chat', {
      method: 'POST',
      body: {
        message: trimmed,
        ...(conversationId ? { conversationId } : {}),
        useRetrieval: true,
        allowWrites,
      },
    });
    return { answer };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429)
        return { error: 'Slow down a moment — too many questions at once.' };
      return { error: error.message };
    }
    return { error: 'The assistant is unavailable right now.' };
  }
}
