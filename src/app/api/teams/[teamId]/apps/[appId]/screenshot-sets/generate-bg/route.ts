import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { validateTeamAccess } from '@/lib/auth';
import { AppNotFoundError, handleAppError } from '@/types/errors';
import prisma from '@/lib/prisma';
import { getTeamLlm } from '@/lib/llm/get-team-llm';
import { nanoid } from 'nanoid';

export const maxDuration = 60;

// POST /api/teams/[teamId]/apps/[appId]/screenshot-sets/generate-bg
// Body: { prompt: string }
// Returns: { url: string }
export async function POST(
  request: Request,
  { params }: { params: { teamId: string; appId: string } }
) {
  try {
    const { teamId } = await validateTeamAccess(request);
    const { appId } = params;

    const app = await prisma.app.findFirst({ where: { id: appId, teamId } });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const { prompt } = (await request.json()) as { prompt?: string };
    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'prompt is required' },
        { status: 400 }
      );
    }

    // Image generation relies on OpenAI's DALL·E API; it has no equivalent on
    // the other OpenAI-compatible providers, so require an OpenAI provider here.
    const { client, provider } = await getTeamLlm(teamId);
    if (provider !== 'openai') {
      return NextResponse.json(
        {
          error:
            'Image generation requires an OpenAI provider. Update the LLM provider in team settings to use this feature.',
        },
        { status: 400 }
      );
    }

    // Enhance prompt for app screenshot backgrounds
    const enhancedPrompt = `App store screenshot background image. ${prompt.trim()}. Abstract, clean, modern design. No text, no UI elements, no devices. Suitable as a background for mobile app marketing.`;

    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1792', // portrait — closest to phone screenshot ratio
      quality: 'standard',
      response_format: 'url',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image generation failed' },
        { status: 500 }
      );
    }

    // Download the image from OpenAI (URL expires quickly)
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch generated image' },
        { status: 500 }
      );
    }
    const imgBuffer = await imgRes.arrayBuffer();

    // Upload to Vercel Blob for persistence
    const filename = `teams/${teamId}/apps/${appId}/screenshots/bg-${nanoid(10)}.png`;
    const blob = await put(filename, imgBuffer, {
      access: 'public',
      contentType: 'image/png',
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    return handleAppError(error as Error);
  }
}
