import { validateTeamAccess } from '@/lib/auth';
import {
  handleAppError,
  AppNotFoundError,
  InvalidParamsError,
} from '@/types/errors';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { logLLMUsage } from '@/lib/llm/log-usage';
import { draftVersion, publicVersion } from '@/lib/utils/versions';

export const maxDuration = 30;

// POST /api/teams/[teamId]/apps/[appId]/versions/generate-whats-new
// Body: { locale: string }
// Returns: { whatsNew: string }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;
    const { locale = 'en-US' } = await request.json();

    if (!locale) throw new InvalidParamsError('locale is required');

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, title: true, store: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    // Get all versions with their state
    const versions = await prisma.appVersion.findMany({
      where: { appId },
      select: { id: true, state: true, version: true },
      orderBy: { createdAt: 'desc' },
    });

    const draftVersionRecord = versions.find((v) =>
      draftVersion(v.state ?? '')
    );
    const publicVersionRecord = versions.find((v) =>
      publicVersion(v.state ?? '')
    );

    if (!draftVersionRecord) {
      throw new InvalidParamsError('No draft version found for this app');
    }

    // Fetch draft localization
    const draft = await prisma.appLocalization.findFirst({
      where: { appVersionId: draftVersionRecord.id, locale },
      select: {
        title: true,
        subtitle: true,
        keywords: true,
        description: true,
        promotionalText: true,
        shortDescription: true,
        fullDescription: true,
        whatsNew: true,
      },
    });

    // Fetch public localization (may not exist)
    const published = publicVersionRecord
      ? await prisma.appLocalization.findFirst({
          where: { appVersionId: publicVersionRecord.id, locale },
          select: {
            title: true,
            subtitle: true,
            keywords: true,
            description: true,
            promotionalText: true,
            shortDescription: true,
            fullDescription: true,
            whatsNew: true,
          },
        })
      : null;

    // Build diff summary
    const fields: Array<{ key: string; label: string }> = [
      { key: 'title', label: 'Title' },
      { key: 'subtitle', label: 'Subtitle' },
      { key: 'description', label: 'Description' },
      { key: 'shortDescription', label: 'Short Description' },
      { key: 'fullDescription', label: 'Full Description' },
      { key: 'promotionalText', label: 'Promotional Text' },
      { key: 'keywords', label: 'Keywords' },
    ];

    const changes: string[] = [];
    for (const { key, label } of fields) {
      const draftVal = (draft as any)?.[key] ?? '';
      const pubVal = (published as any)?.[key] ?? '';
      if (draftVal && draftVal !== pubVal) {
        if (!pubVal) {
          changes.push(`${label}: added "${draftVal.slice(0, 120)}"`);
        } else {
          changes.push(
            `${label}: changed from "${pubVal.slice(0, 80)}" to "${draftVal.slice(0, 80)}"`
          );
        }
      }
    }

    const isGooglePlay = app.store === 'GOOGLEPLAY';
    const maxChars = isGooglePlay ? 500 : 4000;
    const store = isGooglePlay ? 'Google Play' : 'App Store';
    const appTitle = draft?.title ?? app.title ?? 'this app';

    const systemPrompt = `You are an expert mobile app copywriter specializing in ${store} release notes.
Write concise, user-friendly "What's New" text for app updates.

Rules:
- Write in the language matching locale: ${locale}
- Maximum ${maxChars} characters (hard limit)
- Focus on user benefits, not technical details
- Be specific about what changed
- Use present tense ("New feature" not "Added feature")
- If no meaningful changes, write a generic improvement note
- Return valid JSON only — no markdown, no explanation outside the JSON`;

    const changesText =
      changes.length > 0
        ? `Changes detected in the new draft:\n${changes.join('\n')}`
        : 'No specific metadata changes detected (general maintenance update).';

    const userPrompt = `App: "${appTitle}"
Store: ${store}
Locale: ${locale}

${changesText}

Previous "What's New" text (for reference): ${published?.whatsNew?.slice(0, 200) ?? 'none'}

Generate a "What's New" section. Return JSON:
{ "whatsNew": "..." }`;

    const { client, model } = await getTeamLlm(teamId);
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    logLLMUsage('generate-whats-new', model, response.usage);

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const whatsNew: string = parsed.whatsNew ?? '';

    return NextResponse.json({ whatsNew });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
