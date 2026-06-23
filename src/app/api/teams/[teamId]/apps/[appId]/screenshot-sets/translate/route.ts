import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateTeamAccess } from '@/lib/auth';
import { AppNotFoundError, handleAppError } from '@/types/errors';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

export const maxDuration = 60;

const SlideTextSchema = z.object({
  headline: z.string(),
  subtitle: z.string(),
  badge: z.string().optional(),
});

const TranslationResponseSchema = z.object({
  translations: z.array(
    z.object({
      locale: z.string(),
      slides: z.array(SlideTextSchema),
    })
  ),
});

/**
 * POST /api/teams/[teamId]/apps/[appId]/screenshot-sets/translate
 *
 * Body:
 *   slides      – array of { headline, subtitle, badge? } (base texts)
 *   targetLocales – string[] of locale codes to translate into
 *   sourceLocale  – source locale (default "en-US")
 */
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId, userId } = await validateTeamAccess(request);
    await checkRateLimit(`screenshot-translate:${userId}`, 15, '1 h');

    const { appId } = params;
    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { title: true, store: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const body = await request.json();
    const {
      slides,
      targetLocales,
      sourceLocale = 'en-US',
    }: {
      slides: Array<{ headline: string; subtitle: string; badge?: string }>;
      targetLocales: string[];
      sourceLocale?: string;
    } = body;

    if (!slides?.length || !targetLocales?.length) {
      return NextResponse.json(
        { error: 'slides and targetLocales are required' },
        { status: 400 }
      );
    }

    const storeLabel =
      app.store === 'GOOGLEPLAY' ? 'Google Play Store' : 'App Store';

    const slidesText = slides
      .map(
        (s, i) =>
          `Slide ${i + 1}: headline="${s.headline}" | subtitle="${s.subtitle}"${s.badge ? ` | badge="${s.badge}"` : ''}`
      )
      .join('\n');

    const prompt = `You are a professional app store copywriter and translator.

App: "${app.title ?? 'unknown'}" on ${storeLabel}
Source locale: ${sourceLocale}
Target locales: ${targetLocales.join(', ')}

Original slide texts (${sourceLocale}):
${slidesText}

Translate each slide into EACH of the target locales. Follow these rules:
- Keep the same meaning and impact as the original
- Use natural, idiomatic language for each locale (not literal word-for-word translation)
- Respect App Store headline ≤5 words and subtitle ≤10 words guidelines IN THE TARGET LANGUAGE
- Keep badge text very short (1-2 words) or leave empty if untranslatable
- Return translations for ALL ${targetLocales.length} target locale(s) and ALL ${slides.length} slides`;

    const { client, model } = await getTeamLlm(teamId);
    const completion = await client.beta.chat.completions.parse({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: zodResponseFormat(
        TranslationResponseSchema,
        'translation_response'
      ),
    });

    const parsed = completion.choices[0].message.parsed;
    if (!parsed) {
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed.translations);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
