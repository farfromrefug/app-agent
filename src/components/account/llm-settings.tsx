'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { FiCpu } from 'react-icons/fi';
import { useTranslations } from 'next-intl';

import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useTeam } from '@/context/team';
import {
  LLM_PROVIDERS,
  PROVIDER_PRESETS,
  type LlmProvider,
} from '@/lib/llm/providers';
import {
  getLlmConfig,
  saveLlmConfig,
  testLlmConfig,
  type LlmConfig,
} from '@/lib/swr/llm-config';

export function LlmSettings() {
  const t = useTranslations('account');
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [envFallback, setEnvFallback] = useState<LlmConfig['envFallback']>();

  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  // Empty means "leave the stored key unchanged".
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    getLlmConfig(teamId)
      .then((cfg) => {
        const p = (cfg.provider ?? 'openai') as LlmProvider;
        setProvider(p);
        setBaseUrl(cfg.baseUrl || PROVIDER_PRESETS[p].baseUrl);
        setModel(cfg.model || PROVIDER_PRESETS[p].defaultModel);
        setHasApiKey(cfg.hasApiKey);
        setCanEdit(cfg.canEdit);
        setEnvFallback(cfg.envFallback);
      })
      .catch(() => toast.error(t('llm.load-failed')))
      .finally(() => setLoading(false));
  }, [teamId, t]);

  const preset = PROVIDER_PRESETS[provider];

  const onProviderChange = (value: string) => {
    const p = value as LlmProvider;
    setProvider(p);
    // Prefill base URL + model from the preset so the user rarely edits them.
    setBaseUrl(PROVIDER_PRESETS[p].baseUrl);
    setModel(PROVIDER_PRESETS[p].defaultModel);
  };

  const buildInput = () => ({
    provider,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiKey: apiKey.trim() || undefined,
  });

  const handleTest = async () => {
    if (!teamId) return;
    setTesting(true);
    try {
      const res = await testLlmConfig(teamId, buildInput());
      if (res.ok) {
        toast.success(t('llm.test-success'));
      } else {
        toast.error(t('llm.test-failed', { error: res.error ?? '' }));
      }
    } catch {
      toast.error(t('llm.test-failed', { error: '' }));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!teamId) return;
    setSaving(true);
    try {
      await saveLlmConfig(teamId, buildInput());
      if (apiKey.trim()) setHasApiKey(true);
      setApiKey('');
      toast.success(t('llm.save-success'));
    } catch (e) {
      toast.error((e as Error).message || t('llm.save-failed'));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canEdit || saving || testing;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center space-x-2">
            <FiCpu className="h-5 w-5" />
            <h2 className="text-xl font-semibold">{t('llm.title')}</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('llm.description')}
          </p>

          {loading ? (
            <p className="text-sm text-muted-foreground">{t('llm.loading')}</p>
          ) : (
            <>
              {!canEdit && (
                <p className="text-xs rounded-md bg-muted p-2 text-muted-foreground">
                  {t('llm.read-only')}
                </p>
              )}

              <div className="space-y-2">
                <Label>{t('llm.provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={onProviderChange}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_PRESETS[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preset.editableBaseUrl && (
                <div className="space-y-2">
                  <Label>{t('llm.base-url')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={preset.baseUrl || 'https://...'}
                    disabled={disabled}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('llm.model')}</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={preset.defaultModel}
                  disabled={disabled}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('llm.api-key')}</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    hasApiKey
                      ? t('llm.api-key-configured')
                      : preset.requiresApiKey
                        ? t('llm.api-key-placeholder')
                        : t('llm.api-key-optional')
                  }
                  disabled={disabled}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  {t('llm.api-key-help')}
                </p>
              </div>

              <p className="text-xs rounded-md bg-muted p-2 text-muted-foreground">
                {t('llm.caveat')}
              </p>

              {envFallback && !envFallback.hasApiKey && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {t('llm.no-env-fallback')}
                </p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={disabled}
                >
                  {testing ? t('llm.testing') : t('llm.test')}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={disabled}>
                  {saving ? t('llm.saving') : t('llm.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
