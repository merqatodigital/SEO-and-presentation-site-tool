import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileJson,
  Globe,
  ImagePlus,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { AuditResult, ProspectEntry, Scorecard } from '../audit/types';
import { PageFacts, ProjectBrief, ScreenshotAsset, getContrastTextColor } from '../types/tour';
import { ProspectsPanel } from './ProspectsPanel';

interface IntakeStudioProps {
  project: ProjectBrief;
  screenshots: ScreenshotAsset[];
  pageFacts: PageFacts | null;
  isCapturing: boolean;
  captureError: string | null;
  isAuditing: boolean;
  auditStageLabel: string;
  auditError: string | null;
  audit: AuditResult | null;
  scorecard: Scorecard;
  prospects: ProspectEntry[];
  captureUrl: string;
  captureToken: string;
  isGenerating: boolean;
  generationStage: string;
  errorMessage: string | null;
  hasConfiguredAI: boolean;
  onProjectChange: (next: ProjectBrief) => void;
  onScreenshotsChange: (next: ScreenshotAsset[]) => void;
  onScanAndCapture: (websiteUrl: string) => void;
  onCaptureOnly: (websiteUrl: string) => void;
  onAuditOnly: (websiteUrl: string) => void;
  onClearPageFacts: () => void;
  onGenerate: () => void;
  onLoadSampleInputs: () => void;
  onPreviewSampleTour: () => void;
  onImportJson: (file: File) => void;
  onOpenSettings: () => void;
  onGoToStep: (step: 1 | 2 | 3 | 4) => void;
  onProspectsChange: (next: ProspectEntry[]) => void;
  onOpenProspectScorecard: (prospect: ProspectEntry) => void;
  onPromoteProspect: (prospect: ProspectEntry) => void;
}

const COLOR_PRESETS = ['#0F766E', '#1D4ED8', '#0F172A', '#B45309', '#9F1239', '#4338CA'];

async function processImageFile(file: File, maxDimension = 1600): Promise<ScreenshotAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Invalid image file: ${file.name}`));
    image.src = dataUrl;
  });

  let targetWidth = img.naturalWidth;
  let targetHeight = img.naturalHeight;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    dataUrl: compressedDataUrl,
    width: targetWidth,
    height: targetHeight,
  };
}

export const IntakeStudio: React.FC<IntakeStudioProps> = ({
  project,
  screenshots,
  pageFacts,
  isCapturing,
  captureError,
  isAuditing,
  auditStageLabel,
  auditError,
  audit,
  scorecard,
  prospects,
  captureUrl,
  captureToken,
  isGenerating,
  generationStage,
  errorMessage,
  hasConfiguredAI,
  onProjectChange,
  onScreenshotsChange,
  onScanAndCapture,
  onCaptureOnly,
  onAuditOnly,
  onClearPageFacts,
  onGenerate,
  onLoadSampleInputs,
  onPreviewSampleTour,
  onImportJson,
  onOpenSettings,
  onGoToStep,
  onProspectsChange,
  onOpenProspectScorecard,
  onPromoteProspect,
}) => {
  const websiteUrl = project.websiteUrl ?? '';
  const [intakeMode, setIntakeMode] = useState<'single' | 'prospects'>('single');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const brandContrast = getContrastTextColor(project.brandColor);
  const isBusy = isCapturing || isAuditing || isGenerating;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadNotice(null);

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setUploadNotice('Please select PNG, JPG, or WebP screenshot images.');
      return;
    }

    const availableSlots = 6 - screenshots.length;
    if (availableSlots <= 0) {
      setUploadNotice('Maximum of 6 screenshots reached. Remove one to add another.');
      return;
    }

    const filesToProcess = imageFiles.slice(0, availableSlots);
    if (imageFiles.length > availableSlots) {
      setUploadNotice(`Added ${filesToProcess.length} screenshots (6 maximum allowed).`);
    }

    try {
      const processed = await Promise.all(filesToProcess.map((f) => processImageFile(f)));
      onScreenshotsChange([...screenshots, ...processed]);
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : 'Unable to process screenshot.');
    }
  };

  const handleLogoFile = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const processed = await processImageFile(file, 480);
    onProjectChange({ ...project, logoDataUrl: processed.dataUrl });
  };

  const moveScreenshot = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= screenshots.length) return;
    const copy = [...screenshots];
    const [item] = copy.splice(index, 1);
    copy.splice(nextIndex, 0, item);
    onScreenshotsChange(copy);
  };

  const removeScreenshot = (id: string) => {
    onScreenshotsChange(screenshots.filter((s) => s.id !== id));
  };

  const screenshotCountValid = screenshots.length >= 3 && screenshots.length <= 6;
  const briefValid =
    project.clientName.trim().length > 0 &&
    project.businessType.trim().length > 0 &&
    project.brief.trim().length > 0;

  return (
    <section id="step-1" className="no-print space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Step 1 · Client Intake &amp; Automated Site Scan
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl [text-wrap:balance]">
            Scan a website to measure visibility, capture screens, and build the brief
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Start with one client URL to run the technical audit + screenshot capture together, or scan a batch of prospects in bulk.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg bg-slate-200/80 p-1 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setIntakeMode('single')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                intakeMode === 'single'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Single Client
            </button>
            <button
              type="button"
              onClick={() => setIntakeMode('prospects')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors tabular-nums whitespace-nowrap ${
                intakeMode === 'prospects'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Batch Prospects ({prospects.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onLoadSampleInputs}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Load sample
          </button>
          <button
            type="button"
            onClick={onPreviewSampleTour}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            Preview tour
          </button>
          <button
            type="button"
            onClick={() => jsonInputRef.current?.click()}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <FileJson className="h-3.5 w-3.5" />
            Import JSON
          </button>
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportJson(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {intakeMode === 'prospects' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
          <ProspectsPanel
            prospects={prospects}
            captureUrl={captureUrl}
            captureToken={captureToken}
            onProspectsChange={onProspectsChange}
            onOpenScorecard={onOpenProspectScorecard}
            onPromoteToProject={onPromoteProspect}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left 7 columns: Unified URL Scan & Capture + Screenshots */}
          <div className="lg:col-span-7">
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    1. Website URL, Technical Scan &amp; Screenshots
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    Runs live HTML/AI-bot/speed audit + captures up to 5 desktop screens in one click.
                  </p>
                </div>
                <span
                  className={`text-xs font-medium tabular-nums ${
                    screenshotCountValid
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {screenshots.length} / 6 screens
                </span>
              </div>

              {/* Unified Scan & Capture Bar */}
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <label
                  htmlFor="website-url-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Client Website URL
                </label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="website-url-input"
                      type="url"
                      value={websiteUrl}
                      onChange={(e) =>
                        onProjectChange({ ...project, websiteUrl: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isBusy && websiteUrl.trim()) {
                          e.preventDefault();
                          onScanAndCapture(websiteUrl);
                        }
                      }}
                      disabled={isBusy}
                      placeholder="https://client-website.com"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onScanAndCapture(websiteUrl)}
                    disabled={isBusy || !websiteUrl.trim()}
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isAuditing || isCapturing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>
                          {isAuditing ? auditStageLabel || 'Scanning site...' : 'Capturing screens...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        <span>Scan &amp; Capture Site</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Granular optional actions */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400">
                    <button
                      type="button"
                      onClick={() => onAuditOnly(websiteUrl)}
                      disabled={isBusy || !websiteUrl.trim()}
                      className="underline underline-offset-4 hover:text-slate-900 disabled:opacity-40 dark:hover:text-white"
                    >
                      Audit checks only
                    </button>
                    <button
                      type="button"
                      onClick={() => onCaptureOnly(websiteUrl)}
                      disabled={isBusy || !websiteUrl.trim()}
                      className="underline underline-offset-4 hover:text-slate-900 disabled:opacity-40 dark:hover:text-white"
                    >
                      Screenshots only
                    </button>
                  </div>

                  {audit && (
                    <button
                      type="button"
                      onClick={() => onGoToStep(2)}
                      className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:underline dark:text-slate-100 tabular-nums"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>
                        Scorecard ready:{' '}
                        {scorecard.overallScore !== null
                          ? `${scorecard.overallScore}/100 (${scorecard.grade})`
                          : 'View Step 2'}{' '}
                        →
                      </span>
                    </button>
                  )}
                </div>

                {auditError && (
                  <div className="mt-2.5 flex items-start justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span>Audit error: {auditError}</span>
                    </div>
                  </div>
                )}

                {captureError && (
                  <div className="mt-2.5 flex items-start justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span>Capture error: {captureError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="shrink-0 font-semibold underline underline-offset-4 hover:text-rose-950 dark:hover:text-white"
                    >
                      Open Settings
                    </button>
                  </div>
                )}

                {pageFacts && !captureError && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <span className="truncate tabular-nums">
                      Captured page facts{pageFacts.title ? `: ${pageFacts.title}` : ''} ·{' '}
                      {pageFacts.headings.length} headings · {pageFacts.ctas.length} CTAs
                    </span>
                    <button
                      type="button"
                      onClick={onClearPageFacts}
                      className="font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white shrink-0"
                    >
                      Clear facts
                    </button>
                  </div>
                )}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  void handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-7 text-center transition-colors ${
                  isDragging
                    ? 'border-slate-900 bg-slate-100 dark:border-slate-300 dark:bg-slate-800'
                    : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:border-slate-600 dark:hover:bg-slate-800/40'
                }`}
              >
                <Upload className="h-6 w-6 text-slate-500 dark:text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  Drop website screenshots here, or browse files
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Optional for Audit/Scorecard · Required (3–6 screens) for Vision Walkthrough
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {uploadNotice && (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{uploadNotice}</p>
              )}

              {screenshots.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {screenshots.map((shot, idx) => (
                    <div
                      key={shot.id}
                      className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-200 dark:bg-slate-900">
                        <img
                          src={shot.dataUrl}
                          alt={`Screenshot ${idx + 1}: ${shot.name}`}
                          className="h-full w-full object-cover object-top"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                            Screen {idx + 1} · {shot.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {shot.width} × {shot.height}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveScreenshot(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`Move screen ${idx + 1} earlier`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveScreenshot(idx, 1)}
                            disabled={idx === screenshots.length - 1}
                            aria-label={`Move screen ${idx + 1} later`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeScreenshot(shot.id)}
                            aria-label={`Remove screen ${idx + 1}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-rose-100 hover:text-rose-700 dark:text-slate-400 dark:hover:bg-rose-950 dark:hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 columns: Client Brief & Branding */}
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                2. Client Brief &amp; Branding
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Auto-populated on scan; tailor details before generating reports or walkthroughs.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="client-name"
                    className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                  >
                    Client Name
                  </label>
                  <input
                    id="client-name"
                    type="text"
                    value={project.clientName}
                    onChange={(e) => onProjectChange({ ...project, clientName: e.target.value })}
                    placeholder="Harborcrest Dental Studio"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                </div>

                <div>
                  <label
                    htmlFor="business-type"
                    className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                  >
                    Business Type
                  </label>
                  <input
                    id="business-type"
                    type="text"
                    value={project.businessType}
                    onChange={(e) => onProjectChange({ ...project, businessType: e.target.value })}
                    placeholder="Family & Cosmetic Dentistry"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                </div>

                <div>
                  <label
                    htmlFor="short-brief"
                    className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                  >
                    Short Brief
                  </label>
                  <textarea
                    id="short-brief"
                    rows={4}
                    value={project.brief}
                    onChange={(e) => onProjectChange({ ...project, brief: e.target.value })}
                    placeholder="What business goals matter most to this owner? (e.g., direct bookings, local Maps visibility, answering after-hours inquiries)"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="brand-color"
                      className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                    >
                      Brand Primary Color
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="brand-color"
                        type="color"
                        value={project.brandColor}
                        onChange={(e) => onProjectChange({ ...project, brandColor: e.target.value })}
                        className="h-10 w-11 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        value={project.brandColor}
                        onChange={(e) => onProjectChange({ ...project, brandColor: e.target.value })}
                        aria-label="Brand color hex code"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {COLOR_PRESETS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => onProjectChange({ ...project, brandColor: hex })}
                          aria-label={`Select color ${hex}`}
                          style={{ backgroundColor: hex }}
                          className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                            project.brandColor.toLowerCase() === hex.toLowerCase()
                              ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-slate-100 dark:ring-offset-slate-900'
                              : 'border-black/15'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                      Client Logo (Optional)
                    </span>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      {project.logoDataUrl ? (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                          <img
                            src={project.logoDataUrl}
                            alt="Client logo"
                            className="h-7 w-7 rounded object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => onProjectChange({ ...project, logoDataUrl: null })}
                            className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => logoInputRef.current?.click()}
                          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <ImagePlus className="h-4 w-4" />
                          Upload logo
                        </button>
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void handleLogoFile(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </div>
                </div>

                {!hasConfiguredAI && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    Choose OpenRouter Free, Paid, NVIDIA NIM, or Local Ollama in{' '}
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="font-semibold underline underline-offset-4 hover:text-slate-900 dark:hover:text-white"
                    >
                      AI Settings
                    </button>{' '}
                    to run AI analysis reports or walkthrough generation.
                  </div>
                )}

                {errorMessage && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">Could not generate walkthrough</p>
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="text-xs font-semibold underline underline-offset-4 hover:text-rose-950 dark:hover:text-white shrink-0"
                      >
                        Open Settings
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed opacity-90">
                      {errorMessage}
                    </p>
                  </div>
                )}

                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => onGoToStep(2)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <span>Step 2: Review Scorecard &amp; GBP</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={isGenerating || !screenshotCountValid || !briefValid}
                    style={{ backgroundColor: project.brandColor, color: brandContrast }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{generationStage || 'Generating walkthrough...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        <span>Quick-Generate Walkthrough &amp; Proposal</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
