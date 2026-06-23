import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { zodResponseFormat } from '@/lib/llm/openai';
import { getCurrentLlm } from '@/lib/llm/llm-context';
import { keywordFinalSanityCheckPrompt } from '@/lib/llm/prompts/keyword';
import { z } from 'zod';
import { LlmRefusalError } from '@/types/errors';
import { getLocaleName, LocaleCode } from '@/lib/utils/locale';

const IndicesResponseSchema = z.object({
  indices: z.array(z.number()),
});

export const localeSanityCheck = async (
  locale: LocaleCode,
  keywords: string[]
) => {
  const keywordsString = keywords
    .map((keyword, i) => `  ${i + 1}. "${keyword}"`)
    .join('\n');
  const messages = [
    {
      role: 'system',
      content: keywordFinalSanityCheckPrompt.render({
        locale: getLocaleName(locale),
      }),
    },
    {
      role: 'user',
      content: `- Keywords: ${keywordsString}`,
    },
  ] as ChatCompletionMessageParam[];

  const { client, model } = getCurrentLlm();
  const response = await client.beta.chat.completions.parse({
    model,
    messages,
    response_format: zodResponseFormat(IndicesResponseSchema, 'indices'),
  });

  if (!response.choices[0].message.parsed) {
    throw new LlmRefusalError('No response from the model');
  }

  return response.choices[0].message.parsed.indices;
};

export const keywordFinalSanityCheck = async (
  locale: LocaleCode,
  keywords: string[]
) => {
  const keywordsString = keywords
    .map((keyword, i) => `  ${i + 1}. "${keyword}"`)
    .join('\n');
  const messages = [
    {
      role: 'system',
      content: keywordFinalSanityCheckPrompt.render({
        locale: getLocaleName(locale),
      }),
    },
    {
      role: 'user',
      content: `- Keywords: ${keywordsString}`,
    },
  ] as ChatCompletionMessageParam[];

  const { client, model } = getCurrentLlm();
  const response = await client.beta.chat.completions.parse({
    model,
    messages,
    response_format: zodResponseFormat(IndicesResponseSchema, 'indices'),
  });

  if (!response.choices[0].message.parsed) {
    throw new LlmRefusalError('No response from the model');
  }

  return response.choices[0].message.parsed.indices;
};
