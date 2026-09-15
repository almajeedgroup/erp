'use client';

import { useState, useTransition } from 'react';
import { ask } from '@/app/(app)/assistant/actions';
import type { ChatResponse } from '@/lib/types';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatResponse['citations'];
  toolCalls?: ChatResponse['toolCalls'];
  truncated?: boolean;
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;

    setTurns((previous) => [...previous, { role: 'user', content: question }]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const result = await ask(conversationId, question, allowWrites);

      if (result.error || !result.answer) {
        setError(result.error ?? 'Something went wrong.');
        return;
      }

      setConversationId(result.answer.conversationId);
      setTurns((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: result.answer!.content,
          citations: result.answer!.citations,
          toolCalls: result.answer!.toolCalls,
          truncated: result.answer!.truncated,
        },
      ]);
    });
  };

  return (
    <section className="flex h-[32rem] flex-col rounded-xl border border-border-subtle bg-surface-raised">
      <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-ink">Ask about your own data</p>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              “Which invoices are overdue?” · “What is our margin on Phase 2?” · “What are the
              payment terms for Riyadh Metro?”
            </p>
          </div>
        ) : (
          turns.map((turn, index) => (
            <article
              key={index}
              className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
                  turn.role === 'user'
                    ? 'bg-accent text-white'
                    : 'border border-border-subtle bg-surface text-ink'
                }`}
              >
                <p className="whitespace-pre-wrap">{turn.content}</p>

                {turn.toolCalls && turn.toolCalls.length > 0 ? (
                  <p className="mt-2 border-t border-border-subtle pt-2 text-xs text-ink-faint">
                    Used:{' '}
                    {turn.toolCalls
                      .map(
                        (call) => `${call.name}${call.requiresConfirmation ? ' (proposal)' : ''}`,
                      )
                      .join(', ')}
                  </p>
                ) : null}

                {turn.citations && turn.citations.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                    {turn.citations.map((citation) => (
                      <li key={`${citation.documentId}-${citation.chunkIndex}`} className="text-xs">
                        <a
                          href={`/api/documents/${citation.documentId}/download`}
                          className="text-accent-strong hover:underline"
                        >
                          {citation.title}
                        </a>
                        <span className="ml-1 text-ink-faint">
                          #{citation.chunkIndex} · {(citation.score * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {turn.truncated ? (
                  <p className="mt-2 text-xs text-caution">
                    Stopped at the step limit — the answer may be incomplete.
                  </p>
                ) : null}
              </div>
            </article>
          ))
        )}

        {pending ? <p className="text-sm text-ink-faint">Thinking…</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="border-t border-border-subtle p-3">
        <div className="flex gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Your question
          </label>
          <input
            id="assistant-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about clients, projects, invoices…"
            disabled={pending}
            className="flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || draft.trim().length === 0}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            Ask
          </button>
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={allowWrites}
            onChange={(event) => setAllowWrites(event.target.checked)}
            className="rounded border-border-subtle"
          />
          Let it propose changes (it still cannot make them without you confirming)
        </label>
      </form>
    </section>
  );
}
