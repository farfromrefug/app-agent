import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, AppNotFoundError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { logLLMUsage } from '@/lib/llm/log-usage';

export const maxDuration = 30;

// POST /api/teams/[teamId]/apps/[appId]/reviews/ai-reply
// Body: { reviewTitle?, reviewBody, reviewRating, locale? }
// Returns: { reply: string }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;
    const {
      reviewTitle,
      reviewBody,
      reviewRating,
      locale = 'en',
      tone = 'professional',
    } = await request.json();

    if (!reviewBody) {
      return NextResponse.json(
        { error: 'reviewBody required' },
        { status: 400 }
      );
    }

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, title: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const stars =
      '★'.repeat(reviewRating ?? 3) + '☆'.repeat(5 - (reviewRating ?? 3));
    const reviewText = reviewTitle
      ? `Title: "${reviewTitle}"\n${reviewBody}`
      : reviewBody;

    const sentiment =
      (reviewRating ?? 3) <= 2
        ? 'negative'
        : (reviewRating ?? 3) === 3
          ? 'neutral'
          : 'positive';

    const toneGuidelines: Record<string, string> = {
      professional:
        '- Tone: clear, concise, and professional. Polite but not overly effusive.',
      friendly:
        '- Tone: warm, casual, and conversational — like talking to a friend. Use contractions, be upbeat.',
      apologetic:
        '- Tone: extra empathetic and sincere. Lead with acknowledgement, apologise genuinely, focus on resolution and making the user feel heard.',
    };

    const systemPrompt = `You are a customer support representative for a mobile app called "${app.title ?? 'this app'}".
Your job is to write a concise, empathetic reply to a user review.

Guidelines:
${toneGuidelines[tone] ?? toneGuidelines.professional}
- For negative reviews (1-2 stars): acknowledge the frustration, apologise, and offer to help
- For neutral reviews (3 stars): thank the user, address concerns if any, mention ongoing improvements
- For positive reviews (4-5 stars): thank the user warmly and encourage them to keep using the app
- Keep replies between 50-120 words
- Do NOT use markdown, bullet points or headings
- Write in ${locale.startsWith('ja') ? 'Japanese' : locale.startsWith('es') ? 'Spanish' : locale.startsWith('fr') ? 'French' : locale.startsWith('de') ? 'German' : locale.startsWith('pt') ? 'Portuguese' : locale.startsWith('zh') ? 'Chinese' : 'English'}
- Do NOT start with "Dear" or generic openers like "Thank you for your feedback" alone
- Sound human, not corporate`;

    const userPrompt = `Review (${stars} — ${sentiment}):\n${reviewText}\n\nWrite a reply:`;

    const { client, model } = await getTeamLlm(teamId);
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    logLLMUsage('review-ai-reply', model, response.usage);

    const reply = response.choices[0]?.message?.content?.trim() ?? '';
    return NextResponse.json({ reply });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
