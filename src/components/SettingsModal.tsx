import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { AISettings, DEFAULT_AI_SETTINGS } from '../types/tour';
import {
  ModelOption,
  OLLAMA_DEFAULT_BASE_URL,
  OllamaDetectionResult,
  detectLocalOllama,
  fetchAvailableModels,
  isOllamaBaseUrl,
  testAIConnection,
} from '../lib/aiClient';
import { testCaptureServer } from '../lib/captureClient';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AISettings;
  onSave: (next: AISettings) => void;
  onClose: () => void;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1';

type ProviderPreset = NonNullable<AISettings['providerPreset']>;
type ModelSlot = 'analysis' | 'walkthrough';

function inferPresetFromSettings(s: AISettings): ProviderPreset {
  if (isOllamaBaseUrl(s.baseUrl)) return 'ollama';
  if (/integrate\.api\.nvidia\.com/i.test(s.baseUrl)) return 'nvidia';
  if (/openrouter\.ai/i.test(s.baseUrl)) {
    if (s.providerPreset === 'openrouter-paid') return 'openrouter-paid';
    if (s.providerPreset === 'openrouter-free') return 'openrouter-free';
    const active = (s.analysisModel || s.model).trim();
    if (active && !/:free$/i.test(active)) return 'openrouter-paid';
    return 'openrouter-free';
  }
  return 'custom';
}

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
  const [tierFilter, setTierFilter] = useState<'all' | 'free' | 'paid'>('free');
  const [modelSlot, setModelSlot] = useState<ModelSlot>('analysis');
  const [visionOnly, setVisionOnly] = useState(false);

  const [ollamaStatus, setOllamaStatus] = useState<OllamaDetectionResult | null>(null);
  const [probingOllama, setProbingOllama] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingCapture, setTestingCapture] = useState(false);
  const [captureTestResult, setCaptureTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const refreshModels = async (
    targetBaseUrl: string,
    targetApiKey: string,
    targetCaptureToken: string
  ) => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const list = await fetchAvailableModels(targetBaseUrl, targetApiKey, targetCaptureToken);
      setModels(list);
      setModelsUpdatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setModels([]);
      setModelsError(err instanceof Error ? err.message : 'Unable to refresh models.');
    } finally {
      setLoadingModels(false);
    }
  };

  const probeOllama = async (captureToken: string) => {
    setProbingOllama(true);
    const result = await detectLocalOllama(captureToken);
    setOllamaStatus(result);
    setProbingOllama(false);
    return result;
  };

  useEffect(() => {
    if (isOpen) {
      const preset = inferPresetFromSettings(settings);
      setDraft({ ...settings, providerPreset: preset });
      setTestResult(null);
      setCaptureTestResult(null);
      setModelsError(null);
      setTierFilter(
        preset === 'openrouter-free' || preset === 'ollama'
          ? 'free'
          : preset === 'openrouter-paid'
          ? 'paid'
          : 'all'
      );
      setModelSlot('analysis');
      setVisionOnly(false);

      void probeOllama(settings.captureToken);
      void refreshModels(
        settings.baseUrl || OPENROUTER_URL,
        settings.apiKey,
        settings.captureToken
      );
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

  const selectedWalkthroughMeta = useMemo(
    () => models.find((m) => m.id === draft.model.trim()) || null,
    [models, draft.model]
  );

  if (!isOpen) return null;

  const isOllamaActive = isOllamaBaseUrl(draft.baseUrl);
  const activePreset = inferPresetFromSettings(draft);
  const activeCaptureMode =
    draft.captureUrl.trim() === '/api'
      ? 'builtin'
      : /^http:\/\/localhost:8787\/?$/i.test(draft.captureUrl.trim())
      ? 'localhost'
      : 'custom';

  const handleSelectProvider = (preset: 'openrouter-free' | 'openrouter-paid' | 'nvidia' | 'ollama') => {
    let nextBaseUrl = OPENROUTER_URL;
    let nextTier: 'all' | 'free' | 'paid' = 'all';

    if (preset === 'openrouter-free') {
      nextBaseUrl = OPENROUTER_URL;
      nextTier = 'free';
    } else if (preset === 'openrouter-paid') {
      nextBaseUrl = OPENROUTER_URL;
      nextTier = 'paid';
    } else if (preset === 'nvidia') {
      nextBaseUrl = NVIDIA_URL;
      nextTier = 'all';
    } else if (preset === 'ollama') {
      nextBaseUrl = OLLAMA_DEFAULT_BASE_URL;
      nextTier = 'free';
    }

    setDraft((prev) => {
      const next = { ...prev, baseUrl: nextBaseUrl, providerPreset: preset };
      if (preset === 'ollama' && ollamaStatus?.reachable && ollamaStatus.models.length > 0) {
        const firstTextOrAny = ollamaStatus.models[0]?.id || '';
        const firstVision = ollamaStatus.models.find((m) => m.supportsVision)?.id || firstTextOrAny;
        if (!prev.analysisModel?.trim() || !isOllamaBaseUrl(prev.baseUrl)) {
          next.analysisModel = firstTextOrAny;
        }
        if (!prev.model.trim() || !isOllamaBaseUrl(prev.baseUrl)) {
          next.model = firstVision;
        }
      }
      return next;
    });
    setTierFilter(nextTier);
    setModelSearch('');
    setTestResult(null);
    if (preset === 'ollama') {
      void probeOllama(draft.captureToken);
    }
    void refreshModels(nextBaseUrl, draft.apiKey, draft.captureToken);
  };

  const handleSelectSlot = (slot: ModelSlot) => {
    setModelSlot(slot);
    setVisionOnly(slot === 'walkthrough');
  };

  const assignModelToActiveSlot = (modelId: string) => {
    if (modelSlot === 'analysis') {
      setDraft((prev) => ({
        ...prev,
        analysisModel: modelId,
        model: prev.model.trim() ? prev.model : modelId,
      }));
    } else {
      setDraft((prev) => ({
        ...prev,
        model: modelId,
      }));
    }
  };

  const handleTest = async (slotToTest: ModelSlot = modelSlot) => {
    setTesting(true);
    setTestResult(null);
    const modelToTest =
      slotToTest === 'analysis'
        ? draft.analysisModel?.trim() || draft.model.trim()
        : draft.model.trim();
    const result = await testAIConnection(draft, modelToTest);
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
      analysisModel: draft.analysisModel?.trim() || '',
      providerPreset: inferPresetFromSettings(draft),
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
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Fixed Modal Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div>
            <h2
              id="ai-settings-title"
              className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100"
            >
              Open-Source AI Agents &amp; Capture Settings
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Use OpenRouter Free, OpenRouter Paid, NVIDIA NIM, or auto-detected local Ollama. Saved only in browser localStorage.
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
          {/* Local Ollama Detection Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-400" />
              {probingOllama ? (
                <span className="text-slate-600 dark:text-slate-400">
                  Scanning machine for local Ollama (localhost:11434)...
                </span>
              ) : ollamaStatus?.reachable ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  Local Ollama detected ({ollamaStatus.models.length} model
                  {ollamaStatus.models.length === 1 ? '' : 's'} ready)
                </span>
              ) : (
                <span className="text-slate-600 dark:text-slate-400">
                  Local Ollama not detected on port 11434 (optional — run locally for private zero-cost models).
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void probeOllama(draft.captureToken)}
                disabled={probingOllama}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Re-scan Ollama
              </button>
              {ollamaStatus?.reachable && !isOllamaActive && (
                <button
                  type="button"
                  onClick={() => handleSelectProvider('ollama')}
                  className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 whitespace-nowrap"
                >
                  Use Local Ollama
                </button>
              )}
            </div>
          </div>

          {/* Provider Switcher + Base URL */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="ai-base-url"
                className="block text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                AI Provider Preset
              </label>
              <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
                {(
                  [
                    { id: 'openrouter-free', label: 'OpenRouter Free' },
                    { id: 'openrouter-paid', label: 'OpenRouter Paid' },
                    { id: 'nvidia', label: 'NVIDIA NIM' },
                    { id: 'ollama', label: 'Local Ollama' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProvider(item.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activePreset === item.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
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

          {/* API Key (Hidden or Optional for Local Ollama) */}
          {isOllamaActive ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              No API key required for local Ollama. Models run directly on your machine at{' '}
              <code className="font-mono">{draft.baseUrl}</code>.
            </div>
          ) : (
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
                  placeholder={activePreset === 'nvidia' ? 'nvapi-...' : 'sk-or-v1-...'}
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
          )}

          {/* Dual Model Assignment + Catalog */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => handleSelectSlot('analysis')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    modelSlot === 'analysis'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span>1. Analysis &amp; Mention Agent</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSlot('walkthrough')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    modelSlot === 'walkthrough'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>2. Walkthrough Model (Vision)</span>
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                {modelsUpdatedAt && !loadingModels && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {models.length} models · {modelsUpdatedAt}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void refreshModels(draft.baseUrl, draft.apiKey, draft.captureToken)}
                  disabled={loadingModels}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                  {loadingModels ? 'Refreshing...' : 'Refresh models'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="ai-analysis-model"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Analysis &amp; Report Agent Model (Text or Vision)
                </label>
                <input
                  id="ai-analysis-model"
                  type="text"
                  value={draft.analysisModel || ''}
                  onFocus={() => handleSelectSlot('analysis')}
                  onChange={(e) => setDraft((prev) => ({ ...prev, analysisModel: e.target.value }))}
                  placeholder={draft.model.trim() || 'Defaults to Walkthrough model'}
                  className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100 ${
                    modelSlot === 'analysis'
                      ? 'border-slate-900 dark:border-slate-400'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                />
              </div>

              <div>
                <label
                  htmlFor="ai-model-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Walkthrough Model (Vision required)
                </label>
                <input
                  id="ai-model-name"
                  type="text"
                  value={draft.model}
                  onFocus={() => handleSelectSlot('walkthrough')}
                  onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="Pick a Vision model from catalog"
                  className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100 ${
                    modelSlot === 'walkthrough'
                      ? 'border-slate-900 dark:border-slate-400'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                />
              </div>
            </div>

            {selectedWalkthroughMeta?.supportsVision === false && (
              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                Heads up: Walkthrough model &ldquo;{draft.model}&rdquo; is text-only and will reject screenshots. Select a Vision model for Walkthrough, and keep text models in Analysis Agent.
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
                placeholder={`Search models to assign to ${
                  modelSlot === 'analysis' ? 'Analysis Agent' : 'Walkthrough (Vision)'
                }...`}
                aria-label="Filter available models"
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            {modelsError && (
              <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{modelsError}</p>
            )}

            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
              {loadingModels ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading live models...</span>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  {counts.catalog > 0 && tierFilter !== 'all'
                    ? 'This provider lists catalog models under "All" (free starter credits / pay-as-you-go).'
                    : 'No models match your filter. Adjust filters or type a model ID above.'}
                </div>
              ) : (
                filteredModels.map((item) => {
                  const activeSlotValue =
                    modelSlot === 'analysis'
                      ? (draft.analysisModel || '').trim() || draft.model.trim()
                      : draft.model.trim();
                  const selected = activeSlotValue === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => assignModelToActiveSlot(item.id)}
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
                          ? 'Text · '
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
                Website Capture &amp; Audit Server
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
                  Server token (CAPTURE_TOKEN, optional in dev)
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTest(modelSlot)}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {testing
                ? 'Testing...'
                : modelSlot === 'analysis'
                ? 'Test Analysis Agent'
                : 'Test Walkthrough Model'}
            </button>
          </div>

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
