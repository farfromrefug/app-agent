import { getCurrentLlm } from '@/lib/llm/llm-context';
import { shortDescriptionSystemPrompt } from '../prompts/short-description';
import { shortDescriptionUserPrompt } from '../prompts/short-description';

export async function generateShortDescription(
  title: string,
  description: string
) {
  const systemPrompt = shortDescriptionSystemPrompt.trim();
  const userPrompt = shortDescriptionUserPrompt
    .render({
      appTitle: title,
      appDescription: description,
    })
    .trim();
  const { client, model } = getCurrentLlm();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return response.choices[0].message.content || null;
}
