import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Moon,
  Play,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-react';
import { buildAiReadinessSummary } from './audit/aiReadiness';
import { runSiteAudit } from './audit/auditClient';
import { migrateImportedBundle } from './audit/bundleMigration';
import { deriveClientName } from './audit/htmlFindings';
import { buildSampleAudit } from './audit/sampleAudit';
import { computeScorecard } from './audit/scorecard';
import {
  AiMentionCheckResult,
  AuditAssumptions,
  AuditResult,
  ManualFootprint,
  ProspectEntry,
  SiteAnalysisReport,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from './audit/types';
import { AiVisibilityTab } from './components/AiVisibilityTab';
import { AuditSection, AuditTabId } from './components/AuditSection';
import { IntakeStudio } from './components/IntakeStudio';
import { PrintProposalView } from './components/PrintProposalView';
import { ProposalSection } from './components/ProposalSection';
import { SettingsModal } from './components/SettingsModal';
import { SiteAnalysisAgentPanel } from './components/SiteAnalysisAgentPanel';
import { WalkthroughPlayer } from './components/WalkthroughPlayer';
import {
  generateWalkthrough,
  getEffectiveAnalysisModel,
  isOllamaBaseUrl,
  runAiBrandMentionCheck,
  runSiteAnalysisAgent,
} from './lib/aiClient';
import { captureWebsite } from './lib/captureClient';
import {
  SAMPLE_PROJECT_BRIEF,
  SAMPLE_WALKTHROUGH,
  buildSampleScreenshots,
} from './lib/sampleProject';
import {
  AISearchLayerData,
  AISettings,
  CURRENT_BUNDLE_SCHEMA_VERSION,
  CurrencyCode,
  DEFAULT_AI_SETTINGS,
  DEFAULT_FOOTPRINT,
  DEFAULT_PRICING_TIERS,
  FootprintNode,
  FullProjectBundle,
  PageFacts,
  PricingTier,
  ProjectBrief,
  ProposalOutcome,
  RoadmapQuarterPlan,
  ScreenshotAsset,
  WalkthroughData,
  WalkthroughScene,
  buildDefaultAISearchLayer,
  convertPricingTiersCurrency,
  createWalkthroughSchema,
  getContrastTextColor,
} from './types/tour';

const SETTINGS_STORAGE_KEY = 'tourforge_ai_settings_v1';
const THEME_STORAGE_KEY = 'tourforge_theme_v1';
const PROSPECTS_STORAGE_KEY = 'tourforge_prospects_v1';
const MANUAL_STORAGE_PREFIX = 'tourforge_manual_footprint_v1:';

const AUDIT_PROGRESS_LABELS = [
  'Fetching page',
  'Parsing HTML & AI bots',
  'Speed test (Lighthouse)',
  'Scoring findings',
];

type PipelineStep = 1 | 2 | 3 | 4;

const EMPTY_PROJECT: ProjectBrief = {
  clientName: '',
  businessType: '',
  brief: '',
  brandColor: '#0F766E',
  logoDataUrl: null,
  websiteUrl: '',
  currency: 'PHP',
};

function loadInitialSettings(): AISettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return {
      baseUrl: parsed.baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
      apiKey: parsed.apiKey || '',
      model: parsed.model || '',
      analysisModel: parsed.analysisModel || '',
      providerPreset: parsed.providerPreset || DEFAULT_AI_SETTINGS.providerPreset,
      captureUrl: parsed.captureUrl || DEFAULT_AI_SETTINGS.captureUrl,
      captureToken: parsed.captureToken || '',
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function loadInitialTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
}

function loadInitialProspects(): ProspectEntry[] {
  try {
    const raw = localStorage.getItem(PROSPECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProspectEntry[]) : [];
  } catch {
    return [];
  }
}

function getManualStorageKey(websiteUrl: string, clientName: string): string {
  const source = (websiteUrl || clientName || 'default')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${MANUAL_STORAGE_PREFIX}${source || 'default'}`;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadInitialTheme);
  const [aiSettings, setAiSettings] = useState<AISettings>(loadInitialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<PipelineStep>(1);

  const [project, setProject] = useState<ProjectBrief>(EMPTY_PROJECT);
  const [screenshots, setScreenshots] = useState<ScreenshotAsset[]>([]);
  const [pageFacts, setPageFacts] = useState<PageFacts | null>(null);
  const [walkthrough, setWalkthrough] = useState<WalkthroughData | null>(null);
  const [footprint, setFootprint] = useState<FootprintNode[]>(DEFAULT_FOOTPRINT);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>(DEFAULT_PRICING_TIERS);
  const [aiSearchLayer, setAiSearchLayer] = useState<AISearchLayerData>(() =>
    buildDefaultAISearchLayer(EMPTY_PROJECT, null, null)
  );

  // Audit & Lead-Magnet States
  const [auditTab, setAuditTab] = useState<AuditTabId>('scorecard');
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [manualFootprint, setManualFootprint] = useState<ManualFootprint>(
    createEmptyManualFootprint
  );
  const [assumptions, setAssumptions] = useState<AuditAssumptions>(createDefaultAssumptions);
  const [prospects, setProspects] = useState<ProspectEntry[]>(loadInitialProspects);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditStageIndex, setAuditStageIndex] = useState(0);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<'scorecard' | 'proposal'>('proposal');

  // AI Mention Check & Site Analysis Agent States
  const [aiMentionCheck, setAiMentionCheck] = useState<AiMentionCheckResult | null>(null);
  const [isCheckingMentions, setIsCheckingMentions] = useState(false);
  const [mentionCheckError, setMentionCheckError] = useState<string | null>(null);

  const [siteAnalysisReport, setSiteAnalysisReport] = useState<SiteAnalysisReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportStage, setReportStage] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scorecard = useMemo(
    () => computeScorecard(audit, manualFootprint, assumptions),
    [audit, manualFootprint, assumptions]
  );

  const aiReadinessSummary = useMemo(() => buildAiReadinessSummary(audit), [audit]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota issues
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(PROSPECTS_STORAGE_KEY, JSON.stringify(prospects));
    } catch {
      // Ignore storage quota issues
    }
  }, [prospects]);

  useEffect(() => {
    const key = getManualStorageKey(project.websiteUrl || '', project.clientName);
    try {
      localStorage.setItem(key, JSON.stringify(manualFootprint));
    } catch {
      // Ignore storage quota issues
    }
  }, [manualFootprint, project.websiteUrl, project.clientName]);

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintMode('proposal');
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const handleSaveSettings = (next: AISettings) => {
    setAiSettings(next);
    setErrorMessage(null);
    setMentionCheckError(null);
    setReportError(null);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues
    }
  };

  const hasValidAuth =
    isOllamaBaseUrl(aiSettings.baseUrl) || aiSettings.apiKey.trim().length > 0;

  const hasConfiguredAI =
    aiSettings.baseUrl.trim().length > 0 &&
    hasValidAuth &&
    aiSettings.model.trim().length > 0;

  const hasConfiguredAnalysisAI =
    aiSettings.baseUrl.trim().length > 0 &&
    hasValidAuth &&
    getEffectiveAnalysisModel(aiSettings).length > 0;

  const navigateToStep = (step: PipelineStep) => {
    setActiveStep(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCaptureSite = async (websiteUrl: string) => {
    setCaptureError(null);
    setErrorMessage(null);
    setIsCapturing(true);

    try {
      const result = await captureWebsite({
        captureUrl: aiSettings.captureUrl,
        captureToken: aiSettings.captureToken,
        websiteUrl,
        shots: 5,
      });

      setScreenshots(result.screenshots);
      setPageFacts(result.pageFacts);

      const derivedCaptureName = deriveClientName({
        pageTitle: result.pageFacts.title,
        fallbackUrl: result.pageFacts.url || websiteUrl,
        defaultLabel: '',
      });

      setProject((prev) => {
        const nextProject: ProjectBrief = {
          ...prev,
          websiteUrl: result.pageFacts.url || websiteUrl,
          clientName:
            derivedCaptureName && !prev.clientName.trim()
              ? derivedCaptureName
              : prev.clientName,
        };
        setAiSearchLayer(buildDefaultAISearchLayer(nextProject, result.pageFacts, walkthrough));
        return nextProject;
      });
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Unable to capture website.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRunAudit = async (targetUrl: string) => {
    setAuditError(null);
    setIsAuditing(true);
    setAuditStageIndex(0);

    const t1 = window.setTimeout(() => setAuditStageIndex(1), 900);
    const t2 = window.setTimeout(() => setAuditStageIndex(2), 2000);

    try {
      const result = await runSiteAudit(
        targetUrl,
        aiSettings.captureUrl,
        aiSettings.captureToken
      );
      setAuditStageIndex(3);
      setAudit(result);

      const resolvedUrl = result.finalUrl || targetUrl;
      const derivedAuditName = deriveClientName({
        ogSiteName: result.parsed?.ogSiteName,
        pageTitle: result.parsed?.title,
        fallbackUrl: resolvedUrl,
        defaultLabel: '',
      });

      let synthesizedFacts: PageFacts | null = pageFacts;
      if (!synthesizedFacts && result.parsed) {
        synthesizedFacts = {
          url: resolvedUrl,
          title: result.parsed.title,
          description: result.parsed.metaDescription,
          headings: result.parsed.headings,
          ctas: result.parsed.ctaTexts,
        };
        setPageFacts(synthesizedFacts);
      }

      setProject((prev) => {
        const nextProject: ProjectBrief = {
          ...prev,
          websiteUrl: resolvedUrl,
          clientName:
            !prev.clientName.trim() && derivedAuditName
              ? derivedAuditName
              : prev.clientName,
        };
        setAiSearchLayer((curr) =>
          curr.websiteUrl === 'https://example.com'
            ? buildDefaultAISearchLayer(nextProject, synthesizedFacts, walkthrough)
            : curr
        );
        return nextProject;
      });
      setAuditTab('scorecard');
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unable to run site audit.');
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setIsAuditing(false);
    }
  };

  const handleScanAndCapture = async (websiteUrl: string) => {
    await Promise.allSettled([handleRunAudit(websiteUrl), handleCaptureSite(websiteUrl)]);
  };

  const handleLoadSampleAudit = () => {
    setAuditError(null);
    const sample = buildSampleAudit();
    setAudit(sample.audit);
    setManualFootprint(sample.manualFootprint);
    setAssumptions(sample.assumptions);
    setProject((prev) => ({
      ...prev,
      clientName: prev.clientName.trim() || SAMPLE_PROJECT_BRIEF.clientName,
      businessType: prev.businessType.trim() || SAMPLE_PROJECT_BRIEF.businessType,
      brief: prev.brief.trim() || SAMPLE_PROJECT_BRIEF.brief,
      websiteUrl: prev.websiteUrl?.trim() || sample.audit.requestedUrl,
    }));
    setAuditTab('scorecard');
  };

  const handleOpenProspectScorecard = (prospect: ProspectEntry) => {
    setAuditError(null);
    setAudit(prospect.audit);
    setProject((prev) => ({
      ...prev,
      clientName: prospect.name,
      websiteUrl: prospect.url,
    }));
    const savedKey = getManualStorageKey(prospect.url, prospect.name);
    try {
      const raw = localStorage.getItem(savedKey);
      if (raw) {
        setManualFootprint(JSON.parse(raw) as ManualFootprint);
      } else {
        setManualFootprint(createEmptyManualFootprint());
      }
    } catch {
      setManualFootprint(createEmptyManualFootprint());
    }
    setAuditTab('scorecard');
    navigateToStep(2);
  };

  const handlePromoteProspect = (prospect: ProspectEntry) => {
    handleOpenProspectScorecard(prospect);
  };

  const handleRunMentionCheck = async () => {
    setMentionCheckError(null);
    if (!hasConfiguredAnalysisAI) {
      setSettingsOpen(true);
      return;
    }
    setIsCheckingMentions(true);
    try {
      const result = await runAiBrandMentionCheck({
        settings: aiSettings,
        project,
        audit,
        aiSearchLayer,
      });
      setAiMentionCheck(result);
    } catch (err) {
      setMentionCheckError(
        err instanceof Error ? err.message : 'Unable to run AI Brand Mention Check.'
      );
    } finally {
      setIsCheckingMentions(false);
    }
  };

  const handleGenerateSiteReport = async () => {
    setReportError(null);
    if (!hasConfiguredAnalysisAI) {
      setSettingsOpen(true);
      return;
    }
    setIsGeneratingReport(true);
    setReportStage('Analyzing scorecard, AI visibility & GBP facts...');
    try {
      const report = await runSiteAnalysisAgent({
        settings: aiSettings,
        project,
        audit,
        scorecard,
        manualFootprint,
        aiSearchLayer,
        aiMentionCheck,
        pageFacts,
        onStage: setReportStage,
      });
      setSiteAnalysisReport(report);
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : 'Site Analysis Agent failed.'
      );
    } finally {
      setIsGeneratingReport(false);
      setReportStage('');
    }
  };

  const handleGenerate = async () => {
    setErrorMessage(null);

    if (!hasConfiguredAI) {
      setSettingsOpen(true);
      setErrorMessage(
        'Configure your AI provider and Vision-capable Walkthrough model in Settings first.'
      );
      return;
    }

    if (screenshots.length < 3 || screenshots.length > 6) {
      setErrorMessage('Please upload or capture between 3 and 6 website screenshots.');
      return;
    }

    setIsGenerating(true);
    setGenerationStage('Preparing screenshots, brief, and audit findings...');

    try {
      const activeFindings =
        audit || scorecard.knownChecks > 0 ? scorecard.allFindings : [];
      const generated = await generateWalkthrough({
        settings: aiSettings,
        project,
        screenshots,
        pageFacts,
        findings: activeFindings,
        onStage: setGenerationStage,
      });
      setWalkthrough(generated);
      setAiSearchLayer(buildDefaultAISearchLayer(project, pageFacts, generated));
      navigateToStep(4);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setIsGenerating(false);
      setGenerationStage('');
    }
  };

  const handleLoadSampleInputs = () => {
    setErrorMessage(null);
    setCaptureError(null);
    setPageFacts(null);
    const sampleAudit = buildSampleAudit();
    const nextProject: ProjectBrief = {
      ...SAMPLE_PROJECT_BRIEF,
      websiteUrl: sampleAudit.audit.requestedUrl,
    };
    setProject(nextProject);
    setScreenshots(buildSampleScreenshots());
    setAudit(sampleAudit.audit);
    setManualFootprint(sampleAudit.manualFootprint);
    setAssumptions(sampleAudit.assumptions);
    setAiSearchLayer(buildDefaultAISearchLayer(nextProject, null, null));
  };

  const handlePreviewSampleTour = () => {
    setErrorMessage(null);
    setCaptureError(null);
    setPageFacts(null);
    const sampleAudit = buildSampleAudit();
    const sampleProject: ProjectBrief = {
      ...SAMPLE_PROJECT_BRIEF,
      websiteUrl: sampleAudit.audit.requestedUrl,
    };
    setProject(sampleProject);
    setScreenshots(buildSampleScreenshots());
    setAudit(sampleAudit.audit);
    setManualFootprint(sampleAudit.manualFootprint);
    setAssumptions(sampleAudit.assumptions);
    setWalkthrough(SAMPLE_WALKTHROUGH);
    setFootprint(DEFAULT_FOOTPRINT);
    setPricingTiers(DEFAULT_PRICING_TIERS);
    setAiSearchLayer(buildDefaultAISearchLayer(sampleProject, null, SAMPLE_WALKTHROUGH));
    navigateToStep(4);
  };

  const handleImportJson = async (file: File) => {
    setErrorMessage(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const migrated = migrateImportedBundle(raw);
      const rawRecord = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const candidateWalkthrough = migrated.walkthrough ? migrated.walkthrough : rawRecord;

      const maxIdx = Math.max(0, screenshots.length > 0 ? screenshots.length - 1 : 5);
      const schema = createWalkthroughSchema(maxIdx);
      const parsed = schema.safeParse(candidateWalkthrough);

      if (!parsed.success && !migrated.audit) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        setErrorMessage(`Imported JSON does not match the walkthrough or audit schema: ${msg}`);
        return;
      }

      const nextProject: ProjectBrief = migrated.project
        ? {
            clientName: migrated.project.clientName || project.clientName || 'Imported Client',
            businessType:
              migrated.project.businessType || project.businessType || 'Digital Business',
            brief: migrated.project.brief || project.brief,
            brandColor: migrated.project.brandColor || project.brandColor,
            logoDataUrl: migrated.project.logoDataUrl ?? project.logoDataUrl,
            websiteUrl:
              migrated.project.websiteUrl ||
              migrated.audit?.finalUrl ||
              migrated.audit?.requestedUrl ||
              project.websiteUrl,
            currency:
              migrated.project.currency ||
              migrated.assumptions?.currency ||
              project.currency ||
              'PHP',
          }
        : project;

      setProject(nextProject);
      const nextFacts = migrated.pageFacts || null;
      setPageFacts(nextFacts);

      if (migrated.audit !== undefined) setAudit(migrated.audit);
      if (migrated.manualFootprint) setManualFootprint(migrated.manualFootprint);
      if (migrated.assumptions) setAssumptions(migrated.assumptions);
      if (Array.isArray(migrated.prospects)) setProspects(migrated.prospects);
      if (migrated.aiMentionCheck !== undefined) setAiMentionCheck(migrated.aiMentionCheck);
      if (migrated.siteAnalysisReport !== undefined) {
        setSiteAnalysisReport(migrated.siteAnalysisReport);
      }

      if (Array.isArray(migrated.footprint) && migrated.footprint.length === 4) {
        setFootprint(migrated.footprint);
      }
      if (Array.isArray(migrated.pricingTiers) && migrated.pricingTiers.length >= 2) {
        setPricingTiers(migrated.pricingTiers.slice(0, 3));
      }

      if (parsed.success) {
        if (migrated.aiSearchLayer) {
          setAiSearchLayer(migrated.aiSearchLayer);
        } else {
          setAiSearchLayer(buildDefaultAISearchLayer(nextProject, nextFacts, parsed.data));
        }
        if (screenshots.length === 0) {
          setScreenshots(buildSampleScreenshots());
        }
        setWalkthrough(parsed.data);
        navigateToStep(4);
      } else if (migrated.audit) {
        if (migrated.aiSearchLayer) {
          setAiSearchLayer(migrated.aiSearchLayer);
        } else {
          setAiSearchLayer(buildDefaultAISearchLayer(nextProject, nextFacts, null));
        }
        setAuditTab('scorecard');
        navigateToStep(2);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to parse imported JSON file.'
      );
    }
  };

  const downloadBundleJson = (suffix = 'walkthrough') => {
    const bundle: FullProjectBundle = {
      schemaVersion: CURRENT_BUNDLE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      project,
      pageFacts,
      aiSearchLayer,
      walkthrough: walkthrough || SAMPLE_WALKTHROUGH,
      footprint,
      pricingTiers,
      audit,
      manualFootprint,
      assumptions,
      scorecard,
      prospects,
      aiMentionCheck,
      siteAnalysisReport,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = (project.clientName || 'tourforge')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug || 'tourforge'}-${suffix}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrintScorecard = () => {
    setPrintMode('scorecard');
    window.setTimeout(() => window.print(), 40);
  };

  const handlePrintPdf = () => {
    setPrintMode('proposal');
    window.setTimeout(() => window.print(), 40);
  };

  const handleUpdateScene = (index: number, nextScene: WalkthroughScene) => {
    setWalkthrough((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map((s, idx) => (idx === index ? nextScene : s)),
      };
    });
  };

  const handleOutcomesChange = (outcomes: ProposalOutcome[]) => {
    setWalkthrough((prev) => (prev ? { ...prev, outcomes } : prev));
  };

  const handleRoadmapChange = (roadmap: RoadmapQuarterPlan[]) => {
    setWalkthrough((prev) => (prev ? { ...prev, roadmap } : prev));
  };

  const handleTitleChange = (title: string) => {
    setWalkthrough((prev) => (prev ? { ...prev, title } : prev));
  };

  const activeCurrency: CurrencyCode =
    assumptions.currency ?? project.currency ?? 'PHP';

  const handleCurrencyChange = (nextCurrency: CurrencyCode) => {
    setProject((prev) => ({ ...prev, currency: nextCurrency }));
    setAssumptions((prev) => ({ ...prev, currency: nextCurrency }));
    setPricingTiers((prev) => convertPricingTiersCurrency(prev, nextCurrency));
  };

  const brandContrast = getContrastTextColor(project.brandColor);
  const screenshotCountValid = screenshots.length >= 3 && screenshots.length <= 6;
  const briefValid =
    project.clientName.trim().length > 0 &&
    project.businessType.trim().length > 0 &&
    project.brief.trim().length > 0;
  const showPrintableLayer = Boolean(walkthrough || audit || scorecard.knownChecks > 0);

  const pipelineSteps: Array<{
    step: PipelineStep;
    title: string;
    subtitle: string;
    done: boolean;
  }> = [
    {
      step: 1,
      title: '1. Intake & Scan',
      subtitle: audit
        ? `${screenshots.length} screens · Site scanned`
        : screenshots.length > 0
        ? `${screenshots.length}/6 screens ready`
        : 'URL scan & brief',
      done: Boolean(audit || screenshots.length >= 3),
    },
    {
      step: 2,
      title: '2. Scorecard & GBP',
      subtitle:
        scorecard.overallScore !== null
          ? `${scorecard.overallScore}/100 (${scorecard.grade})`
          : 'Scorecard & competitors',
      done: scorecard.knownChecks > 0,
    },
    {
      step: 3,
      title: '3. AI Visibility',
      subtitle:
        aiReadinessSummary.score !== null
          ? `${aiReadinessSummary.score}/100 · ${aiReadinessSummary.allowedBotsCount}/${aiReadinessSummary.totalBotsCount} bots`
          : 'Bots, llms.txt & mentions',
      done: Boolean(audit?.aiReadiness || aiMentionCheck),
    },
    {
      step: 4,
      title: '4. Report & Proposal',
      subtitle: siteAnalysisReport
        ? 'Agent report ready'
        : walkthrough
        ? 'Walkthrough & pricing'
        : 'AI report & 2027 pitch',
      done: Boolean(siteAnalysisReport || walkthrough),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Three-Zone Top Bar */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateToStep(1)}
            className="text-left text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            TourForge Lite
          </button>

          {/* Zone 2: Clean Step Links */}
          <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
            {pipelineSteps.map((item) => (
              <button
                key={item.step}
                type="button"
                onClick={() => navigateToStep(item.step)}
                className={`transition-colors whitespace-nowrap shrink-0 ${
                  activeStep === item.step
                    ? 'font-semibold text-slate-950 underline decoration-2 underline-offset-8 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {item.title}
              </button>
            ))}
          </nav>

          {/* Zone 3: Theme Toggle + Settings Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>AI &amp; Settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        {/* Step 1 -> Step 4 Pipeline Switcher Bar */}
        <div
          aria-label="Agency audit and proposal pipeline"
          className="no-print grid grid-cols-2 gap-2.5 lg:grid-cols-4"
        >
          {pipelineSteps.map((item) => {
            const isCurrent = activeStep === item.step;
            return (
              <button
                key={item.step}
                type="button"
                onClick={() => navigateToStep(item.step)}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  isCurrent
                    ? 'border-slate-900 bg-white dark:border-slate-100 dark:bg-slate-900'
                    : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`truncate text-xs font-semibold ${
                      isCurrent
                        ? 'text-slate-950 dark:text-white'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {item.subtitle}
                  </p>
                </div>
                {item.done && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* STEP 1: Intake & Scan */}
        {activeStep === 1 && (
          <IntakeStudio
            project={project}
            screenshots={screenshots}
            pageFacts={pageFacts}
            isCapturing={isCapturing}
            captureError={captureError}
            isAuditing={isAuditing}
            auditStageLabel={AUDIT_PROGRESS_LABELS[auditStageIndex] || 'Scanning...'}
            auditError={auditError}
            audit={audit}
            scorecard={scorecard}
            prospects={prospects}
            captureUrl={aiSettings.captureUrl}
            captureToken={aiSettings.captureToken}
            isGenerating={isGenerating}
            generationStage={generationStage}
            errorMessage={errorMessage}
            hasConfiguredAI={hasConfiguredAI}
            onProjectChange={setProject}
            onScreenshotsChange={setScreenshots}
            onScanAndCapture={(url) => void handleScanAndCapture(url)}
            onCaptureOnly={(url) => void handleCaptureSite(url)}
            onAuditOnly={(url) => void handleRunAudit(url)}
            onClearPageFacts={() => setPageFacts(null)}
            onGenerate={() => void handleGenerate()}
            onLoadSampleInputs={handleLoadSampleInputs}
            onPreviewSampleTour={handlePreviewSampleTour}
            onImportJson={(file) => void handleImportJson(file)}
            onOpenSettings={() => setSettingsOpen(true)}
            onGoToStep={navigateToStep}
            onProspectsChange={setProspects}
            onOpenProspectScorecard={handleOpenProspectScorecard}
            onPromoteProspect={handlePromoteProspect}
          />
        )}

        {/* STEP 2: Scorecard & GBP */}
        {activeStep === 2 && (
          <AuditSection
            activeTab={auditTab}
            onTabChange={setAuditTab}
            auditUrl={project.websiteUrl || ''}
            onAuditUrlChange={(url) => setProject((prev) => ({ ...prev, websiteUrl: url }))}
            isAuditing={isAuditing}
            auditStageIndex={auditStageIndex}
            auditError={auditError}
            audit={audit}
            manualFootprint={manualFootprint}
            assumptions={assumptions}
            scorecard={scorecard}
            project={project}
            onRunAudit={(url) => void handleRunAudit(url)}
            onLoadSampleAudit={handleLoadSampleAudit}
            onManualFootprintChange={setManualFootprint}
            onAssumptionsChange={setAssumptions}
            onCurrencyChange={handleCurrencyChange}
            onPrintScorecard={handlePrintScorecard}
            onExportAuditJson={() => downloadBundleJson('audit')}
          />
        )}

        {/* STEP 3: Standalone AI Visibility */}
        {activeStep === 3 && (
          <AiVisibilityTab
            project={project}
            audit={audit}
            manualFootprint={manualFootprint}
            aiSearchLayer={aiSearchLayer}
            walkthrough={walkthrough}
            aiSettings={aiSettings}
            hasConfiguredAnalysisAI={hasConfiguredAnalysisAI}
            aiMentionCheck={aiMentionCheck}
            isCheckingMentions={isCheckingMentions}
            mentionCheckError={mentionCheckError}
            onAISearchLayerChange={setAiSearchLayer}
            onResetAISearchLayer={() =>
              setAiSearchLayer(buildDefaultAISearchLayer(project, pageFacts, walkthrough))
            }
            onRunMentionCheck={() => void handleRunMentionCheck()}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* STEP 4: Site Analysis Agent, Walkthrough & Proposal */}
        {activeStep === 4 && (
          <div id="step-4" className="no-print space-y-8">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
                Step 4 · AI Analysis Report, Walkthrough &amp; 2027 Proposal
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
                Deliver Client Report, Interactive Walkthrough &amp; Pricing Proposal
              </h2>
            </div>

            <SiteAnalysisAgentPanel
              project={project}
              aiSettings={aiSettings}
              hasConfiguredAnalysisAI={hasConfiguredAnalysisAI}
              report={siteAnalysisReport}
              isGeneratingReport={isGeneratingReport}
              reportStage={reportStage}
              reportError={reportError}
              onGenerateReport={() => void handleGenerateSiteReport()}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            {walkthrough ? (
              <>
                <WalkthroughPlayer
                  walkthrough={walkthrough}
                  screenshots={screenshots}
                  brandColor={project.brandColor}
                  onUpdateScene={handleUpdateScene}
                />

                <ProposalSection
                  project={project}
                  walkthrough={walkthrough}
                  footprint={footprint}
                  pricingTiers={pricingTiers}
                  currency={activeCurrency}
                  aiSearchLayer={aiSearchLayer}
                  audit={audit}
                  manualFootprint={manualFootprint}
                  onTitleChange={handleTitleChange}
                  onOutcomesChange={handleOutcomesChange}
                  onRoadmapChange={handleRoadmapChange}
                  onFootprintChange={setFootprint}
                  onPricingChange={setPricingTiers}
                  onCurrencyChange={handleCurrencyChange}
                  onAISearchLayerChange={setAiSearchLayer}
                  onOpenAiVisibilityTab={() => navigateToStep(3)}
                  onExportJson={() => downloadBundleJson('walkthrough')}
                  onPrintPdf={handlePrintPdf}
                />
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Interactive Screenshot Walkthrough &amp; Editable 2027 Proposal
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {screenshots.length}/6 screenshots ready ·{' '}
                      {briefValid ? 'Client brief complete' : 'Complete client name, type & brief in Step 1'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handlePreviewSampleTour}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Load Sample Tour
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={isGenerating || !screenshotCountValid || !briefValid}
                      style={{ backgroundColor: project.brandColor, color: brandContrast }}
                      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-95 disabled:opacity-45 whitespace-nowrap"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{generationStage || 'Generating walkthrough...'}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Generate Walkthrough &amp; Proposal</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {errorMessage && (
                  <p className="mt-3 text-xs text-rose-700 dark:text-rose-400 whitespace-pre-line">
                    {errorMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step Navigation Footer */}
        <div className="no-print flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
          {activeStep > 1 ? (
            <button
              type="button"
              onClick={() => navigateToStep((activeStep - 1) as PipelineStep)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Previous: Step {activeStep - 1}</span>
            </button>
          ) : (
            <span />
          )}

          {activeStep < 4 && (
            <button
              type="button"
              onClick={() => navigateToStep((activeStep + 1) as PipelineStep)}
              style={{ backgroundColor: project.brandColor, color: brandContrast }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-95"
            >
              <span>
                Next: {pipelineSteps[activeStep].title}
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Printable Scorecard + Proposal Layer (Always Mounted for Any-Step Print) */}
        {showPrintableLayer && (
          <PrintProposalView
            project={project}
            walkthrough={walkthrough}
            screenshots={screenshots}
            footprint={footprint}
            pricingTiers={pricingTiers}
            aiSearchLayer={aiSearchLayer}
            audit={audit}
            scorecard={scorecard}
            auditedUrl={project.websiteUrl || ''}
            printMode={printMode}
            siteAnalysisReport={siteAnalysisReport}
          />
        )}
      </main>

      <footer className="no-print border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        TourForge Lite · Open-source website audits, AI visibility checks, GBP benchmarks, and 2027 proposals
      </footer>

      <SettingsModal
        isOpen={settingsOpen}
        settings={aiSettings}
        onSave={handleSaveSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
