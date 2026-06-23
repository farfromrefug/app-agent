import { logLLMUsage } from '@/lib/llm/log-usage';
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { LocaleCode, getLocaleName } from '@/lib/utils/locale';
import { zodResponseFormat } from '@/lib/llm/openai';
import { getCurrentLlm } from '@/lib/llm/llm-context';
import { z } from 'zod';
import { LlmRefusalError } from '@/types/errors';
import { keywordGenerationPrompt } from '@/lib/llm/prompts/keyword';

const KeywordResponseSchema = z.object({
  keywords: z.array(z.string()),
});

export async function generateAsoKeywords(
  locale: LocaleCode,
  title: string,
  shortDescription: string
): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content: keywordGenerationPrompt.render({
        locale: getLocaleName(locale),
      }),
    },
    {
      role: 'user',
      content: `Here's the target app information:
Title: "${title}"
Description: "${shortDescription}"
Locale: ${getLocaleName(locale)}`,
    },
  ] as ChatCompletionMessageParam[];

  const { client, model } = getCurrentLlm();
  const response = await client.beta.chat.completions.parse({
    model,
    messages,
    response_format: zodResponseFormat(KeywordResponseSchema, 'keywords'),
  });

  if (response.choices[0].message.refusal) {
    throw new LlmRefusalError(response.choices[0].message.refusal);
  }

  logLLMUsage('generate-aso-keywords', model, response.usage);
  return response.choices[0].message.parsed?.keywords ?? [];
}
