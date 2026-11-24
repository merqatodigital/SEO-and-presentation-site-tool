import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  HelpCircle,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  buildAiReadinessSummary,
  buildRecommendedRobotsTxt,
} from '../audit/aiReadiness';
import { buildValidatedJsonLd } from '../audit/jsonLd';
import {
  AiMentionCheckResult,
  AuditResult,
  ManualFootprint,
  RagBand,
} from '../audit/types';
import { getEffectiveAnalysisModel, getProviderLabel } from '../lib/aiClient';
import {
  AISearchLayerData,
  AISettings,
  ProjectBrief,
  WalkthroughData,
  buildLlmsTxt,
  getContrastTextColor,
} from '../types/tour';

interface AiVisibilityTabProps {
  project: ProjectBrief;
  audit: AuditResult | null;
  manualFootprint: ManualFootprint;
  aiSearchLayer: AISearchLayerData;
  walkthrough: WalkthroughData | null;
  aiSettings: AISettings;
  hasConfiguredAnalysisAI: boolean;
  aiMentionCheck: AiMentionCheckResult | null;
  isCheckingMentions: boolean;
  mentionCheckError: string | null;
  onAISearchLayerChange: (next: AISearchLayerData) => void;
  onResetAISearchLayer: () => void;
  onRunMentionCheck: () => void;
  onOpenSettings: () => void;
}

function ragBadgeClass(rag: RagBand): string {
  if (rag === 'green') {
    return 'text-emerald-700 dark:text-emerald-400';
  }
  if (rag === 'amber') {
    return 'text-amber-700 dark:text-amber-400';
  }
  if (rag === 'red') {
    return 'text-rose-700 dark:text-rose-400';
  }
  return 'text-slate-500 dark:text-slate-400';
}

export const AiVisibilityTab: React.FC<AiVisibilityTabProps> = ({
  project,
  audit,
  manualFootprint,
  aiSearchLayer,
  walkthrough,
  aiSettings,
  hasConfiguredAnalysisAI,
  aiMentionCheck,
  isCheckingMentions,
  mentionCheckError,
  onAISearchLayerChange,
  onResetAISearchLayer,
  onRunMentionCheck,
  onOpenSettings,
}) => {
  const [artifactTab, setArtifactTab] = useState<'jsonld' | 'llms' | 'robots'>('jsonld');
  const [copiedArtifact, setCopiedArtifact] = useState(false);

  const brandContrast = getContrastTextColor(project.brandColor);
  const summary = useMemo(() => buildAiReadinessSummary(audit), [audit]);
  const jsonLdResult = useMemo(
    () => buildValidatedJsonLd(project, aiSearchLayer, audit, manualFootprint),
    [project, aiSearchLayer, audit, manualFootprint]
  );
  const llmsTxtContent = useMemo(
    () => buildLlmsTxt(project, aiSearchLayer, walkthrough),
    [project, aiSearchLayer, walkthrough]
  );
  const robotsTxtContent = useMemo(
    () => buildRecommendedRobotsTxt(audit?.finalUrl || project.websiteUrl || aiSearchLayer.websiteUrl),
    [audit?.finalUrl, project.websiteUrl, aiSearchLayer.websiteUrl]
  );

  const activeArtifactText =
    artifactTab === 'jsonld'
      ? jsonLdResult.scriptTag
      : artifactTab === 'llms'
      ? llmsTxtContent
      : robotsTxtContent;
  const canExportArtifact = artifactTab !== 'jsonld' || jsonLdResult.valid;

  const activeModelId = getEffectiveAnalysisModel(aiSettings);
  const activeProviderLabel = getProviderLabel(aiSettings);

  const handleCopyArtifact = async () => {
    if (!canExportArtifact) return;
    try {
      await navigator.clipboard.writeText(activeArtifactText);
      setCopiedArtifact(true);
      window.setTimeout(() => setCopiedArtifact(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleDownloadArtifact = () => {
    if (!canExportArtifact) return;
    const filename =
      artifactTab === 'jsonld'
        ? 'structured-data-schema.html'
        : artifactTab === 'llms'
        ? 'llms.txt'
        : 'robots.txt';
    const mime =
      artifactTab === 'jsonld' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([activeArtifactText], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const entity = audit?.aiReadiness?.entityCompleteness;
  const entityFields = [
    { label: 'Schema @type', present: entity?.hasBusinessType ?? false },
    { label: 'PostalAddress', present: entity?.hasAddress ?? false },
    { label: 'Telephone', present: entity?.hasTelephone ?? false },
    { label: 'OpeningHours', present: entity?.hasOpeningHours ?? false },
    { label: 'PriceRange', present: entity?.hasPriceRange ?? false },
    { label: 'SameAs Links', present: entity?.hasSameAs ?? false },
    { label: 'FAQPage Q&As', present: entity?.hasFaqPage ?? false },
    { label: 'GeoCoords', present: entity?.hasGeo ?? false },
  ];

  const botAccess = audit?.aiReadiness?.botAccess ?? [];
  const llmsLive = audit?.aiReadiness?.llmsTxt;

  return (
    <section id="step-3" className="no-print space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Step 3 · AI Search &amp; Answer Engine Readiness
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
            Being Found on AI (ChatGPT, Claude &amp; Perplexity)
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Verify whether AI crawlers can read your site, inspect live{' '}
            <code className="font-mono text-xs">/llms.txt</code> and rich Schema entities, test real brand recall, and export ready-to-publish files.
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 shrink-0">
          <div className="tabular-nums">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              AI Readiness Score
            </p>
            <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-slate-100">
              {summary.score !== null ? `${summary.score}/100` : 'Not scanned'}
            </p>
          </div>
          <div className="border-l border-slate-200 pl-4 text-xs tabular-nums dark:border-slate-800">
            <p className={`font-semibold ${ragBadgeClass(summary.rag)}`}>
              {summary.score === null
                ? 'Run Step 1 scan'
                : summary.rag === 'green'
                ? 'AI Ready'
                : summary.rag === 'amber'
                ? 'Partial Visibility'
                : 'AI Blind Spots'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              {summary.allowedBotsCount}/{summary.totalBotsCount} bots allowed ·{' '}
              {summary.entityFieldsPresent}/{summary.entityFieldsTotal} entity fields
            </p>
          </div>
        </div>
      </div>

      {/* Part A: Deterministic AI Audit (Bots, /llms.txt, Rich Entity Completeness) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* AI Crawler Access */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              AI Crawler Bot Access (robots.txt)
            </h3>
            <span className="text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
              {audit?.aiReadiness ? `${summary.allowedBotsCount}/${summary.totalBotsCount} allowed` : 'Not audited'}
            </span>
          </div>

          <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {botAccess.length === 0 ? (
              <div className="px-3.5 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                Run an audit in Step 1 (or load the sample project) to inspect live{' '}
                <code className="font-mono">robots.txt</code> rules for GPTBot, ClaudeBot, and PerplexityBot.
              </div>
            ) : (
              botAccess.map((b) => (
                <div
                  key={b.bot}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {b.bot}
                    </p>
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {b.label}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold shrink-0 ${
                      b.status === 'allowed'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : b.status === 'blocked'
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {b.status === 'allowed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : b.status === 'blocked' ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : (
                      <HelpCircle className="h-3.5 w-3.5" />
                    )}
                    <span className="capitalize">{b.status}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live /llms.txt + Rich Entity Completeness */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Live <code className="font-mono">/llms.txt</code> Check
              </h3>
              <span
                className={`text-xs font-semibold ${
                  summary.llmsStatus === 'found'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : summary.llmsStatus === 'missing'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {summary.llmsStatus === 'found'
                  ? `Detected (${llmsLive?.bytes ?? 0} bytes)`
                  : summary.llmsStatus === 'missing'
                  ? 'Missing at root'
                  : 'Not checked'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {llmsLive?.exists === true && llmsLive.preview
                ? llmsLive.preview.slice(0, 180)
                : llmsLive?.reason ||
                  'No /llms.txt summary file detected on the live domain. Use the generator below to export one cleanly.'}
            </p>
          </div>

          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rich Business Entity Schema Detected ({summary.entityFieldsPresent}/8)
              </h3>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {entityFields.map((f) => (
                <div
                  key={f.label}
                  className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
                >
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {f.label}
                  </span>
                  {audit?.parsed ? (
                    f.present ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500 dark:text-rose-400" />
                    )
                  ) : (
                    <span className="text-[10px] text-slate-400">—</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Action Checklist from deterministic readiness summary */}
          {summary.items.length > 0 && (
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800 space-y-2">
              {summary.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400">{item.detail}</p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold uppercase ${
                      item.status === 'pass'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : item.status === 'warn'
                        ? 'text-amber-700 dark:text-amber-400'
                        : item.status === 'fail'
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Part B: Live AI Brand Mention Check (via OpenRouter / NVIDIA NIM / Local Ollama) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <Search className="h-4 w-4" style={{ color: project.brandColor }} />
              <span>AI Brand Mention Check</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Test 3 standardized buyer discovery queries via{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {activeModelId ? `${activeProviderLabel} · ${activeModelId}` : 'no AI model selected'}
              </span>
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Switch Agent</span>
            </button>
            <button
              type="button"
              onClick={onRunMentionCheck}
              disabled={isCheckingMentions || !hasConfiguredAnalysisAI}
              style={{ backgroundColor: project.brandColor, color: brandContrast }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-95 disabled:opacity-45 whitespace-nowrap"
            >
              {isCheckingMentions ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Testing 3 buyer queries...</span>
                </>
              ) : (
                <>
                  <Bot className="h-3.5 w-3.5" />
                  <span>Run Brand Mention Check</span>
                </>
              )}
            </button>
          </div>
        </div>

        {!hasConfiguredAnalysisAI && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            Configure an OpenRouter Free/Paid model, NVIDIA NIM, or local Ollama in{' '}
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-semibold underline underline-offset-4"
            >
              Settings
            </button>{' '}
            to run the Brand Mention Check.
          </div>
        )}

        {mentionCheckError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{mentionCheckError}</span>
          </div>
        )}

        {aiMentionCheck && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Overall AI Recall:{' '}
                  <span
                    className={
                      aiMentionCheck.overallVisibility === 'visible'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : aiMentionCheck.overallVisibility === 'partial'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }
                  >
                    {aiMentionCheck.overallVisibility === 'visible'
                      ? 'Visible'
                      : aiMentionCheck.overallVisibility === 'partial'
                      ? 'Partial'
                      : 'Not mentioned'}
                  </span>
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {aiMentionCheck.modelId}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                Checked {new Date(aiMentionCheck.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div
              className={`rounded-lg border px-3.5 py-2 text-xs ${
                aiMentionCheck.searchCapable
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100'
              }`}
            >
              {aiMentionCheck.searchCaveat}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {aiMentionCheck.results.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      &ldquo;{item.query}&rdquo;
                    </p>
                    <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                      {item.summary}
                    </p>
                  </div>
                  <div className="mt-3 space-y-1 border-t border-slate-200 pt-2.5 dark:border-slate-800">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      Client named:{' '}
                      <span
                        className={
                          item.clientMentioned
                            ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                            : 'font-semibold text-rose-700 dark:text-rose-400'
                        }
                      >
                        {item.clientMentioned ? 'Yes' : 'No'}
                      </span>{' '}
                      · Domain cited: {item.citedDomain ? 'Yes' : 'No'}
                    </p>
                    {item.competitorsMentioned.length > 0 && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Named instead: {item.competitorsMentioned.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Part C: Verified Business Facts Editor + Ready-to-Publish Deliverables (Schema, llms.txt, robots.txt) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
              AI Visibility Deliverables · Schema @type: {jsonLdResult.selectedType}
            </p>
            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
              <FileCode2 className="h-4 w-4" style={{ color: project.brandColor }} />
              <span>Ready-to-Publish AI Search Files (Schema JSON-LD, llms.txt &amp; robots.txt)</span>
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Available immediately after scan — no Walkthrough required. Edit facts below to regenerate clean markup for the client&apos;s site.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetAISearchLayer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Sync from brief &amp; audit
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-7 lg:grid-cols-12">
          {/* Left 6 cols: Business Facts & Q&A Editor */}
          <div className="space-y-4 lg:col-span-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Service Area / City
                </label>
                <input
                  type="text"
                  value={aiSearchLayer.serviceArea}
                  onChange={(e) =>
                    onAISearchLayerChange({ ...aiSearchLayer, serviceArea: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Official Website / Booking URL
                </label>
                <input
                  type="text"
                  value={aiSearchLayer.websiteUrl}
                  onChange={(e) =>
                    onAISearchLayerChange({ ...aiSearchLayer, websiteUrl: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Verified Summary &amp; Primary Services
              </label>
              <textarea
                rows={2}
                value={aiSearchLayer.primaryOffer}
                onChange={(e) =>
                  onAISearchLayerChange({ ...aiSearchLayer, primaryOffer: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Key Differentiator / Proof
                </label>
                <input
                  type="text"
                  value={aiSearchLayer.keyDifferentiator}
                  onChange={(e) =>
                    onAISearchLayerChange({ ...aiSearchLayer, keyDifferentiator: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Contact &amp; Booking Action
                </label>
                <input
                  type="text"
                  value={aiSearchLayer.contactInfo}
                  onChange={(e) =>
                    onAISearchLayerChange({ ...aiSearchLayer, contactInfo: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Verified Q&amp;As (feeds FAQPage JSON-LD &amp; llms.txt)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onAISearchLayerChange({
                      ...aiSearchLayer,
                      faqs: [
                        ...aiSearchLayer.faqs,
                        {
                          question: `What hours or availability does ${project.clientName || 'the business'} offer?`,
                          answer: 'Share accurate opening hours, booking lead times, or response expectations.',
                        },
                      ],
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Q&amp;A
                </button>
              </div>
              <div className="mt-2 space-y-2.5">
                {aiSearchLayer.faqs.map((qa, idx) => (
                  <div
                    key={idx}
                    className="group rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <input
                        type="text"
                        value={qa.question}
                        onChange={(e) => {
                          const nextFaqs = aiSearchLayer.faqs.map((item, i) =>
                            i === idx ? { ...item, question: e.target.value } : item
                          );
                          onAISearchLayerChange({ ...aiSearchLayer, faqs: nextFaqs });
                        }}
                        aria-label={`AI Q&A ${idx + 1} question`}
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-100 dark:focus:bg-slate-900"
                      />
                      {aiSearchLayer.faqs.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            onAISearchLayerChange({
                              ...aiSearchLayer,
                              faqs: aiSearchLayer.faqs.filter((_, i) => i !== idx),
                            })
                          }
                          aria-label={`Remove Q&A ${idx + 1}`}
                          className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      value={qa.answer}
                      onChange={(e) => {
                        const nextFaqs = aiSearchLayer.faqs.map((item, i) =>
                          i === idx ? { ...item, answer: e.target.value } : item
                        );
                        onAISearchLayerChange({ ...aiSearchLayer, faqs: nextFaqs });
                      }}
                      aria-label={`AI Q&A ${idx + 1} answer`}
                      className="mt-1 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-600 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-400 dark:focus:bg-slate-900"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right 6 cols: Exporter */}
          <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-950 text-slate-100 lg:col-span-6 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3.5 py-2.5">
              <div className="inline-flex rounded-lg bg-slate-900 p-0.5">
                {(
                  [
                    { id: 'jsonld', label: 'Schema JSON-LD' },
                    { id: 'llms', label: 'llms.txt' },
                    { id: 'robots', label: 'robots.txt' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setArtifactTab(t.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      artifactTab === t.id
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canExportArtifact}
                  onClick={() => void handleCopyArtifact()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                >
                  {copiedArtifact ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!canExportArtifact}
                  onClick={handleDownloadArtifact}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {artifactTab === 'jsonld'
                      ? 'HTML'
                      : artifactTab === 'llms'
                      ? 'llms.txt'
                      : 'robots.txt'}
                  </span>
                </button>
              </div>
            </div>

            {artifactTab === 'llms' && (
              <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-2 text-[11px] text-amber-300">
                Optional emerging convention: publish at domain root alongside clean Schema.org JSON-LD.
              </div>
            )}

            <pre className="max-h-[420px] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
              {activeArtifactText}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
};
