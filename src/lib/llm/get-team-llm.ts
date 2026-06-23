/**
 * Resolves the LLM client to use for a given team.
 *
 * Historically the app used a single OpenAI client built from env vars at import
 * time (see src/lib/llm/openai.ts). Teams can now configure their own provider
 * in-app (provider / base URL / model / API key), which applies to every app in
 * the team. This resolver loads that config, decrypts the stored key, and builds
 * an OpenAI-compatible client — falling back to the env defaults when a team has
 * not configured anything.
 *
 * Server-only: imports node:crypto (via secret.ts) and Prisma.
 */
import OpenAI from 'openai';

import prisma from '@/lib/prisma';
import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from '@/lib/config';
import { decryptSecret } from '@/lib/crypto/secret';
import {
  PROVIDER_PRESETS,
  isLlmProvider,
  type LlmProvider,
} from '@/lib/llm/providers';

export type { LlmProvider } from '@/lib/llm/providers';
export { PROVIDER_PRESETS, isLlmProvider } from '@/lib/llm/providers';

export type TeamLlm = {
  client: OpenAI;
  model: string;
  /** Resolved provider, used to gate provider-specific features (e.g. images). */
  provider: LlmProvider;
};

/** The env-based fallback client + model (the legacy behavior). */
export function envLlm(): TeamLlm {
  return {
    client: new OpenAI({
      apiKey: LLM_API_KEY,
      baseURL: LLM_BASE_URL || undefined,
    }),
    model: LLM_MODEL,
    provider: LLM_BASE_URL ? 'custom' : 'openai',
  };
}

/**
 * Build a TeamLlm from raw config values. Used both by {@link getTeamLlm} and by
 * the "test connection" endpoint (which validates unsaved values).
 */
export function buildLlm(config: {
  provider?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
}): TeamLlm {
  const provider: LlmProvider = isLlmProvider(config.provider)
    ? config.provider
    : 'openai';
  const preset = PROVIDER_PRESETS[provider];
  const baseURL = (config.baseUrl || preset.baseUrl || '').trim();
  const apiKey = (config.apiKey || '').trim();

  return {
    client: new OpenAI({
      // Some OpenAI-compatible servers (Ollama) reject an empty key; send a
      // harmless placeholder when none is configured.
      apiKey: apiKey || 'not-needed',
      baseURL: baseURL || undefined,
    }),
    model: (config.model || preset.defaultModel || LLM_MODEL).trim(),
    provider,
  };
}

/**
 * Resolve the LLM client for a team. Falls back to the env defaults when the
 * team is missing, has no provider configured, or has no usable key.
 */
export async function getTeamLlm(teamId?: string | null): Promise<TeamLlm> {
  if (!teamId) {
    return envLlm();
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      llmProvider: true,
      llmBaseUrl: true,
      llmModel: true,
      llmApiKey: true,
    },
  });

  if (!team || !team.llmProvider) {
    return envLlm();
  }

  const provider: LlmProvider = isLlmProvider(team.llmProvider)
    ? team.llmProvider
    : 'openai';
  const apiKey = team.llmApiKey ? decryptSecret(team.llmApiKey) : '';

  // If a key is required but unavailable, fall back rather than failing calls.
  if (PROVIDER_PRESETS[provider].requiresApiKey && !apiKey) {
    return envLlm();
  }

  return buildLlm({
    provider,
    baseUrl: team.llmBaseUrl,
    model: team.llmModel,
    apiKey,
  });
}
