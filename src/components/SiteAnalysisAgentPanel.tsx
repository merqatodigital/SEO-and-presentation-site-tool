import React, { useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  Download,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { SiteAnalysisReport } from '../audit/types';
import {
  getEffectiveAnalysisModel,
  getProviderLabel,
  siteAnalysisReportToMarkdown,
} from '../lib/aiClient';
import { AISettings, ProjectBrief, getContrastTextColor } from '../types/tour';

interface SiteAnalysisAgentPanelProps {
  project: ProjectBrief;
  aiSettings: AISettings;
  hasConfiguredAnalysisAI: boolean;
  report: SiteAnalysisReport | null;
  isGeneratingReport: boolean;
  reportStage: string;
  reportError: string | null;
  onGenerateReport: () => void;
  onOpenSettings: () => void;
}

export const SiteAnalysisAgentPanel: React.FC<SiteAnalysisAgentPanelProps> = ({
  project,
  aiSettings,
  hasConfiguredAnalysisAI,
  report,
  isGeneratingReport,
  reportStage,
  reportError,
  onGenerateReport,
  onOpenSettings,
}) => {
  const [copiedMd, setCopiedMd] = useState(false);
  const brandContrast = getContrastTextColor(project.brandColor);
  const activeModel = getEffectiveAnalysisModel(aiSettings);
  const providerLabel = getProviderLabel(aiSettings);

  const handleCopyMarkdown = async () => {
    if (!report) return;
    const md = siteAnalysisReportToMarkdown(
      report,
      project.clientName || 'Client',
      project.websiteUrl
    );
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      window.setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleDownloadMarkdown = () => {
    if (!report) return;
    const md = siteAnalysisReportToMarkdown(
      report,
      project.clientName || 'Client',
      project.websiteUrl
    );
    const slug = (project.clientName || 'site-analysis')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug || 'client'}-analysis-report.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Open-Source Site Analysis Agent · {providerLabel}
            {activeModel ? ` (${activeModel})` : ''}
          </p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Bot className="h-4 w-4" style={{ color: project.brandColor }} />
            <span>AI Strategy Brief &amp; Executive Site Report</span>
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Synthesizes the deterministic scorecard, AI visibility checks, and GBP competitor benchmark into an agency brief — works even without screenshots.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Change Agent</span>
          </button>
          <button
            type="button"
            onClick={onGenerateReport}
            disabled={isGeneratingReport || !hasConfiguredAnalysisAI}
            style={{ backgroundColor: project.brandColor, color: brandContrast }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-95 disabled:opacity-45 whitespace-nowrap"
          >
            {isGeneratingReport ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{reportStage || 'Running analysis...'}</span>
              </>
            ) : (
              <>
                <Bot className="h-3.5 w-3.5" />
                <span>{report ? 'Regenerate Report' : 'Run Site Analysis Agent'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!hasConfiguredAnalysisAI && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          Choose an OpenRouter Free/Paid model, NVIDIA NIM, or local Ollama in{' '}
          <button
            type="button"
            onClick={onOpenSettings}
            className="font-semibold underline underline-offset-4"
          >
            AI Settings
          </button>{' '}
          to run the Site Analysis Agent.
        </div>
      )}

      {reportError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="whitespace-pre-line">{reportError}</span>
        </div>
      )}

      {report && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Generated by <strong className="text-slate-800 dark:text-slate-200">{report.providerLabel}</strong>{' '}
              (<code className="font-mono">{report.modelId}</code>) ·{' '}
              {new Date(report.generatedAt).toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyMarkdown()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copiedMd ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Copied MD</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Markdown</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download .md</span>
              </button>
            </div>
          </div>

          {report.needsReview && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Verify numbers carefully: this model included figures that could not be matched verbatim against the measured scorecard evidence.
              </span>
            </div>
          )}

          {/* Executive Summary + Client Pitch Angle */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-7 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Executive Summary
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {report.executiveSummary}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-5 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Recommended Client Pitch Opener
              </h4>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                &ldquo;{report.clientPitchAngle}&rdquo;
              </p>
            </div>
          </div>

          {/* Revenue Leaks + AI Verdict + GBP Summary */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Biggest Revenue Leaks
              </h4>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {report.biggestRevenueLeaks.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="font-semibold text-rose-600 dark:text-rose-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                AI Visibility Verdict
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {report.aiVisibilityVerdict}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                GBP &amp; Competitor Summary
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {report.gbpActionSummary}
              </p>
            </div>
          </div>

          {/* 30-Day & 90-Day Plans */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                30-Day Quick Wins
              </h4>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {report.quickWins30Days.map((item, idx) => (
                  <li key={idx}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                90-Day Strategic Plan
              </h4>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {report.strategic90Days.map((item, idx) => (
                  <li key={idx}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
