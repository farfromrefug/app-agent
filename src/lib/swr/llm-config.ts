import { LlmProvider } from '@/lib/llm/providers';

export type LlmConfig = {
  provider: LlmProvider | null;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  isConfigured: boolean;
  canEdit: boolean;
  envFallback: {
    hasApiKey: boolean;
    baseUrl: string;
    model: string;
  };
};

export type LlmConfigInput = {
  provider: LlmProvider | null;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export async function getLlmConfig(teamId: string): Promise<LlmConfig> {
  const res = await fetch(`/api/teams/${teamId}/llm-config`);
  if (!res.ok) throw new Error('Failed to load LLM config');
  return res.json();
}

export async function saveLlmConfig(teamId: string, input: LlmConfigInput) {
  const res = await fetch(`/api/teams/${teamId}/llm-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to save LLM config');
  }
  return res.json();
}

export async function testLlmConfig(
  teamId: string,
  input: LlmConfigInput
): Promise<{ ok: boolean; model?: string; error?: string }> {
  const res = await fetch(`/api/teams/${teamId}/llm-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test', ...input }),
  });
  return res.json();
}
