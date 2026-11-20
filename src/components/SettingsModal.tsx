import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { AISettings, DEFAULT_AI_SETTINGS } from '../types/tour';
import { ModelOption, fetchAvailableModels, testAIConnection } from '../lib/aiClient';
import { testCaptureServer } from '../lib/captureClient';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AISettings;
  onSave: (next: AISettings) => void;
  onClose: () => void;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState<AISettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [showCaptureToken, setShowCaptureToken] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsUpdatedAt, setModelsUpdatedAt] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [visionOnly, setVisionOnly] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingCapture, setTestingCapture] = useState(false);
  const [captureTestResult, setCaptureTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const refreshModels = async (targetBaseUrl: string, targetApiKey: string) => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const list = await fetchAvailableModels(targetBaseUrl, targetApiKey);
      setModels(list);
      setModelsUpdatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Unable to refresh models.');
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setTestResult(null);
      setCaptureTestResult(null);
      setModelsError(null);
      void refreshModels(settings.baseUrl || OPENROUTER_URL, settings.apiKey);
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter((m) => {
      if (tierFilter === 'free' && m.tier === 'paid') return false;
      if (tierFilter === 'paid' && m.tier === 'free') return false;
      if (visionOnly && m.supportsVision === false) return false;
      if (query) {
        return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query);
      }
      return true;
    });
  }, [models, modelSearch, tierFilter, visionOnly]);

  const counts = useMemo(() => {
    let free = 0;
    let paid = 0;
    let catalog = 0;
    for (const m of models) {
      if (m.tier === 'free') free++;
      else if (m.tier === 'paid') paid++;
      else catalog++;
    }
    return { all: models.length, free, paid, catalog };
  }, [models]);

  const selectedModelMeta = useMemo(
    () => models.find((m) => m.id === draft.model.trim()) || null,
    [models, draft.model]
  );

  if (!isOpen) return null;

  const cleanBase = draft.baseUrl.trim().replace(/\/+$/, '');
  const activeProvider =
    cleanBase === OPENROUTER_URL
      ? 'openrouter'
      : cleanBase === NVIDIA_URL
      ? 'nvidia'
      : 'custom';

  const activeCaptureMode =
    draft.captureUrl.trim() === '/api'
      ? 'builtin'
      : /^http:\/\/localhost:8787\/?$/i.test(draft.captureUrl.trim())
      ? 'localhost'
      : 'custom';

  const handleSelectProvider = (provider: 'openrouter' | 'nvidia') => {
    const nextBaseUrl = provider === 'openrouter' ? OPENROUTER_URL : NVIDIA_URL;
    setDraft((prev) => ({ ...prev, baseUrl: nextBaseUrl }));
    setTierFilter('all');
    setModelSearch('');
    void refreshModels(nextBaseUrl, draft.apiKey);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testAIConnection(draft);
    setTestResult(result);
    setTesting(false);
  };

  const handleTestCapture = async (urlOverride?: string) => {
    setTestingCapture(true);
    setCaptureTestResult(null);
    const result = await testCaptureServer(urlOverride ?? draft.captureUrl, draft.captureToken);
    setCaptureTestResult(result);
    setTestingCapture(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      baseUrl: draft.baseUrl.trim() || DEFAULT_AI_SETTINGS.baseUrl,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      captureUrl: draft.captureUrl.trim() || DEFAULT_AI_SETTINGS.captureUrl,
      captureToken: draft.captureToken.trim(),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-settings-title"
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Fixed Modal Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div>
            <h2
              id="ai-settings-title"
              className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100"
            >
              AI &amp; Capture Settings
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Choose OpenRouter, NVIDIA NIM, or any OpenAI-compatible endpoint. Saved in browser localStorage only.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Middle Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
          {/* Provider Switcher + Base URL */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="ai-base-url"
                className="block text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                Provider &amp; Base URL
              </label>
              <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => handleSelectProvider('openrouter')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeProvider === 'openrouter'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  OpenRouter
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectProvider('nvidia')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeProvider === 'nvidia'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  NVIDIA NIM
                </button>
              </div>
            </div>

            <input
              id="ai-base-url"
              type="url"
              required
              value={draft.baseUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://openrouter.ai/api/v1"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
            />
          </div>

          {/* API Key */}
          <div>
            <label
              htmlFor="ai-api-key"
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              API Key
            </label>
            <div className="relative mt-1.5">
              <input
                id="ai-api-key"
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={activeProvider === 'nvidia' ? 'nvapi-...' : 'sk-or-v1-...'}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Model Name + Live Catalog Browser with Refresh */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="ai-model-name"
                className="block text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                Model Name
              </label>

              <div className="flex items-center gap-2.5">
                {modelsUpdatedAt && !loadingModels && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {models.length} models · {modelsUpdatedAt}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void refreshModels(draft.baseUrl, draft.apiKey)}
                  disabled={loadingModels}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                  {loadingModels ? 'Refreshing...' : 'Refresh models'}
                </button>
              </div>
            </div>

            <input
              id="ai-model-name"
              type="text"
              value={draft.model}
              onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="Select a Vision model below or type any model ID"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-400"
            />

            {selectedModelMeta?.supportsVision === false && (
              <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Heads up: this model is text-only and will reject screenshot uploads. Choose a Vision model below.
              </p>
            )}

            {/* Filter Bar: All / Free / Paid + Search + Vision */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setTierFilter('all')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                    tierFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  All ({counts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter('free')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                    tierFilter === 'free'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Free ({counts.free})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter('paid')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                    tierFilter === 'paid'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Paid ({counts.paid})
                </button>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={visionOnly}
                  onChange={(e) => setVisionOnly(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-0 dark:border-slate-700"
                />
                <span>Vision capable only</span>
              </label>
            </div>

            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search models..."
                aria-label="Filter available models"
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            {modelsError && (
              <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{modelsError}</p>
            )}

            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
              {loadingModels ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading live models...</span>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  {counts.catalog > 0 && tierFilter !== 'all'
                    ? 'This provider lists catalog models under "All" (free starter credits / pay-as-you-go).'
                    : 'No models match your filter. Type any custom model ID above.'}
                </div>
              ) : (
                filteredModels.map((item) => {
                  const selected = draft.model.trim() === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, model: item.id }))}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                        selected
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'hover:bg-slate-50 text-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.name}</p>
                        <p
                          className={`truncate font-mono text-[11px] ${
                            selected
                              ? 'text-slate-300 dark:text-slate-600'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {item.id}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] font-medium tabular-nums ${
                          selected
                            ? 'text-slate-200 dark:text-slate-700'
                            : item.tier === 'free'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.supportsVision === true
                          ? 'Vision · '
                          : item.supportsVision === false
                          ? 'Text-only · '
                          : ''}
                        {item.pricingLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Website Capture Server */}
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Website Capture Server
              </h3>
              <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, captureUrl: '/api' }));
                    setCaptureTestResult(null);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeCaptureMode === 'builtin'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Built-in (/api)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, captureUrl: 'http://localhost:8787' }));
                    setCaptureTestResult(null);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeCaptureMode === 'localhost'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Localhost (8787)
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="capture-server-url"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Capture server URL
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="capture-server-url"
                    type="text"
                    value={draft.captureUrl}
                    onChange={(e) => setDraft((prev) => ({ ...prev, captureUrl: e.target.value }))}
                    placeholder="/api"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestCapture()}
                    disabled={testingCapture}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {testingCapture && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Test capture
                  </button>
                </div>
                {captureTestResult && (
                  <p
                    className={`mt-1.5 text-xs ${
                      captureTestResult.ok
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {captureTestResult.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="capture-token"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Capture token (optional)
                </label>
                <div className="relative mt-1">
                  <input
                    id="capture-token"
                    type={showCaptureToken ? 'text' : 'password'}
                    value={draft.captureToken}
                    onChange={(e) => setDraft((prev) => ({ ...prev, captureToken: e.target.value }))}
                    placeholder="Optional bearer token"
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCaptureToken((prev) => !prev)}
                    aria-label={showCaptureToken ? 'Hide capture token' : 'Show capture token'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    {showCaptureToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              )}
              <span className="break-words">{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Fixed Modal Footer — Always Visible */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 sm:px-6 dark:border-slate-800 dark:bg-slate-950/70">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {testing ? 'Testing...' : 'Test connection'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              Save settings
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
