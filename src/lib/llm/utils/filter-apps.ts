import { appFilteringSystemPrompt } from '@/lib/llm/prompts/keyword';
import { zodResponseFormat } from '@/lib/llm/openai';
import { getCurrentLlm } from '@/lib/llm/llm-context';
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { z } from 'zod';
import { LlmRefusalError } from '@/types/errors';
import { logLLMUsage } from '@/lib/llm/log-usage';

const IndicesResponseSchema = z.object({
  reasoningSteps: z.array(z.string()),
  indices: z.array(z.number()),
});

interface FilterableApp {
  title?: string | null;
  description?: string | null;
}

export async function filterApps<T extends FilterableApp>(
  title: string,
  shortDescription: string,
  apps: T[]
): Promise<T[]> {
  const messages = [
    { role: 'system', content: appFilteringSystemPrompt.trim() },
    {
      role: 'user',
      content: `- App Description: "${title} (${shortDescription})"\n- Potential Competitors List:\n${apps.map((app, i) => `  ${i + 1}. "${app.title} (${app.description?.slice(0, 200)}...)"`).join('\n')}`,
    },
  ] as ChatCompletionMessageParam[];

  const { client, model } = getCurrentLlm();
  const response = await client.beta.chat.completions.parse({
    model,
    messages,
    response_format: zodResponseFormat(IndicesResponseSchema, 'indices'),
  });

  if (response.choices[0].message.refusal) {
    throw new LlmRefusalError('The model refused to generate indices.');
  }

  logLLMUsage('filter-apps', model, response.usage);
  const result = response.choices[0].message.parsed;
  const indices = result?.indices;
  return (indices?.map((i) => apps[i - 1]).filter(Boolean) as T[]) || [];
}
