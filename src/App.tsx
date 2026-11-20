import React, { useEffect, useMemo, useState } from 'react';
import { Moon, SlidersHorizontal, Sun } from 'lucide-react';
import { runSiteAudit } from './audit/auditClient';
import { migrateImportedBundle } from './audit/bundleMigration';
import { deriveClientName } from './audit/htmlFindings';
import { buildSampleAudit } from './audit/sampleAudit';
import { computeScorecard } from './audit/scorecard';
import {
  AuditAssumptions,
  AuditResult,
  ManualFootprint,
  ProspectEntry,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from './audit/types';
import { AuditSection, AuditTabId } from './components/AuditSection';
import { IntakeStudio } from './components/IntakeStudio';
import { PrintProposalView } from './components/PrintProposalView';
import { ProposalSection } from './components/ProposalSection';
import { SettingsModal } from './components/SettingsModal';
import { WalkthroughPlayer } from './components/WalkthroughPlayer';
import { generateWalkthrough } from './lib/aiClient';
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
  createWalkthroughSchema,
} from './types/tour';

const SETTINGS_STORAGE_KEY = 'tourforge_ai_settings_v1';
const THEME_STORAGE_KEY = 'tourforge_theme_v1';
const PROSPECTS_STORAGE_KEY = 'tourforge_prospects_v1';
const MANUAL_STORAGE_PREFIX = 'tourforge_manual_footprint_v1:';

const EMPTY_PROJECT: ProjectBrief = {
  clientName: '',
  businessType: '',
  brief: '',
  brandColor: '#0F766E',
  logoDataUrl: null,
  websiteUrl: '',
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
  const [auditTab, setAuditTab] = useState<AuditTabId>('auto');
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

  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scorecard = useMemo(
    () => computeScorecard(audit, manualFootprint, assumptions),
    [audit, manualFootprint, assumptions]
  );

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

  // Persist prospects list in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(PROSPECTS_STORAGE_KEY, JSON.stringify(prospects));
    } catch {
      // Ignore storage quota issues
    }
  }, [prospects]);

  // Autosave manual footprint per project key
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
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues
    }
  };

  const hasConfiguredAI =
    aiSettings.baseUrl.trim().length > 0 &&
    aiSettings.apiKey.trim().length > 0 &&
    aiSettings.model.trim().length > 0;

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

      const nextProject: ProjectBrief = {
        ...project,
        websiteUrl: result.pageFacts.url || websiteUrl,
        clientName:
          derivedCaptureName && !project.clientName.trim()
            ? derivedCaptureName
            : project.clientName,
      };
      setProject(nextProject);
      setAiSearchLayer(buildDefaultAISearchLayer(nextProject, result.pageFacts, walkthrough));
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
      const nextProject: ProjectBrief = {
        ...project,
        websiteUrl: resolvedUrl,
        clientName:
          !project.clientName.trim() && derivedAuditName
            ? derivedAuditName
            : project.clientName,
      };
      setProject(nextProject);

      if (!pageFacts && result.parsed) {
        setPageFacts({
          url: resolvedUrl,
          title: result.parsed.title,
          description: result.parsed.metaDescription,
          headings: result.parsed.headings,
          ctas: result.parsed.ctaTexts,
        });
      }
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unable to run site audit.');
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setIsAuditing(false);
    }
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
  };

  const handlePromoteProspect = (prospect: ProspectEntry) => {
    handleOpenProspectScorecard(prospect);
    setAuditTab('scorecard');
    setTimeout(() => {
      document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleGenerate = async () => {
    setErrorMessage(null);

    if (!hasConfiguredAI) {
      setSettingsOpen(true);
      setErrorMessage('Configure your AI Base URL, API key, and model name in Settings first.');
      return;
    }

    if (screenshots.length < 3 || screenshots.length > 6) {
      setErrorMessage('Please upload between 3 and 6 website screenshots.');
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
      setTimeout(() => {
        document.getElementById('walkthrough')?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
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
    setProject({
      ...SAMPLE_PROJECT_BRIEF,
      websiteUrl: sampleAudit.audit.requestedUrl,
    });
    setScreenshots(buildSampleScreenshots());
    setAiSearchLayer(buildDefaultAISearchLayer(SAMPLE_PROJECT_BRIEF, null, null));
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
    setTimeout(() => {
      document.getElementById('walkthrough')?.scrollIntoView({ behavior: 'smooth' });
    }, 120);
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
          }
        : project;

      setProject(nextProject);
      const nextFacts = migrated.pageFacts || null;
      setPageFacts(nextFacts);

      if (migrated.audit !== undefined) setAudit(migrated.audit);
      if (migrated.manualFootprint) setManualFootprint(migrated.manualFootprint);
      if (migrated.assumptions) setAssumptions(migrated.assumptions);
      if (Array.isArray(migrated.prospects)) setProspects(migrated.prospects);

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
        setTimeout(() => {
          document.getElementById('walkthrough')?.scrollIntoView({ behavior: 'smooth' });
        }, 120);
      } else if (migrated.audit) {
        setAuditTab('scorecard');
        setTimeout(() => {
          document.getElementById('audit')?.scrollIntoView({ behavior: 'smooth' });
        }, 120);
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

  const showPrintableLayer = Boolean(walkthrough || audit || scorecard.knownChecks > 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Three-Zone Top Bar */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#studio"
            className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            TourForge Lite
          </a>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <a
              href="#studio"
              className="transition-colors hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
            >
              Inputs
            </a>
            <a
              href="#audit"
              className="transition-colors hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
            >
              Audit
            </a>
            {walkthrough && (
              <>
                <a
                  href="#walkthrough"
                  className="transition-colors hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
                >
                  Walkthrough
                </a>
                <a
                  href="#proposal"
                  className="transition-colors hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
                >
                  Proposal
                </a>
              </>
            )}
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
              <span>Settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-14 px-4 py-8 sm:px-6 sm:py-10">
        <IntakeStudio
          project={project}
          screenshots={screenshots}
          pageFacts={pageFacts}
          isCapturing={isCapturing}
          captureError={captureError}
          isGenerating={isGenerating}
          generationStage={generationStage}
          errorMessage={errorMessage}
          hasConfiguredAI={hasConfiguredAI}
          onProjectChange={setProject}
          onScreenshotsChange={setScreenshots}
          onCaptureSite={(url) => void handleCaptureSite(url)}
          onClearPageFacts={() => setPageFacts(null)}
          onGenerate={() => void handleGenerate()}
          onLoadSampleInputs={handleLoadSampleInputs}
          onPreviewSampleTour={handlePreviewSampleTour}
          onImportJson={(file) => void handleImportJson(file)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

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
          prospects={prospects}
          captureUrl={aiSettings.captureUrl}
          captureToken={aiSettings.captureToken}
          onRunAudit={(url) => void handleRunAudit(url)}
          onLoadSampleAudit={handleLoadSampleAudit}
          onManualFootprintChange={setManualFootprint}
          onAssumptionsChange={setAssumptions}
          onProspectsChange={setProspects}
          onOpenProspectScorecard={handleOpenProspectScorecard}
          onPromoteProspect={handlePromoteProspect}
          onPrintScorecard={handlePrintScorecard}
          onExportAuditJson={() => downloadBundleJson('audit')}
        />

        {walkthrough && (
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
              aiSearchLayer={aiSearchLayer}
              audit={audit}
              manualFootprint={manualFootprint}
              onTitleChange={handleTitleChange}
              onOutcomesChange={handleOutcomesChange}
              onRoadmapChange={handleRoadmapChange}
              onFootprintChange={setFootprint}
              onPricingChange={setPricingTiers}
              onAISearchLayerChange={setAiSearchLayer}
              onResetAISearchLayer={() =>
                setAiSearchLayer(buildDefaultAISearchLayer(project, pageFacts, walkthrough))
              }
              onExportJson={() => downloadBundleJson('walkthrough')}
              onPrintPdf={handlePrintPdf}
            />
          </>
        )}

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
          />
        )}
      </main>

      <footer className="no-print border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        TourForge Lite · Evidence-based website audits, walkthroughs, and 2027 proposals
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
