import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateTeamAccess } from '@/lib/auth';
import { AppNotFoundError, handleAppError } from '@/types/errors';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

export const maxDuration = 60;

const SlidesSchema = z.object({
  slides: z.array(
    z.object({
      headline: z.string(),
      subtitle: z.string(),
      badge: z.string().optional(),
    })
  ),
});

// POST /api/teams/[teamId]/apps/[appId]/screenshot-sets/generate-texts
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId, userId } = await validateTeamAccess(request);
    await checkRateLimit(`screenshot-gen:${userId}`, 20, '1 h');

    const { appId } = params;

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: {
        title: true,
        subtitle: true,
        shortDescription: true,
        store: true,
        platform: true,
      },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const body = await request.json();
    const { locale = 'en-US', count = 5, description, keywords } = body;

    const storeLabel =
      app.store === 'GOOGLEPLAY' ? 'Google Play Store' : 'App Store';

    const prompt = `You are an expert App Store Optimization copywriter.

App: "${app.title ?? 'unknown'}"
Store: ${storeLabel}
Locale: ${locale}
${app.subtitle ? `Subtitle: ${app.subtitle}` : ''}
${description ? `Description: ${description}` : app.shortDescription ? `Short description: ${app.shortDescription}` : ''}
${keywords ? `Top keywords: ${keywords}` : ''}

Generate exactly ${count} screenshot slide texts for this app. Each slide should highlight a different benefit or feature.

Rules:
- Headline: max 5 words, punchy, benefit-focused, title case. No punctuation at the end.
- Subtitle: max 10 words, elaborates the headline, sentence case.
- Badge (optional): 1-2 words only (e.g. "New", "Pro", "Free", "#1"). Leave empty if not relevant.
- Write in the language of the locale (${locale}).
- Vary the tone across slides: empowering, practical, social proof, emotional, call-to-action.
- Do NOT mention competitor names.`;

    const { client, model } = await getTeamLlm(teamId);
    const completion = await client.beta.chat.completions.parse({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: zodResponseFormat(SlidesSchema, 'slides_response'),
    });

    const parsed = completion.choices[0].message.parsed;
    if (!parsed) {
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed.slides);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
