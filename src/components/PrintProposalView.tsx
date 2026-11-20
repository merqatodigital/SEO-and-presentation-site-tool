import React from 'react';
import { deriveClientName } from '../audit/htmlFindings';
import { AuditResult, Scorecard } from '../audit/types';
import {
  AISearchLayerData,
  FootprintNode,
  PricingTier,
  ProjectBrief,
  ScreenshotAsset,
  WalkthroughData,
  getContrastTextColor,
} from '../types/tour';
import { PrintScorecardView } from './PrintScorecardView';

interface PrintProposalViewProps {
  project: ProjectBrief;
  walkthrough: WalkthroughData | null;
  screenshots: ScreenshotAsset[];
  footprint: FootprintNode[];
  pricingTiers: PricingTier[];
  aiSearchLayer: AISearchLayerData;
  audit: AuditResult | null;
  scorecard: Scorecard;
  auditedUrl: string;
  printMode: 'scorecard' | 'proposal';
}

export const PrintProposalView: React.FC<PrintProposalViewProps> = ({
  project,
  walkthrough,
  screenshots,
  footprint,
  pricingTiers,
  aiSearchLayer,
  audit,
  scorecard,
  auditedUrl,
  printMode,
}) => {
  const brandContrast = getContrastTextColor(project.brandColor);
  const showScorecardFirstPage = Boolean(audit || scorecard.knownChecks > 0);
  const printClientName = deriveClientName({
    explicitClientName: project.clientName,
    ogSiteName: audit?.parsed?.ogSiteName,
    pageTitle: audit?.parsed?.title,
    fallbackUrl: audit?.finalUrl || auditedUrl || audit?.requestedUrl,
    defaultLabel: 'Client',
  });

  return (
    <div
      className={`hidden print-only bg-white text-slate-900 ${
        printMode === 'scorecard' ? 'print-scorecard-only' : ''
      }`}
    >
      {/* Page 1: Dedicated One-Page Audit Scorecard */}
      {showScorecardFirstPage && (
        <PrintScorecardView
          project={project}
          audit={audit}
          scorecard={scorecard}
          auditedUrl={auditedUrl}
        />
      )}

      {/* Proposal Pages (hidden automatically when printing Scorecard Only) */}
      {walkthrough && (
        <div className="print-proposal-body">
          {/* Header Banner */}
          <div className="border-b-2 pb-5" style={{ borderColor: project.brandColor }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {project.logoDataUrl ? (
                  <img
                    src={project.logoDataUrl}
                    alt={printClientName}
                    className="h-12 w-12 rounded-lg border border-slate-200 object-contain p-1"
                  />
                ) : (
                  <div
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="flex h-12 w-12 items-center justify-center rounded-lg text-base font-bold"
                  >
                    {printClientName.slice(0, 2).toUpperCase() || 'TF'}
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {printClientName} · {project.businessType}
                  </p>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    {walkthrough.title}
                  </h1>
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-semibold text-slate-800">Digital Growth Proposal</p>
                <p>Prepared with TourForge Lite</p>
              </div>
            </div>
          </div>

          {/* Walkthrough Storyboard */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-slate-900">Guided Website Walkthrough</h2>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {walkthrough.scenes.map((scene, idx) => {
                const shot =
                  screenshots[
                    Math.min(
                      Math.max(0, scene.screenshotIndex),
                      Math.max(0, screenshots.length - 1)
                    )
                  ];
                return (
                  <div
                    key={idx}
                    className="print-avoid-break overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    {shot && (
                      <div className="relative aspect-[16/10] w-full bg-slate-100">
                        <img
                          src={shot.dataUrl}
                          alt={scene.caption}
                          className="h-full w-full object-contain"
                        />
                        <div
                          style={{
                            left: `${scene.highlight.x}%`,
                            top: `${scene.highlight.y}%`,
                            width: `${scene.highlight.w}%`,
                            height: `${scene.highlight.h}%`,
                            borderColor: project.brandColor,
                          }}
                          className="absolute rounded border-2"
                        />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-xs font-semibold text-slate-500">
                        Scene {idx + 1}
                        {scene.findingRefs && scene.findingRefs.length > 0
                          ? ` · Evidence: ${scene.findingRefs.join(', ')}`
                          : ''}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{scene.caption}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        {scene.narration}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outcomes */}
          <div className="mt-7 print-avoid-break">
            <h2 className="text-lg font-semibold text-slate-900">What You Get</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {walkthrough.outcomes.map((outcome, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-sm font-semibold text-slate-900">{outcome.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    {outcome.description}
                  </p>
                  {outcome.evidence && (
                    <p className="mt-1.5 border-t border-slate-100 pt-1 text-[11px] font-medium text-slate-500">
                      Evidence: {outcome.evidence}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Digital Footprint */}
          <div className="mt-7 print-avoid-break">
            <h2 className="text-lg font-semibold text-slate-900">
              Connected Digital Footprint — {printClientName}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {footprint.map((node) => (
                <div key={node.id} className="rounded-lg border border-slate-200 p-3.5">
                  <p className="text-sm font-semibold text-slate-900">{node.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{node.summary}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Structured Business Data Summary */}
          {aiSearchLayer.enabled && (
            <div className="mt-7 print-avoid-break">
              <h2 className="text-lg font-semibold text-slate-900">
                Structured Business Data &amp; Verified Q&amp;As
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Verified Schema JSON-LD facts so search engines and AI assistants quote accurate
                offerings, direct booking links, and answers.
              </p>
              <div className="mt-3 rounded-lg border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1.5">
                <p>
                  <strong>Service Area:</strong> {aiSearchLayer.serviceArea} ·{' '}
                  <strong>Website:</strong> {aiSearchLayer.websiteUrl}
                </p>
                <p>
                  <strong>Primary Offer:</strong> {aiSearchLayer.primaryOffer}
                </p>
                <p>
                  <strong>Key Differentiator:</strong> {aiSearchLayer.keyDifferentiator} ·{' '}
                  <strong>Action:</strong> {aiSearchLayer.contactInfo}
                </p>
              </div>
              {aiSearchLayer.faqs.length > 0 && (
                <div className="mt-2.5 grid grid-cols-1 gap-2">
                  {aiSearchLayer.faqs.map((qa, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                      <p className="font-semibold text-slate-900">{qa.question}</p>
                      <p className="mt-0.5 text-slate-600">{qa.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 2027 Roadmap */}
          <div className="mt-7 print-avoid-break">
            <h2 className="text-lg font-semibold text-slate-900">2027 Roadmap</h2>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {walkthrough.roadmap.map((q) => (
                <div key={q.quarter} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-900">{q.quarter} 2027</p>
                  <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                    {q.items.map((item, idx) => (
                      <li key={idx}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing Tiers */}
          <div className="mt-7 print-avoid-break">
            <h2 className="text-lg font-semibold text-slate-900">Investment Options</h2>
            <div
              className={`mt-3 grid gap-3 ${pricingTiers.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
            >
              {pricingTiers.map((tier) => (
                <div
                  key={tier.id}
                  style={tier.recommended ? { borderColor: project.brandColor } : undefined}
                  className={`rounded-lg border p-4 ${tier.recommended ? 'border-2' : 'border-slate-200'}`}
                >
                  <p className="text-sm font-bold text-slate-900">{tier.name}</p>
                  <p className="text-xs text-slate-500">{tier.audience}</p>
                  <div className="mt-3 flex items-baseline justify-between border-y border-slate-200 py-2 text-xs">
                    <span>
                      Setup: <strong className="text-sm text-slate-900">{tier.setupPrice}</strong>
                    </span>
                    <span>
                      Monthly:{' '}
                      <strong className="text-sm text-slate-900">{tier.monthlyPrice}</strong>
                    </span>
                  </div>
                  <ul className="mt-2.5 space-y-1 text-xs text-slate-700">
                    {tier.features.map((feat, fIdx) => (
                      <li key={fIdx}>✓ {feat}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
