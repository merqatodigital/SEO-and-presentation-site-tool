import React, { useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  HelpCircle,
  ListChecks,
  MessageSquare,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  buildGbpActionPlaybook,
  computeGbpCompetitorBenchmark,
} from '../audit/gbpPlaybook';
import { CompetitorBenchmarkRow, ManualFootprint } from '../audit/types';
import { ProjectBrief, getContrastTextColor } from '../types/tour';

interface GbpBenchmarkPanelProps {
  manual: ManualFootprint;
  project: ProjectBrief;
  clientName: string;
  onManualChange: (next: ManualFootprint) => void;
  onSwitchToGbpForm?: () => void;
}

export const GbpBenchmarkPanel: React.FC<GbpBenchmarkPanelProps> = ({
  manual,
  project,
  clientName,
  onManualChange,
  onSwitchToGbpForm,
}) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const competitors = manual.competitors ?? [];
  const benchmark = computeGbpCompetitorBenchmark(manual, clientName);
  const playbook = buildGbpActionPlaybook(manual, project, clientName);
  const brandContrast = getContrastTextColor(project.brandColor);

  const addCompetitor = () => {
    if (competitors.length >= 3) return;
    const next: CompetitorBenchmarkRow = {
      id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      category: project.businessType.trim() || '',
      reviewCount: null,
      averageRating: null,
      photoCount: null,
      postsLast90Days: null,
    };
    onManualChange({ ...manual, competitors: [...competitors, next] });
  };

  const updateCompetitor = (id: string, patch: Partial<CompetitorBenchmarkRow>) => {
    onManualChange({
      ...manual,
      competitors: competitors.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const removeCompetitor = (id: string) => {
    onManualChange({
      ...manual,
      competitors: competitors.filter((c) => c.id !== id),
    });
  };

  const handleCopyTemplate = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx(null), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const parseOptionalInt = (raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };

  const parseOptionalRating = (raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 && n <= 5 ? Number(n.toFixed(1)) : null;
  };

  const urgencyClass = (priority: 'Urgent' | 'This Week' | 'Monthly') => {
    if (priority === 'Urgent') {
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-200';
    }
    if (priority === 'This Week') {
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200';
    }
    return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  };

  return (
    <div className="space-y-8">
      {/* 1. Competitor Input & Benchmark Table */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Local GBP Competitor Benchmark
            </h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Compare your Google Business Profile metrics side by side with up to 3 top local competitors on Maps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onSwitchToGbpForm && (
              <button
                type="button"
                onClick={onSwitchToGbpForm}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Edit Client GBP Data
              </button>
            )}
            {competitors.length < 3 && (
              <button
                type="button"
                onClick={addCompetitor}
                style={{ backgroundColor: project.brandColor, color: brandContrast }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-95 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add competitor ({competitors.length}/3)
              </button>
            )}
          </div>
        </div>

        {/* Summary Callout */}
        <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <div className="space-y-0.5">
            <p className="font-semibold">{benchmark.summaryLine}</p>
            {(benchmark.avgCompetitorReviews !== null || benchmark.avgCompetitorPhotos !== null) && (
              <p className="text-slate-600 dark:text-slate-400 tabular-nums">
                Competitor avg:{' '}
                {benchmark.avgCompetitorReviews !== null ? `${benchmark.avgCompetitorReviews} reviews` : '—'}
                {' · '}
                {benchmark.avgCompetitorRating !== null ? `${benchmark.avgCompetitorRating}★` : '—'}
                {' · '}
                {benchmark.avgCompetitorPhotos !== null ? `${benchmark.avgCompetitorPhotos} photos` : '—'}
                {' · '}
                {benchmark.avgCompetitorPosts90d !== null ? `${benchmark.avgCompetitorPosts90d} posts/90d` : '—'}
              </p>
            )}
          </div>
        </div>

        {/* Competitor Entry Rows */}
        {competitors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            No competitors entered yet. Click <strong>Add competitor</strong> to enter 1–3 top-ranking businesses from Google Maps and quantify the review &amp; photo gap.
          </div>
        ) : (
          <div className="space-y-2.5">
            {competitors.map((comp, idx) => (
              <div
                key={comp.id}
                className="grid grid-cols-1 gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12 sm:items-end dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Competitor {idx + 1} Name
                  </label>
                  <input
                    type="text"
                    value={comp.name}
                    onChange={(e) => updateCompetitor(comp.id, { name: e.target.value })}
                    placeholder="e.g. Harbor Dental Clinic"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Reviews
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={comp.reviewCount ?? ''}
                    onChange={(e) =>
                      updateCompetitor(comp.id, { reviewCount: parseOptionalInt(e.target.value) })
                    }
                    placeholder="0"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Star Rating
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={comp.averageRating ?? ''}
                    onChange={(e) =>
                      updateCompetitor(comp.id, {
                        averageRating: parseOptionalRating(e.target.value),
                      })
                    }
                    placeholder="4.7"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Photos
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={comp.photoCount ?? ''}
                    onChange={(e) =>
                      updateCompetitor(comp.id, { photoCount: parseOptionalInt(e.target.value) })
                    }
                    placeholder="25"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    90d Posts
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={comp.postsLast90Days ?? ''}
                    onChange={(e) =>
                      updateCompetitor(comp.id, {
                        postsLast90Days: parseOptionalInt(e.target.value),
                      })
                    }
                    placeholder="4"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="flex justify-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => removeCompetitor(comp.id)}
                    aria-label={`Remove competitor ${idx + 1}`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Side-by-side Benchmark Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[580px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5 font-semibold">Business</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Reviews</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Rating</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Photos</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Posts (90d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              <tr className="bg-slate-50/70 font-semibold dark:bg-slate-950/60">
                <td className="px-3.5 py-2.5 text-slate-900 dark:text-slate-100">
                  {clientName || 'Client'} (Target)
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                  {benchmark.clientReviews ?? 'Unknown'}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                  {benchmark.clientRating !== null ? `${benchmark.clientRating}★` : 'Unknown'}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                  {benchmark.clientPhotos ?? 'Unknown'}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                  {benchmark.clientPosts90d ?? 'Unknown'}
                </td>
              </tr>
              {benchmark.competitors.map((comp) => (
                <tr key={comp.id}>
                  <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300">
                    {comp.name.trim() || 'Unnamed competitor'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {comp.reviewCount ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {comp.averageRating !== null ? `${comp.averageRating}★` : '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {comp.photoCount ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {comp.postsLast90Days ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. GBP Action Playbook */}
      <div className="space-y-6 border-t border-slate-200 pt-6 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            GBP Optimization Playbook
          </h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Deterministic execution checklist generated from GBP gaps, competitor targets, and business category.
          </p>
        </div>

        {/* Prioritized Actions */}
        <div>
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <ListChecks className="h-3.5 w-3.5" />
            <span>Prioritized Actions ({playbook.prioritizedActions.length})</span>
          </h4>
          {playbook.prioritizedActions.length === 0 ? (
            <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              All core GBP fundamentals are marked complete and meeting competitor benchmarks.
            </div>
          ) : (
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {playbook.prioritizedActions.map((act, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${urgencyClass(
                        act.priority
                      )}`}
                    >
                      {act.priority}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {act.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {act.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Photo Shot List + Review Scripts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Camera className="h-3.5 w-3.5" />
              <span>Recommended Photo Shot List</span>
            </h4>
            <ul className="mt-2.5 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              {playbook.photoShotList.map((shot, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="font-mono text-[11px] font-semibold text-slate-400 tabular-nums">
                    0{idx + 1}
                  </span>
                  <span>{shot}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-7">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Copy-Ready Review Request Templates</span>
            </h4>
            <div className="mt-2.5 space-y-2.5">
              {playbook.reviewTemplates.map((tpl, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {tpl.channel}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyTemplate(idx, tpl.script)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {copiedIdx === idx ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {tpl.script}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* GBP Q&A Seeds */}
        <div>
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>GBP Q&amp;A Seeds to Pre-Publish</span>
          </h4>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {playbook.qaSeeds.map((qa, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                <p className="font-semibold text-slate-900 dark:text-slate-100">{qa.question}</p>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{qa.answerPrompt}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
