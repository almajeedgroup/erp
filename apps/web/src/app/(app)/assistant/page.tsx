import type { Metadata } from 'next';
import { Card, NoAccess, PageHeader } from '@/components/ui';
import { Assistant } from '@/components/assistant';
import { apiFetchOrNull } from '@/lib/api';

export const metadata: Metadata = { title: 'AI assistant' };

interface ToolRow {
  name: string;
  description: string;
  permission: string;
  write: boolean;
  available: boolean;
}

/**
 * The assistant.
 *
 * The tool list is fetched server-side and shown to the user, because the most
 * useful thing an assistant can be honest about is what it cannot do. A user
 * who can see that `get_receivables_aging` needs `analytics:read` knows exactly
 * what to ask an administrator for.
 */
export default async function AssistantPage() {
  const tools = await apiFetchOrNull<ToolRow[]>('/api/v1/ai/tools');
  if (!tools) return <NoAccess permission="ai:chat" />;

  const available = tools.filter((tool) => tool.available);
  const withheld = tools.filter((tool) => !tool.available);

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Answers from your own records. It can only see what your role can see, and it never changes anything without you confirming."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Assistant />
        </div>

        <div className="space-y-4">
          <Card title="What it can do" description={`${available.length} tools available to you.`}>
            <ul className="space-y-2.5">
              {available.map((tool) => (
                <li key={tool.name}>
                  <p className="font-mono text-xs text-ink">{tool.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{tool.description}</p>
                </li>
              ))}
            </ul>
          </Card>

          {withheld.length > 0 ? (
            <Card
              title="Not available to you"
              description="Your role doesn’t grant these, so they are never offered to the model."
            >
              <ul className="space-y-2">
                {withheld.map((tool) => (
                  <li key={tool.name} className="text-xs">
                    <p className="font-mono text-ink-muted">{tool.name}</p>
                    <p className="text-ink-faint">
                      needs <code>{tool.permission}</code>
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
