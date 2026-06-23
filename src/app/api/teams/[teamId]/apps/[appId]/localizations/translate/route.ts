import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { getLocaleName, LocaleCode } from '@/lib/utils/locale';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export const maxDuration = 120;

interface TranslateBody {
  sourceLocale: string;
  targetLocales: string[];
  fields: {
    title?: string;
    subtitle?: string;
    description?: string;
    keywords?: string;
    shortDescription?: string;
    fullDescription?: string;
  };
  store: string;
}

// POST /api/teams/[teamId]/apps/[appId]/localizations/translate
// Translates metadata fields from sourceLocale to each targetLocale
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId, userId } = await validateTeamAccess(request);
    await checkRateLimit(`translate:${userId}`, 20, '1 m');
    const { appId } = params;
    const body: TranslateBody = await request.json();
    const { sourceLocale, targetLocales, fields, store } = body;

    if (!targetLocales?.length) {
      return NextResponse.json({});
    }

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const sourceLang = getLocaleName(sourceLocale as LocaleCode);
    const fieldEntries = Object.entries(fields).filter(([, v]) => v?.trim());

    if (fieldEntries.length === 0) return NextResponse.json({});

    const isAppStore = store !== 'GOOGLEPLAY';

    // Build character limit notes
    const limitNotes = isAppStore
      ? 'title≤30, subtitle≤30, keywords≤100 (comma-separated), description≤4000, promotionalText≤170'
      : 'title≤50, shortDescription≤80, fullDescription≤4000';

    const sourceText = fieldEntries
      .map(([k, v]) => `### ${k}\n${v}`)
      .join('\n\n');

    const result: Record<string, Record<string, string>> = {};

    const { client, model } = await getTeamLlm(teamId);

    // Translate to each target locale (parallelize up to 5 at a time)
    const chunks: string[][] = [];
    for (let i = 0; i < targetLocales.length; i += 5) {
      chunks.push(targetLocales.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (targetLocale) => {
          const targetLang = getLocaleName(targetLocale as LocaleCode);
          const prompt = `You are an expert App Store localization translator. Translate the following app metadata from ${sourceLang} to ${targetLang}.

Rules:
- Preserve ASO intent, tone, and keyword density
- Respect character limits: ${limitNotes}
- For keywords: translate and localize terms naturally, keep comma-separated format
- Do NOT add explanations — output ONLY the translated fields in JSON

Source fields:
${sourceText}

Respond with a JSON object with the same keys as the source fields, containing the translated values.`;

          const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
          });

          const content = response.choices[0]?.message?.content ?? '{}';
          try {
            result[targetLocale] = JSON.parse(content);
          } catch {
            result[targetLocale] = {};
          }
        })
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
