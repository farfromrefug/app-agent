import { NextRequest, NextResponse } from 'next/server';
import {
  getAnalyticsReportRequests,
  getAnalyticsReports,
  getAnalyticsReportInstances,
  getAnalyticsSegments,
  downloadAndParseSegment,
  parseEngagementRow,
  requestReport,
} from '@/lib/app-store-connect/analytics';
import {
  generateJWT,
  isAppStoreConnectJWTExpired,
} from '@/lib/app-store-connect/auth';
import { validateCronSecret } from '@/lib/utils/cron-auth';
import prisma from '@/lib/prisma';
import { subDays } from 'date-fns';
import { Store } from '@/lib/db-enums';
import { logCron } from '@/lib/utils/log-cron';

export async function GET(request: NextRequest) {
  const authError = validateCronSecret(request);
  if (authError) return authError;
  const startTime = Date.now();

  const results: { appId: string; rowsSaved: number }[] = [];
  const errors: { appId: string; error: string }[] = [];

  const apps = await prisma.app.findMany({
    where: { store: Store.APPSTORE },
    include: {
      team: {
        select: {
          id: true,
          appStoreConnectJWT: true,
          appStoreConnectJWTExpiresAt: true,
          appStoreConnectIssuerId: true,
          appStoreConnectKeyId: true,
          appStoreConnectPrivateKey: true,
        },
      },
    },
  });

  for (const app of apps) {
    try {
      if (!app.team.appStoreConnectJWT) continue;

      // Refresh JWT if expired
      let jwt = app.team.appStoreConnectJWT;
      if (isAppStoreConnectJWTExpired(jwt)) {
        if (
          !app.team.appStoreConnectIssuerId ||
          !app.team.appStoreConnectKeyId ||
          !app.team.appStoreConnectPrivateKey
        ) {
          console.log(`Team ${app.team.id} missing ASC credentials, skipping`);
          continue;
        }
        jwt = await generateJWT(
          app.team.appStoreConnectIssuerId,
          app.team.appStoreConnectKeyId,
          app.team.appStoreConnectPrivateKey
        );
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 20);
        await prisma.team.update({
          where: { id: app.team.id },
          data: {
            appStoreConnectJWT: jwt,
            appStoreConnectJWTExpiresAt: expiresAt,
          },
        });
      }

      // Get or create report request
      let reportRequests = await getAnalyticsReportRequests(
        jwt,
        app.storeAppId
      );
      reportRequests = reportRequests.filter(
        (r) => r.attributes.stoppedDueToInactivity === false
      );

      if (!reportRequests.length) {
        await requestReport(jwt, app.storeAppId);
        console.log(`Requested new analytics report for app ${app.storeAppId}`);
        continue; // Report won't be ready until tomorrow
      }

      const reportRequestId = reportRequests[0].id;
      const reports = await getAnalyticsReports(jwt, reportRequestId);

      const engagementReport = reports.find(
        (r) => r.attributes.category === 'APP_STORE_ENGAGEMENT'
      );

      if (!engagementReport) {
        console.log(
          `No engagement report ready for app ${app.storeAppId}, available: ${reports.map((r) => r.attributes.category).join(', ')}`
        );
        continue;
      }

      const instances = await getAnalyticsReportInstances(
        jwt,
        engagementReport.id
      );

      // instances is raw JSON — extract the data array
      const instanceList: any[] = instances?.data || [];

      // Find most recent daily instance
      const dailyInstances = instanceList.filter(
        (i: any) => i.attributes?.granularity === 'DAILY'
      );
      if (!dailyInstances.length) {
        console.log(`No daily instances for app ${app.storeAppId}`);
        continue;
      }

      // Sort by processingDate descending and take the latest
      dailyInstances.sort(
        (a: any, b: any) =>
          new Date(b.attributes.processingDate).getTime() -
          new Date(a.attributes.processingDate).getTime()
      );
      const latestInstance = dailyInstances[0];

      const segments = await getAnalyticsSegments(jwt, latestInstance.id);
      if (!segments.length || !segments[0].url) {
        console.log(`No segments for app ${app.storeAppId}`);
        continue;
      }

      // Download and parse the first segment (usually one per instance)
      const rows = await downloadAndParseSegment(segments[0].url);
      let rowsSaved = 0;

      for (const row of rows) {
        const parsed = parseEngagementRow(row);
        if (!parsed.date) continue;

        const date = new Date(parsed.date);
        if (isNaN(date.getTime())) continue;

        await prisma.appAnalytics.upsert({
          where: { appId_date: { appId: app.id, date } },
          update: {
            impressions: parsed.impressions,
            pageViews: parsed.pageViews,
            downloads: parsed.downloads,
            sessions: parsed.sessions,
            activeDevices: parsed.activeDevices,
          },
          create: {
            appId: app.id,
            date,
            impressions: parsed.impressions,
            pageViews: parsed.pageViews,
            downloads: parsed.downloads,
            sessions: parsed.sessions,
            activeDevices: parsed.activeDevices,
          },
        });
        rowsSaved++;
      }

      // Clean up records older than 90 days
      await prisma.appAnalytics.deleteMany({
        where: {
          appId: app.id,
          date: { lt: subDays(new Date(), 90) },
        },
      });

      results.push({ appId: app.id, rowsSaved });
    } catch (err: any) {
      console.error(`Analytics cron error for app ${app.id}:`, err);
      errors.push({ appId: app.id, error: err.message });
    }
  }

  const totalRows = results.reduce((s, r) => s + r.rowsSaved, 0);
  await logCron({
    cronName: 'analytics',
    startTime,
    recordsProcessed: totalRows,
  });
  return NextResponse.json({ success: true, results, errors });
}
