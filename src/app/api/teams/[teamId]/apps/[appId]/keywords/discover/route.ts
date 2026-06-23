import { NextResponse } from 'next/server';
import { validateTeamAccess } from '@/lib/auth';
import {
  AppNotFoundError,
  handleAppError,
  InvalidParamsError,
} from '@/types/errors';
import prisma from '@/lib/prisma';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { scoreKeyword } from '@/lib/aso/score';
import { scoreKeywordGPlay } from '@/lib/google-play/score-keyword';
import { googlePlayToAppStore } from '@/lib/utils/locale';
import { Store } from '@/types/aso';
import { AppStoreLocaleCode } from '@/lib/utils/locale';

export const maxDuration = 120;

// POST /api/teams/[teamId]/apps/[appId]/keywords/discover
// Body: { seedKeywords?: string[], locale: string, store: 'APPSTORE' | 'GOOGLEPLAY' }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, store: true, storeAppId: true, title: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const body = await request.json();
    const locale: string = body.locale ?? 'en-US';
    const seedKeywords: string[] = body.seedKeywords ?? [];

    if (seedKeywords.length === 0 && !app.title) {
      throw new InvalidParamsError('Provide at least one seed keyword');
    }

    // Get existing tracked keywords to avoid duplicates
    const existing = await prisma.asoKeyword.findMany({
      where: { appId },
      select: { keyword: true },
    });
    const existingSet = new Set(existing.map((k) => k.keyword.toLowerCase()));

    // Use AI to generate candidate keywords
    const prompt = `You are an App Store Optimization expert. Generate 20 highly relevant search keywords for an app.

App name: ${app.title ?? 'Unknown'}
Seed keywords: ${seedKeywords.length > 0 ? seedKeywords.join(', ') : '(none — use app name as reference)'}
Store locale: ${locale}

Requirements:
- Mix of short-tail (1-2 words) and long-tail (3-5 words) keywords
- Focus on user intent and discoverability
- Avoid brand names and trademarked terms
- Return ONLY a JSON array of strings, no explanation

Example: ["photo editor", "remove background", "portrait mode", "selfie camera filter"]`;

    const { client, model, provider } = await getTeamLlm(teamId);
    const completion = await client.chat.completions.create({
      // Prefer the cheaper mini model on OpenAI; otherwise use the team's model.
      model: provider === 'openai' ? 'gpt-4o-mini' : model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    let candidates: string[] = [];
    try {
      const parsed = JSON.parse(completion.choices[0].message.content ?? '{}');
      candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.keywords)
          ? parsed.keywords
          : (Object.values(parsed).flat() as string[]);
    } catch {
      candidates = seedKeywords;
    }

    // Filter out already-tracked keywords
    candidates = candidates
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.toLowerCase().trim())
      .filter((k) => !existingSet.has(k))
      .slice(0, 20);

    if (candidates.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Score candidates in batches of 5
    const isGPlay = app.store === Store.GOOGLEPLAY;
    const appStoreLocale = googlePlayToAppStore(locale) as AppStoreLocaleCode;

    const suggestions: {
      keyword: string;
      trafficScore: number;
      difficultyScore: number;
      position: number | null;
      overall: number;
    }[] = [];

    const batchSize = 5;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((kw) =>
          isGPlay
            ? scoreKeywordGPlay(locale, kw, app.storeAppId)
            : scoreKeyword(appStoreLocale, kw, app.storeAppId)
        )
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled') {
          suggestions.push({
            keyword: batch[j],
            trafficScore: r.value.trafficScore ?? 0,
            difficultyScore: r.value.difficultyScore ?? 0,
            position: r.value.position === -1 ? null : r.value.position,
            overall: r.value.overall ?? 0,
          });
        }
      }
    }

    // Sort by traffic descending
    suggestions.sort((a, b) => b.trafficScore - a.trafficScore);

    return NextResponse.json({ suggestions });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
