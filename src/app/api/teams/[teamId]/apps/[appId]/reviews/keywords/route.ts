import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { z } from 'zod';
import { zodResponseFormat } from '@/lib/llm/openai';

export const maxDuration = 60;

const ResponseSchema = z.object({
  keywords: z.array(
    z.object({
      keyword: z.string(),
      frequency: z.number().int(),
      sentiment: z.enum(['positive', 'neutral']),
    })
  ),
});

// GET /api/teams/[teamId]/apps/[appId]/reviews/keywords?days=90
// Extracts frequently mentioned terms from positive/neutral reviews as keyword suggestions
export async function GET(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;
    const url = new URL(request.url);
    const days = Math.min(
      parseInt(url.searchParams.get('days') ?? '90', 10),
      365
    );

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Fetch positive and neutral reviews (score >= 3) with text
    const reviews = await prisma.appReview.findMany({
      where: {
        appId,
        reviewedAt: { gte: since },
        score: { gte: 3 },
        body: { not: null },
      },
      select: { body: true, score: true },
      orderBy: { reviewedAt: 'desc' },
      take: 200,
    });

    if (reviews.length === 0) return NextResponse.json([]);

    const reviewText = reviews.map((r) => `[${r.score}★] ${r.body}`).join('\n');

    const { client, model } = await getTeamLlm(teamId);
    const response = await client.beta.chat.completions.parse({
      model,
      messages: [
        {
          role: 'user',
          content: `You are an ASO expert. Analyze these app store reviews and extract the most frequently mentioned features, use cases, or descriptive terms that users use to describe the app.

Rules:
- Only extract meaningful keywords (2-3 words max per keyword)
- Focus on terms users naturally use to find this type of app
- Ignore generic words like "great", "good", "love"
- Count how many reviews mention each term (approximately)
- Mark as "positive" if mentioned positively, "neutral" otherwise
- Return the top 20 most relevant keywords

Reviews:
${reviewText}`,
        },
      ],
      response_format: zodResponseFormat(ResponseSchema, 'keywords'),
    });

    const parsed = response.choices[0]?.message?.parsed;
    if (!parsed) return NextResponse.json([]);

    return NextResponse.json(
      parsed.keywords.sort((a, b) => b.frequency - a.frequency).slice(0, 20)
    );
  } catch (error) {
    return handleAppError(error as Error);
  }
}
