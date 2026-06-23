import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { parseGuessedKeywords } from '@/lib/serialize-keywords';
import { NextResponse } from 'next/server';
import openai from '@/lib/llm/openai';
import { LLM_MODEL } from '@/lib/config';
import { logLLMUsage } from '@/lib/llm/log-usage';

export const maxDuration = 30;

export interface AISuggestion {
  keyword: string;
  rationale: string;
}

// POST /api/teams/[teamId]/apps/[appId]/keywords/ai-suggestions
// Body: { locale: string }
// Returns: { suggestions: AISuggestion[] }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;
    const { locale = 'en-US' } = await request.json();

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, title: true, store: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    // Current tracked keywords for this locale
    const tracked = await prisma.asoKeyword.findMany({
      where: { appId, locale },
      select: { keyword: true, trafficScore: true, overall: true },
      orderBy: { overall: 'desc' },
      take: 30,
    });

    // App metadata for context
    const localization = await prisma.appLocalization.findFirst({
      where: { appVersion: { appId }, locale },
      select: {
        title: true,
        subtitle: true,
        keywords: true,
        description: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Top competitor keywords for context
    const competitors = await prisma.competitor.findMany({
      where: { appId, locale },
      select: { title: true, guessedKeywords: true },
      take: 5,
    });
    const allCompKws = competitors
      .flatMap((c) => parseGuessedKeywords(c.guessedKeywords))
      .slice(0, 40);
    const competitorKeywords = Array.from(new Set(allCompKws));

    const trackedList = tracked.map((k) => k.keyword).join(', ');
    const competitorList = competitorKeywords.join(', ');
    const currentKeywordsField = localization?.keywords ?? '';
    const appTitle = localization?.title ?? app.title ?? 'this app';
    const appDesc = localization?.description?.slice(0, 400) ?? '';
    const store = app.store === 'GOOGLEPLAY' ? 'Google Play' : 'App Store';

    const systemPrompt = `You are an expert ASO (App Store Optimization) specialist for ${store}.
Your task is to suggest high-value keywords that the app should track.

Rules:
- Suggest EXACTLY 10 keywords
- Each keyword must NOT already be in the tracked list
- Prefer long-tail keywords with moderate traffic and low competition
- Mix: branded alternatives, feature-based, use-case, category, and audience keywords
- Keywords must be relevant to the app's actual functionality
- Return valid JSON only — no markdown, no explanation outside the JSON`;

    const userPrompt = `App: "${appTitle}"
Store: ${store}
Locale: ${locale}
Description: ${appDesc}
Current keyword field: ${currentKeywordsField}
Currently tracked: ${trackedList || 'none'}
Competitor keywords (for context): ${competitorList || 'none'}

Return a JSON object with this exact shape:
{
  "suggestions": [
    { "keyword": "...", "rationale": "one sentence why this keyword adds value" },
    ...10 items
  ]
}`;

    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    logLLMUsage('keyword-ai-suggestions', LLM_MODEL, response.usage);

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const suggestions: AISuggestion[] = (parsed.suggestions ?? []).slice(0, 10);

    // Filter out any that are already tracked (LLM might ignore the rule)
    const trackedSet = new Set(tracked.map((k) => k.keyword.toLowerCase()));
    const filtered = suggestions.filter(
      (s) => !trackedSet.has(s.keyword.toLowerCase())
    );

    return NextResponse.json({ suggestions: filtered });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
