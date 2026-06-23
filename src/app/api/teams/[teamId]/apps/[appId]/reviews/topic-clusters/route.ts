import { NextResponse } from 'next/server';
import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { logLLMUsage } from '@/lib/llm/log-usage';

export const maxDuration = 30;

export interface TopicCluster {
  topic: string;
  emoji: string;
  count: number;
  sentiment: 'positive' | 'negative' | 'mixed';
  keywords: string[];
  examples: string[];
}

// POST /api/teams/[teamId]/apps/[appId]/reviews/topic-clusters
// Body: { reviews: { body: string; rating: number; title?: string | null }[] }
// Returns: { clusters: TopicCluster[] }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, title: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const { reviews } = (await request.json()) as {
      reviews: { body: string; rating: number; title?: string | null }[];
    };

    if (!reviews?.length) return NextResponse.json({ clusters: [] });

    // Sample uniformly up to 80 reviews to keep prompt manageable
    const step = Math.ceil(reviews.length / 80);
    const sample = reviews.filter((_, i) => i % step === 0).slice(0, 80);

    const reviewText = sample
      .map(
        (r, i) =>
          `${i + 1}. [${r.rating}★] ${r.title ? r.title + ': ' : ''}${r.body.slice(0, 180)}`
      )
      .join('\n');

    const prompt = `Analyze these user reviews for the app "${app.title ?? 'this app'}" and identify 4-6 recurring topics.

Reviews:
${reviewText}

Return ONLY valid JSON (no markdown) with this exact shape:
{"clusters":[{"topic":"2-4 word topic name","emoji":"one emoji","count":N,"sentiment":"positive|negative|mixed","keywords":["term1","term2","term3"],"examples":["short excerpt max 80 chars","another excerpt"]}]}`;

    const { client, model } = await getTeamLlm(teamId);
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });

    logLLMUsage('review-topic-clusters', model, response.usage);

    let clusters: TopicCluster[] = [];
    try {
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
      clusters = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.clusters)
          ? parsed.clusters
          : [];
    } catch {
      clusters = [];
    }

    return NextResponse.json({ clusters });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
