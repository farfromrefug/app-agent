import prisma from '@/lib/prisma';
import { validateTeamAccess } from '@/lib/auth';
import {
  AppNotFoundError,
  handleAppError,
  InvalidParamsError,
} from '@/types/errors';
import { googlePlayToAppStore } from '@/lib/utils/locale';
import { findCompetitors } from '@/lib/aso/keyword-hunt/find-competitors';
import { withTeamLlm } from '@/lib/llm/llm-context';
import { draftVersion, publicVersion } from '@/lib/utils/versions';
import { Store } from '@/types/aso';
import { createStreamingResponse } from '@/lib/utils/streaming';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export const maxDuration = 300;

// Run competitor research and return a list of competitor apps
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string; locale: string } }
) {
  const startedAt = Date.now();
  let userId = 'unknown';
  let teamId = 'unknown';
  try {
    ({ teamId, userId } = await validateTeamAccess(request));
    await checkRateLimit(`competitor-research:${userId}`, 3, '1 h');

    const { appId, locale } = params;
    const data = await request.json();
    console.log(
      JSON.stringify({
        event: 'competitor_research_start',
        userId,
        teamId,
        appId,
        locale,
        store: data.store,
      })
    );

    if (!data.shortDescription) {
      throw new InvalidParamsError('Short description is required');
    }
    if (!data.store) {
      throw new InvalidParamsError('Store is required');
    }
    if (!data.platform) {
      throw new InvalidParamsError('Platform is required');
    }

    // Verify app belongs to team
    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!app) {
      throw new AppNotFoundError(`App ${appId} not found`);
    }

    let appVersion = app.versions.find((v) => v.state && draftVersion(v.state));

    if (!appVersion && app.store === Store.GOOGLEPLAY) {
      appVersion = app.versions.find((v) => v.state && publicVersion(v.state));
    }

    if (!appVersion) {
      throw new InvalidParamsError(
        app.store === Store.GOOGLEPLAY
          ? 'No version found for this app'
          : 'No draft version found for this app'
      );
    }

    await prisma.app.update({
      where: { id: appId },
      data: { shortDescription: data.shortDescription },
    });

    const appStoreLocale = googlePlayToAppStore(locale);

    return createStreamingResponse(async (writer) => {
      await withTeamLlm(teamId, () =>
        findCompetitors(
          appId,
          appStoreLocale,
          data.shortDescription,
          writer,
          locale
        )
      );
      console.log(
        JSON.stringify({
          event: 'competitor_research_complete',
          userId,
          teamId,
          appId,
          locale,
          durationMs: Date.now() - startedAt,
        })
      );
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'competitor_research_error',
        userId,
        teamId,
        error: (error as Error).message,
        durationMs: Date.now() - startedAt,
      })
    );
    return handleAppError(error as Error);
  }
}
