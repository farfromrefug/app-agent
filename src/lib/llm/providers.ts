/**
 * LLM provider presets, shared by the server resolver (get-team-llm.ts) and the
 * client settings UI. This module is intentionally free of server-only imports
 * (no prisma, no node:crypto) so it can be bundled into client components.
 *
 * All providers are driven through the OpenAI SDK via an OpenAI-compatible
 * `baseURL`.
 */
export type LlmProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';

export type ProviderPreset = {
  label: string;
  /** Default OpenAI-compatible base URL; empty means OpenAI's default. */
  baseUrl: string;
  defaultModel: string;
  /** Whether the base URL is editable in the UI (custom/ollama) or fixed. */
  editableBaseUrl: boolean;
  /** Whether an API key is required (Ollama typically needs none). */
  requiresApiKey: boolean;
};

export const PROVIDER_PRESETS: Record<LlmProvider, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    baseUrl: '',
    defaultModel: 'gpt-4o',
    editableBaseUrl: false,
    requiresApiKey: true,
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    baseUrl: 'https://api.anthropic.com/v1/',
    defaultModel: 'claude-3-5-sonnet-latest',
    editableBaseUrl: false,
    requiresApiKey: true,
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    editableBaseUrl: true,
    requiresApiKey: false,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModel: 'gpt-4o',
    editableBaseUrl: true,
    requiresApiKey: true,
  },
};

export const LLM_PROVIDERS = Object.keys(PROVIDER_PRESETS) as LlmProvider[];

export function isLlmProvider(value: unknown): value is LlmProvider {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, value)
  );
}
