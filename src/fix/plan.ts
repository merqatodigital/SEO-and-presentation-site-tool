import path from 'node:path';
import { buildAiReadinessSummary } from '../audit/aiReadiness';
import {
  RepoFileChangeAction,
  buildGeneratedRepoAssets,
  buildSecurityHeaderSnippets,
} from '../audit/githubReport';
import { deriveClientName } from '../audit/htmlFindings';
import { buildValidatedJsonLd } from '../audit/jsonLd';
import { computeScorecard } from '../audit/scorecard';
import {
  AuditAssumptions,
  AuditResult,
  ManualFootprint,
  Scorecard,
  createDefaultAssumptions,
  createEmptyManualFootprint,
} from '../audit/types';
import {
  AISearchLayerData,
  FullProjectBundle,
  PageFacts,
  ProjectBrief,
  buildDefaultAISearchLayer,
} from '../types/tour';

export type ApplyOperation = 'create' | 'merge-config' | 'replace-placeholder';

export const ALLOWLISTED_FIX_PATHS = [
  'vercel.json',
  'next.config.js',
  '_headers',
  'nginx.conf',
  'public/robots.txt',
  'public/llms.txt',
  'public/schema.jsonld',
  'generated/security-badge.html',
  'index.html',
  'app/layout.tsx',
] as const;

export type AllowlistedFixPath = (typeof ALLOWLISTED_FIX_PATHS)[number];

const ALLOWLIST_SET = new Set<string>(ALLOWLISTED_FIX_PATHS);

const FORBIDDEN_PATH_PATTERN =
  /(?:^|\/)(?:\.env(?:\..*)?|\.git(?:\/|$)|package-lock\.json$|bun\.lockb?$|yarn\.lock$|pnpm-lock\.ya?ml$|.*secret.*\.[^/]+$|.*\.pem$|.*\.key$)/i;

const REDACT_TEXT_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END[^-]+-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{25,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  /\bsk-or-v1-[0-9a-f]{24,}\b/gi,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/gi,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s"'<>]+:[^@\s"'<>]+@[^/\s"'<>]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

export function redactSecretsFromText(raw: string): string {
  let out = raw;
  for (const regex of REDACT_TEXT_PATTERNS) {
    out = out.replace(regex, (match) => {
      if (/^Bearer\s+/i.test(match)) {
        return 'Bearer [REDACTED]';
      }
      return `${match.slice(0, 6)}…[REDACTED]`;
    });
  }
  return out;
}

export interface MetadataPlaceholderPatch {
  title?: string;
  description?: string;
  schemaJsonLdTag?: string;
  schemaRawJson?: string;
}

export interface PlannedFixAction {
  id: string;
  findingId: string;
  path: string;
  operation: ApplyOperation;
  content: string;
  reason: string;
  safe: boolean;
  unsafeReason?: string;
  priority: 'P0' | 'P1' | 'P2';
  metadataPatch?: MetadataPlaceholderPatch;
}

export interface UnhandledFindingItem {
  findingId: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  reason: string;
}

export interface ApplyPlan {
  generatedAt: string;
  targetUrl: string;
  beforeScore: number | null;
  securityScore: number | null;
  actions: PlannedFixAction[];
  safeActionsCount: number;
  skippedActionsCount: number;
  unhandledFindings: UnhandledFindingItem[];
}

export function normalizeRelativeRepoPath(rawPath: string): string | null {
  const trimmed = rawPath.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replace(/^\.\//, ''));
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.includes('\0')
  ) {
    return null;
  }
  return normalized;
}

export function isAllowlistedFixPath(relPath: string): {
  allowed: boolean;
  normalizedPath: string | null;
  reason?: string;
} {
  const normalized = normalizeRelativeRepoPath(relPath);
  if (!normalized) {
    return {
      allowed: false,
      normalizedPath: null,
      reason: 'Path is empty, absolute, or uses directory traversal.',
    };
  }
  if (FORBIDDEN_PATH_PATTERN.test(normalized)) {
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: `Refusing protected file path "${normalized}" (.env, secret, git metadata, or lockfile).`,
    };
  }
  if (!ALLOWLIST_SET.has(normalized)) {
    return {
      allowed: false,
      normalizedPath: normalized,
      reason: `Path "${normalized}" is outside the bounded allowlist.`,
    };
  }
  return { allowed: true, normalizedPath: normalized };
}

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsxString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export interface MergeOutcome {
  ok: boolean;
  content: string;
  changed: boolean;
  reason?: string;
}

export function mergeVercelJsonConfig(existingRaw: string | null, snippetJson: string): MergeOutcome {
  let incomingHeaders: Array<{ key: string; value: string }> = [];
  try {
    const parsedSnippet = JSON.parse(snippetJson) as {
      headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
    };
    incomingHeaders = parsedSnippet.headers?.[0]?.headers ?? [];
  } catch {
    return { ok: false, content: existingRaw ?? '', changed: false, reason: 'Invalid generated vercel.json snippet.' };
  }

  if (existingRaw === null) {
    return { ok: true, content: snippetJson.trimEnd() + '\n', changed: true };
  }

  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(existingRaw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        content: existingRaw,
        changed: false,
        reason: 'Existing vercel.json root must be a JSON object; skipping.',
      };
    }
    existing = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing vercel.json could not be parsed as valid JSON; skipping.',
    };
  }

  if (existing.headers === undefined) {
    const merged = {
      ...existing,
      headers: [{ source: '/(.*)', headers: incomingHeaders }],
    };
    return { ok: true, content: JSON.stringify(merged, null, 2) + '\n', changed: true };
  }

  if (!Array.isArray(existing.headers)) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing vercel.json "headers" field is not an array; ambiguous merge skipped.',
    };
  }

  const rules = existing.headers.map((r) => (r && typeof r === 'object' ? { ...(r as Record<string, unknown>) } : r));
  let globalRule = rules.find(
    (r) =>
      r &&
      typeof r === 'object' &&
      ((r as Record<string, unknown>).source === '/(.*)' || (r as Record<string, unknown>).source === '/')
  ) as Record<string, unknown> | undefined;

  if (!globalRule) {
    rules.push({ source: '/(.*)', headers: incomingHeaders });
    return {
      ok: true,
      content: JSON.stringify({ ...existing, headers: rules }, null, 2) + '\n',
      changed: true,
    };
  }

  if (globalRule.headers !== undefined && !Array.isArray(globalRule.headers)) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing vercel.json global header rule is ambiguous; skipping.',
    };
  }

  const existingHeaderList = Array.isArray(globalRule.headers)
    ? (globalRule.headers as Array<{ key?: string; value?: string }>)
    : [];
  const presentKeys = new Set(
    existingHeaderList
      .map((h) => (typeof h?.key === 'string' ? h.key.toLowerCase().trim() : ''))
      .filter(Boolean)
  );

  const additions = incomingHeaders.filter((h) => !presentKeys.has(h.key.toLowerCase()));
  if (additions.length === 0) {
    return { ok: true, content: existingRaw, changed: false };
  }

  globalRule.headers = [...existingHeaderList, ...additions];
  return {
    ok: true,
    content: JSON.stringify({ ...existing, headers: rules }, null, 2) + '\n',
    changed: true,
  };
}

export function mergeNetlifyHeaders(existingRaw: string | null, snippetText: string): MergeOutcome {
  const incomingLines = snippetText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== '/*' && l.includes(':'));

  if (existingRaw === null) {
    return { ok: true, content: snippetText.trimEnd() + '\n', changed: true };
  }

  const lines = existingRaw.split(/\r?\n/);
  const globalIdx = lines.findIndex((l) => l.trim() === '/*');
  if (globalIdx === -1) {
    const appended = [
      existingRaw.trimEnd(),
      '',
      '/*',
      ...incomingLines.map((l) => `  ${l}`),
      '',
    ]
      .filter((val, idx) => !(idx === 0 && val === ''))
      .join('\n');
    return { ok: true, content: appended, changed: true };
  }

  // Find end of /* block (next non-empty line starting at col 0 that isn't a comment)
  let blockEnd = lines.length;
  const existingKeys = new Set<string>();
  for (let i = globalIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line) && !line.trim().startsWith('#')) {
      blockEnd = i;
      break;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      existingKeys.add(line.slice(0, colonIdx).trim().toLowerCase());
    }
  }

  const toInsert = incomingLines
    .filter((l) => {
      const key = l.slice(0, l.indexOf(':')).trim().toLowerCase();
      return key && !existingKeys.has(key);
    })
    .map((l) => `  ${l}`);

  if (toInsert.length === 0) {
    return { ok: true, content: existingRaw, changed: false };
  }

  const updated = [
    ...lines.slice(0, blockEnd),
    ...toInsert,
    ...lines.slice(blockEnd),
  ].join('\n');
  return { ok: true, content: updated.endsWith('\n') ? updated : updated + '\n', changed: true };
}

export function mergeNginxConf(existingRaw: string | null, snippetText: string): MergeOutcome {
  if (existingRaw === null) {
    return { ok: true, content: snippetText.trimEnd() + '\n', changed: true };
  }

  const serverMatches = Array.from(existingRaw.matchAll(/\bserver\s*\{/g));
  if (serverMatches.length === 0) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'No nginx "server {" block found in existing nginx.conf; skipping ambiguous merge.',
    };
  }
  if (serverMatches.length > 1) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: `Found ${serverMatches.length} nginx server blocks; ambiguous merge skipped.`,
    };
  }

  const startIdx = serverMatches[0].index! + serverMatches[0][0].length;
  // Walk matching braces to locate the closing brace of the single server block
  let depth = 1;
  let closeIdx = -1;
  for (let i = startIdx; i < existingRaw.length; i++) {
    const ch = existingRaw[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Unbalanced braces in existing nginx.conf; skipping.',
    };
  }

  const serverBody = existingRaw.slice(startIdx, closeIdx);
  const incomingLines = snippetText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const additions: string[] = [];
  for (const directive of incomingLines) {
    const headerMatch = directive.match(/^add_header\s+([A-Za-z0-9-]+)\s+/i);
    if (headerMatch) {
      const headerName = headerMatch[1];
      const hasHeader = new RegExp(`\\badd_header\\s+${headerName}\\b`, 'i').test(serverBody);
      if (!hasHeader) additions.push(`  ${directive}`);
    } else if (directive.startsWith('server_tokens')) {
      if (!/\bserver_tokens\b/i.test(serverBody)) additions.push(`  ${directive}`);
    } else if (directive.startsWith('location ~')) {
      if (!/location\s+~\s+\/\\\.\(git\|env/i.test(serverBody)) additions.push(`  ${directive}`);
    }
  }

  if (additions.length === 0) {
    return { ok: true, content: existingRaw, changed: false };
  }

  const beforeClose = existingRaw.slice(0, closeIdx).replace(/\s*$/, '');
  const afterClose = existingRaw.slice(closeIdx);
  const merged = `${beforeClose}\n\n  # TourForge passive security headers\n${additions.join('\n')}\n${afterClose}`;
  return { ok: true, content: merged.endsWith('\n') ? merged : merged + '\n', changed: true };
}

export function mergeNextConfigJs(existingRaw: string | null, snippetText: string): MergeOutcome {
  if (existingRaw === null) {
    return { ok: true, content: snippetText.trimEnd() + '\n', changed: true };
  }

  if (/\bheaders\s*\(/.test(existingRaw) || /\bheaders\s*:/.test(existingRaw)) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing next.config.js already defines headers(); skipping to avoid overriding rules.',
    };
  }

  // Safely support standard plain object declaration: `const nextConfig = {` or `module.exports = {`
  if (/\bmodule\.exports\s*=\s*\w+\(/.test(existingRaw) || /=>\s*\{/.test(existingRaw)) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing next.config.js uses a wrapper/function export; skipping automated merge.',
    };
  }

  const headersFnMatch = snippetText.match(/async headers\(\)\s*\{[\s\S]*?\n\s*\},?/);
  if (!headersFnMatch) {
    return { ok: false, content: existingRaw, changed: false, reason: 'Could not extract headers() snippet.' };
  }
  const headersMethod = headersFnMatch[0].replace(/,?$/, ',');

  const configObjMatch = existingRaw.match(
    /((?:const|let|var)\s+nextConfig\s*=\s*\{|module\.exports\s*=\s*\{|export\s+default\s*\{)/
  );
  if (!configObjMatch || configObjMatch.index === undefined) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Could not locate plain config object in next.config.js; skipping automated merge.',
    };
  }

  const insertAt = configObjMatch.index + configObjMatch[0].length;
  const merged = `${existingRaw.slice(0, insertAt)}\n  ${headersMethod}${existingRaw.slice(insertAt)}`;
  return { ok: true, content: merged.endsWith('\n') ? merged : merged + '\n', changed: true };
}

export function applyMetadataPlaceholders(
  existingRaw: string | null,
  relPath: string,
  patch: MetadataPlaceholderPatch
): MergeOutcome {
  if (existingRaw === null) {
    return {
      ok: false,
      content: '',
      changed: false,
      reason: `${relPath} does not exist in target repository; replace-placeholder requires an existing template.`,
    };
  }

  let updated = existingRaw;
  let changed = false;

  if (relPath === 'index.html') {
    if (patch.title) {
      const safeTitle = escapeHtmlAttr(patch.title);
      if (updated.includes('<!-- TOURFORGE:SEO_TITLE -->')) {
        updated = updated.replace('<!-- TOURFORGE:SEO_TITLE -->', `<title>${safeTitle}</title>`);
        changed = true;
      } else if (/<title>\s*TOURFORGE_PLACEHOLDER\s*<\/title>/i.test(updated)) {
        updated = updated.replace(
          /<title>\s*TOURFORGE_PLACEHOLDER\s*<\/title>/i,
          `<title>${safeTitle}</title>`
        );
        changed = true;
      }
    }
    if (patch.description) {
      const safeDesc = escapeHtmlAttr(patch.description);
      if (updated.includes('<!-- TOURFORGE:META_DESCRIPTION -->')) {
        updated = updated.replace(
          '<!-- TOURFORGE:META_DESCRIPTION -->',
          `<meta name="description" content="${safeDesc}" />`
        );
        changed = true;
      }
    }
    if (patch.schemaJsonLdTag && updated.includes('<!-- TOURFORGE:JSONLD -->')) {
      updated = updated.replace('<!-- TOURFORGE:JSONLD -->', patch.schemaJsonLdTag);
      changed = true;
    }
  } else if (relPath === 'app/layout.tsx') {
    if (patch.title && updated.includes('TOURFORGE_SEO_TITLE')) {
      updated = updated.replace(
        /(['"`])TOURFORGE_SEO_TITLE\1/,
        `'${escapeJsxString(patch.title)}'`
      );
      changed = true;
    }
    if (patch.description && updated.includes('TOURFORGE_META_DESCRIPTION')) {
      updated = updated.replace(
        /(['"`])TOURFORGE_META_DESCRIPTION\1/,
        `'${escapeJsxString(patch.description)}'`
      );
      changed = true;
    }
    if (patch.schemaRawJson && updated.includes('{/* TOURFORGE:JSONLD */}')) {
      updated = updated.replace(
        '{/* TOURFORGE:JSONLD */}',
        `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(
          patch.schemaRawJson
        )} }} />`
      );
      changed = true;
    }
  }

  if (!changed) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: `No TOURFORGE placeholder markers found in ${relPath}; skipped rather than overwriting existing metadata.`,
    };
  }

  return { ok: true, content: updated, changed: true };
}

export function mergeRobotsTxt(existingRaw: string | null, recommendedRobotsTxt: string): MergeOutcome {
  if (existingRaw === null) {
    return { ok: true, content: recommendedRobotsTxt.trimEnd() + '\n', changed: true };
  }
  if (/^\s*Disallow:\s*\/\s*$/m.test(existingRaw)) {
    return {
      ok: false,
      content: existingRaw,
      changed: false,
      reason: 'Existing robots.txt contains blanket Disallow: /; review manually before editing.',
    };
  }
  const missingBots: string[] = [];
  for (const bot of ['OAI-SearchBot', 'GPTBot', 'PerplexityBot', 'ClaudeBot']) {
    if (!new RegExp(`User-agent:\\s*${bot}`, 'i').test(existingRaw)) {
      missingBots.push(`User-agent: ${bot}\nAllow: /`);
    }
  }
  if (missingBots.length === 0) {
    return { ok: true, content: existingRaw, changed: false };
  }
  const merged = `${existingRaw.trimEnd()}\n\n# AI Search Crawlers (added by TourForge Lite)\n${missingBots.join('\n\n')}\n`;
  return { ok: true, content: merged, changed: true };
}

export function buildProjectDefaultsFromAudit(
  audit: AuditResult | null,
  overrides?: {
    project?: Partial<ProjectBrief>;
    aiSearchLayer?: AISearchLayerData;
    manual?: ManualFootprint;
    assumptions?: AuditAssumptions;
  }
): {
  project: ProjectBrief;
  aiSearchLayer: AISearchLayerData;
  manual: ManualFootprint;
  assumptions: AuditAssumptions;
} {
  const parsed = audit?.parsed ?? null;
  const resolvedClientName = deriveClientName({
    explicitClientName: overrides?.project?.clientName,
    ogSiteName: parsed?.ogSiteName,
    pageTitle: parsed?.title,
    fallbackUrl: audit?.finalUrl || audit?.requestedUrl,
    defaultLabel: 'Audited Website',
  });
  const project: ProjectBrief = {
    clientName: resolvedClientName,
    businessType: overrides?.project?.businessType?.trim() || 'Local Business',
    brief:
      overrides?.project?.brief?.trim() ||
      parsed?.metaDescription ||
      `Automated website & passive security audit for ${resolvedClientName}.`,
    brandColor: overrides?.project?.brandColor || '#0F766E',
    logoDataUrl: overrides?.project?.logoDataUrl ?? null,
    websiteUrl: overrides?.project?.websiteUrl || audit?.finalUrl || audit?.requestedUrl || 'https://example.com',
    currency: overrides?.project?.currency ?? 'PHP',
  };
  const pageFacts: PageFacts | null = parsed
    ? {
        url: audit?.finalUrl || audit?.requestedUrl,
        title: parsed.title,
        description: parsed.metaDescription,
        headings: parsed.headings.filter(Boolean).slice(0, 12),
        ctas: parsed.ctaTexts.slice(0, 8),
      }
    : null;
  const aiSearchLayer = overrides?.aiSearchLayer ?? buildDefaultAISearchLayer(project, pageFacts, null);
  const manual = overrides?.manual ?? createEmptyManualFootprint();
  const assumptions = overrides?.assumptions ?? createDefaultAssumptions();
  return { project, aiSearchLayer, manual, assumptions };
}

function selectConfigTargets(
  snippets: Record<string, string>,
  existingFiles?: string[]
): AllowlistedFixPath[] {
  const allHeaderConfigs: AllowlistedFixPath[] = [
    'vercel.json',
    'next.config.js',
    '_headers',
    'nginx.conf',
  ];

  if (!existingFiles || existingFiles.length === 0) {
    return allHeaderConfigs.filter((p) => Boolean(snippets[p]));
  }

  const existingSet = new Set(
    existingFiles.map((f) => normalizeRelativeRepoPath(f)).filter((x): x is string => Boolean(x))
  );
  const matched = allHeaderConfigs.filter((p) => existingSet.has(p) && Boolean(snippets[p]));
  if (matched.length > 0) return matched;

  // If no header config file exists yet, create the best single default for the stack
  if (existingSet.has('app/layout.tsx') || existingSet.has('next.config.mjs')) {
    return ['next.config.js'];
  }
  return ['_headers'];
}

export function buildApplyPlan(input: {
  audit: AuditResult | null;
  repoChanges: RepoFileChangeAction[];
  bundle?: Partial<FullProjectBundle>;
  scorecard?: Scorecard | null;
  existingFiles?: string[];
  now?: Date;
}): ApplyPlan {
  const { audit, repoChanges, bundle, existingFiles } = input;
  const defaults = buildProjectDefaultsFromAudit(audit, {
    project: bundle?.project,
    aiSearchLayer: bundle?.aiSearchLayer,
    manual: bundle?.manualFootprint ?? undefined,
    assumptions: bundle?.assumptions ?? undefined,
  });

  const scorecard =
    input.scorecard ??
    bundle?.scorecard ??
    computeScorecard(audit, defaults.manual, defaults.assumptions);
  const secScoreVal = scorecard.securityScore?.score ?? null;
  const assets = buildGeneratedRepoAssets(
    defaults.project,
    defaults.aiSearchLayer,
    audit,
    defaults.manual,
    secScoreVal
  );
  const jsonLd = buildValidatedJsonLd(
    defaults.project,
    defaults.aiSearchLayer,
    audit,
    defaults.manual
  );
  const securitySnippets = buildSecurityHeaderSnippets(audit);
  const aiSummary = buildAiReadinessSummary(audit);

  const findingStatusMap = new Map(
    (audit?.findings ?? []).map((f) => [f.id, f.status])
  );

  const existingSet = existingFiles
    ? new Set(
        existingFiles
          .map((f) => normalizeRelativeRepoPath(f))
          .filter((x): x is string => Boolean(x))
      )
    : null;

  const actionsByPath = new Map<string, PlannedFixAction>();
  const unsafeActions: PlannedFixAction[] = [];
  const unhandledFindings: UnhandledFindingItem[] = [];

  const registerSafeAction = (action: PlannedFixAction) => {
    const existing = actionsByPath.get(action.path);
    if (!existing) {
      actionsByPath.set(action.path, action);
    } else {
      if (!existing.reason.includes(action.findingId)) {
        existing.reason = `${existing.reason}; ${action.findingId}: ${action.reason}`;
      }
      if (action.metadataPatch) {
        existing.metadataPatch = {
          ...existing.metadataPatch,
          ...action.metadataPatch,
        };
      }
    }
  };

  for (const item of repoChanges) {
    const findingStatus = findingStatusMap.get(item.findingId);
    if (findingStatus === 'unknown') {
      unhandledFindings.push({
        findingId: item.findingId,
        title: item.title,
        priority: item.priority,
        reason: 'Finding status is unknown; kept as GitHub Issue and never auto-applied.',
      });
      continue;
    }

    // 1. Check any explicit forbidden/unallowlisted snippet keys or concrete paths first
    let rejectedExplicitPath = false;
    if (item.snippets) {
      for (const [rawKey, snippetVal] of Object.entries(item.snippets)) {
        const check = isAllowlistedFixPath(rawKey);
        if (!check.allowed) {
          rejectedExplicitPath = true;
          unsafeActions.push({
            id: `unsafe:${item.findingId}:${rawKey}`,
            findingId: item.findingId,
            path: check.normalizedPath ?? rawKey,
            operation: 'create',
            content: redactSecretsFromText(snippetVal),
            reason: item.actionSummary,
            safe: false,
            unsafeReason: check.reason,
            priority: item.priority,
          });
        }
      }
    }
    for (const rawTarget of item.targetRepoPaths) {
      // Glob patterns (e.g. src/components/*) or multi-file suggestions are checked when explicit snippets/forbidden names appear
      const hasGlob = rawTarget.includes('*');
      if (FORBIDDEN_PATH_PATTERN.test(rawTarget)) {
        rejectedExplicitPath = true;
        unsafeActions.push({
          id: `unsafe:${item.findingId}:${rawTarget}`,
          findingId: item.findingId,
          path: normalizeRelativeRepoPath(rawTarget) ?? rawTarget,
          operation: 'create',
          content: '',
          reason: item.actionSummary,
          safe: false,
          unsafeReason: `Protected path "${rawTarget}" (.env, secret, git metadata, or lockfile) is never editable.`,
          priority: item.priority,
        });
      } else if (!hasGlob && item.snippets && item.snippets[rawTarget] === undefined) {
        const check = isAllowlistedFixPath(rawTarget);
        if (!check.allowed && item.targetRepoPaths.length === 1) {
          rejectedExplicitPath = true;
          unsafeActions.push({
            id: `unsafe:${item.findingId}:${rawTarget}`,
            findingId: item.findingId,
            path: check.normalizedPath ?? rawTarget,
            operation: 'create',
            content: '',
            reason: item.actionSummary,
            safe: false,
            unsafeReason: check.reason,
            priority: item.priority,
          });
        }
      }
    }

    // 2. Deterministic mapping per known findingId
    if (
      item.findingId === 'sec-csp' ||
      item.findingId === 'sec-hsts' ||
      item.findingId === 'sec-xcto' ||
      item.findingId === 'sec-xfo' ||
      item.findingId === 'sec-referrer' ||
      item.findingId === 'sec-permissions' ||
      item.findingId === 'sec-exposure-hints'
    ) {
      const snippets = item.snippets ?? securitySnippets;
      const targets = selectConfigTargets(snippets, existingFiles);
      for (const targetPath of targets) {
        const content = snippets[targetPath] ?? securitySnippets[targetPath];
        if (!content) continue;
        const op: ApplyOperation =
          existingSet && !existingSet.has(targetPath) ? 'create' : 'merge-config';
        registerSafeAction({
          id: `${item.findingId}:${targetPath}`,
          findingId: item.findingId,
          path: targetPath,
          operation: op,
          content,
          reason: `${item.title} (${redactSecretsFromText(item.evidence)})`,
          safe: true,
          priority: item.priority,
        });
      }
      continue;
    }

    if (item.findingId === 'seo-robots' || item.findingId === 'ai-crawlers') {
      const op: ApplyOperation =
        existingSet && existingSet.has('public/robots.txt') ? 'merge-config' : 'create';
      registerSafeAction({
        id: `${item.findingId}:public/robots.txt`,
        findingId: item.findingId,
        path: 'public/robots.txt',
        operation: op,
        content: assets.robotsTxt.trimEnd() + '\n',
        reason: `${item.title} (${item.evidence})`,
        safe: true,
        priority: item.priority,
      });
      continue;
    }

    if (item.findingId === 'ai-llms-txt') {
      registerSafeAction({
        id: `${item.findingId}:public/llms.txt`,
        findingId: item.findingId,
        path: 'public/llms.txt',
        operation: 'create',
        content: assets.llmsTxt.trimEnd() + '\n',
        reason: `${item.title} (${item.evidence})`,
        safe: true,
        priority: item.priority,
      });
      continue;
    }

    if (
      item.findingId === 'seo-jsonld' ||
      item.findingId === 'seo-jsonld-business-type' ||
      item.findingId === 'ai-entity-schema' ||
      item.findingId === 'ai-faq-schema'
    ) {
      if (jsonLd.valid) {
        registerSafeAction({
          id: `${item.findingId}:public/schema.jsonld`,
          findingId: item.findingId,
          path: 'public/schema.jsonld',
          operation: 'create',
          content: jsonLd.rawJson.trimEnd() + '\n',
          reason: `Add validated ${jsonLd.selectedType} JSON-LD structured data.`,
          safe: true,
          priority: item.priority,
        });
      }
      const placeholderTargets: Array<'index.html' | 'app/layout.tsx'> = existingSet
        ? (['index.html', 'app/layout.tsx'] as const).filter((p) => existingSet.has(p))
        : ['index.html'];
      for (const htmlTarget of placeholderTargets) {
        registerSafeAction({
          id: `${item.findingId}:${htmlTarget}`,
          findingId: item.findingId,
          path: htmlTarget,
          operation: 'replace-placeholder',
          content: assets.schemaJsonLdTag,
          reason: `Inject JSON-LD placeholder in ${htmlTarget} if TOURFORGE placeholder exists.`,
          safe: true,
          priority: item.priority,
          metadataPatch: {
            schemaJsonLdTag: assets.schemaJsonLdTag,
            schemaRawJson: jsonLd.rawJson,
          },
        });
      }
      continue;
    }

    if (item.findingId === 'seo-title' || item.findingId === 'seo-title-length' || item.findingId === 'seo-description') {
      const placeholderTargets: Array<'index.html' | 'app/layout.tsx'> = existingSet
        ? (['index.html', 'app/layout.tsx'] as const).filter((p) => existingSet.has(p))
        : ['index.html'];
      const isTitle = item.findingId.includes('title');
      const suggestedTitle = `${defaults.project.clientName} | ${defaults.project.businessType}`.slice(0, 60);
      const suggestedDescription = (
        defaults.aiSearchLayer.primaryOffer || defaults.project.brief
      ).slice(0, 155);

      for (const htmlTarget of placeholderTargets) {
        registerSafeAction({
          id: `${item.findingId}:${htmlTarget}`,
          findingId: item.findingId,
          path: htmlTarget,
          operation: 'replace-placeholder',
          content: isTitle ? suggestedTitle : suggestedDescription,
          reason: `Populate ${isTitle ? 'title' : 'meta description'} placeholder in ${htmlTarget}.`,
          safe: true,
          priority: item.priority,
          metadataPatch: isTitle ? { title: suggestedTitle } : { description: suggestedDescription },
        });
      }
      continue;
    }

    // All other findings (LCP, CTAs, secrets revocation, third-party scripts, cookies, etc.) are ambiguous or require code edits -> stay as GitHub Issues
    if (!rejectedExplicitPath) {
      unhandledFindings.push({
        findingId: item.findingId,
        title: item.title,
        priority: item.priority,
        reason: `Requires manual application review (${item.targetRepoPaths.slice(0, 3).join(', ')}); kept as GitHub Issue.`,
      });
    }
  }

  // Include embeddable "Security Passed" badge asset when site is eligible
  if (audit?.security?.badgeEligible && assets.securityBadgeHtml) {
    registerSafeAction({
      id: 'sec-badge:generated/security-badge.html',
      findingId: 'sec-badge',
      path: 'generated/security-badge.html',
      operation: 'create',
      content: assets.securityBadgeHtml.trimEnd() + '\n',
      reason: 'Zero high-severity passive security issues detected; provide embeddable Security Passed badge.',
      safe: true,
      priority: 'P2',
    });
  }

  // Deterministic order: safe actions sorted by path, then unsafe actions
  const safeActions = Array.from(actionsByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  const actions = [...safeActions, ...unsafeActions];

  // Ensure AI readiness note isn't unused if summary had warnings
  void aiSummary;

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    targetUrl: defaults.project.websiteUrl || audit?.finalUrl || audit?.requestedUrl || '',
    beforeScore: scorecard.overallScore,
    securityScore: secScoreVal,
    actions,
    safeActionsCount: safeActions.length,
    skippedActionsCount: unsafeActions.length + unhandledFindings.length,
    unhandledFindings,
  };
}
