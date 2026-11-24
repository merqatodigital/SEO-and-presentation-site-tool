import React from 'react';
import { buildAiReadinessSummary } from '../audit/aiReadiness';
import { deriveClientName } from '../audit/htmlFindings';
import { getRagLabel } from '../audit/scorecard';
import { AuditResult, Scorecard } from '../audit/types';
import { ProjectBrief, getContrastTextColor } from '../types/tour';

interface PrintScorecardViewProps {
  project: ProjectBrief;
  audit: AuditResult | null;
  scorecard: Scorecard;
  auditedUrl: string;
}

function getRagBarColor(rag: Scorecard['rag']): string {
  if (rag === 'green') return '#16A34A';
  if (rag === 'amber') return '#D97706';
  if (rag === 'red') return '#DC2626';
  return '#64748B';
}

export const PrintScorecardView: React.FC<PrintScorecardViewProps> = ({
  project,
  audit,
  scorecard,
  auditedUrl,
}) => {
  const brandContrast = getContrastTextColor(project.brandColor);
  const clientTitle = deriveClientName({
    explicitClientName: project.clientName,
    ogSiteName: audit?.parsed?.ogSiteName,
    pageTitle: audit?.parsed?.title,
    fallbackUrl: audit?.finalUrl || auditedUrl || audit?.requestedUrl,
    defaultLabel: 'Website Audit Prospect',
  });
  const isProvisional = scorecard.isProvisional ?? scorecard.dataCompletenessPct < 70;
  const aiSummary = buildAiReadinessSummary(audit);
  const displayUrl = audit?.finalUrl || auditedUrl || audit?.requestedUrl || 'Manual & Website Audit';
  const auditDate = audit?.auditedAt
    ? new Date(audit.auditedAt).toLocaleDateString()
    : new Date().toLocaleDateString();

  return (
    <section
      aria-label="Printable one-page audit scorecard"
      className="print-scorecard-page bg-white text-slate-900"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-4 border-b-2 pb-3"
        style={{ borderColor: project.brandColor }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {project.logoDataUrl ? (
            <img
              src={project.logoDataUrl}
              alt={clientTitle}
              className="h-10 w-10 shrink-0 rounded-md border border-slate-200 object-contain p-0.5"
            />
          ) : (
            <div
              style={{ backgroundColor: project.brandColor, color: brandContrast }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold"
            >
              {clientTitle.slice(0, 2).toUpperCase() || 'TF'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">
              Digital Visibility Scorecard · {auditDate}
            </p>
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
              {clientTitle}
            </h1>
            <p className="truncate text-[11px] text-slate-600">{displayUrl}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 rounded-lg border border-slate-200 px-3.5 py-2">
          <div className="text-right tabular-nums">
            <p className="text-[10px] font-medium text-slate-500">Overall Score</p>
            <p className="text-2xl font-bold leading-none text-slate-900">
              {scorecard.overallScore !== null ? scorecard.overallScore : '—'}
              <span className="text-xs font-normal text-slate-500">/100</span>
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-slate-600">
              Completeness: {scorecard.dataCompletenessPct}% ({scorecard.knownChecks}/
              {scorecard.totalChecks})
            </p>
            {isProvisional && (
              <p className="mt-0.5 text-[9px] font-medium text-amber-800">
                Add Google Business Profile data for a final grade.
              </p>
            )}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              style={{ backgroundColor: getRagBarColor(scorecard.rag) }}
              className="flex h-11 w-11 flex-col items-center justify-center rounded-md text-white"
            >
              <span className="text-base font-bold leading-none">{scorecard.grade}</span>
              <span className="mt-0.5 text-[9px] font-medium">
                {scorecard.rag === 'green'
                  ? 'Green'
                  : scorecard.rag === 'amber'
                  ? 'Amber'
                  : scorecard.rag === 'red'
                  ? 'Red'
                  : 'N/A'}
              </span>
            </div>
            {isProvisional && (
              <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-900">
                Provisional
              </span>
            )}
          </div>
        </div>
      </div>

      {audit?.auditNotes && audit.auditNotes.length > 0 && (
        <div className="mt-2.5 space-y-0.5 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-700">
          {audit.auditNotes.map((note, idx) => (
            <p key={idx}>Note: {note.message}</p>
          ))}
        </div>
      )}

      {/* Category Bars */}
      <div className="mt-3.5">
        <h2 className="text-xs font-bold tracking-wide text-slate-800">
          Category Breakdown (Weights total 100%)
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {scorecard.categories.map((cat) => {
            const isInsufficient = Boolean(cat.insufficientData || cat.score === null);
            return (
              <div
                key={cat.id}
                className="grid grid-cols-12 items-center gap-2 rounded border border-slate-200 px-2.5 py-1.5 text-[11px]"
              >
                <div className="col-span-5 min-w-0">
                  <span className="font-semibold text-slate-900">{cat.label}</span>
                  <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">
                    ({cat.baseWeight}% weight
                    {isInsufficient ? ' · excluded' : ''})
                  </span>
                </div>
                <div className="col-span-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    {!isInsufficient && cat.score !== null && (
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${cat.score}%`,
                          backgroundColor: getRagBarColor(cat.rag),
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="col-span-3 text-right tabular-nums">
                  {isInsufficient ? (
                    <span className="text-[10px] font-semibold text-slate-500">
                      Insufficient data
                    </span>
                  ) : (
                    <>
                      <span className="font-bold text-slate-900">{cat.score}/100</span>
                      <span className="ml-1.5 text-[10px] font-medium text-slate-600">
                        · {getRagLabel(cat.rag)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fix First Top 5 */}
      <div className="mt-3.5">
        <h2 className="text-xs font-bold tracking-wide text-slate-800">
          Fix First (Top 5 Highest-Impact Priorities)
        </h2>
        <div className="mt-2 space-y-1.5">
          {scorecard.fixFirst.length === 0 ? (
            <p className="rounded border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              No failing or warning checks recorded yet.
            </p>
          ) : (
            scorecard.fixFirst.map((item, idx) => (
              <div
                key={item.id}
                className="rounded border border-slate-200 px-3 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">
                    {idx + 1}. {item.label}{' '}
                    <span className="font-normal text-slate-500">
                      [{item.status.toUpperCase()} · Weight {item.weight}/5]
                    </span>
                  </p>
                  <span className="font-mono text-[10px] text-slate-700 tabular-nums shrink-0">
                    {item.evidence}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
                  {item.businessImpact} Fix: {item.fix}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Measured Speed Metrics + Ignored Leads Estimate (2 columns compact footer) */}
      <div className="mt-3.5 grid grid-cols-2 gap-3">
        <div className="rounded border border-slate-200 p-2.5 text-[10px]">
          <p className="font-bold text-slate-900">Measured Website Speed &amp; Technical</p>
          {audit?.speed ? (
            <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 tabular-nums text-slate-700">
              <span>Perf: {audit.speed.scores.performance ?? '—'}/100</span>
              <span>SEO: {audit.speed.scores.seo ?? '—'}/100</span>
              <span>
                TTFB: {audit.ttfbMs !== null ? `${audit.ttfbMs} ms` : '—'}
              </span>
              <span>
                LCP:{' '}
                {audit.speed.lcpMs !== null ? `${(audit.speed.lcpMs / 1000).toFixed(1)}s` : '—'}
              </span>
              <span>
                CLS: {audit.speed.cls !== null ? audit.speed.cls.toFixed(2) : '—'}
              </span>
              <span>
                Weight:{' '}
                {audit.speed.totalByteWeight !== null
                  ? `${(audit.speed.totalByteWeight / (1024 * 1024)).toFixed(2)} MB`
                  : '—'}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-slate-600">
              {audit?.speedReason || 'Speed test not run yet.'}
              {audit?.ttfbMs !== null && audit?.ttfbMs !== undefined
                ? ` · Median TTFB: ${audit.ttfbMs} ms`
                : ''}
            </p>
          )}
          {aiSummary.score !== null && (
            <p className="mt-1 border-t border-slate-100 pt-1 text-[9px] font-medium text-slate-600 tabular-nums">
              AI Search Readiness: {aiSummary.score}/100 ({aiSummary.allowedBotsCount}/{aiSummary.totalBotsCount} bots · {aiSummary.entityFieldsPresent}/8 schema)
            </p>
          )}
          {audit?.security && (
            <p className="mt-1 border-t border-slate-100 pt-1 text-[9px] font-medium text-slate-600 tabular-nums">
              Passive Security:{' '}
              {scorecard.securityScore &&
              !scorecard.securityScore.insufficientData &&
              scorecard.securityScore.score !== null
                ? `${scorecard.securityScore.score}/100`
                : 'Insufficient data'}{' '}
              · {audit.security.highSeverityCount} high-severity ·{' '}
              {audit.security.tls.isHttps ? 'HTTPS' : 'HTTP'}
              {audit.security.tls.hstsEnabled ? ' + HSTS' : ''}
              {audit.security.badgeEligible ? ' · Security Passed badge eligible' : ''}
            </p>
          )}
        </div>

        <div className="rounded border border-slate-200 p-2.5 text-[10px]">
          <p className="font-bold text-slate-900">Monthly Missed Inquiries Estimate</p>
          {scorecard.ignoredLeads.visible ? (
            <div className="mt-1 space-y-0.5 tabular-nums text-slate-700">
              <p>
                Est. inquiries lost/mo:{' '}
                <strong className="text-slate-900">
                  {scorecard.ignoredLeads.inquiriesLostLow}–
                  {scorecard.ignoredLeads.inquiriesLostHigh}
                </strong>
                {scorecard.ignoredLeads.revenueLostPhpLow !== null &&
                  scorecard.ignoredLeads.revenueLostPhpHigh !== null && (
                    <>
                      {' '}
                      · Est. revenue:{' '}
                      <strong className="text-slate-900">
                        {scorecard.ignoredLeads.currency ?? project.currency ?? 'PHP'}{' '}
                        {scorecard.ignoredLeads.revenueLostPhpLow.toLocaleString()}–
                        {scorecard.ignoredLeads.revenueLostPhpHigh.toLocaleString()}
                      </strong>
                    </>
                  )}
              </p>
              <p className="text-[9px] text-slate-500">{scorecard.ignoredLeads.disclaimer}</p>
            </div>
          ) : (
            <p className="mt-1 text-slate-600">
              Hidden (monthly website visitors marked unknown). {scorecard.ignoredLeads.disclaimer}
            </p>
          )}
        </div>
      </div>

      <p className="mt-2.5 text-center text-[9px] text-slate-500">
        Generated by TourForge Lite · Measured HTML, speed &amp; directory consistency audit · All unknown items excluded from score
      </p>
    </section>
  );
};
