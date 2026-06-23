import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { parseGuessedKeywords } from '@/lib/serialize-keywords';
import { NextResponse } from 'next/server';

export interface KeywordGapEntry {
  keyword: string;
  locale: string;
  competitorTitle: string;
  competitorId: string;
  competitorCount: number; // how many competitors use this keyword
}

// GET /api/teams/[teamId]/apps/[appId]/keywords/gap
// Returns a cross-locale table of competitor keywords not tracked by this app,
// grouped and sorted by how many competitors use them.
export async function GET(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    // All tracked keywords (by locale)
    const tracked = await prisma.asoKeyword.findMany({
      where: { appId },
      select: { keyword: true, locale: true },
    });
    // Build a set of "locale:keyword" for O(1) lookup
    const trackedSet = new Set(
      tracked.map((k) => `${k.locale}:${k.keyword.toLowerCase().trim()}`)
    );

    // All competitors with their guessed keywords
    const competitors = await prisma.competitor.findMany({
      where: { appId },
      select: { id: true, title: true, locale: true, guessedKeywords: true },
    });

    // keyword+locale → { competitorTitle, count }
    const gapMap: Record<
      string,
      {
        keyword: string;
        locale: string;
        competitorTitle: string;
        competitorId: string;
        count: number;
      }
    > = {};

    for (const competitor of competitors) {
      for (const kw of parseGuessedKeywords(competitor.guessedKeywords)) {
        const lower = kw.toLowerCase().trim();
        if (!lower) continue;
        const key = `${competitor.locale}:${lower}`;
        if (trackedSet.has(key)) continue; // already tracked

        if (!gapMap[key]) {
          gapMap[key] = {
            keyword: kw.trim(),
            locale: competitor.locale,
            competitorTitle: competitor.title,
            competitorId: competitor.id,
            count: 0,
          };
        }
        gapMap[key].count += 1;
        // keep the title of the most-recurring competitor
        if (gapMap[key].count === 1) {
          gapMap[key].competitorTitle = competitor.title;
          gapMap[key].competitorId = competitor.id;
        }
      }
    }

    const result: KeywordGapEntry[] = Object.values(gapMap)
      .map((v) => ({
        keyword: v.keyword,
        locale: v.locale,
        competitorTitle: v.competitorTitle,
        competitorId: v.competitorId,
        competitorCount: v.count,
      }))
      .sort(
        (a, b) =>
          b.competitorCount - a.competitorCount ||
          a.locale.localeCompare(b.locale)
      );

    return NextResponse.json(result);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
