import { NextResponse } from 'next/server';

import { validateTeamAccess } from '@/lib/auth';
import { handleAppError, NotPermittedError } from '@/types/errors';
import { User } from '@/types/user';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret';
import { isLlmProvider, PROVIDER_PRESETS } from '@/lib/llm/providers';
import { buildLlm } from '@/lib/llm/get-team-llm';
import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from '@/lib/config';

function requireAdmin(
  team: { users: { role: string; userId: string }[] },
  userId: string
) {
  const isAdmin = team.users.some(
    (u) => u.role === 'ADMIN' && u.userId === userId
  );
  if (!isAdmin) {
    throw new NotPermittedError('Only team admins can change LLM settings');
  }
}

// GET /api/teams/[teamId]/llm-config
// Returns the team's LLM config (never the key) plus the env-based fallback.
export async function GET(
  request: Request,
  { params }: { params: { teamId: string } }
) {
  try {
    const {
      teamId,
      session,
      team: accessTeam,
    } = await validateTeamAccess(request);
    const canEdit = accessTeam.users.some(
      (u) => u.role === 'ADMIN' && u.userId === (session.user as User).id
    );

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        llmProvider: true,
        llmBaseUrl: true,
        llmModel: true,
        llmApiKey: true,
      },
    });

    return NextResponse.json({
      provider: team?.llmProvider ?? null,
      baseUrl: team?.llmBaseUrl ?? '',
      model: team?.llmModel ?? '',
      hasApiKey: Boolean(team?.llmApiKey),
      isConfigured: Boolean(team?.llmProvider),
      canEdit,
      // Env fallback used when the team has not configured a provider.
      envFallback: {
        hasApiKey: Boolean(LLM_API_KEY),
        baseUrl: LLM_BASE_URL,
        model: LLM_MODEL,
      },
    });
  } catch (error) {
    return handleAppError(error as Error);
  }
}

// PUT /api/teams/[teamId]/llm-config  (ADMIN only)
// Body: { provider, baseUrl?, model?, apiKey? }
//   - apiKey omitted/empty keeps the existing key
//   - provider === null clears the team config (revert to env defaults)
export async function PUT(
  request: Request,
  { params }: { params: { teamId: string } }
) {
  try {
    const { teamId, session, team } = await validateTeamAccess(request);
    const userId = (session.user as User).id;
    requireAdmin(team, userId);

    const body = (await request.json()) as {
      provider?: string | null;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };

    // Clear configuration -> fall back to env defaults.
    if (body.provider === null) {
      await prisma.team.update({
        where: { id: teamId },
        data: {
          llmProvider: null,
          llmBaseUrl: null,
          llmModel: null,
          llmApiKey: null,
        },
      });
      await logAudit({
        teamId,
        userId,
        userEmail: (session.user as User).email ?? undefined,
        action: 'update',
        entity: 'llm_config',
        meta: { cleared: true },
      });
      return NextResponse.json({ ok: true, cleared: true });
    }

    if (!isLlmProvider(body.provider)) {
      return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
    }

    const preset = PROVIDER_PRESETS[body.provider];
    const apiKey = (body.apiKey ?? '').trim();

    const data: {
      llmProvider: string;
      llmBaseUrl: string | null;
      llmModel: string | null;
      llmApiKey?: string;
    } = {
      llmProvider: body.provider,
      llmBaseUrl: (body.baseUrl ?? '').trim() || preset.baseUrl || null,
      llmModel: (body.model ?? '').trim() || preset.defaultModel || null,
    };

    // Only overwrite the key when a new one is supplied.
    if (apiKey) {
      data.llmApiKey = encryptSecret(apiKey);
    }

    await prisma.team.update({ where: { id: teamId }, data });

    await logAudit({
      teamId,
      userId,
      userEmail: (session.user as User).email ?? undefined,
      action: 'update',
      entity: 'llm_config',
      meta: {
        provider: body.provider,
        model: data.llmModel,
        keyUpdated: Boolean(apiKey),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAppError(error as Error);
  }
}

// POST /api/teams/[teamId]/llm-config  (ADMIN only)
// Body: { action: 'test', provider, baseUrl?, model?, apiKey? }
// Verifies connectivity. If apiKey is omitted, the stored key is used.
export async function POST(
  request: Request,
  { params }: { params: { teamId: string } }
) {
  try {
    const { teamId, session, team } = await validateTeamAccess(request);
    requireAdmin(team, (session.user as User).id);

    const body = (await request.json()) as {
      action?: string;
      provider?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };

    if (body.action !== 'test') {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    if (!isLlmProvider(body.provider)) {
      return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
    }

    // Use the submitted key, else fall back to the stored (decrypted) key.
    let apiKey = (body.apiKey ?? '').trim();
    if (!apiKey) {
      const stored = await prisma.team.findUnique({
        where: { id: teamId },
        select: { llmApiKey: true },
      });
      apiKey = stored?.llmApiKey ? decryptSecret(stored.llmApiKey) : '';
    }

    const { client, model } = buildLlm({
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      apiKey,
    });

    try {
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      return NextResponse.json({ ok: true, model });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: (err as Error).message },
        { status: 200 }
      );
    }
  } catch (error) {
    return handleAppError(error as Error);
  }
}
