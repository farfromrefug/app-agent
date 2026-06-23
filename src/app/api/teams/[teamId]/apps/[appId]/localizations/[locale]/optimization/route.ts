import { optimizeContents } from '@/lib/aso/optimize';
import { withTeamLlm } from '@/lib/llm/llm-context';
import { validateTeamAccess } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { LocaleCode } from '@/lib/utils/locale';
import { draftVersion, publicVersion } from '@/lib/utils/versions';
import { Store } from '@/types/aso';
import {
  AppNotFoundError,
  handleAppError,
  InvalidParamsError,
} from '@/types/errors';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export const maxDuration = 300;

// Generate ASO friendly title, subtitle, description, and keywords
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string; locale: LocaleCode } }
) {
  // It will take the final keywords, the current title, subtitle, and description as an input.
  // It will leverage LLM to generate the title, subtitle, and description.
  // It will validate the length and format of the LLM output. If it fails, it will retry with the feedback message.
  const startedAt = Date.now();
  let userId = 'unknown';
  let teamId = 'unknown';
  try {
    ({ teamId, userId } = await validateTeamAccess(request));
    await checkRateLimit(`optimization:${userId}`, 10, '1 m');

    const { appId, locale } = params;
    const data = await request.json();
    console.log(
      JSON.stringify({
        event: 'optimization_start',
        userId,
        teamId,
        appId,
        locale,
      })
    );

    // Verify app belongs to team
    const app = await prisma.app.findFirst({
      where: {
        id: appId,
        teamId: teamId,
      },
      include: {
        versions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10, // Get more versions to find either draft or public
        },
      },
    });

    if (!app) {
      throw new AppNotFoundError(`App ${appId} not found`);
    }

    // For Google Play, we can use public versions
    // For App Store, we prefer draft versions
    let appVersion = app.versions.find((v) => v.state && draftVersion(v.state));

    if (!appVersion && app.store === Store.GOOGLEPLAY) {
      // If no draft, use public version for Google Play
      appVersion = app.versions.find((v) => v.state && publicVersion(v.state));
    }

    if (!appVersion) {
      throw new InvalidParamsError(
        app.store === Store.GOOGLEPLAY
          ? 'No version found for this app'
          : 'No draft version found for this app'
      );
    }

    if (!data.title || !data.asoKeywords || !data.targets) {
      throw new InvalidParamsError('Missing required properties');
    }

    // Generate optimized ASO content using the team's configured LLM.
    const result = await withTeamLlm(teamId, () =>
      optimizeContents(
        locale,
        data.title,
        data.asoKeywords,
        data.targets,
        data.subtitle,
        data.keywords,
        data.description,
        data.shortDescription,
        data.descriptionOutline,
        data.previousResult,
        data.userFeedback,
        app.store
      )
    );

    console.log(
      JSON.stringify({
        event: 'optimization_complete',
        userId,
        teamId,
        appId,
        locale,
        durationMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json(result);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'optimization_error',
        userId,
        teamId,
        error: (error as Error).message,
        durationMs: Date.now() - startedAt,
      })
    );
    return handleAppError(error as Error);
  }
}
