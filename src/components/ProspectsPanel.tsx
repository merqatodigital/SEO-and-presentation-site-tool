import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { runSiteAudit } from '../audit/auditClient';
import { deriveClientName } from '../audit/htmlFindings';
import { computeScorecard, getRagLabel } from '../audit/scorecard';
import {
  AuditResult,
  ProspectEntry,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from '../audit/types';

interface ProspectsPanelProps {
  prospects: ProspectEntry[];
  captureUrl: string;
  captureToken: string;
  onProspectsChange: (next: ProspectEntry[]) => void;
  onOpenScorecard: (prospect: ProspectEntry) => void;
  onPromoteToProject: (prospect: ProspectEntry) => void;
}

type SortKey = 'score' | 'name' | 'date';

function resolveProspectDisplayName(prospect: ProspectEntry): string {
  return deriveClientName({
    explicitClientName: prospect.name,
    ogSiteName: prospect.audit?.parsed?.ogSiteName,
    pageTitle: prospect.audit?.parsed?.title,
    fallbackUrl: prospect.url,
    defaultLabel: prospect.url,
  });
}

function buildProspectRecord(
  audit: AuditResult,
  explicitName?: string
): ProspectEntry {
  const scorecard = computeScorecard(
    audit,
    createEmptyManualFootprint(),
    createDefaultAssumptions()
  );
  const topFailLabels = scorecard.allFindings
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'fail' ? -1 : 1;
      return b.weight - a.weight;
    })
    .slice(0, 3)
    .map((f) => `${f.label} (${f.evidence})`);

  const derivedName = deriveClientName({
    explicitClientName: explicitName,
    ogSiteName: audit.parsed?.ogSiteName,
    pageTitle: audit.parsed?.title,
    fallbackUrl: audit.finalUrl || audit.requestedUrl,
    defaultLabel: audit.finalUrl || audit.requestedUrl,
  });

  return {
    id: `prospect-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: derivedName,
    url: audit.finalUrl || audit.requestedUrl,
    overallScore: scorecard.overallScore,
    grade: scorecard.grade,
    rag: scorecard.rag,
    topFailingFindings: topFailLabels,
    auditedAt: audit.auditedAt,
    audit,
    scorecard,
  };
}

function ragTextClasses(rag: ProspectEntry['rag']): string {
  if (rag === 'green') return 'text-emerald-700 dark:text-emerald-400';
  if (rag === 'amber') return 'text-amber-700 dark:text-amber-400';
  if (rag === 'red') return 'text-rose-700 dark:text-rose-400';
  return 'text-slate-500 dark:text-slate-400';
}

function csvCell(value: string): string {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
}

export const ProspectsPanel: React.FC<ProspectsPanelProps> = ({
  prospects,
  captureUrl,
  captureToken,
  onProspectsChange,
  onOpenScorecard,
  onPromoteToProject,
}) => {
  const [quickName, setQuickName] = useState('');
  const [quickUrl, setQuickUrl] = useState('');
  const [quickRunning, setQuickRunning] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const [batchText, setBatchText] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    skipped: Array<{ url: string; reason: string }>;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(true); // Lowest score first = hottest lead

  const sortedProspects = useMemo(() => {
    const copy = [...prospects];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'score') {
        const sA = a.overallScore ?? 999;
        const sB = b.overallScore ?? 999;
        cmp = sA - sB;
      } else if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = new Date(a.auditedAt).getTime() - new Date(b.auditedAt).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [prospects, sortKey, sortAsc]);

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(nextKey);
      setSortAsc(nextKey === 'score');
    }
  };

  const handleQuickAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickUrl.trim()) return;
    setQuickError(null);
    setQuickRunning(true);
    try {
      const audit = await runSiteAudit(quickUrl, captureUrl, captureToken);
      const record = buildProspectRecord(audit, quickName);
      onProspectsChange([record, ...prospects]);
      setQuickName('');
      setQuickUrl('');
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Quick audit failed.');
    } finally {
      setQuickRunning(false);
    }
  };

  const handleBatchAudit = async () => {
    const rawLines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (rawLines.length === 0) return;
    const urls = Array.from(new Set(rawLines)).slice(0, 20);
    const controller = new AbortController();
    batchAbortRef.current = controller;

    setBatchRunning(true);
    setBatchProgress({ done: 0, total: urls.length, skipped: [] });

    let nextIndex = 0;
    const added: ProspectEntry[] = [];
    const skipped: Array<{ url: string; reason: string }> = [];
    let completedCount = 0;

    const worker = async () => {
      while (nextIndex < urls.length && !controller.signal.aborted) {
        const currentUrl = urls[nextIndex++];
        try {
          const audit = await runSiteAudit(
            currentUrl,
            captureUrl,
            captureToken,
            controller.signal
          );
          const record = buildProspectRecord(audit);
          added.push(record);
        } catch (err) {
          if (controller.signal.aborted) break;
          skipped.push({
            url: currentUrl,
            reason: err instanceof Error ? err.message : 'Failed to audit URL',
          });
        } finally {
          if (!controller.signal.aborted) {
            completedCount++;
            setBatchProgress({
              done: completedCount,
              total: urls.length,
              skipped: [...skipped],
            });
          }
        }
      }
    };

    // UI concurrency 2; server queue executes Lighthouse sequentially
    await Promise.all([worker(), worker()]);

    if (added.length > 0) {
      onProspectsChange([...added, ...prospects]);
    }
    setBatchRunning(false);
    batchAbortRef.current = null;
  };

  const handleCancelBatch = () => {
    batchAbortRef.current?.abort();
    setBatchRunning(false);
  };

  const handleExportCsv = () => {
    const headers = [
      'Name',
      'URL',
      'Score',
      'Grade',
      'Status',
      'Top Failing Finding 1',
      'Top Failing Finding 2',
      'Top Failing Finding 3',
      'Audit Date',
    ];
    const rows = sortedProspects.map((p) => [
      resolveProspectDisplayName(p),
      p.url,
      p.overallScore !== null ? String(p.overallScore) : 'N/A',
      p.grade,
      getRagLabel(p.rag),
      p.topFailingFindings[0] || '',
      p.topFailingFindings[1] || '',
      p.topFailingFindings[2] || '',
      p.auditedAt,
    ]);
    const csv = [
      headers.map(csvCell).join(','),
      ...rows.map((r) => r.map(csvCell).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tourforge-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Quick Audit Single URL */}
        <form
          onSubmit={(e) => void handleQuickAudit(e)}
          className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-5 dark:border-slate-800 dark:bg-slate-950"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Quick Prospect Audit
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Run an automated check on a single lead URL and save their score.
          </p>

          <div className="mt-3 space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Business Name (Optional)
              </label>
              <input
                type="text"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="Coco Cove Resort"
                disabled={quickRunning || batchRunning}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Prospect Website URL
              </label>
              <input
                type="url"
                required
                value={quickUrl}
                onChange={(e) => setQuickUrl(e.target.value)}
                placeholder="https://example-business.com"
                disabled={quickRunning || batchRunning}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            {quickError && (
              <p className="text-xs text-rose-700 dark:text-rose-400">{quickError}</p>
            )}

            <button
              type="submit"
              disabled={quickRunning || batchRunning || !quickUrl.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              {quickRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Auditing prospect...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>Quick audit &amp; save</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Batch Audit (Up to 20 URLs) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-7 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Batch Lead Scanner (Up to 20 URLs)
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Paste one URL per line. Runs 2 in parallel while the server queues Lighthouse safely.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
              {Math.min(
                20,
                batchText
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean).length
              )}{' '}
              / 20 queued
            </span>
          </div>

          <textarea
            rows={4}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            disabled={batchRunning}
            placeholder={'https://resort-one.example\nhttps://clinic-two.example\nhttps://cafe-three.example'}
            aria-label="Batch URLs to audit"
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBatchAudit()}
                disabled={
                  batchRunning ||
                  quickRunning ||
                  batchText
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean).length === 0
                }
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
              >
                {batchRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Running batch...</span>
                  </>
                ) : (
                  <span>Run batch audit</span>
                )}
              </button>

              {batchRunning && (
                <button
                  type="button"
                  onClick={handleCancelBatch}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Stop
                </button>
              )}
            </div>

            {batchProgress && (
              <span className="text-xs font-medium text-slate-600 tabular-nums dark:text-slate-300">
                Processed {batchProgress.done} of {batchProgress.total}
                {batchProgress.skipped.length > 0
                  ? ` · ${batchProgress.skipped.length} skipped`
                  : ''}
              </span>
            )}
          </div>

          {batchProgress && batchProgress.skipped.length > 0 && (
            <div className="mt-2.5 max-h-24 overflow-y-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              {batchProgress.skipped.map((s, idx) => (
                <p key={idx} className="truncate">
                  Skipped {s.url}: {s.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Saved Prospects Table */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Saved Prospects ({prospects.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sorted by lowest score first so hottest leads appear at the top.
            </p>
          </div>

          {prospects.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export CSV
            </button>
          )}
        </div>

        {prospects.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No prospects saved yet. Run a quick or batch audit above to build your outreach list.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Prospect</span>
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleSort('score')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Score</span>
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-semibold">Top Failing Finding</th>
                  <th className="px-4 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Audited</span>
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sortedProspects.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {resolveProspectDisplayName(item)}
                      </p>
                      <p className="max-w-[240px] truncate text-slate-500 dark:text-slate-400">
                        {item.url}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {item.overallScore !== null ? `${item.overallScore}/100` : 'N/A'} ·{' '}
                        {item.grade}
                      </p>
                      <p className={`text-[11px] font-medium ${ragTextClasses(item.rag)}`}>
                        {getRagLabel(item.rag)}
                      </p>
                    </td>
                    <td className="px-4 py-3 max-w-[260px] text-slate-700 dark:text-slate-300">
                      <p className="line-clamp-2">
                        {item.topFailingFindings[0] || 'No failing checks'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-500 tabular-nums dark:text-slate-400 whitespace-nowrap">
                      {new Date(item.auditedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenScorecard(item)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          Open scorecard
                        </button>
                        <button
                          type="button"
                          onClick={() => onPromoteToProject(item)}
                          className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
                        >
                          <span>Promote</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onProspectsChange(prospects.filter((p) => p.id !== item.id))
                          }
                          aria-label={`Delete prospect ${item.name}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
