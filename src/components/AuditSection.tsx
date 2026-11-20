import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Globe,
  HelpCircle,
  Loader2,
  Printer,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { deriveClientName } from '../audit/htmlFindings';
import { buildOutreachSummary, getRagLabel } from '../audit/scorecard';
import {
  AUDIT_CATEGORIES,
  AuditAssumptions,
  AuditCategoryId,
  AuditFinding,
  AuditResult,
  FindingStatus,
  ManualFootprint,
  ProspectEntry,
  RagBand,
  Scorecard,
} from '../audit/types';
import {
  CURRENCY_CONFIG,
  CurrencyCode,
  ProjectBrief,
  getContrastTextColor,
} from '../types/tour';
import { ManualFootprintForm } from './ManualFootprintForm';
import { ProspectsPanel } from './ProspectsPanel';

export type AuditTabId = 'auto' | 'manual' | 'scorecard' | 'prospects';

interface AuditSectionProps {
  activeTab: AuditTabId;
  onTabChange: (tab: AuditTabId) => void;
  auditUrl: string;
  onAuditUrlChange: (url: string) => void;
  isAuditing: boolean;
  auditStageIndex: number; // 0..3
  auditError: string | null;
  audit: AuditResult | null;
  manualFootprint: ManualFootprint;
  assumptions: AuditAssumptions;
  scorecard: Scorecard;
  project: ProjectBrief;
  prospects: ProspectEntry[];
  captureUrl: string;
  captureToken: string;
  onRunAudit: (url: string) => void;
  onLoadSampleAudit: () => void;
  onManualFootprintChange: (next: ManualFootprint) => void;
  onAssumptionsChange: (next: AuditAssumptions) => void;
  onCurrencyChange?: (currency: CurrencyCode) => void;
  onProspectsChange: (next: ProspectEntry[]) => void;
  onOpenProspectScorecard: (prospect: ProspectEntry) => void;
  onPromoteProspect: (prospect: ProspectEntry) => void;
  onPrintScorecard: () => void;
  onExportAuditJson: () => void;
}

const AUDIT_PROGRESS_STEPS = [
  'Fetching page',
  'Parsing HTML & links',
  'Speed test (Lighthouse)',
  'Scoring findings',
];

function ragBarBg(rag: RagBand): string {
  if (rag === 'green') return '#16A34A';
  if (rag === 'amber') return '#D97706';
  if (rag === 'red') return '#DC2626';
  return '#64748B';
}

function ragTextColor(rag: RagBand): string {
  if (rag === 'green') return 'text-emerald-700 dark:text-emerald-400';
  if (rag === 'amber') return 'text-amber-700 dark:text-amber-400';
  if (rag === 'red') return 'text-rose-700 dark:text-rose-400';
  return 'text-slate-500 dark:text-slate-400';
}

function statusMeta(status: FindingStatus): {
  label: string;
  cls: string;
  icon: React.ReactNode;
} {
  if (status === 'pass') {
    return {
      label: 'Pass',
      cls: 'text-emerald-700 dark:text-emerald-400',
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />,
    };
  }
  if (status === 'warn') {
    return {
      label: 'Warn',
      cls: 'text-amber-700 dark:text-amber-400',
      icon: <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />,
    };
  }
  if (status === 'fail') {
    return {
      label: 'Fail',
      cls: 'text-rose-700 dark:text-rose-400',
      icon: <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />,
    };
  }
  return {
    label: 'Unknown',
    cls: 'text-slate-500 dark:text-slate-400',
    icon: <HelpCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />,
  };
}

export const AuditSection: React.FC<AuditSectionProps> = ({
  activeTab,
  onTabChange,
  auditUrl,
  onAuditUrlChange,
  isAuditing,
  auditStageIndex,
  auditError,
  audit,
  manualFootprint,
  assumptions,
  scorecard,
  project,
  prospects,
  captureUrl,
  captureToken,
  onRunAudit,
  onLoadSampleAudit,
  onManualFootprintChange,
  onAssumptionsChange,
  onCurrencyChange,
  onProspectsChange,
  onOpenProspectScorecard,
  onPromoteProspect,
  onPrintScorecard,
  onExportAuditJson,
}) => {
  const activeCurrency: CurrencyCode =
    assumptions.currency ?? project.currency ?? 'PHP';
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditCategoryId>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FindingStatus>('all');
  const [findingsSort, setFindingsSort] = useState<'weight' | 'status' | 'category'>('weight');
  const [findingsAsc, setFindingsAsc] = useState(false);
  const [copiedOutreach, setCopiedOutreach] = useState(false);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs: Array<{ id: AuditTabId; label: string }> = [
    { id: 'auto', label: 'Auto audit' },
    { id: 'manual', label: 'Manual footprint' },
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'prospects', label: `Prospects (${prospects.length})` },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + tabs.length) % tabs.length;
    onTabChange(tabs[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  const filteredFindings = useMemo(() => {
    const statusRank: Record<FindingStatus, number> = {
      fail: 0,
      warn: 1,
      unknown: 2,
      pass: 3,
    };
    return scorecard.allFindings
      .filter((f) => (categoryFilter === 'all' ? true : f.category === categoryFilter))
      .filter((f) => (statusFilter === 'all' ? true : f.status === statusFilter))
      .sort((a, b) => {
        let cmp = 0;
        if (findingsSort === 'weight') {
          cmp = a.weight - b.weight;
        } else if (findingsSort === 'status') {
          cmp = statusRank[a.status] - statusRank[b.status];
        } else {
          cmp = a.category.localeCompare(b.category);
        }
        if (cmp === 0) return a.id.localeCompare(b.id);
        return findingsAsc ? cmp : -cmp;
      });
  }, [scorecard.allFindings, categoryFilter, statusFilter, findingsSort, findingsAsc]);

  const toggleFindingsSort = (key: 'weight' | 'status' | 'category') => {
    if (findingsSort === key) {
      setFindingsAsc((p) => !p);
    } else {
      setFindingsSort(key);
      setFindingsAsc(key === 'status');
    }
  };

  const resolvedClientName = useMemo(
    () =>
      deriveClientName({
        explicitClientName: manualFootprint.nap.businessName.trim() || project.clientName,
        ogSiteName: audit?.parsed?.ogSiteName,
        pageTitle: audit?.parsed?.title,
        fallbackUrl: audit?.finalUrl || auditUrl || audit?.requestedUrl,
        defaultLabel: 'Client Visibility Scorecard',
      }),
    [manualFootprint.nap.businessName, project.clientName, audit, auditUrl]
  );

  const isProvisional = scorecard.isProvisional ?? scorecard.dataCompletenessPct < 70;

  const handleCopyOutreach = async () => {
    const text = buildOutreachSummary(
      resolvedClientName,
      audit?.finalUrl || auditUrl || audit?.requestedUrl || '',
      scorecard,
      audit?.auditNotes
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOutreach(true);
      window.setTimeout(() => setCopiedOutreach(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const brandContrast = getContrastTextColor(project.brandColor);
  const categoryLabelMap = useMemo(
    () => new Map(AUDIT_CATEGORIES.map((c) => [c.id, c.label])),
    []
  );

  // Overall score ring geometry
  const ringRadius = 38;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const scorePct = scorecard.overallScore !== null ? scorecard.overallScore : 0;
  const ringDashOffset = ringCircumference * (1 - scorePct / 100);

  return (
    <section
      id="audit"
      className="no-print scroll-mt-20 space-y-6 border-t border-slate-200 pt-10 dark:border-slate-800"
    >
      {/* Section Header + Sub-Tab Navigation */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Evidence &amp; Lead Magnet Engine
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
            Website Audit &amp; Visibility Scorecard
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Deterministic measured checks (HTML, Lighthouse speed, GBP &amp; NAP consistency) ground
            every walkthrough and proposal claim.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Audit workspace tabs"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/75 p-1 dark:bg-slate-900"
        >
          {tabs.map((tab, idx) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                onClick={() => onTabChange(tab.id)}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Card Surface */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {/* TAB 1: AUTO AUDIT */}
        {activeTab === 'auto' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex-1">
                <label
                  htmlFor="audit-url-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Target Website URL
                </label>
                <div className="relative mt-1.5">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="audit-url-input"
                    type="url"
                    value={auditUrl}
                    onChange={(e) => onAuditUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isAuditing && auditUrl.trim()) {
                        e.preventDefault();
                        onRunAudit(auditUrl);
                      }
                    }}
                    placeholder="https://client-website.com"
                    disabled={isAuditing}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onRunAudit(auditUrl)}
                  disabled={isAuditing || !auditUrl.trim()}
                  style={{ backgroundColor: project.brandColor, color: brandContrast }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-95 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isAuditing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{AUDIT_PROGRESS_STEPS[auditStageIndex] || 'Running audit...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>Run audit</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onLoadSampleAudit}
                  disabled={isAuditing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Load sample audit
                </button>
              </div>
            </div>

            {/* Progress Pipeline Indicator */}
            {isAuditing && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Running deterministic checks (sequential Lighthouse queue)
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {AUDIT_PROGRESS_STEPS.map((label, idx) => {
                    const done = idx < auditStageIndex;
                    const active = idx === auditStageIndex;
                    return (
                      <div
                        key={label}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                      >
                        {done ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        ) : active ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-700 dark:text-slate-300" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 text-center text-slate-400">·</span>
                        )}
                        <span
                          className={`truncate ${
                            active || done
                              ? 'font-medium text-slate-900 dark:text-slate-100'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {auditError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{auditError}</span>
              </div>
            )}

            {audit ? (
              <div className="space-y-6">
                {audit.auditNotes && audit.auditNotes.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100">
                    {audit.auditNotes.map((note, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
                        <span>{note.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {audit.fetchError && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      Partial audit recorded ({audit.fetchError}). Unreachable checks were marked{' '}
                      <strong>Unknown</strong> and excluded from your score.
                    </span>
                  </div>
                )}

                {/* Measured Summary Metrics Strip */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      HTTP / Median TTFB
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.httpStatus ?? '—'} ·{' '}
                      {audit.ttfbMs !== null ? `${audit.ttfbMs} ms` : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Mobile Performance
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.speed?.scores.performance ?? 'Unknown'}
                      {audit.speed?.scores.performance !== null && audit.speed?.scores.performance !== undefined
                        ? '/100'
                        : ''}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">LCP / FCP</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.speed?.lcpMs !== null && audit.speed?.lcpMs !== undefined
                        ? `${(audit.speed.lcpMs / 1000).toFixed(1)}s`
                        : '—'}{' '}
                      /{' '}
                      {audit.speed?.fcpMs !== null && audit.speed?.fcpMs !== undefined
                        ? `${(audit.speed.fcpMs / 1000).toFixed(1)}s`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">CLS / TBT</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.speed?.cls !== null && audit.speed?.cls !== undefined
                        ? audit.speed.cls.toFixed(2)
                        : '—'}{' '}
                      /{' '}
                      {audit.speed?.tbtMs !== null && audit.speed?.tbtMs !== undefined
                        ? `${Math.round(audit.speed.tbtMs)}ms`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Page Weight</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.speed?.totalByteWeight !== null &&
                      audit.speed?.totalByteWeight !== undefined
                        ? `${(audit.speed.totalByteWeight / (1024 * 1024)).toFixed(2)} MB`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      SEO / A11y / Best
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {audit.speed?.scores.seo ?? '—'} · {audit.speed?.scores.accessibility ?? '—'} ·{' '}
                      {audit.speed?.scores.bestPractices ?? '—'}
                    </p>
                  </div>
                </div>

                {/* Top 3 Speed Opportunities */}
                {audit.speed && audit.speed.opportunities.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                    <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Top 3 Measured Speed Opportunities
                    </h3>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {audit.speed.opportunities.map((opp) => (
                        <div
                          key={opp.id}
                          className="rounded border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                        >
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {opp.title}
                          </p>
                          <p className="mt-0.5 text-slate-500 tabular-nums dark:text-slate-400">
                            Est. savings: {opp.savingsText}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!audit.speed && audit.speedReason && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    Speed test note: {audit.speedReason}
                  </div>
                )}

                {/* Per-Check Results Stream */}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Automated Check Results ({audit.findings.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => onTabChange('scorecard')}
                      className="text-xs font-semibold underline underline-offset-4 text-slate-800 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
                    >
                      Open Scorecard →
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {audit.findings.map((finding) => {
                      const meta = statusMeta(finding.status);
                      return (
                        <div
                          key={finding.id}
                          className="flex flex-col gap-1 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="mt-0.5">{meta.icon}</span>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">
                                {finding.label}{' '}
                                <span className={`ml-1 font-medium ${meta.cls}`}>
                                  ({meta.label})
                                </span>
                              </p>
                              <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                                {finding.businessImpact}
                              </p>
                            </div>
                          </div>
                          <span className="font-mono text-[11px] text-slate-700 tabular-nums shrink-0 dark:text-slate-300">
                            {finding.evidence}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              !isAuditing && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                  Enter a client website URL and click <strong>Run audit</strong> to measure speed,
                  on-page SEO, and contact links — or click <strong>Load sample audit</strong> to
                  inspect the scorecard offline.
                </div>
              )
            )}
          </div>
        )}

        {/* TAB 2: MANUAL FOOTPRINT */}
        {activeTab === 'manual' && (
          <ManualFootprintForm manual={manualFootprint} onChange={onManualFootprintChange} />
        )}

        {/* TAB 3: SCORECARD */}
        {activeTab === 'scorecard' && (
          <div className="space-y-8">
            {/* One-Page Header + Score Ring */}
            <div className="flex flex-col gap-6 border-b border-slate-200 pb-6 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
              <div className="flex items-center gap-4 min-w-0">
                {project.logoDataUrl ? (
                  <img
                    src={project.logoDataUrl}
                    alt={resolvedClientName}
                    className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
                  />
                ) : (
                  <div
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-base font-bold"
                  >
                    {resolvedClientName.slice(0, 2).toUpperCase() || 'TF'}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="truncate">
                      {audit?.finalUrl || auditUrl || 'Manual & Website Scorecard'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {audit?.auditedAt
                        ? new Date(audit.auditedAt).toLocaleDateString()
                        : new Date().toLocaleDateString()}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700 tabular-nums dark:text-slate-300">
                      Data completeness: {scorecard.dataCompletenessPct}% ({scorecard.knownChecks}/
                      {scorecard.totalChecks})
                    </span>
                  </div>
                  <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    {resolvedClientName}
                  </h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 shrink-0">
                {/* SVG Score Ring + Grade */}
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="relative h-20 w-20 shrink-0">
                    <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
                      <circle
                        cx="48"
                        cy="48"
                        r={ringRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        className="text-slate-200 dark:text-slate-800"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r={ringRadius}
                        fill="none"
                        stroke={ragBarBg(scorecard.rag)}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringDashOffset}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
                      <span className="text-lg font-bold leading-none text-slate-900 dark:text-slate-100">
                        {scorecard.overallScore !== null ? scorecard.overallScore : '—'}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">/ 100</span>
                    </div>
                  </div>
                  <div className="tabular-nums">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Overall Grade</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-slate-100">
                        {scorecard.grade}
                      </p>
                      {isProvisional && (
                        <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          Provisional
                        </span>
                      )}
                    </div>
                    <p className={`text-xs font-semibold ${ragTextColor(scorecard.rag)}`}>
                      {getRagLabel(scorecard.rag)}
                    </p>
                    {isProvisional && (
                      <p className="mt-0.5 max-w-[190px] text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                        Add Google Business Profile data for a final grade.
                      </p>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onPrintScorecard}
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-95 whitespace-nowrap shrink-0"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print scorecard</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyOutreach()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedOutreach ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Outreach copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy outreach summary</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onExportAuditJson}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export audit JSON</span>
                  </button>
                </div>
              </div>
            </div>

            {audit?.auditNotes && audit.auditNotes.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100">
                {audit.auditNotes.map((note, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
                    <span>{note.message}</span>
                  </div>
                ))}
              </div>
            )}

            {isProvisional && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  Data completeness is {scorecard.dataCompletenessPct}% (Provisional). Add Google
                  Business Profile data for a final grade. Categories with under 50% measured checks
                  are excluded and weights are renormalized.
                </span>
              </div>
            )}

            {/* Five Category Bars */}
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Category Scores (Weights sum to 100%)
              </h4>
              <div className="mt-3 space-y-2.5">
                {scorecard.categories.map((cat) => {
                  const isInsufficient = Boolean(cat.insufficientData || cat.score === null);
                  return (
                    <div
                      key={cat.id}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-12 sm:items-center dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="sm:col-span-5">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {cat.label}
                        </p>
                        <p className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          Base weight {cat.baseWeight}%
                          {isInsufficient
                            ? ' · Excluded (<50% measured)'
                            : cat.effectiveWeight !== cat.baseWeight && cat.effectiveWeight > 0
                            ? ` · Effective ${cat.effectiveWeight}%`
                            : ''}{' '}
                          · {cat.knownCount}/{cat.totalCount} measured
                        </p>
                      </div>
                      <div className="sm:col-span-4">
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          {!isInsufficient && cat.score !== null && (
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${cat.score}%`,
                                backgroundColor: ragBarBg(cat.rag),
                              }}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:col-span-3 sm:justify-end sm:gap-2 tabular-nums">
                        {isInsufficient ? (
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            Insufficient data
                          </span>
                        ) : (
                          <>
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {cat.score}/100
                            </span>
                            <span className={`text-xs font-semibold ${ragTextColor(cat.rag)}`}>
                              {getRagLabel(cat.rag)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top 5 Fix First + Ignored Leads Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Fix First Top 5 */}
              <div className="lg:col-span-7">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Fix First (Top 5 Priorities)
                </h4>
                <div className="mt-3 space-y-2.5">
                  {scorecard.fixFirst.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      No failing or warning findings right now.
                    </div>
                  ) : (
                    scorecard.fixFirst.map((item, idx) => {
                      const meta = statusMeta(item.status);
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold text-slate-500 tabular-nums">
                                0{idx + 1}
                              </span>
                              {meta.icon}
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {item.label}
                              </p>
                            </div>
                            <span className="text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
                              {meta.label} · Weight {item.weight}/5
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-300">
                            Evidence: {item.evidence}
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                            {item.businessImpact}
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200">
                            Fix: {item.fix}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Transparent Ignored-Leads Estimate */}
              <div className="lg:col-span-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      &ldquo;Ignored Leads&rdquo; Assumptions
                    </h4>
                    <div className="flex items-center gap-2.5">
                      <select
                        value={activeCurrency}
                        onChange={(e) => {
                          const next = e.target.value as CurrencyCode;
                          if (onCurrencyChange) {
                            onCurrencyChange(next);
                          } else {
                            onAssumptionsChange({ ...assumptions, currency: next });
                          }
                        }}
                        aria-label="Select currency"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => (
                          <option key={code} value={code}>
                            {CURRENCY_CONFIG[code].label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          onAssumptionsChange({ ...assumptions, monthlyVisitors: null })
                        }
                        className="text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      >
                        I don&apos;t know visitors
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Monthly Website Visitors
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={assumptions.monthlyVisitors ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onAssumptionsChange({
                            ...assumptions,
                            monthlyVisitors: raw === '' ? null : Math.max(0, Number(raw) || 0),
                          });
                        }}
                        placeholder="Leave blank if unknown"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Inquiry Rate (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={assumptions.inquiryRatePct}
                        onChange={(e) =>
                          onAssumptionsChange({
                            ...assumptions,
                            inquiryRatePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Avg Booking Value ({activeCurrency})
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={assumptions.avgBookingValuePhp ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onAssumptionsChange({
                            ...assumptions,
                            avgBookingValuePhp:
                              raw === '' ? null : Math.max(0, Number(raw) || 0),
                          });
                        }}
                        placeholder="Optional"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Loss % Slow Load (Auto:{' '}
                        {scorecard.ignoredLeads.breakdownPct.slowLoad}%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={assumptions.slowLoadLossPct ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onAssumptionsChange({
                            ...assumptions,
                            slowLoadLossPct: raw === '' ? null : Math.max(0, Math.min(100, Number(raw) || 0)),
                          });
                        }}
                        placeholder={`Auto (${scorecard.ignoredLeads.breakdownPct.slowLoad}%)`}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Loss % Missing Chat/Call (Auto:{' '}
                        {scorecard.ignoredLeads.breakdownPct.missingContact}%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={assumptions.missingContactLossPct ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onAssumptionsChange({
                            ...assumptions,
                            missingContactLossPct:
                              raw === '' ? null : Math.max(0, Math.min(100, Number(raw) || 0)),
                          });
                        }}
                        placeholder={`Auto (${scorecard.ignoredLeads.breakdownPct.missingContact}%)`}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Loss % Low Review Trust (Auto:{' '}
                        {scorecard.ignoredLeads.breakdownPct.lowReviewTrust}%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={assumptions.lowReviewTrustLossPct ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onAssumptionsChange({
                            ...assumptions,
                            lowReviewTrustLossPct:
                              raw === '' ? null : Math.max(0, Math.min(100, Number(raw) || 0)),
                          });
                        }}
                        placeholder={`Auto (${scorecard.ignoredLeads.breakdownPct.lowReviewTrust}%)`}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {/* Estimate Display (Hidden entirely if monthlyVisitors unknown) */}
                  {scorecard.ignoredLeads.visible ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Estimated Monthly Range Lost ({scorecard.ignoredLeads.effectiveLossPct}%
                        combined friction)
                      </p>
                      <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {scorecard.ignoredLeads.inquiriesLostLow} –{' '}
                        {scorecard.ignoredLeads.inquiriesLostHigh} inquiries / mo
                      </p>
                      {scorecard.ignoredLeads.revenueLostPhpLow !== null &&
                        scorecard.ignoredLeads.revenueLostPhpHigh !== null && (
                          <p className="mt-0.5 text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-300">
                            {activeCurrency} {scorecard.ignoredLeads.revenueLostPhpLow.toLocaleString()} –{' '}
                            {scorecard.ignoredLeads.revenueLostPhpHigh.toLocaleString()} / mo
                          </p>
                        )}
                      <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {scorecard.ignoredLeads.disclaimer}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Estimate hidden until monthly website visitors is entered.{' '}
                      {scorecard.ignoredLeads.disclaimer}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Full Findings Table */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  All Audit Findings ({filteredFindings.length} of {scorecard.allFindings.length})
                </h4>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as 'all' | AuditCategoryId)
                    }
                    aria-label="Filter findings by category"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <option value="all">All categories</option>
                    {AUDIT_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'all' | FindingStatus)
                    }
                    aria-label="Filter findings by status"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <option value="all">All statuses</option>
                    <option value="fail">Fail</option>
                    <option value="warn">Warn</option>
                    <option value="pass">Pass</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Check &amp; Impact</th>
                      <th className="px-3.5 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => toggleFindingsSort('category')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Category</span>
                          <ArrowDownUp className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => toggleFindingsSort('status')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Status</span>
                          <ArrowDownUp className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold">Evidence</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">
                        <button
                          type="button"
                          onClick={() => toggleFindingsSort('weight')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Weight</span>
                          <ArrowDownUp className="h-3 w-3" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredFindings.map((f: AuditFinding) => {
                      const meta = statusMeta(f.status);
                      return (
                        <tr
                          key={f.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-950/60"
                        >
                          <td className="px-3.5 py-2.5 max-w-[300px]">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {f.label}
                            </p>
                            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                              {f.businessImpact}
                            </p>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">
                            {categoryLabelMap.get(f.category) || f.category}
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 font-semibold ${meta.cls}`}>
                              {meta.icon}
                              <span>{meta.label}</span>
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                            {f.evidence}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                            {f.weight}/5
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PROSPECTS */}
        {activeTab === 'prospects' && (
          <ProspectsPanel
            prospects={prospects}
            captureUrl={captureUrl}
            captureToken={captureToken}
            onProspectsChange={onProspectsChange}
            onOpenScorecard={onOpenProspectScorecard}
            onPromoteToProject={onPromoteProspect}
          />
        )}
      </div>
    </section>
  );
};
