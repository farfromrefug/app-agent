import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { parseGuessedKeywords } from '@/lib/serialize-keywords';
import { NextResponse } from 'next/server';

export interface KeywordOpportunity {
  keyword: string;
  competitorTitle: string;
  competitorId: string;
}

// GET /api/teams/[teamId]/apps/[appId]/keywords/opportunities?locale=en-US
// Returns competitor keywords not yet tracked by this app for the given locale
export async function GET(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get('locale') ?? '';

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    // Tracked keywords for this app + locale
    const tracked = await prisma.asoKeyword.findMany({
      where: { appId, ...(locale ? { locale } : {}) },
      select: { keyword: true },
    });
    const trackedSet = new Set(tracked.map((k) => k.keyword.toLowerCase()));

    // Competitor keywords
    const competitors = await prisma.competitor.findMany({
      where: { appId, ...(locale ? { locale } : {}) },
      select: {
        id: true,
        title: true,
        guessedKeywords: true,
      },
    });

    // Build opportunities: competitor keywords not in tracked set
    const seen = new Set<string>();
    const opportunities: KeywordOpportunity[] = [];

    for (const competitor of competitors) {
      for (const kw of parseGuessedKeywords(competitor.guessedKeywords)) {
        const lower = kw.toLowerCase().trim();
        if (!lower || trackedSet.has(lower) || seen.has(lower)) continue;
        seen.add(lower);
        opportunities.push({
          keyword: kw.trim(),
          competitorTitle: competitor.title,
          competitorId: competitor.id,
        });
      }
    }

    return NextResponse.json(opportunities);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
