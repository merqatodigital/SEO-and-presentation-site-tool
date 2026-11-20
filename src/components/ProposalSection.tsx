import React, { useState } from 'react';
import {
  Bot,
  Calendar,
  Check,
  Copy,
  Download,
  Globe,
  Plus,
  Printer,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { buildValidatedJsonLd } from '../audit/jsonLd';
import { AuditResult, ManualFootprint } from '../audit/types';
import {
  AISearchLayerData,
  CURRENCY_CONFIG,
  CurrencyCode,
  FootprintNode,
  PricingTier,
  ProjectBrief,
  ProposalOutcome,
  RoadmapQuarterPlan,
  WalkthroughData,
  buildLlmsTxt,
  getAddedPricingTierDefaults,
  getContrastTextColor,
} from '../types/tour';

interface ProposalSectionProps {
  project: ProjectBrief;
  walkthrough: WalkthroughData;
  footprint: FootprintNode[];
  pricingTiers: PricingTier[];
  currency: CurrencyCode;
  aiSearchLayer: AISearchLayerData;
  audit: AuditResult | null;
  manualFootprint: ManualFootprint;
  onTitleChange: (title: string) => void;
  onOutcomesChange: (outcomes: ProposalOutcome[]) => void;
  onRoadmapChange: (roadmap: RoadmapQuarterPlan[]) => void;
  onFootprintChange: (footprint: FootprintNode[]) => void;
  onPricingChange: (tiers: PricingTier[]) => void;
  onCurrencyChange: (currency: CurrencyCode) => void;
  onAISearchLayerChange: (next: AISearchLayerData) => void;
  onResetAISearchLayer: () => void;
  onExportJson: () => void;
  onPrintPdf: () => void;
}

const NODE_ICONS: Record<FootprintNode['id'], React.ReactNode> = {
  website: <Globe className="h-4 w-4" />,
  'ai-agent': <Bot className="h-4 w-4" />,
  automations: <Workflow className="h-4 w-4" />,
  social: <Share2 className="h-4 w-4" />,
};

export const ProposalSection: React.FC<ProposalSectionProps> = ({
  project,
  walkthrough,
  footprint,
  pricingTiers,
  currency,
  aiSearchLayer,
  audit,
  manualFootprint,
  onTitleChange,
  onOutcomesChange,
  onRoadmapChange,
  onFootprintChange,
  onPricingChange,
  onCurrencyChange,
  onAISearchLayerChange,
  onResetAISearchLayer,
  onExportJson,
  onPrintPdf,
}) => {
  const [artifactTab, setArtifactTab] = useState<'jsonld' | 'llms'>('jsonld');
  const [copiedArtifact, setCopiedArtifact] = useState(false);

  const brandContrast = getContrastTextColor(project.brandColor);

  const llmsTxtContent = buildLlmsTxt(project, aiSearchLayer, walkthrough);
  const jsonLdResult = buildValidatedJsonLd(project, aiSearchLayer, audit, manualFootprint);
  const activeArtifactText =
    artifactTab === 'jsonld' ? jsonLdResult.scriptTag : llmsTxtContent;
  const canExportArtifact = artifactTab === 'llms' || jsonLdResult.valid;

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
    const filename = artifactTab === 'jsonld' ? 'structured-data-schema.html' : 'llms.txt';
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

  const updateOutcome = (index: number, patch: Partial<ProposalOutcome>) => {
    const next = walkthrough.outcomes.map((item, idx) =>
      idx === index ? { ...item, ...patch } : item
    );
    onOutcomesChange(next);
  };

  const addOutcome = () => {
    onOutcomesChange([
      ...walkthrough.outcomes,
      {
        title: 'Clearer Customer Path',
        description: 'Make it effortless for visitors to take the next step from any page.',
      },
    ]);
  };

  const removeOutcome = (index: number) => {
    if (walkthrough.outcomes.length <= 1) return;
    onOutcomesChange(walkthrough.outcomes.filter((_, idx) => idx !== index));
  };

  const updateRoadmapItem = (qIdx: number, itemIdx: number, value: string) => {
    const next = walkthrough.roadmap.map((q, idx) => {
      if (idx !== qIdx) return q;
      const items = q.items.map((it, i) => (i === itemIdx ? value : it));
      return { ...q, items };
    });
    onRoadmapChange(next);
  };

  const addRoadmapItem = (qIdx: number) => {
    const next = walkthrough.roadmap.map((q, idx) =>
      idx === qIdx ? { ...q, items: [...q.items, 'New quarterly milestone'] } : q
    );
    onRoadmapChange(next);
  };

  const removeRoadmapItem = (qIdx: number, itemIdx: number) => {
    const next = walkthrough.roadmap.map((q, idx) => {
      if (idx !== qIdx || q.items.length <= 1) return q;
      return { ...q, items: q.items.filter((_, i) => i !== itemIdx) };
    });
    onRoadmapChange(next);
  };

  const updateFootprintNode = (id: FootprintNode['id'], summary: string) => {
    onFootprintChange(
      footprint.map((node) => (node.id === id ? { ...node, summary } : node))
    );
  };

  const updateTier = (tierId: string, patch: Partial<PricingTier>) => {
    onPricingChange(
      pricingTiers.map((tier) => (tier.id === tierId ? { ...tier, ...patch } : tier))
    );
  };

  const updateTierFeature = (tierId: string, featIdx: number, value: string) => {
    onPricingChange(
      pricingTiers.map((tier) => {
        if (tier.id !== tierId) return tier;
        return {
          ...tier,
          features: tier.features.map((f, i) => (i === featIdx ? value : f)),
        };
      })
    );
  };

  const addTierFeature = (tierId: string) => {
    onPricingChange(
      pricingTiers.map((tier) =>
        tier.id === tierId
          ? { ...tier, features: [...tier.features, 'Included deliverable'] }
          : tier
      )
    );
  };

  const removeTierFeature = (tierId: string, featIdx: number) => {
    onPricingChange(
      pricingTiers.map((tier) => {
        if (tier.id !== tierId || tier.features.length <= 1) return tier;
        return { ...tier, features: tier.features.filter((_, i) => i !== featIdx) };
      })
    );
  };

  const addPricingTier = () => {
    if (pricingTiers.length >= 3) return;
    const defaults = getAddedPricingTierDefaults(currency);
    onPricingChange([
      ...pricingTiers,
      {
        id: `tier-${Date.now()}`,
        name: 'Complete Digital Suite',
        audience: 'For established teams scaling regional reach',
        setupPrice: defaults.setupPrice,
        monthlyPrice: defaults.monthlyPrice,
        recommended: false,
        features: [
          'Full website & direct booking experience',
          '24/7 customer inquiry assistant',
          'Automated follow-ups & social cadence',
        ],
      },
    ]);
  };

  const removePricingTier = (tierId: string) => {
    if (pricingTiers.length <= 2) return;
    onPricingChange(pricingTiers.filter((t) => t.id !== tierId));
  };

  const getNode = (id: FootprintNode['id']) =>
    footprint.find((n) => n.id === id) || footprint[0];

  return (
    <section id="proposal" className="no-print scroll-mt-20 space-y-12 border-t border-slate-200 pt-12 dark:border-slate-800">
      {/* Branded Proposal Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              {project.logoDataUrl ? (
                <img
                  src={project.logoDataUrl}
                  alt={`${project.clientName} logo`}
                  className="h-10 w-10 rounded-lg border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
                />
              ) : (
                <div
                  style={{ backgroundColor: project.brandColor, color: brandContrast }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold"
                >
                  {project.clientName.trim().slice(0, 2).toUpperCase() || 'TF'}
                </div>
              )}
              <div className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {project.clientName}
                </span>
                <span className="mx-2" aria-hidden="true">·</span>
                <span>{project.businessType}</span>
                <span className="mx-2" aria-hidden="true">·</span>
                <span>2027 Digital Proposal</span>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="proposal-title" className="sr-only">
                Proposal Title
              </label>
              <input
                id="proposal-title"
                type="text"
                value={walkthrough.title}
                onChange={(e) => onTitleChange(e.target.value)}
                className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-semibold tracking-tight text-slate-900 transition-colors hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950 sm:text-3xl"
              />
              <p className="mt-1 px-1 text-xs text-slate-500 dark:text-slate-400">
                Every heading, outcome, milestone, and price below can be edited inline before exporting.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onExportJson}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              Export as JSON
            </button>
            <button
              type="button"
              onClick={onPrintPdf}
              style={{ backgroundColor: project.brandColor, color: brandContrast }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-95 whitespace-nowrap shrink-0"
            >
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </button>
          </div>
        </div>
      </div>

      {/* 1. What You Get Outcome Cards */}
      <div>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
              Business Outcomes
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              What you get
            </h3>
          </div>
          <button
            type="button"
            onClick={addOutcome}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add outcome
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {walkthrough.outcomes.map((outcome, idx) => (
            <div
              key={idx}
              className="group relative rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  style={{ color: project.brandColor }}
                  className="text-xs font-semibold tabular-nums"
                >
                  0{idx + 1}
                </span>
                {walkthrough.outcomes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeOutcome(idx)}
                    aria-label={`Remove outcome ${idx + 1}`}
                    className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-rose-950 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <input
                type="text"
                value={outcome.title}
                onChange={(e) => updateOutcome(idx, { title: e.target.value })}
                aria-label={`Outcome ${idx + 1} title`}
                className="mt-2 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
              />
              <textarea
                rows={2}
                value={outcome.description}
                onChange={(e) => updateOutcome(idx, { description: e.target.value })}
                aria-label={`Outcome ${idx + 1} description`}
                className="mt-1.5 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-relaxed text-slate-600 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-400 dark:hover:border-slate-700 dark:focus:bg-slate-950"
              />
              {outcome.evidence && (
                <p className="mt-2 border-t border-slate-100 px-1 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Evidence (read-only):
                  </span>{' '}
                  {outcome.evidence}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 2. Simple Footprint Diagram */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 max-w-2xl">
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Connected System
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Your digital footprint around {project.clientName}
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Every channel points back to your business so customers book directly and stay engaged.
          </p>
        </div>

        {/* Desktop Hub & Spoke Diagram */}
        <div className="relative mx-auto max-w-4xl py-4">
          <svg
            className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
            viewBox="0 0 800 420"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1="400"
              y1="210"
              x2="180"
              y2="95"
              stroke={project.brandColor}
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
            <line
              x1="400"
              y1="210"
              x2="620"
              y2="95"
              stroke={project.brandColor}
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
            <line
              x1="400"
              y1="210"
              x2="180"
              y2="325"
              stroke={project.brandColor}
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
            <line
              x1="400"
              y1="210"
              x2="620"
              y2="325"
              stroke={project.brandColor}
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
          </svg>

          <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:items-center md:gap-6">
            {/* Left Spokes: Website + Automations */}
            <div className="space-y-4 md:space-y-12">
              {(['website', 'automations'] as const).map((id) => {
                const node = getNode(id);
                return (
                  <div
                    key={id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span style={{ color: project.brandColor }}>{NODE_ICONS[id]}</span>
                      <span>{node.label}</span>
                    </div>
                    <textarea
                      rows={2}
                      value={node.summary}
                      onChange={(e) => updateFootprintNode(id, e.target.value)}
                      aria-label={`${node.label} description`}
                      className="mt-1.5 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-600 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-400 dark:hover:border-slate-700 dark:focus:bg-slate-900"
                    />
                  </div>
                );
              })}
            </div>

            {/* Center Business Hub */}
            <div className="flex justify-center">
              <div
                style={{ borderColor: project.brandColor }}
                className="flex w-full max-w-xs flex-col items-center justify-center rounded-2xl border-2 bg-white px-6 py-7 text-center shadow-sm dark:bg-slate-950"
              >
                {project.logoDataUrl ? (
                  <img
                    src={project.logoDataUrl}
                    alt={`${project.clientName} hub logo`}
                    className="mb-3 h-12 w-12 rounded-lg object-contain"
                  />
                ) : (
                  <div
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold"
                  >
                    {project.clientName.trim().slice(0, 2).toUpperCase() || 'TF'}
                  </div>
                )}
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {project.clientName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {project.businessType}
                </p>
              </div>
            </div>

            {/* Right Spokes: AI Agent + Social */}
            <div className="space-y-4 md:space-y-12">
              {(['ai-agent', 'social'] as const).map((id) => {
                const node = getNode(id);
                return (
                  <div
                    key={id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span style={{ color: project.brandColor }}>{NODE_ICONS[id]}</span>
                      <span>{node.label}</span>
                    </div>
                    <textarea
                      rows={2}
                      value={node.summary}
                      onChange={(e) => updateFootprintNode(id, e.target.value)}
                      aria-label={`${node.label} description`}
                      className="mt-1.5 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-600 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-400 dark:hover:border-slate-700 dark:focus:bg-slate-900"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Structured data (JSON-LD) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
              Machine-Readable Website Markup · Selected @type: {jsonLdResult.selectedType}
            </p>
            <h3 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              <Sparkles className="h-5 w-5 shrink-0" style={{ color: project.brandColor }} />
              <span>Structured data (JSON-LD)</span>
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Populated automatically from your business type, manual NAP, opening hours, detected
              profile links (<code className="font-mono text-xs">sameAs</code>), and verified Q&amp;As
              without self-serving rating markup.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onResetAISearchLayer}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Sync from brief
            </button>
            <button
              type="button"
              onClick={() =>
                onAISearchLayerChange({ ...aiSearchLayer, enabled: !aiSearchLayer.enabled })
              }
              style={
                aiSearchLayer.enabled
                  ? { borderColor: project.brandColor, color: project.brandColor }
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {aiSearchLayer.enabled ? 'Included in PDF' : 'Excluded from PDF'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left 7 columns: Client Business Facts & Q&A Editor */}
          <div className="space-y-4 lg:col-span-7">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Service Area / Location
                </label>
                <input
                  type="text"
                  value={aiSearchLayer.serviceArea}
                  onChange={(e) =>
                    onAISearchLayerChange({ ...aiSearchLayer, serviceArea: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Editable AI Search Q&As */}
            <div className="pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Verified Q&amp;As for ChatGPT &amp; Claude.ai
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

              <div className="mt-2.5 space-y-3">
                {aiSearchLayer.faqs.map((qa, idx) => (
                  <div
                    key={idx}
                    className="group rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"
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
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-900"
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
                      className="mt-1 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-xs leading-relaxed text-slate-600 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none dark:text-slate-400 dark:hover:border-slate-700 dark:focus:bg-slate-900"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right 5 columns: Ready-to-Publish JSON-LD & Experimental llms.txt Preview */}
          <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-950 text-slate-100 lg:col-span-5 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <div className="inline-flex rounded-lg bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setArtifactTab('jsonld')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    artifactTab === 'jsonld'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Schema JSON-LD
                </button>
                <button
                  type="button"
                  onClick={() => setArtifactTab('llms')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    artifactTab === 'llms'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Experimental: llms.txt
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {artifactTab === 'jsonld' && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold ${
                      jsonLdResult.valid ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>{jsonLdResult.valid ? 'Valid JSON' : 'Invalid JSON'}</span>
                  </span>
                )}
                <button
                  type="button"
                  disabled={!canExportArtifact}
                  onClick={() => void handleCopyArtifact()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
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
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{artifactTab === 'jsonld' ? 'HTML' : 'llms.txt'}</span>
                </button>
              </div>
            </div>

            {artifactTab === 'llms' && (
              <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-amber-300">
                No major search engine or AI assistant has confirmed it uses this. Optional.
              </div>
            )}

            <pre className="max-h-[420px] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
              {activeArtifactText}
            </pre>
          </div>
        </div>
      </div>

      {/* 4. 2027 Roadmap (Q1-Q4) */}
      <div>
        <div className="mb-5">
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Phased Growth Plan
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            2027 Roadmap
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {walkthrough.roadmap.map((quarterPlan, qIdx) => (
            <div
              key={quarterPlan.quarter}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" style={{ color: project.brandColor }} />
                  <span className="text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {quarterPlan.quarter} 2027
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => addRoadmapItem(qIdx)}
                  aria-label={`Add milestone to ${quarterPlan.quarter}`}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <ul className="mt-4 space-y-2.5">
                {quarterPlan.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="group flex items-start gap-2">
                    <span
                      style={{ backgroundColor: project.brandColor }}
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                    />
                    <textarea
                      rows={2}
                      value={item}
                      onChange={(e) => updateRoadmapItem(qIdx, itemIdx, e.target.value)}
                      aria-label={`${quarterPlan.quarter} item ${itemIdx + 1}`}
                      className="w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-snug text-slate-700 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-300 dark:hover:border-slate-700 dark:focus:bg-slate-950"
                    />
                    {quarterPlan.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRoadmapItem(qIdx, itemIdx)}
                        aria-label={`Remove ${quarterPlan.quarter} item ${itemIdx + 1}`}
                        className="mt-1 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Editable Pricing Tiers (2-3 tiers, setup + monthly) */}
      <div>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
              Investment Options
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Transparent pricing tiers (setup + monthly)
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
              <span>Currency</span>
              <select
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
                aria-label="Pricing currency"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => (
                  <option key={code} value={code}>
                    {CURRENCY_CONFIG[code].label}
                  </option>
                ))}
              </select>
            </label>

            {pricingTiers.length < 3 && (
              <button
                type="button"
                onClick={addPricingTier}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add 3rd tier
              </button>
            )}
          </div>
        </div>

        <div
          className={`grid grid-cols-1 gap-5 ${
            pricingTiers.length === 2 ? 'md:grid-cols-2' : 'lg:grid-cols-3'
          }`}
        >
          {pricingTiers.map((tier) => (
            <div
              key={tier.id}
              style={tier.recommended ? { borderColor: project.brandColor } : undefined}
              className={`flex flex-col rounded-xl border bg-white p-6 dark:bg-slate-900 ${
                tier.recommended
                  ? 'border-2 shadow-xs'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => updateTier(tier.id, { recommended: !tier.recommended })}
                  style={
                    tier.recommended
                      ? { color: project.brandColor }
                      : undefined
                  }
                  className="text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
                >
                  {tier.recommended ? 'Recommended option' : 'Mark as recommended'}
                </button>
                {pricingTiers.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removePricingTier(tier.id)}
                    aria-label={`Remove ${tier.name} tier`}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <input
                type="text"
                value={tier.name}
                onChange={(e) => updateTier(tier.id, { name: e.target.value })}
                aria-label="Tier name"
                className="mt-2 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
              />
              <input
                type="text"
                value={tier.audience}
                onChange={(e) => updateTier(tier.id, { audience: e.target.value })}
                aria-label="Target audience"
                className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-400 dark:hover:border-slate-700 dark:focus:bg-slate-950"
              />

              <div className="mt-5 grid grid-cols-2 gap-3 border-y border-slate-200 py-4 dark:border-slate-800">
                <div>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    One-time setup
                  </span>
                  <input
                    type="text"
                    value={tier.setupPrice}
                    onChange={(e) => updateTier(tier.id, { setupPrice: e.target.value })}
                    aria-label="Setup price"
                    className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 tabular-nums hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
                  />
                </div>
                <div>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Monthly care
                  </span>
                  <input
                    type="text"
                    value={tier.monthlyPrice}
                    onChange={(e) => updateTier(tier.id, { monthlyPrice: e.target.value })}
                    aria-label="Monthly price"
                    className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 tabular-nums hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
                  />
                </div>
              </div>

              <ul className="mt-4 flex-1 space-y-2">
                {tier.features.map((feat, fIdx) => (
                  <li key={fIdx} className="group flex items-start gap-2">
                    <Check
                      className="mt-1.5 h-3.5 w-3.5 shrink-0"
                      style={{ color: project.brandColor }}
                    />
                    <input
                      type="text"
                      value={feat}
                      onChange={(e) => updateTierFeature(tier.id, fIdx, e.target.value)}
                      aria-label={`Feature ${fIdx + 1}`}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-700 hover:border-slate-200 focus:border-slate-400 focus:bg-slate-50 focus:outline-none dark:text-slate-300 dark:hover:border-slate-700 dark:focus:bg-slate-950"
                    />
                    {tier.features.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTierFeature(tier.id, fIdx)}
                        aria-label={`Remove feature ${fIdx + 1}`}
                        className="mt-1 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => addTierFeature(tier.id)}
                className="mt-4 inline-flex items-center gap-1 self-start text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                <Plus className="h-3.5 w-3.5" />
                Add deliverable
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
