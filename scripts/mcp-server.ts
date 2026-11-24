#!/usr/bin/env node
import readline from 'node:readline';
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
import { CurrencyCode } from '../src/types/tour.ts';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'tourforge_audit_url',
    description:
      'Run a deterministic TourForge website + AI-readiness audit on a public URL and map failing findings to required GitHub repository changes.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public https:// website URL to audit' },
        clientName: { type: 'string', description: 'Optional business name override' },
        businessType: { type: 'string', description: 'Optional industry/category label' },
        currency: {
          type: 'string',
          enum: ['PHP', 'USD', 'EUR'],
          description: 'Reporting currency (default PHP)',
        },
        repoName: { type: 'string', description: 'Optional GitHub repo slug (owner/repo)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'tourforge_capture_site',
    description:
      'Capture viewport screenshots and visible DOM facts from a live URL via a running TourForge server (requires TOURFORGE_SERVER_URL).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public https:// website URL to capture' },
        shots: { type: 'number', description: 'Screenshot count (3 to 6, default 5)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'tourforge_generate_repo_fixes',
    description:
      'Generate ready-to-commit robots.txt, /llms.txt, Schema.org JSON-LD, and a GitHub Issue checklist from a URL or existing AuditResult.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Website URL (runs audit if auditResult is omitted)' },
        auditResult: {
          type: 'object',
          description: 'Optional existing AuditResult JSON from tourforge_audit_url',
        },
        clientName: { type: 'string' },
        businessType: { type: 'string' },
      },
    },
  },
  {
    name: 'tourforge_export_bundle',
    description:
      'Build a TourForge UI-importable FullProjectBundle JSON from a URL or existing AuditResult so teammates can open it via Import JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Website URL (runs audit if auditResult is omitted)' },
        auditResult: { type: 'object', description: 'Optional existing AuditResult JSON' },
        clientName: { type: 'string' },
        businessType: { type: 'string' },
        currency: { type: 'string', enum: ['PHP', 'USD', 'EUR'] },
      },
    },
  },
];

function getServerConfig() {
  return {
    serverUrl: process.env.TOURFORGE_SERVER_URL?.trim().replace(/\/+$/, '') || null,
    captureToken: process.env.CAPTURE_TOKEN?.trim() || '',
  };
}

async function resolveAudit(url?: string, rawAudit?: unknown): Promise<AuditResult> {
  if (rawAudit) {
    return AuditResultSchema.parse(rawAudit);
  }
  if (!url || !url.trim()) {
    throw new Error('Either url or auditResult must be provided.');
  }

  const { serverUrl, captureToken } = getServerConfig();
  if (serverUrl) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (captureToken) {
      headers.Authorization = `Bearer ${captureToken}`;
    }
    const res = await fetch(`${serverUrl}/api/audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`TourForge server (${res.status}) returned invalid JSON.`);
    }
    if (!res.ok) {
      const msg =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(`Remote /api/audit failed (${res.status}): ${msg}`);
    }
    return AuditResultSchema.parse(payload);
  }

  return enqueueAudit(url);
}

function normalizeCurrency(val: unknown): CurrencyCode {
  if (val === 'USD' || val === 'EUR' || val === 'PHP') return val;
  return 'PHP';
}

export async function handleMcpToolCall(
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (name === 'tourforge_audit_url') {
    const url = String(args.url || '').trim();
    if (!url) throw new Error('url is required.');
    const currency = normalizeCurrency(args.currency);
    const audit = await resolveAudit(url);
    const manual = createEmptyManualFootprint();
    const assumptions = { ...createDefaultAssumptions(), currency };
    const scorecard = computeScorecard(audit, manual, assumptions);
    const aiSummary = buildAiReadinessSummary(audit);
    const repoChanges = buildRepoChangeChecklist(audit, aiSummary);
    const bundle = buildAgentOutputBundle({
      url,
      clientName: typeof args.clientName === 'string' ? args.clientName : undefined,
      businessType: typeof args.businessType === 'string' ? args.businessType : undefined,
      currency,
      audit,
      scorecard,
      manual,
      assumptions,
    });
    const assets = buildGeneratedRepoAssets(
      bundle.project,
      bundle.aiSearchLayer!,
      audit,
      manual,
      scorecard.securityScore?.score ?? null
    );
    const markdown = buildAgentMarkdownReport({
      url,
      repoName: typeof args.repoName === 'string' ? args.repoName : undefined,
      project: bundle.project,
      audit,
      scorecard,
      aiSummary,
      repoChanges,
    });

    return {
      content: [
        { type: 'text', text: markdown },
        {
          type: 'text',
          text: JSON.stringify(
            {
              project: bundle.project,
              scorecard: {
                overallScore: scorecard.overallScore,
                grade: scorecard.grade,
                isProvisional: scorecard.isProvisional,
                dataCompletenessPct: scorecard.dataCompletenessPct,
                securityScore: scorecard.securityScore ?? null,
              },
              security: audit.security ?? null,
              securityBadge: {
                eligible: Boolean(audit.security?.badgeEligible),
                htmlSnippet: assets.securityBadgeHtml,
                svg: assets.securityBadgeSvg,
              },
              aiReadiness: aiSummary,
              repoChanges,
              audit,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'tourforge_capture_site') {
    const url = String(args.url || '').trim();
    if (!url) throw new Error('url is required.');
    const { serverUrl, captureToken } = getServerConfig();
    if (!serverUrl) {
      throw new Error(
        'TOURFORGE_SERVER_URL must be configured to invoke remote /api/capture.'
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (captureToken) headers.Authorization = `Bearer ${captureToken}`;

    const res = await fetch(`${serverUrl}/api/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        shots: typeof args.shots === 'number' ? args.shots : 5,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Remote /api/capture failed (${res.status}): ${text.slice(0, 240)}`);
    }
    return {
      content: [{ type: 'text', text }],
    };
  }

  if (name === 'tourforge_generate_repo_fixes') {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    const audit = await resolveAudit(rawUrl, args.auditResult);
    const resolvedUrl = rawUrl || audit.finalUrl || audit.requestedUrl;
    const manual = createEmptyManualFootprint();
    const assumptions = createDefaultAssumptions();
    const scorecard = computeScorecard(audit, manual, assumptions);
    const aiSummary = buildAiReadinessSummary(audit);
    const repoChanges = buildRepoChangeChecklist(audit, aiSummary);
    const bundle = buildAgentOutputBundle({
      url: resolvedUrl,
      clientName: typeof args.clientName === 'string' ? args.clientName : undefined,
      businessType: typeof args.businessType === 'string' ? args.businessType : undefined,
      audit,
      scorecard,
      manual,
      assumptions,
    });
    const assets = buildGeneratedRepoAssets(
      bundle.project,
      bundle.aiSearchLayer!,
      audit,
      manual,
      scorecard.securityScore?.score ?? null
    );
    const githubIssueMarkdown = buildGitHubIssueBody({
      url: resolvedUrl,
      project: bundle.project,
      scorecard,
      aiSummary,
      repoChanges,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              repoChanges,
              githubIssueMarkdown,
              files: {
                'public/robots.txt': assets.robotsTxt,
                'public/llms.txt': assets.llmsTxt,
                'schema.jsonld': assets.schemaJsonLdTag,
                'vercel.json': assets.securitySnippets['vercel.json'],
                'next.config.js': assets.securitySnippets['next.config.js'],
                '_headers': assets.securitySnippets['_headers'],
                'nginx.conf': assets.securitySnippets['nginx.conf'],
                ...(assets.securityBadgeHtml
                  ? { 'security-badge.html': assets.securityBadgeHtml }
                  : {}),
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'tourforge_export_bundle') {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    const currency = normalizeCurrency(args.currency);
    const audit = await resolveAudit(rawUrl, args.auditResult);
    const manual = createEmptyManualFootprint();
    const assumptions = { ...createDefaultAssumptions(), currency };
    const scorecard = computeScorecard(audit, manual, assumptions);
    const bundle = buildAgentOutputBundle({
      url: rawUrl || audit.finalUrl || audit.requestedUrl,
      clientName: typeof args.clientName === 'string' ? args.clientName : undefined,
      businessType: typeof args.businessType === 'string' ? args.businessType : undefined,
      currency,
      audit,
      scorecard,
      manual,
      assumptions,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }],
    };
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}

export async function handleJsonRpcMessage(
  msg: JsonRpcRequest
): Promise<Record<string, unknown> | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: msg?.id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
    };
  }

  // Notifications have no id and expect no reply
  if (msg.id === undefined) {
    return null;
  }

  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'tourforge-lite',
          version: '1.0.0',
        },
      },
    };
  }

  if (msg.method === 'ping') {
    return { jsonrpc: '2.0', id: msg.id, result: {} };
  }

  if (msg.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: MCP_TOOLS,
      },
    };
  }

  if (msg.method === 'tools/call') {
    const params = msg.params || {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    const toolArgs =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};
    try {
      const result = await handleMcpToolCall(toolName, toolArgs);
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result,
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : 'Tool execution error.',
            },
          ],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  };
}

function startStdioServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcRequest;
        const reply = await handleJsonRpcMessage(parsed);
        if (reply) {
          process.stdout.write(JSON.stringify(reply) + '\n');
        }
      } catch {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }) + '\n'
        );
      }
    })();
  });
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  startStdioServer();
}
