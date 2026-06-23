/**
 * Request-scoped LLM client context.
 *
 * The LLM utilities in src/lib/llm/utils run deep inside ASO call chains that
 * don't all receive a teamId. Rather than thread a client through every layer,
 * we resolve the team's client once at the API-route boundary and stash it in
 * an AsyncLocalStorage. Leaf utilities read it via {@link getCurrentLlm}.
 *
 * Outside a request (cron, scripts) the store is empty and callers transparently
 * fall back to the env-configured client — i.e. the legacy behavior.
 *
 * Server-only (node:async_hooks).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { getTeamLlm, envLlm, type TeamLlm } from '@/lib/llm/get-team-llm';

const storage = new AsyncLocalStorage<TeamLlm>();

/**
 * Resolve the team's LLM client and run `fn` with it bound as the current
 * context. Wrap an API route handler's body in this so every LLM call it makes
 * (directly or through the ASO layer) uses the team's configured provider.
 */
export async function withTeamLlm<T>(
  teamId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const llm = await getTeamLlm(teamId);
  return storage.run(llm, fn);
}

/** Run `fn` with an already-resolved client bound as the current context. */
export function runWithLlm<T>(llm: TeamLlm, fn: () => Promise<T>): Promise<T> {
  return storage.run(llm, fn);
}

/**
 * The LLM client for the current request, or the env-configured fallback when
 * called outside a {@link withTeamLlm} scope.
 */
export function getCurrentLlm(): TeamLlm {
  return storage.getStore() ?? envLlm();
}
