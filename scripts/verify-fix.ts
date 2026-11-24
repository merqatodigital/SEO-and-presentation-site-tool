#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { computeScorecard } from '../src/audit/scorecard.ts';
import {
  AuditCategoryId,
  AuditResult,
  Scorecard,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from '../src/audit/types.ts';
import { redactSecretsFromText } from '../src/fix/plan.ts';
import { runAuditTarget } from './agent-audit.ts';
import { loadBundleOrAuditPayload, validateRepoSlug } from './apply-repo-fixes.ts';

const execFile = promisify(execFileCb);

export interface VerifyFixCliOptions {
  previewUrl: string;
  bundlePath: string;
  prRef: string | null;
  repo: string | null;
  serverUrl: string | null;
  captureToken: string;
}

export interface CategoryScoreDelta {
  id: AuditCategoryId;
  label: string;
  beforeScore: number | null;
  afterScore: number | null;
  delta: number | null;
  summary: string;
}

export interface ScoreDeltaReport {
  previewUrl: string;
  beforeScorecard: Scorecard;
  afterScorecard: Scorecard;
  overallSummary: string;
  securitySummary: string;
  categoryDeltas: CategoryScoreDelta[];
  resolvedFindingIds: string[];
  remainingFailures: Array<{ id: string; label: string; status: string }>;
  markdownComment: string;
}

export function parseVerifyCliArgs(argv: string[]): VerifyFixCliOptions | { help: true } {
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

  return {
    previewUrl: (
      getFlag('url') ||
      getFlag('preview-url') ||
      getFlag('preview') ||
      ''
    ).trim(),
    bundlePath: (getFlag('bundle') || getFlag('audit') || '').trim(),
    prRef: getFlag('pr')?.trim() || null,
    repo: getFlag('repo')?.trim() || null,
    serverUrl: getFlag('server') || process.env.TOURFORGE_SERVER_URL?.trim() || null,
    captureToken: getFlag('token') || process.env.CAPTURE_TOKEN?.trim() || '',
  };
}

function formatDeltaText(before: number | null, after: number | null): {
  delta: number | null;
  summary: string;
} {
  const beforeLabel = before !== null ? `${before}` : 'N/A';
  const afterLabel = after !== null ? `${after}` : 'N/A';
  if (before === null || after === null) {
    return { delta: null, summary: `before ${beforeLabel} -> after ${afterLabel}` };
  }
  const delta = after - before;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  return {
    delta,
    summary: `before ${before} -> after ${after} (${sign})`,
  };
}

export function computeScoreDeltaReport(params: {
  previewUrl: string;
  beforeBundleOrAudit: Record<string, unknown>;
  afterAudit: AuditResult;
}): ScoreDeltaReport {
  const bundle = loadBundleOrAuditPayload(params.beforeBundleOrAudit);
  const manual = bundle.manualFootprint ?? createEmptyManualFootprint();
  const assumptions = bundle.assumptions ?? createDefaultAssumptions();

  const beforeScorecard =
    bundle.scorecard ?? computeScorecard(bundle.audit ?? null, manual, assumptions);
  const afterScorecard = computeScorecard(params.afterAudit, manual, assumptions);

  const overallFmt = formatDeltaText(
    beforeScorecard.overallScore,
    afterScorecard.overallScore
  );

  const categoryDeltas: CategoryScoreDelta[] = afterScorecard.categories.map((afterCat) => {
    const beforeCat = beforeScorecard.categories.find((c) => c.id === afterCat.id);
    const fmt = formatDeltaText(beforeCat?.score ?? null, afterCat.score);
    return {
      id: afterCat.id,
      label: afterCat.label,
      beforeScore: beforeCat?.score ?? null,
      afterScore: afterCat.score,
      delta: fmt.delta,
      summary: fmt.summary,
    };
  });

  const secDelta = categoryDeltas.find((c) => c.id === 'security');
  const securitySummary = secDelta?.summary ?? 'before N/A -> after N/A';

  const beforeBad = new Set(
    (bundle.audit?.findings ?? [])
      .filter((f) => f.status === 'fail' || f.status === 'warn')
      .map((f) => f.id)
  );
  const afterMap = new Map(params.afterAudit.findings.map((f) => [f.id, f]));
  const resolvedFindingIds: string[] = [];
  for (const id of beforeBad) {
    if (afterMap.get(id)?.status === 'pass') {
      resolvedFindingIds.push(id);
    }
  }

  const remainingFailures = params.afterAudit.findings
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .map((f) => ({ id: f.id, label: f.label, status: f.status }));

  const lines: string[] = [
    `## TourForge Preview Re-Audit Delta`,
    '',
    `- **Preview URL:** ${params.previewUrl}`,
    `- **Overall Score:** ${overallFmt.summary}`,
    `- **Passive Security & Headers:** ${securitySummary}`,
    `- **High-Severity Security Findings:** ${bundle.audit?.security?.highSeverityCount ?? 'N/A'} -> ${params.afterAudit.security?.highSeverityCount ?? 'N/A'}`,
    '',
    '| Category | Score Delta |',
    '| --- | --- |',
    ...categoryDeltas.map((c) => `| ${c.label} | ${c.summary} |`),
    '',
  ];

  if (resolvedFindingIds.length > 0) {
    lines.push(
      `### Resolved Findings (${resolvedFindingIds.length})`,
      ...resolvedFindingIds.map((id) => `- \`${id}\` (now PASS)`),
      ''
    );
  }

  if (remainingFailures.length > 0) {
    lines.push(
      `### Remaining Open Findings (${remainingFailures.length})`,
      ...remainingFailures.slice(0, 12).map((f) => `- \`${f.id}\` [${f.status.toUpperCase()}]: ${f.label}`),
      ''
    );
  }

  return {
    previewUrl: params.previewUrl,
    beforeScorecard,
    afterScorecard,
    overallSummary: overallFmt.summary,
    securitySummary,
    categoryDeltas,
    resolvedFindingIds,
    remainingFailures,
    markdownComment: redactSecretsFromText(lines.join('\n').trim() + '\n'),
  };
}

export async function executeVerifyFix(options: {
  previewUrl: string;
  bundle: Record<string, unknown>;
  prRef?: string | null;
  repo?: string | null;
  serverUrl?: string | null;
  captureToken?: string;
  deps?: {
    runAudit?: (url: string) => Promise<AuditResult>;
    postPrComment?: (args: { prRef: string; repo?: string | null; body: string }) => Promise<void>;
  };
}): Promise<{ report: ScoreDeltaReport; afterAudit: AuditResult; commented: boolean }> {
  const afterAudit = options.deps?.runAudit
    ? await options.deps.runAudit(options.previewUrl)
    : await runAuditTarget(options.previewUrl, {
        serverUrl: options.serverUrl,
        captureToken: options.captureToken,
      });

  const report = computeScoreDeltaReport({
    previewUrl: options.previewUrl,
    beforeBundleOrAudit: options.bundle,
    afterAudit,
  });

  let commented = false;
  if (options.prRef) {
    if (options.deps?.postPrComment) {
      await options.deps.postPrComment({
        prRef: options.prRef,
        repo: options.repo,
        body: report.markdownComment,
      });
      commented = true;
    } else {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tourforge-verify-'));
      try {
        const bodyPath = path.join(tmpDir, 'comment.md');
        await fs.writeFile(bodyPath, report.markdownComment, 'utf8');
        const args = ['pr', 'comment', options.prRef, '--body-file', bodyPath];
        if (options.repo) {
          args.push('--repo', validateRepoSlug(options.repo));
        }
        await execFile('gh', args, { timeout: 30_000 });
        commented = true;
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return { report, afterAudit, commented };
}

async function main() {
  const parsed = parseVerifyCliArgs(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(`TourForge Re-Audit & PR Delta Proof

Usage:
  npm run verify:fix -- --url https://preview.example.com --bundle tourforge-bundle.json [options]

Options:
  --url <url>        Deployed preview URL to re-audit (required)
  --bundle <file>    Original tourforge-bundle.json from before the PR (required)
  --pr <num|url>     Optional GitHub PR number or URL to comment the score delta on
  --repo <owner/name> Optional repository slug when --pr is a PR number
  --server <url>     Optional running TourForge server URL for /api/audit
  --token <token>    Optional CAPTURE_TOKEN for --server
`);
    process.exit(0);
  }

  if (!parsed.previewUrl || !parsed.bundlePath) {
    console.error('Error: --url <previewUrl> and --bundle <bundle.json> are required.');
    process.exit(1);
  }

  const rawBundle = JSON.parse(
    await fs.readFile(path.resolve(parsed.bundlePath), 'utf8')
  ) as Record<string, unknown>;

  const { report, commented } = await executeVerifyFix({
    previewUrl: parsed.previewUrl,
    bundle: rawBundle,
    prRef: parsed.prRef,
    repo: parsed.repo,
    serverUrl: parsed.serverUrl,
    captureToken: parsed.captureToken,
  });

  console.log(report.markdownComment);
  if (parsed.prRef) {
    console.log(commented ? `Posted score delta to PR ${parsed.prRef}.` : 'Did not post PR comment.');
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('[TourForge verify:fix] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
