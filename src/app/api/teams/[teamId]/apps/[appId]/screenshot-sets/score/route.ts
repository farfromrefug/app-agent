import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateTeamAccess } from '@/lib/auth';
import { AppNotFoundError, handleAppError } from '@/types/errors';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

export const maxDuration = 60;

const SlideScoreSchema = z.object({
  slideIndex: z.number(),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
});

const ScoreResponseSchema = z.object({
  overallScore: z.number().min(0).max(100),
  overallSummary: z.string(),
  slides: z.array(SlideScoreSchema),
  topStrengths: z.array(z.string()),
  topImprovements: z.array(z.string()),
});

// POST /api/teams/[teamId]/apps/[appId]/screenshot-sets/score
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId, userId } = await validateTeamAccess(request);
    await checkRateLimit(`screenshot-score:${userId}`, 30, '1 h');

    const { appId } = params;
    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { title: true, store: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const body = await request.json();
    const {
      slides,
      locale = 'en-US',
    }: {
      slides: Array<{ headline: string; subtitle: string; badge?: string }>;
      locale?: string;
    } = body;

    if (!slides?.length) {
      return NextResponse.json(
        { error: 'slides is required' },
        { status: 400 }
      );
    }

    const storeLabel =
      app.store === 'GOOGLEPLAY' ? 'Google Play Store' : 'App Store';

    const slidesText = slides
      .map(
        (s, i) =>
          `Slide ${i + 1}:\n  Headline: "${s.headline}"\n  Subtitle: "${s.subtitle}"${s.badge ? `\n  Badge: "${s.badge}"` : ''}`
      )
      .join('\n\n');

    const prompt = `You are a senior App Store Optimization (ASO) expert. Evaluate the following screenshot slide texts for the app "${app.title ?? 'unknown'}" on ${storeLabel} (locale: ${locale}).

${slidesText}

Score each slide 0–100 and the overall set 0–100 based on these ASO best practices:
- Headline: ≤5 words, clear benefit, no filler words, avoids generic terms like "Amazing" or "Best"
- Subtitle: ≤10 words, reinforces headline, specific not vague
- First slide: highest-impact feature, strongest CTA
- Variety: each slide covers a different feature or audience pain point
- Clarity: no jargon, immediately understandable to the target user
- Emotional hook: creates desire or urgency
- Locale correctness: natural language for ${locale}

Be constructive but specific. Identify exact words that weaken the copy and suggest concrete replacements.`;

    const { client, model } = await getTeamLlm(teamId);
    const completion = await client.beta.chat.completions.parse({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: zodResponseFormat(ScoreResponseSchema, 'score_response'),
    });

    const parsed = completion.choices[0].message.parsed;
    if (!parsed) {
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
