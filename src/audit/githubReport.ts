import {
  AISearchLayerData,
  CURRENT_BUNDLE_SCHEMA_VERSION,
  CurrencyCode,
  DEFAULT_FOOTPRINT,
  FullProjectBundle,
  PageFacts,
  ProjectBrief,
  buildDefaultAISearchLayer,
  buildDefaultPricingTiers,
  buildLlmsTxt,
} from '../types/tour';
import {
  AiReadinessSummary,
  buildAiReadinessSummary,
  buildRecommendedRobotsTxt,
} from './aiReadiness';
import { deriveClientName } from './htmlFindings';
import { buildValidatedJsonLd } from './jsonLd';
import {
  AuditAssumptions,
  AuditFinding,
  AuditResult,
  ManualFootprint,
  Scorecard,
  SiteAnalysisReport,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from './types';

export interface RepoFileChangeAction {
  priority: 'P0' | 'P1' | 'P2';
  findingId: string;
  title: string;
  targetRepoPaths: string[];
  evidence: string;
  actionSummary: string;
  suggestedSnippetPath?: string;
}

const PRIORITY_ORDER: Record<RepoFileChangeAction['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function mapFindingToRepoAction(finding: AuditFinding): RepoFileChangeAction | null {
  if (finding.status !== 'fail' && finding.status !== 'warn') return null;

  const basePriority: RepoFileChangeAction['priority'] =
    finding.weight >= 4 && finding.status === 'fail'
      ? 'P0'
      : finding.status === 'fail'
      ? 'P1'
      : 'P2';

  switch (finding.id) {
    case 'seo-robots':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['public/robots.txt', 'static/robots.txt', 'app/robots.ts'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
        suggestedSnippetPath: 'generated/robots.txt',
      };
    case 'seo-jsonld':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['index.html', 'app/layout.tsx', 'src/app/layout.tsx'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
        suggestedSnippetPath: 'generated/schema.jsonld',
      };
    case 'seo-title':
    case 'seo-description':
    case 'seo-canonical':
    case 'seo-og':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['index.html', 'app/layout.tsx', 'src/pages/*'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
    case 'seo-h1':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['src/pages/*', 'app/page.tsx', 'src/components/Hero*'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
    case 'speed-images-alt':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['src/components/**', 'src/pages/**', 'app/**'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
    case 'speed-lcp':
    case 'speed-cls':
    case 'speed-ttfb':
    case 'speed-viewport':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['index.html', 'src/components/Hero*', 'public/images/*', 'server*'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
    case 'contact-tel':
    case 'contact-messaging':
    case 'contact-booking-cta':
    case 'contact-form-or-booking':
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: [
          'src/components/Header*',
          'src/components/Hero*',
          'src/components/Footer*',
          'src/components/Contact*',
        ],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
    default:
      return {
        priority: basePriority,
        findingId: finding.id,
        title: finding.label,
        targetRepoPaths: ['index.html', 'src/**'],
        evidence: finding.evidence,
        actionSummary: finding.fix,
      };
  }
}

export function buildRepoChangeChecklist(
  audit: AuditResult | null,
  aiSummary: AiReadinessSummary
): RepoFileChangeAction[] {
  const actions: RepoFileChangeAction[] = [];
  const seenIds = new Set<string>();

  for (const finding of audit?.findings ?? []) {
    const mapped = mapFindingToRepoAction(finding);
    if (!mapped) continue;
    seenIds.add(mapped.findingId);
    actions.push(mapped);
  }

  for (const aiItem of aiSummary.items) {
    if (aiItem.status !== 'fail' && aiItem.status !== 'warn') continue;
    if (aiItem.id === 'ai-crawlers' && !seenIds.has('seo-robots')) {
      actions.push({
        priority: aiItem.status === 'fail' ? 'P0' : 'P1',
        findingId: aiItem.id,
        title: aiItem.label,
        targetRepoPaths: ['public/robots.txt', 'static/robots.txt', 'app/robots.ts'],
        evidence: aiItem.detail,
        actionSummary: aiItem.fix,
        suggestedSnippetPath: 'generated/robots.txt',
      });
    } else if (aiItem.id === 'ai-llms-txt') {
      actions.push({
        priority: 'P1',
        findingId: aiItem.id,
        title: aiItem.label,
        targetRepoPaths: ['public/llms.txt', 'static/llms.txt'],
        evidence: aiItem.detail,
        actionSummary: aiItem.fix,
        suggestedSnippetPath: 'generated/llms.txt',
      });
    } else if (
      (aiItem.id === 'ai-entity-schema' || aiItem.id === 'ai-faq-schema') &&
      !seenIds.has('seo-jsonld')
    ) {
      actions.push({
        priority: aiItem.status === 'fail' ? 'P1' : 'P2',
        findingId: aiItem.id,
        title: aiItem.label,
        targetRepoPaths: ['index.html', 'app/layout.tsx', 'src/app/layout.tsx'],
        evidence: aiItem.detail,
        actionSummary: aiItem.fix,
        suggestedSnippetPath: 'generated/schema.jsonld',
      });
    }
  }

  return actions.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return a.findingId.localeCompare(b.findingId);
  });
}

export interface AgentGeneratedAssets {
  robotsTxt: string;
  llmsTxt: string;
  schemaJsonLdTag: string;
  schemaRawJson: string;
}

export function buildGeneratedRepoAssets(
  project: ProjectBrief,
  aiSearchLayer: AISearchLayerData,
  audit: AuditResult | null,
  manual: ManualFootprint
): AgentGeneratedAssets {
  const jsonLd = buildValidatedJsonLd(project, aiSearchLayer, audit, manual);
  return {
    robotsTxt: buildRecommendedRobotsTxt(project.websiteUrl || audit?.finalUrl || audit?.requestedUrl),
    llmsTxt: buildLlmsTxt(project, aiSearchLayer, null),
    schemaJsonLdTag: jsonLd.scriptTag,
    schemaRawJson: jsonLd.rawJson,
  };
}

export function buildAgentOutputBundle(params: {
  url: string;
  clientName?: string;
  businessType?: string;
  currency?: CurrencyCode;
  audit: AuditResult;
  scorecard: Scorecard;
  manual?: ManualFootprint;
  assumptions?: AuditAssumptions;
  siteAnalysisReport?: SiteAnalysisReport | null;
}): FullProjectBundle {
  const parsed = params.audit.parsed;
  const resolvedClientName = deriveClientName({
    explicitClientName: params.clientName,
    ogSiteName: parsed?.ogSiteName,
    pageTitle: parsed?.title,
    fallbackUrl: params.audit.finalUrl || params.url,
    defaultLabel: 'Audited Website',
  });

  const project: ProjectBrief = {
    clientName: resolvedClientName,
    businessType: params.businessType?.trim() || 'Local Business',
    brief:
      parsed?.metaDescription ||
      `Automated website and AI-readiness audit for ${resolvedClientName}.`,
    brandColor: '#0F766E',
    logoDataUrl: null,
    websiteUrl: params.audit.finalUrl || params.url,
    currency: params.currency ?? 'PHP',
  };

  const pageFacts: PageFacts | null = parsed
    ? {
        url: params.audit.finalUrl || params.url,
        title: parsed.title,
        description: parsed.metaDescription,
        headings: parsed.headings.filter(Boolean).slice(0, 12),
        ctas: parsed.ctaTexts.slice(0, 8),
      }
    : null;

  const aiSearchLayer = buildDefaultAISearchLayer(project, pageFacts, null);
  const manual = params.manual ?? createEmptyManualFootprint();
  const assumptions: AuditAssumptions = params.assumptions ?? {
    ...createDefaultAssumptions(),
    currency: params.currency ?? 'PHP',
  };

  return {
    schemaVersion: CURRENT_BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    pageFacts,
    aiSearchLayer,
    // Minimal placeholder only populated when walkthrough is built in UI; legacy imports fall back to Step 2 when scenes are empty
    walkthrough: {
      title: `${resolvedClientName} Website & AI Visibility Audit`,
      scenes: [],
      outcomes: [],
      roadmap: [],
    },
    footprint: DEFAULT_FOOTPRINT,
    pricingTiers: buildDefaultPricingTiers(params.currency ?? 'PHP'),
    audit: params.audit,
    manualFootprint: manual,
    assumptions,
    scorecard: params.scorecard,
    siteAnalysisReport: params.siteAnalysisReport ?? null,
  };
}

export function buildAgentMarkdownReport(params: {
  url: string;
  repoName?: string;
  project: ProjectBrief;
  audit: AuditResult;
  scorecard: Scorecard;
  aiSummary: AiReadinessSummary;
  repoChanges: RepoFileChangeAction[];
  siteAnalysisReport?: SiteAnalysisReport | null;
}): string {
  const { project, audit, scorecard, aiSummary, repoChanges, siteAnalysisReport } = params;
  const isProvisional = scorecard.isProvisional ?? scorecard.dataCompletenessPct < 70;
  const scoreLine =
    scorecard.overallScore !== null
      ? `${scorecard.overallScore}/100 (Grade ${scorecard.grade}${isProvisional ? ' — Provisional, website-only' : ''})`
      : 'Incomplete';

  const lines: string[] = [
    `# Website & AI Visibility Audit Report — ${project.clientName}`,
    '',
    `- **Target URL:** ${audit.finalUrl || params.url}`,
    ...(params.repoName ? [`- **Source-of-Truth Repo:** \`${params.repoName}\``] : []),
    `- **Scanned At:** ${audit.auditedAt}`,
    `- **Overall Website Score:** ${scoreLine}`,
    `- **Data Completeness:** ${scorecard.dataCompletenessPct}% (${scorecard.knownChecks}/${scorecard.totalChecks} checks measured)`,
    `- **AI Visibility Readiness:** ${aiSummary.score !== null ? `${aiSummary.score}/100` : 'Unchecked'} (${aiSummary.allowedBotsCount}/${aiSummary.totalBotsCount} AI bots allowed · /llms.txt: ${aiSummary.llmsStatus} · Entity Schema: ${aiSummary.entityFieldsPresent}/${aiSummary.entityFieldsTotal})`,
    '',
    '## Category Breakdown',
    '',
    '| Category | Score | Status | Measured Checks |',
    '| --- | --- | --- | --- |',
    ...scorecard.categories.map((c) => {
      const scoreText = c.insufficientData || c.score === null ? 'Insufficient data' : `${c.score}/100`;
      const statusText = c.insufficientData ? 'Excluded (<50% data)' : c.rag.toUpperCase();
      return `| ${c.label} | ${scoreText} | ${statusText} | ${c.knownCount}/${c.totalCount} |`;
    }),
    '',
    '## Required Changes in GitHub Repository',
    '',
  ];

  if (repoChanges.length === 0) {
    lines.push('No failing or warning website/AI readiness checks were flagged.');
  } else {
    for (const item of repoChanges) {
      lines.push(`### [${item.priority}] ${item.title} (\`${item.findingId}\`)`);
      lines.push(`- **Measured Evidence:** ${item.evidence}`);
      lines.push(`- **Likely Repo Files:** ${item.targetRepoPaths.map((p) => `\`${p}\``).join(', ')}`);
      lines.push(`- **Required Change:** ${item.actionSummary}`);
      if (item.suggestedSnippetPath) {
        lines.push(`- **Generated Patch File:** \`${item.suggestedSnippetPath}\``);
      }
      lines.push('');
    }
  }

  if (audit.auditNotes && audit.auditNotes.length > 0) {
    lines.push('## Scan Notes');
    lines.push('');
    for (const note of audit.auditNotes) {
      lines.push(`- **${note.code}:** ${note.message}`);
    }
    lines.push('');
  }

  if (siteAnalysisReport) {
    lines.push('## AI Agent Executive Narrative');
    lines.push(`*Provider: ${siteAnalysisReport.providerLabel} · Model: ${siteAnalysisReport.modelId}*`);
    if (siteAnalysisReport.needsReview) {
      lines.push('> **Review Notice:** One or more numeric figures in this narrative were not traced verbatim to measured inputs and should be verified before client delivery.');
    }
    lines.push('', siteAnalysisReport.executiveSummary, '');
    if (siteAnalysisReport.quickWins30Days.length > 0) {
      lines.push('**30-Day Quick Wins:**');
      for (const win of siteAnalysisReport.quickWins30Days) {
        lines.push(`- ${win}`);
      }
      lines.push('');
    }
  }

  lines.push(
    '---',
    '*Generated deterministically by TourForge Lite. Import `tourforge-bundle.json` in the TourForge UI to view the interactive scorecard, screenshots, and proposal.*'
  );

  return lines.join('\n').trim() + '\n';
}

export function buildGitHubIssueBody(params: {
  url: string;
  project: ProjectBrief;
  scorecard: Scorecard;
  aiSummary: AiReadinessSummary;
  repoChanges: RepoFileChangeAction[];
  bundleFileHint?: string;
}): string {
  const { project, scorecard, aiSummary, repoChanges } = params;
  const isProvisional = scorecard.isProvisional ?? scorecard.dataCompletenessPct < 70;
  const scoreLabel =
    scorecard.overallScore !== null
      ? `${scorecard.overallScore}/100 (${scorecard.grade}${isProvisional ? ' · Provisional' : ''})`
      : 'Incomplete';

  const lines: string[] = [
    `## TourForge Audit: ${project.clientName} (${scoreLabel})`,
    '',
    `- **Live URL:** ${params.url}`,
    `- **Website Score:** ${scoreLabel} (${scorecard.knownChecks}/${scorecard.totalChecks} checks measured)`,
    `- **AI Visibility Score:** ${aiSummary.score !== null ? `${aiSummary.score}/100` : 'N/A'} (${aiSummary.allowedBotsCount}/${aiSummary.totalBotsCount} bots allowed · \`/llms.txt\`: **${aiSummary.llmsStatus}** · Entity JSON-LD: **${aiSummary.entityFieldsPresent}/${aiSummary.entityFieldsTotal}**)`,
    '',
    '### Repo Action Checklist',
    '',
  ];

  if (repoChanges.length === 0) {
    lines.push('- [x] All automated website & AI-readiness checks passed.');
  } else {
    for (const item of repoChanges) {
      const files = item.targetRepoPaths.slice(0, 3).map((p) => `\`${p}\``).join(', ');
      const snippetNote = item.suggestedSnippetPath ? ` *(see \`${item.suggestedSnippetPath}\`)*` : '';
      lines.push(
        `- [ ] **[${item.priority}] ${item.title}** — ${item.evidence} → Update ${files}${snippetNote}: ${item.actionSummary}`
      );
    }
  }

  lines.push(
    '',
    `> **Team Review:** Download or import \`${params.bundleFileHint || 'tourforge-bundle.json'}\` in TourForge Lite to inspect the full Scorecard & Proposal.`
  );

  return lines.join('\n').trim() + '\n';
}
