#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { enqueueAudit } from '../serverAudit.ts';
import { buildAiReadinessSummary } from '../src/audit/aiReadiness.ts';
import {
  buildAgentMarkdownReport,
  buildAgentOutputBundle,
  buildGeneratedRepoAssets,
  buildGitHubIssueBody,
  buildRepoChangeChecklist,
} from '../src/audit/githubReport.ts';
import { computeScorecard } from '../src/audit/scorecard.ts';
import {
  AuditResult,
  AuditResultSchema,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from '../src/audit/types.ts';
import { runSiteAnalysisAgent } from '../src/lib/aiClient.ts';
import { AISettings, CurrencyCode, DEFAULT_AI_SETTINGS } from '../src/types/tour.ts';

export interface CliOptions {
  url: string;
  outDir: string | null;
  serverUrl: string | null;
  captureToken: string;
  clientName?: string;
  businessType?: string;
  currency: CurrencyCode;
  repoName?: string;
  runAi: boolean;
  jsonStdout: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions | { help: true } {
  const getFlag = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
      return argv[idx + 1];
    }
    const prefix = `--${name}=`;
    const eqArg = argv.find((a) => a.startsWith(prefix));
    return eqArg ? eqArg.slice(prefix.length) : undefined;
  };

  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const url = (getFlag('url') || argv.find((a) => /^https?:\/\//i.test(a)) || '').trim();
  const rawCurrency = (getFlag('currency') || 'PHP').toUpperCase();
  const currency: CurrencyCode =
    rawCurrency === 'USD' || rawCurrency === 'EUR' ? rawCurrency : 'PHP';

  return {
    url,
    outDir: getFlag('out') || null,
    serverUrl: getFlag('server') || process.env.TOURFORGE_SERVER_URL?.trim() || null,
    captureToken: getFlag('token') || process.env.CAPTURE_TOKEN?.trim() || '',
    clientName: getFlag('client'),
    businessType: getFlag('type'),
    currency,
    repoName: getFlag('repo') || process.env.GITHUB_REPOSITORY,
    runAi: argv.includes('--ai'),
    jsonStdout: argv.includes('--json'),
  };
}

export async function runAuditTarget(
  url: string,
  options: { serverUrl?: string | null; captureToken?: string }
): Promise<AuditResult> {
  if (options.serverUrl) {
    const base = options.serverUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options.captureToken) {
      headers.Authorization = `Bearer ${options.captureToken}`;
    }

    const res = await fetch(`${base}/api/audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    });
    const text = await res.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error(`TourForge server (${res.status}) returned non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const errMsg =
        parsedJson && typeof parsedJson === 'object' && 'error' in parsedJson
          ? String((parsedJson as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(`TourForge /api/audit failed (${res.status}): ${errMsg}`);
    }
    return AuditResultSchema.parse(parsedJson);
  }

  return enqueueAudit(url);
}

function buildNodeAiSettingsFromEnv(): AISettings {
  const ollamaUrl = process.env.OLLAMA_URL?.trim();
  const envBase = process.env.TOURFORGE_AI_BASE_URL?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim() || '';
  const genericKey = process.env.TOURFORGE_AI_API_KEY?.trim() || '';

  let baseUrl = envBase || DEFAULT_AI_SETTINGS.baseUrl;
  let apiKey = genericKey || openrouterKey || nvidiaKey;
  let providerPreset: AISettings['providerPreset'] = 'openrouter-free';

  if (!envBase) {
    if (openrouterKey) {
      baseUrl = 'https://openrouter.ai/api/v1';
      apiKey = openrouterKey;
      providerPreset = 'openrouter-free';
    } else if (nvidiaKey) {
      baseUrl = 'https://integrate.api.nvidia.com/v1';
      apiKey = nvidiaKey;
      providerPreset = 'nvidia';
    } else if (ollamaUrl && !/^(disabled|none)$/i.test(ollamaUrl)) {
      baseUrl = `${ollamaUrl.replace(/\/+$/, '')}/v1`;
      apiKey = '';
      providerPreset = 'ollama';
    }
  }

  const model =
    process.env.TOURFORGE_AI_MODEL?.trim() ||
    (providerPreset === 'ollama' ? 'qwen2.5:7b' : 'meta-llama/llama-3.3-70b-instruct:free');

  return {
    ...DEFAULT_AI_SETTINGS,
    baseUrl,
    apiKey,
    model,
    analysisModel: model,
    providerPreset,
  };
}

async function nodeCompleteChat(
  settings: AISettings,
  messages: Array<{ role: string; content: string }>,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.analysisModel || settings.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 1800,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AI provider returned HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI provider returned empty completion content.');
  }
  return content;
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(`TourForge Lite Headless Agent Audit CLI

Usage:
  npm run audit:cli -- --url https://example.com [options]

Options:
  --url <url>           Target public website URL (required)
  --out <dir>           Output folder for report.md, github-issue.md, tourforge-bundle.json, generated/*
  --server <url>        Remote/running TourForge server URL (e.g. http://127.0.0.1:3000). Runs in-process if omitted.
  --token <token>       Bearer token for --server (defaults to CAPTURE_TOKEN env var)
  --client <name>       Override derived client name
  --type <business>     Business category label (e.g. "Boutique Hotel", "Dental Clinic")
  --currency <code>     PHP | USD | EUR (default: PHP)
  --repo <owner/repo>   GitHub repository label included in reports (defaults to GITHUB_REPOSITORY)
  --ai                  Also run Site Analysis Agent narrative (uses OPENROUTER_API_KEY / NVIDIA_API_KEY / OLLAMA_URL)
  --json                Print JSON summary payload to stdout
`);
    process.exit(0);
  }

  if (!parsed.url) {
    console.error('Error: --url <https://...> is required. Run with --help for usage.');
    process.exit(1);
  }

  console.error(`[TourForge CLI] Auditing ${parsed.url} (${parsed.serverUrl ? `via ${parsed.serverUrl}` : 'in-process'})...`);

  const audit = await runAuditTarget(parsed.url, {
    serverUrl: parsed.serverUrl,
    captureToken: parsed.captureToken,
  });

  const manual = createEmptyManualFootprint();
  const assumptions = { ...createDefaultAssumptions(), currency: parsed.currency };
  const scorecard = computeScorecard(audit, manual, assumptions);
  const aiSummary = buildAiReadinessSummary(audit);

  const initialBundle = buildAgentOutputBundle({
    url: parsed.url,
    clientName: parsed.clientName,
    businessType: parsed.businessType,
    currency: parsed.currency,
    audit,
    scorecard,
    manual,
    assumptions,
  });

  let siteAnalysisReport = null;
  if (parsed.runAi) {
    const aiSettings = buildNodeAiSettingsFromEnv();
    console.error(`[TourForge CLI] Running Site Analysis Agent via ${aiSettings.baseUrl} (${aiSettings.analysisModel})...`);
    siteAnalysisReport = await runSiteAnalysisAgent({
      settings: aiSettings,
      project: initialBundle.project,
      audit,
      scorecard,
      manualFootprint: manual,
      aiSearchLayer: initialBundle.aiSearchLayer!,
      completeChat: (msgs) => nodeCompleteChat(aiSettings, msgs),
    });
  }

  const finalBundle = buildAgentOutputBundle({
    url: parsed.url,
    clientName: parsed.clientName,
    businessType: parsed.businessType,
    currency: parsed.currency,
    audit,
    scorecard,
    manual,
    assumptions,
    siteAnalysisReport,
  });

  const repoChanges = buildRepoChangeChecklist(audit, aiSummary);
  const assets = buildGeneratedRepoAssets(
    finalBundle.project,
    finalBundle.aiSearchLayer!,
    audit,
    manual
  );

  const markdownReport = buildAgentMarkdownReport({
    url: parsed.url,
    repoName: parsed.repoName,
    project: finalBundle.project,
    audit,
    scorecard,
    aiSummary,
    repoChanges,
    siteAnalysisReport,
  });

  const githubIssueMd = buildGitHubIssueBody({
    url: parsed.url,
    project: finalBundle.project,
    scorecard,
    aiSummary,
    repoChanges,
    bundleFileHint: parsed.outDir
      ? path.posix.join(parsed.outDir.replace(/\\/g, '/'), 'tourforge-bundle.json')
      : 'tourforge-bundle.json',
  });

  if (parsed.outDir) {
    const outAbs = path.resolve(parsed.outDir);
    const genDir = path.join(outAbs, 'generated');
    await fs.mkdir(genDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(outAbs, 'tourforge-bundle.json'), JSON.stringify(finalBundle, null, 2), 'utf8'),
      fs.writeFile(path.join(outAbs, 'report.md'), markdownReport, 'utf8'),
      fs.writeFile(path.join(outAbs, 'github-issue.md'), githubIssueMd, 'utf8'),
      fs.writeFile(path.join(genDir, 'robots.txt'), assets.robotsTxt + '\n', 'utf8'),
      fs.writeFile(path.join(genDir, 'llms.txt'), assets.llmsTxt + '\n', 'utf8'),
      fs.writeFile(path.join(genDir, 'schema.jsonld'), assets.schemaJsonLdTag + '\n', 'utf8'),
    ]);
    console.error(`[TourForge CLI] Wrote artifacts to ${outAbs}`);
  }

  if (parsed.jsonStdout) {
    console.log(
      JSON.stringify(
        {
          clientName: finalBundle.project.clientName,
          url: finalBundle.project.websiteUrl,
          overallScore: scorecard.overallScore,
          grade: scorecard.grade,
          isProvisional: scorecard.isProvisional,
          aiReadinessScore: aiSummary.score,
          repoChangesCount: repoChanges.length,
          repoChanges,
          outDir: parsed.outDir,
        },
        null,
        2
      )
    );
  } else {
    console.log(markdownReport);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('[TourForge CLI] Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
