import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateCronSecret } from '@/lib/utils/cron-auth';
import { refreshAppStoreConnectJWT } from '@/lib/auth';
import {
  updateLocalization as updateAppStoreLocalization,
  upsertLocalizationInfo,
} from '@/lib/app-store-connect/metadata';
import { updateMultipleListings as updateGooglePlayMultipleListings } from '@/lib/google-play/metadata';
import { getGooglePlayKeyFromDB } from '@/lib/google-play/key';
import { hasPublicVersion } from '@/lib/utils/versions';
import { Store } from '@/lib/db-enums';
import { logCron } from '@/lib/utils/log-cron';

export const maxDuration = 120;

// Hourly cron: execute any pending scheduled publishes whose time has come
export async function GET(request: NextRequest) {
  const authError = validateCronSecret(request);
  if (authError) return authError;
  const startTime = Date.now();

  const now = new Date();

  const due = await prisma.scheduledPublish.findMany({
    where: { status: 'pending', scheduledAt: { lte: now } },
    include: {
      app: {
        select: {
          id: true,
          storeAppId: true,
          store: true,
          teamId: true,
          team: {
            select: {
              id: true,
              appStoreConnectPrivateKey: true,
              appStoreConnectKeyId: true,
              appStoreConnectIssuerId: true,
            },
          },
        },
      },
    },
  });

  let executed = 0;
  let failed = 0;

  for (const schedule of due) {
    const { app } = schedule;
    try {
      // Find the latest draft version
      const version = await prisma.appVersion.findFirst({
        where: { appId: app.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!version) throw new Error('No version found');

      const localizations = await prisma.appLocalization.findMany({
        where: { appVersionId: version.id },
        include: { appVersion: true },
      });

      if (app.store === Store.GOOGLEPLAY) {
        const serviceAccountKey = await getGooglePlayKeyFromDB(app.teamId);
        if (!serviceAccountKey) throw new Error('Google Play key not found');

        const filteredLocalizations = localizations.filter((loc) => loc.locale);
        const listingsToUpdate = filteredLocalizations.map((loc) => ({
          language: loc.locale!,
          title: loc.title || undefined,
          shortDescription: loc.shortDescription || undefined,
          fullDescription: loc.fullDescription || loc.description || undefined,
          video: loc.videoUrl || undefined,
        }));
        const releaseNotes = filteredLocalizations
          .filter((loc) => loc.whatsNew)
          .map((loc) => ({ language: loc.locale!, text: loc.whatsNew! }));
        const firstVersion = filteredLocalizations[0]?.appVersion;
        const releaseNotesConfig =
          releaseNotes.length > 0 && firstVersion
            ? {
                track: firstVersion.releaseType || 'production',
                versionCode: parseInt(firstVersion.version || '0', 10),
                notes: releaseNotes,
              }
            : undefined;

        await updateGooglePlayMultipleListings(
          serviceAccountKey,
          app.storeAppId,
          listingsToUpdate,
          releaseNotesConfig
        );
      } else {
        // App Store Connect
        if (
          !app.team.appStoreConnectPrivateKey ||
          !app.team.appStoreConnectKeyId ||
          !app.team.appStoreConnectIssuerId
        ) {
          throw new Error('App Store Connect credentials not configured');
        }
        const jwt = await refreshAppStoreConnectJWT(app.teamId);

        const updatePromises = localizations.map(async (localization) => {
          if (!localization.appVersion.appInfoId) return;
          if (!localization.locale && !localization.description) return;

          if (localization.title) {
            const result = await upsertLocalizationInfo(
              jwt,
              localization.appVersion.appInfoId,
              localization.appInfoLocalizationId || '',
              {
                locale: localization.locale || 'en-US',
                name: localization.title,
                subtitle: localization.subtitle,
                privacyChoicesUrl: localization.privacyChoicesUrl,
                privacyPolicyText: localization.privacyPolicyText,
                privacyPolicyUrl: localization.privacyPolicyUrl,
              }
            );
            if (result?.id) {
              await prisma.appLocalization.update({
                where: { id: localization.id },
                data: { appInfoLocalizationId: result.id },
              });
            }
          }

          const appHasPublicVersion = await hasPublicVersion(app.id);
          return updateAppStoreLocalization(jwt, localization.id, {
            description: localization.description || '',
            keywords: localization.keywords || '',
            marketingUrl: localization.marketingUrl || '',
            promotionalText: localization.promotionalText || '',
            supportUrl: localization.supportUrl || '',
            whatsNew: appHasPublicVersion
              ? localization.whatsNew || ''
              : undefined,
          });
        });
        await Promise.all(updatePromises);
      }

      // Mark app as not staged + save whats new history
      await prisma.app.update({
        where: { id: app.id },
        data: { isStaged: false },
      });

      const historyEntries = localizations
        .filter((loc) => loc.whatsNew?.trim())
        .map((loc) => ({
          appId: app.id,
          locale: loc.locale ?? 'en-US',
          text: loc.whatsNew!,
          version: loc.appVersion.version ?? undefined,
        }));
      if (historyEntries.length > 0) {
        await prisma.whatsNewHistory.createMany({ data: historyEntries });
      }

      await prisma.scheduledPublish.update({
        where: { id: schedule.id },
        data: { status: 'done', executedAt: new Date() },
      });
      executed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.scheduledPublish.update({
        where: { id: schedule.id },
        data: { status: 'failed', executedAt: new Date(), error: msg },
      });
      failed++;
      console.error(`[scheduled-publish] Failed for app ${app.id}:`, err);
    }
  }

  await logCron({
    cronName: 'scheduled-publish',
    startTime,
    recordsProcessed: executed,
  });
  return NextResponse.json({ executed, failed });
}
