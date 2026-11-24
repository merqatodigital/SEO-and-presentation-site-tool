#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildAiReadinessSummary } from '../src/audit/aiReadiness.ts';
import { buildRepoChangeChecklist } from '../src/audit/githubReport.ts';
import { computeScorecard } from '../src/audit/scorecard.ts';
import {
  AuditResultSchema,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from '../src/audit/types.ts';
import {
  ApplyPlan,
  PlannedFixAction,
  applyMetadataPlaceholders,
  buildApplyPlan,
  buildProjectDefaultsFromAudit,
  isAllowlistedFixPath,
  mergeNetlifyHeaders,
  mergeNextConfigJs,
  mergeNginxConf,
  mergeRobotsTxt,
  mergeVercelJsonConfig,
  redactSecretsFromText,
} from '../src/fix/plan.ts';
import { FullProjectBundle } from '../src/types/tour.ts';

const execFile = promisify(execFileCb);

const REPO_SLUG_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH_REGEX = /^fix\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface ApplyRepoCliOptions {
  repo: string;
  auditPath: string;
  outDir: string | null;
  branch: string;
  dryRun: boolean;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecCommandFn = (
  cmd: string,
  args: string[],
  cwd: string
) => Promise<CommandResult>;

export interface ApplyRepoResult {
  repo: string;
  branch: string;
  dryRun: boolean;
  applied: boolean;
  abortedReason: string | null;
  plan: ApplyPlan;
  appliedFiles: Array<{ path: string; operation: string; findingId: string; reason: string }>;
  skippedFiles: Array<{ path: string; reason: string }>;
  diff: string;
  prUrl: string | null;
  prBody: string;
}

export function validateRepoSlug(repo: string): string {
  const clean = repo.trim();
  if (!REPO_SLUG_REGEX.test(clean)) {
    throw new Error(`Invalid repository slug "${repo}". Expected "owner/name".`);
  }
  return clean;
}

export function defaultFixBranchName(now = new Date()): string {
  const datePart = now.toISOString().slice(0, 10);
  return `fix/tourforge-${datePart}`;
}

export function validateFixBranchName(branch: string): string {
  const clean = branch.trim();
  if (clean === 'main' || clean === 'master' || !SAFE_BRANCH_REGEX.test(clean) || clean.includes('..')) {
    throw new Error(
      `Invalid fix branch "${branch}". Branch must start with "fix/" and may never target main/master.`
    );
  }
  return clean;
}

export function parseApplyCliArgs(argv: string[]): ApplyRepoCliOptions | { help: true } {
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

  const hasApply = argv.includes('--apply');
  const hasDryRun = argv.includes('--dry-run');
  const dryRun = hasApply && !hasDryRun ? false : true;

  return {
    repo: (getFlag('repo') || '').trim(),
    auditPath: (getFlag('audit') || getFlag('bundle') || '').trim(),
    outDir: getFlag('out') || null,
    branch: (getFlag('branch') || defaultFixBranchName()).trim(),
    dryRun,
  };
}

async function defaultExecCommand(
  cmd: string,
  args: string[],
  cwd: string
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFile(cmd, args, {
      cwd,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? e.message ?? 'Command failed'),
    };
  }
}

async function listRepoFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listRepoFiles(rootDir, full);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(path.relative(rootDir, full).split(path.sep).join('/'));
    }
  }
  return results;
}

export function loadBundleOrAuditPayload(rawJson: unknown): FullProjectBundle {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Audit/bundle JSON must be an object.');
  }
  const obj = rawJson as Record<string, unknown>;
  if ('audit' in obj || 'project' in obj) {
    const bundle = obj as unknown as FullProjectBundle;
    if (bundle.audit) {
      AuditResultSchema.parse(bundle.audit);
    }
    return bundle;
  }
  const parsedAudit = AuditResultSchema.parse(rawJson);
  const defaults = buildProjectDefaultsFromAudit(parsedAudit);
  const scorecard = computeScorecard(parsedAudit, defaults.manual, defaults.assumptions);
  return {
    exportedAt: new Date().toISOString(),
    project: defaults.project,
    aiSearchLayer: defaults.aiSearchLayer,
    walkthrough: { title: `${defaults.project.clientName} Audit`, scenes: [], outcomes: [], roadmap: [] },
    footprint: [],
    pricingTiers: [],
    audit: parsedAudit,
    manualFootprint: defaults.manual,
    assumptions: defaults.assumptions,
    scorecard,
  };
}

function buildDraftPrBody(params: {
  bundle: FullProjectBundle;
  plan: ApplyPlan;
  appliedFiles: Array<{ path: string; operation: string; findingId: string; reason: string }>;
  skippedFiles: Array<{ path: string; reason: string }>;
}): string {
  const { bundle, plan, appliedFiles, skippedFiles } = params;
  const beforeOverall =
    plan.beforeScore !== null ? `${plan.beforeScore}/100` : 'Incomplete';
  const beforeSecurity =
    plan.securityScore !== null ? `${plan.securityScore}/100` : 'Insufficient data';

  const lines: string[] = [
    `## TourForge Bounded Automated Fixes (${bundle.project?.clientName || plan.targetUrl})`,
    '',
    `- **Audited URL:** ${plan.targetUrl || bundle.audit?.finalUrl || 'N/A'}`,
    `- **Before Overall Score:** ${beforeOverall}`,
    `- **Before Passive Security Score:** ${beforeSecurity}`,
    `- **Verification Required:** Re-run audit against preview URL to confirm`,
    '',
    '### Findings Addressed in This Draft PR',
    '',
  ];

  if (appliedFiles.length === 0) {
    lines.push('- No files were modified.');
  } else {
    for (const f of appliedFiles) {
      lines.push(
        `- \`${f.path}\` (${f.operation}) — **\`${f.findingId}\`**: ${redactSecretsFromText(f.reason)}`
      );
    }
  }

  const scenes = bundle.walkthrough?.scenes ?? [];
  if (scenes.length > 0 || bundle.pageFacts) {
    lines.push('', '### Audit Evidence & Captured Context', '');
    if (bundle.pageFacts?.title) {
      lines.push(`- **Captured Title:** ${redactSecretsFromText(bundle.pageFacts.title)}`);
    }
    for (const scene of scenes.slice(0, 5)) {
      const refs = scene.findingRefs?.length ? ` [${scene.findingRefs.join(', ')}]` : '';
      lines.push(
        `- **Shot #${scene.screenshotIndex + 1}:** ${redactSecretsFromText(scene.caption)}${refs} — ${redactSecretsFromText(scene.narration)}`
      );
    }
  }

  if (skippedFiles.length > 0 || plan.unhandledFindings.length > 0) {
    lines.push('', '### Items Left for Manual Review (Not Auto-Applied)', '');
    for (const sk of skippedFiles) {
      lines.push(`- \`${sk.path}\` skipped: ${redactSecretsFromText(sk.reason)}`);
    }
    for (const un of plan.unhandledFindings) {
      lines.push(`- **[${un.priority}] \`${un.findingId}\` (${un.title})**: ${redactSecretsFromText(un.reason)}`);
    }
  }

  lines.push(
    '',
    '### Confirm Score Delta',
    '```bash',
    'npm run verify:fix -- --url <PREVIEW_URL> --bundle <tourforge-bundle.json> --pr <THIS_PR_URL>',
    '```'
  );

  return redactSecretsFromText(lines.join('\n').trim() + '\n');
}

async function applyActionToFile(
  repoDir: string,
  action: PlannedFixAction
): Promise<{ applied: boolean; reason?: string }> {
  if (!action.safe) {
    return { applied: false, reason: action.unsafeReason || 'Marked unsafe by planner.' };
  }
  const allowCheck = isAllowlistedFixPath(action.path);
  if (!allowCheck.allowed || !allowCheck.normalizedPath) {
    return { applied: false, reason: allowCheck.reason || 'Path is not allowlisted.' };
  }

  const resolvedTarget = path.resolve(repoDir, allowCheck.normalizedPath);
  const resolvedRoot = path.resolve(repoDir);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return { applied: false, reason: 'Path escapes repository root boundary.' };
  }

  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(resolvedTarget, 'utf8');
  } catch {
    existingRaw = null;
  }

  let finalContent = action.content;
  if (action.path === 'vercel.json') {
    const merged = mergeVercelJsonConfig(existingRaw, action.content);
    if (!merged.ok) return { applied: false, reason: merged.reason };
    if (!merged.changed) return { applied: false, reason: 'All recommended Vercel headers already present.' };
    finalContent = merged.content;
  } else if (action.path === '_headers') {
    const merged = mergeNetlifyHeaders(existingRaw, action.content);
    if (!merged.ok) return { applied: false, reason: merged.reason };
    if (!merged.changed) return { applied: false, reason: 'All recommended _headers entries already present.' };
    finalContent = merged.content;
  } else if (action.path === 'nginx.conf') {
    const merged = mergeNginxConf(existingRaw, action.content);
    if (!merged.ok) return { applied: false, reason: merged.reason };
    if (!merged.changed) return { applied: false, reason: 'All recommended nginx directives already present.' };
    finalContent = merged.content;
  } else if (action.path === 'next.config.js') {
    const merged = mergeNextConfigJs(existingRaw, action.content);
    if (!merged.ok) return { applied: false, reason: merged.reason };
    if (!merged.changed) return { applied: false, reason: 'No changes needed in next.config.js.' };
    finalContent = merged.content;
  } else if (action.path === 'public/robots.txt') {
    const merged = mergeRobotsTxt(existingRaw, action.content);
    if (!merged.ok) return { applied: false, reason: merged.reason };
    if (!merged.changed) return { applied: false, reason: 'robots.txt already permits AI search crawlers.' };
    finalContent = merged.content;
  } else if (action.path === 'index.html' || action.path === 'app/layout.tsx') {
    const merged = applyMetadataPlaceholders(
      existingRaw,
      action.path,
      action.metadataPatch ?? {}
    );
    if (!merged.ok) return { applied: false, reason: merged.reason };
    finalContent = merged.content;
  } else if (existingRaw !== null) {
    if (existingRaw.trim() === action.content.trim()) {
      return { applied: false, reason: `${action.path} already matches generated content.` };
    }
    return {
      applied: false,
      reason: `${action.path} already exists with custom content; skipping overwrite.`,
    };
  }

  await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
  await fs.writeFile(resolvedTarget, finalContent, 'utf8');
  return { applied: true };
}

export async function executeApplyRepoFixes(options: {
  repo: string;
  bundle: FullProjectBundle | Record<string, unknown>;
  branch?: string;
  dryRun?: boolean;
  outDir?: string | null;
  deps?: {
    cloneSource?: string;
    execCommand?: ExecCommandFn;
    createDraftPr?: (args: {
      repo: string;
      branch: string;
      title: string;
      body: string;
      cwd: string;
    }) => Promise<string>;
  };
}): Promise<ApplyRepoResult> {
  const repo = validateRepoSlug(options.repo);
  const branch = validateFixBranchName(options.branch || defaultFixBranchName());
  const dryRun = options.dryRun !== false;
  const bundle = loadBundleOrAuditPayload(options.bundle);
  const audit = bundle.audit ?? null;
  if (!audit) {
    throw new Error('Bundle does not contain an audit result.');
  }

  const exec = options.deps?.execCommand ?? defaultExecCommand;
  const cloneSource = options.deps?.cloneSource || `https://github.com/${repo}.git`;

  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'tourforge-fix-'));
  const repoDir = path.join(tmpBase, 'repo');

  try {
    const cloneRes = await exec('git', ['clone', '--depth', '1', cloneSource, repoDir], tmpBase);
    if (cloneRes.code !== 0) {
      throw new Error(`git clone failed: ${redactSecretsFromText(cloneRes.stderr || cloneRes.stdout)}`);
    }

    const checkoutRes = await exec('git', ['checkout', '-b', branch], repoDir);
    if (checkoutRes.code !== 0) {
      throw new Error(`git checkout -b failed: ${redactSecretsFromText(checkoutRes.stderr)}`);
    }

    const existingFiles = await listRepoFiles(repoDir);
    const manual = bundle.manualFootprint ?? createEmptyManualFootprint();
    const assumptions = bundle.assumptions ?? createDefaultAssumptions();
    const scorecard = bundle.scorecard ?? computeScorecard(audit, manual, assumptions);
    const aiSummary = buildAiReadinessSummary(audit);
    const repoChanges = buildRepoChangeChecklist(audit, aiSummary);

    const plan = buildApplyPlan({
      audit,
      repoChanges,
      bundle,
      scorecard,
      existingFiles,
    });

    const appliedFiles: Array<{
      path: string;
      operation: string;
      findingId: string;
      reason: string;
    }> = [];
    const skippedFiles: Array<{ path: string; reason: string }> = [];

    for (const action of plan.actions) {
      const outcome = await applyActionToFile(repoDir, action);
      if (outcome.applied) {
        appliedFiles.push({
          path: action.path,
          operation: action.operation,
          findingId: action.findingId,
          reason: action.reason,
        });
      } else {
        skippedFiles.push({
          path: action.path,
          reason: outcome.reason || 'Skipped',
        });
      }
    }

    let diff = '';
    if (appliedFiles.length > 0) {
      const addRes = await exec(
        'git',
        ['add', '--', ...appliedFiles.map((f) => f.path)],
        repoDir
      );
      if (addRes.code !== 0) {
        throw new Error(`git add failed: ${redactSecretsFromText(addRes.stderr)}`);
      }
      const diffRes = await exec('git', ['diff', '--cached'], repoDir);
      diff = redactSecretsFromText(diffRes.stdout);
    }

    const prBody = buildDraftPrBody({
      bundle,
      plan,
      appliedFiles,
      skippedFiles,
    });

    if (options.outDir) {
      const outAbs = path.resolve(options.outDir);
      await fs.mkdir(outAbs, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(outAbs, 'apply-plan.json'), JSON.stringify(plan, null, 2), 'utf8'),
        fs.writeFile(path.join(outAbs, 'apply-diff.patch'), diff, 'utf8'),
        fs.writeFile(path.join(outAbs, 'pr-body.md'), prBody, 'utf8'),
      ]);
    }

    if (dryRun) {
      return {
        repo,
        branch,
        dryRun: true,
        applied: false,
        abortedReason: null,
        plan,
        appliedFiles,
        skippedFiles,
        diff,
        prUrl: null,
        prBody,
      };
    }

    if (appliedFiles.length === 0) {
      return {
        repo,
        branch,
        dryRun: false,
        applied: false,
        abortedReason: 'No safe allowlisted changes applied cleanly; aborting without PR.',
        plan,
        appliedFiles,
        skippedFiles,
        diff,
        prUrl: null,
        prBody,
      };
    }

    // Run repo lint/build checks if package.json defines them
    const pkgPath = path.join(repoDir, 'package.json');
    let pkgJson: {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } | null = null;
    try {
      pkgJson = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    } catch {
      pkgJson = null;
    }

    if (pkgJson?.scripts) {
      const hasDeps =
        Object.keys(pkgJson.dependencies ?? {}).length > 0 ||
        Object.keys(pkgJson.devDependencies ?? {}).length > 0;
      const hasLock = existingFiles.includes('package-lock.json');
      if (hasDeps && hasLock) {
        const ciRes = await exec('npm', ['ci', '--ignore-scripts'], repoDir);
        if (ciRes.code !== 0) {
          await exec('git', ['reset', '--hard', 'HEAD'], repoDir);
          return {
            repo,
            branch,
            dryRun: false,
            applied: false,
            abortedReason: `Dependency install failed before verification; branch discarded: ${redactSecretsFromText(ciRes.stderr || ciRes.stdout).slice(0, 400)}`,
            plan,
            appliedFiles,
            skippedFiles,
            diff,
            prUrl: null,
            prBody,
          };
        }
      }

      if (pkgJson.scripts.lint) {
        const lintRes = await exec('npm', ['run', 'lint'], repoDir);
        if (lintRes.code !== 0) {
          await exec('git', ['reset', '--hard', 'HEAD'], repoDir);
          return {
            repo,
            branch,
            dryRun: false,
            applied: false,
            abortedReason: `Repo lint failed; branch discarded with no push: ${redactSecretsFromText(lintRes.stderr || lintRes.stdout).slice(0, 400)}`,
            plan,
            appliedFiles,
            skippedFiles,
            diff,
            prUrl: null,
            prBody,
          };
        }
      }

      if (pkgJson.scripts.build) {
        const buildRes = await exec('npm', ['run', 'build'], repoDir);
        if (buildRes.code !== 0) {
          await exec('git', ['reset', '--hard', 'HEAD'], repoDir);
          return {
            repo,
            branch,
            dryRun: false,
            applied: false,
            abortedReason: `Repo build failed; branch discarded with no push: ${redactSecretsFromText(buildRes.stderr || buildRes.stdout).slice(0, 400)}`,
            plan,
            appliedFiles,
            skippedFiles,
            diff,
            prUrl: null,
            prBody,
          };
        }
      }
    }

    const commitMsg = `chore(tourforge): apply ${appliedFiles.length} deterministic visibility/security fix(es)`;
    const commitRes = await exec(
      'git',
      [
        '-c',
        'user.name=TourForge Bot',
        '-c',
        'user.email=tourforge-bot@users.noreply.github.com',
        'commit',
        '-m',
        commitMsg,
      ],
      repoDir
    );
    if (commitRes.code !== 0) {
      throw new Error(`git commit failed: ${redactSecretsFromText(commitRes.stderr || commitRes.stdout)}`);
    }

    // Never push to main/master; never force push
    validateFixBranchName(branch);
    const pushRes = await exec('git', ['push', '-u', 'origin', branch], repoDir);
    if (pushRes.code !== 0) {
      throw new Error(`git push failed: ${redactSecretsFromText(pushRes.stderr || pushRes.stdout)}`);
    }

    const prTitle = `TourForge fixes for ${bundle.project?.clientName || repo}`;
    let prUrl: string;
    if (options.deps?.createDraftPr) {
      prUrl = await options.deps.createDraftPr({
        repo,
        branch,
        title: prTitle,
        body: prBody,
        cwd: repoDir,
      });
    } else {
      const prBodyPath = path.join(tmpBase, 'pr-body.md');
      await fs.writeFile(prBodyPath, prBody, 'utf8');
      const ghRes = await exec(
        'gh',
        [
          'pr',
          'create',
          '--draft',
          '--repo',
          repo,
          '--head',
          branch,
          '--title',
          prTitle,
          '--body-file',
          prBodyPath,
        ],
        repoDir
      );
      if (ghRes.code !== 0) {
        throw new Error(`gh pr create failed: ${redactSecretsFromText(ghRes.stderr || ghRes.stdout)}`);
      }
      prUrl = ghRes.stdout.trim().split(/\r?\n/).pop()?.trim() || '';
    }

    return {
      repo,
      branch,
      dryRun: false,
      applied: true,
      abortedReason: null,
      plan,
      appliedFiles,
      skippedFiles,
      diff,
      prUrl,
      prBody,
    };
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const parsed = parseApplyCliArgs(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(`TourForge Bounded Repo Fix Runner

Usage:
  npm run fix:repo -- --repo owner/name --audit tourforge-bundle.json [options]

Options:
  --repo <owner/name>   Target GitHub repository slug (required)
  --audit <file>        Path to tourforge-bundle.json or AuditResult JSON (required)
  --branch <name>       Target branch (defaults to fix/tourforge-YYYY-MM-DD)
  --out <dir>           Write apply-plan.json, apply-diff.patch, and pr-body.md
  --dry-run             Plan and print diff without pushing or opening a PR (default)
  --apply               Commit, push fix branch, run repo checks, and open a Draft PR via gh
`);
    process.exit(0);
  }

  if (!parsed.repo || !parsed.auditPath) {
    console.error('Error: --repo <owner/name> and --audit <bundle.json> are required.');
    process.exit(1);
  }

  const rawText = await fs.readFile(path.resolve(parsed.auditPath), 'utf8');
  const rawJson = JSON.parse(rawText) as Record<string, unknown>;

  const result = await executeApplyRepoFixes({
    repo: parsed.repo,
    bundle: rawJson,
    branch: parsed.branch,
    dryRun: parsed.dryRun,
    outDir: parsed.outDir,
  });

  console.log(`=== TourForge Apply Plan (${result.dryRun ? 'DRY RUN' : 'APPLY'}) ===`);
  console.log(`Repo: ${result.repo} | Branch: ${result.branch}`);
  console.log(`Safe planned actions: ${result.plan.safeActionsCount} | Applied: ${result.appliedFiles.length} | Skipped/Unhandled: ${result.skippedFiles.length + result.plan.unhandledFindings.length}`);

  if (result.skippedFiles.length > 0) {
    console.log('\nSkipped actions:');
    for (const s of result.skippedFiles) {
      console.log(`  - ${s.path}: ${s.reason}`);
    }
  }

  if (result.diff) {
    console.log('\nDiff:\n' + result.diff);
  }

  if (result.abortedReason) {
    console.error(`\nAborted: ${result.abortedReason}`);
    process.exit(1);
  }

  if (result.prUrl) {
    console.log(`\nDraft PR created: ${result.prUrl}`);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('[TourForge fix:repo] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
