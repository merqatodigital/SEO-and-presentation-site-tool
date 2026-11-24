import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright-core';
import {
  CHROME_USER_AGENT,
  CHROMIUM_FLAGS,
  SsrfBlockedError,
  attachPublicUrlRouteFilter,
  isPrivateOrBlockedIp,
  validatePublicTargetUrl,
} from './serverShared.ts';
import {
  AI_CRAWLER_BOTS,
  buildEntityCompletenessFromParsed,
  parseRobotsAiBots,
} from './src/audit/aiReadiness.ts';
import {
  buildAutomatedFindings,
  evaluateHostSwitch,
  inspectHtmlContent,
  parseHtmlWithCheerio,
} from './src/audit/htmlFindings.ts';
import {
  AiReadinessResult,
  AuditFinding,
  AuditNote,
  AuditResult,
  AuditResultSchema,
  ContentSource,
  ParsedHtmlFacts,
  SpeedMetrics,
  SpeedOpportunity,
} from './src/audit/types.ts';

export { SsrfBlockedError, isPrivateOrBlockedIp, validatePublicTargetUrl };

export const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim() || '',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
].filter((candidate): candidate is string => Boolean(candidate));

export function resolveChromiumExecutable(): string | null {
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

interface SafeFetchResult {
  finalUrl: string;
  statusCode: number;
  ttfbMs: number;
  bytes: number;
  text: string;
  contentType: string;
}

export async function fetchWithSsrfProtection(
  initialUrl: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    headersOnly?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const headersOnly = options.headersOnly ?? false;

  let currentUrl = initialUrl;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (controller.signal.aborted) {
        throw new Error('Request aborted.');
      }
      await validatePublicTargetUrl(currentUrl);
      const startTime = Date.now();
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'User-Agent': CHROME_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) {
          throw new Error(`Redirect (${response.status}) had no destination URL.`);
        }
        if (hop === maxRedirects) {
          throw new Error(`Exceeded maximum of ${maxRedirects} redirects.`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const ttfbMs = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || '';

      if (headersOnly) {
        await response.body?.cancel().catch(() => {});
        return {
          finalUrl: currentUrl,
          statusCode: response.status,
          ttfbMs,
          bytes: 0,
          text: '',
          contentType,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = maxBytes - totalBytes;
          if (remaining <= 0) {
            await reader.cancel().catch(() => {});
            break;
          }
          if (value.byteLength > remaining) {
            chunks.push(value.subarray(0, remaining));
            totalBytes += remaining;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(value);
          totalBytes += value.byteLength;
        }
      }

      const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const text = combined.toString('utf8');

      return {
        finalUrl: currentUrl,
        statusCode: response.status,
        ttfbMs,
        bytes: totalBytes,
        text,
        contentType,
      };
    }

    throw new Error('Too many redirects.');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        options.signal?.aborted
          ? 'Audit deadline reached.'
          : `Request timed out after ${Math.round(timeoutMs / 1000)}s.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function parseRobotsAllowsIndexing(robotsContent: string): boolean {
  const lines = robotsContent.split(/\r?\n/);
  let appliesToAll = false;
  let hasWildcardDisallowAll = false;
  let hasWildcardAllowRoot = false;

  for (const rawLine of lines) {
    const clean = rawLine.split('#')[0].trim();
    if (!clean) continue;
    const colonIdx = clean.indexOf(':');
    if (colonIdx === -1) continue;
    const directive = clean.slice(0, colonIdx).trim().toLowerCase();
    const value = clean.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      appliesToAll = value === '*';
    } else if (appliesToAll && directive === 'disallow') {
      if (value === '/') {
        hasWildcardDisallowAll = true;
      }
    } else if (appliesToAll && directive === 'allow') {
      if (value === '/') {
        hasWildcardAllowRoot = true;
      }
    }
  }

  return !(hasWildcardDisallowAll && !hasWildcardAllowRoot);
}

async function getRandomFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate free port for browser audit.')));
      }
    });
  });
}

function formatSavings(ms?: number, bytes?: number): string {
  if (typeof ms === 'number' && ms >= 100) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
  }
  if (typeof bytes === 'number' && bytes >= 1024) {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.round(bytes / 1024)} KB`;
  }
  return '';
}

async function runLighthouseAudit(
  targetUrl: string,
  signal?: AbortSignal
): Promise<{ speed: SpeedMetrics | null; reason: string | null }> {
  if (signal?.aborted) {
    return { speed: null, reason: 'Audit timed out before speed test completed.' };
  }
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    return {
      speed: null,
      reason: 'No Chromium found. Set PLAYWRIGHT_EXECUTABLE_PATH.',
    };
  }

  let port: number;
  try {
    port = await getRandomFreePort();
  } catch (err) {
    return {
      speed: null,
      reason: err instanceof Error ? err.message : 'Unable to allocate debugging port.',
    };
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tourforge-lh-'));
  let proc: ReturnType<typeof spawn> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    proc = spawn(
      executablePath,
      [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        ...CHROMIUM_FLAGS,
        `--user-data-dir=${userDataDir}`,
      ],
      {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );

    const runPromise = (async (): Promise<SpeedMetrics> => {
      await new Promise<void>((resolve, reject) => {
        if (!proc) {
          reject(new Error('Browser failed to start.'));
          return;
        }
        let stderrBuf = '';
        const bootTimer = setTimeout(() => {
          reject(new Error('Timed out waiting for Chromium debugging port.'));
        }, 15000);

        proc.once('error', (err) => {
          clearTimeout(bootTimer);
          reject(err);
        });
        proc.once('exit', (code) => {
          clearTimeout(bootTimer);
          reject(new Error(`Browser exited early (code ${code ?? 'unknown'}).`));
        });
        proc.stderr?.on('data', (chunk) => {
          stderrBuf += chunk.toString();
          if (/DevTools listening on ws:\/\/127\.0\.0\.1:\d+/.test(stderrBuf)) {
            clearTimeout(bootTimer);
            resolve();
          }
        });
      });

      const runnerResult = await lighthouse(targetUrl, {
        port,
        output: 'json',
        onlyCategories: ['performance', 'seo', 'accessibility', 'best-practices'],
        formFactor: 'mobile',
        throttlingMethod: 'provided',
        logLevel: 'error',
      });

      const lhr = runnerResult?.lhr;
      if (!lhr) {
        throw new Error('Lighthouse returned an empty report.');
      }

      const runtimeErr = lhr.runtimeError?.message;
      if (runtimeErr && lhr.categories.performance?.score === null) {
        throw new Error(runtimeErr);
      }

      const toScore = (val: number | null | undefined): number | null =>
        typeof val === 'number' && Number.isFinite(val) ? Math.round(val * 100) : null;

      const numAudit = (id: string): number | null => {
        const val = lhr.audits?.[id]?.numericValue;
        return typeof val === 'number' && Number.isFinite(val) ? val : null;
      };

      const rawOpps: Array<{ opp: SpeedOpportunity; rankScore: number }> = [];
      for (const [id, auditItem] of Object.entries(lhr.audits || {})) {
        const details = auditItem.details as
          | {
              type?: string;
              overallSavingsMs?: number;
              overallSavingsBytes?: number;
            }
          | undefined;
        if (!details || details.type !== 'opportunity') continue;
        const ms = typeof details.overallSavingsMs === 'number' ? details.overallSavingsMs : 0;
        const bytes = typeof details.overallSavingsBytes === 'number' ? details.overallSavingsBytes : 0;
        if (ms <= 50 && bytes <= 10240) continue;
        const savingsText = formatSavings(ms, bytes);
        if (!savingsText) continue;
        rawOpps.push({
          opp: {
            id,
            title: auditItem.title || id,
            savingsText,
          },
          rankScore: ms + bytes / 1024,
        });
      }

      rawOpps.sort((a, b) => b.rankScore - a.rankScore);

      return {
        scores: {
          performance: toScore(lhr.categories?.performance?.score),
          seo: toScore(lhr.categories?.seo?.score),
          accessibility: toScore(lhr.categories?.accessibility?.score),
          bestPractices: toScore(lhr.categories?.['best-practices']?.score),
        },
        fcpMs: numAudit('first-contentful-paint'),
        lcpMs: numAudit('largest-contentful-paint'),
        cls: numAudit('cumulative-layout-shift'),
        tbtMs: numAudit('total-blocking-time'),
        speedIndexMs: numAudit('speed-index'),
        totalByteWeight: numAudit('total-byte-weight'),
        opportunities: rawOpps.slice(0, 3).map((item) => item.opp),
      };
    })();

    let onExternalAbort: (() => void) | null = null;
    const timeoutPromise = new Promise<SpeedMetrics>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Speed audit timed out after 90 seconds.'));
      }, 90000);
      if (signal) {
        onExternalAbort = () => reject(new Error('Audit timed out before speed test completed.'));
        if (signal.aborted) {
          onExternalAbort();
        } else {
          signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }
    });

    const speed = await Promise.race([runPromise, timeoutPromise]);
    if (onExternalAbort && signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
    return { speed, reason: null };
  } catch (err) {
    return {
      speed: null,
      reason: err instanceof Error ? err.message : 'Speed test failed to complete.',
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (proc) {
      if (process.platform !== 'win32' && proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process already exited
          }
        }
      } else if (!proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process already exited
        }
      }
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failure
    }
  }
}

export class AuditQueueFullError extends Error {
  statusCode = 503;
  constructor(message = 'Audit queue is full, try again in a minute') {
    super(message);
  }
}

export class AuditJobSkippedError extends Error {
  constructor(message = 'Client disconnected before audit started') {
    super(message);
  }
}

export const MAX_AUDIT_PENDING = 4;
export const AUDIT_OVERALL_DEADLINE_MS = 150_000;
let pendingAuditCount = 0;

// Strict concurrency-1 queue for CPU-heavy Lighthouse audits (max 4 pending)
let auditQueueTail: Promise<unknown> = Promise.resolve();

export function enqueueAudit(
  rawUrl: string,
  options: { shouldSkip?: () => boolean; deadlineMs?: number } = {}
): Promise<AuditResult> {
  if (pendingAuditCount >= MAX_AUDIT_PENDING) {
    return Promise.reject(new AuditQueueFullError());
  }
  pendingAuditCount++;
  const runJob = () => {
    if (options.shouldSkip?.()) {
      return Promise.reject(new AuditJobSkippedError());
    }
    return executeFullSiteAudit(rawUrl, { deadlineMs: options.deadlineMs });
  };
  const next = auditQueueTail
    .then(runJob, runJob)
    .finally(() => {
      pendingAuditCount = Math.max(0, pendingAuditCount - 1);
    });
  auditQueueTail = next.catch(() => {});
  return next;
}

const JS_SHELL_HARD_CAP_MS = 45_000;

export async function renderPageWithPlaywright(
  targetUrl: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Audit timed out before page render completed.');
  }
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    throw new Error('No Chromium found. Set PLAYWRIGHT_EXECUTABLE_PATH.');
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  let onExternalAbort: (() => void) | null = null;

  const closeBrowserSafely = async () => {
    const active = browser;
    browser = null;
    if (active) {
      await active.close().catch(() => {});
    }
  };

  try {
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadlineHandle = setTimeout(() => {
        void closeBrowserSafely();
        reject(new Error('JavaScript page render timed out after 45 seconds.'));
      }, JS_SHELL_HARD_CAP_MS);
      if (signal) {
        onExternalAbort = () => {
          void closeBrowserSafely();
          reject(new Error('Audit timed out before page render completed.'));
        };
        if (signal.aborted) {
          onExternalAbort();
        } else {
          signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }
    });

    const renderWork = async (): Promise<string> => {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [...CHROMIUM_FLAGS],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        userAgent: CHROME_USER_AGENT,
      });

      const page = await context.newPage();
      const routeFilter = await attachPublicUrlRouteFilter(page);

      const response = await page.goto(targetUrl, {
        waitUntil: 'load',
        timeout: 25_000,
      });

      const blockedNavError = routeFilter.getBlockedNavigationError();
      if (blockedNavError) {
        throw new SsrfBlockedError(blockedNavError, 403);
      }

      await validatePublicTargetUrl(page.url());

      if (response && (response.status() === 403 || response.status() === 429 || response.status() === 503)) {
        throw new Error(`HTTP_${response.status()}`);
      }

      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      return await page.content();
    };

    return await Promise.race([renderWork(), deadlinePromise]);
  } finally {
    if (deadlineHandle) clearTimeout(deadlineHandle);
    if (onExternalAbort && signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
    await closeBrowserSafely();
  }
}

export interface ResolveHtmlContentOptions {
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  html: string;
  fetchError: string | null;
  renderJsShell?: (url: string) => Promise<string>;
}

export interface HtmlContentResolution {
  contentSource: ContentSource;
  auditNotes: AuditNote[];
  redirectedFromHost?: string;
  parsed: ParsedHtmlFacts | null;
  contentError: string | null;
}

export async function resolveHtmlContent(
  options: ResolveHtmlContentOptions
): Promise<HtmlContentResolution> {
  const auditNotes: AuditNote[] = [];
  const hostSwitch = evaluateHostSwitch(options.requestedUrl, options.finalUrl);
  if (hostSwitch.note) {
    auditNotes.push(hostSwitch.note);
  }

  if (options.httpStatus === 403 || options.httpStatus === 429 || options.httpStatus === 503) {
    auditNotes.push({
      code: 'bot-wall',
      message: 'This site blocks automated checks, so content and speed checks could not be completed.',
    });
    return {
      contentSource: 'blocked',
      auditNotes,
      redirectedFromHost: hostSwitch.redirectedFromHost,
      parsed: null,
      contentError: 'This site blocks automated checks',
    };
  }

  if (options.fetchError) {
    return {
      contentSource: 'raw',
      auditNotes,
      redirectedFromHost: hostSwitch.redirectedFromHost,
      parsed: null,
      contentError: options.fetchError,
    };
  }

  const inspection = inspectHtmlContent(options.html, options.httpStatus);

  if (inspection.classification === 'bot-wall') {
    auditNotes.push({
      code: 'bot-wall',
      message: 'This site blocks automated checks, so content and speed checks could not be completed.',
    });
    return {
      contentSource: 'blocked',
      auditNotes,
      redirectedFromHost: hostSwitch.redirectedFromHost,
      parsed: null,
      contentError: 'This site blocks automated checks',
    };
  }

  if (inspection.classification === 'soft-404') {
    auditNotes.push({
      code: 'soft-404',
      message: 'This page returned a "not found" message instead of real site content.',
    });
    return {
      contentSource: 'raw',
      auditNotes,
      redirectedFromHost: hostSwitch.redirectedFromHost,
      parsed: null,
      contentError: 'Page returned a soft 404 (not found) message.',
    };
  }

  if (inspection.classification === 'js-shell') {
    if (options.renderJsShell) {
      try {
        const renderedHtml = await options.renderJsShell(options.finalUrl || options.requestedUrl);
        const renderedInspection = inspectHtmlContent(renderedHtml, 200);
        if (renderedInspection.classification === 'bot-wall') {
          auditNotes.push({
            code: 'bot-wall',
            message: 'This site blocks automated checks, so content and speed checks could not be completed.',
          });
          return {
            contentSource: 'blocked',
            auditNotes,
            redirectedFromHost: hostSwitch.redirectedFromHost,
            parsed: null,
            contentError: 'This site blocks automated checks',
          };
        }
        if (renderedInspection.classification === 'soft-404') {
          auditNotes.push({
            code: 'soft-404',
            message: 'This page returned a "not found" message instead of real site content.',
          });
          return {
            contentSource: 'raw',
            auditNotes,
            redirectedFromHost: hostSwitch.redirectedFromHost,
            parsed: null,
            contentError: 'Page returned a soft 404 (not found) message.',
          };
        }

        auditNotes.push({
          code: 'rendered',
          message: 'Read from the rendered page; this site builds its content with JavaScript.',
        });
        return {
          contentSource: 'rendered',
          auditNotes,
          redirectedFromHost: hostSwitch.redirectedFromHost,
          parsed: parseHtmlWithCheerio(renderedHtml),
          contentError: null,
        };
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          throw err;
        }
        if (err instanceof Error && /^HTTP_(?:403|429|503)$/.test(err.message)) {
          auditNotes.push({
            code: 'bot-wall',
            message: 'This site blocks automated checks, so content and speed checks could not be completed.',
          });
          return {
            contentSource: 'blocked',
            auditNotes,
            redirectedFromHost: hostSwitch.redirectedFromHost,
            parsed: null,
            contentError: 'This site blocks automated checks',
          };
        }
        auditNotes.push({
          code: 'render-failed',
          message: 'Could not load dynamic JavaScript content; content checks were marked Unknown.',
        });
        return {
          contentSource: 'raw',
          auditNotes,
          redirectedFromHost: hostSwitch.redirectedFromHost,
          parsed: null,
          contentError: 'Could not render JavaScript page content.',
        };
      }
    }

    auditNotes.push({
      code: 'render-failed',
      message: 'Could not load dynamic JavaScript content; content checks were marked Unknown.',
    });
    return {
      contentSource: 'raw',
      auditNotes,
      redirectedFromHost: hostSwitch.redirectedFromHost,
      parsed: null,
      contentError: 'Could not render JavaScript page content.',
    };
  }

  return {
    contentSource: 'raw',
    auditNotes,
    redirectedFromHost: hostSwitch.redirectedFromHost,
    parsed: parseHtmlWithCheerio(options.html),
    contentError: null,
  };
}

export interface ResolveHtmlAndFindingsInput extends ResolveHtmlContentOptions {
  isHttps: boolean | null;
  ttfbMs: number | null;
  ttfbSampleCount: number;
  robotsTxt: AuditResult['robotsTxt'];
  sitemapXml: AuditResult['sitemapXml'];
  speed: SpeedMetrics | null;
  speedReason: string | null;
}

export async function resolveHtmlContentAndFindings(
  input: ResolveHtmlAndFindingsInput
): Promise<HtmlContentResolution & { findings: AuditFinding[] }> {
  const resolution = await resolveHtmlContent(input);
  const isBlocked = resolution.contentSource === 'blocked';
  const findings = buildAutomatedFindings({
    isHttps: input.isHttps,
    fetchError: input.fetchError,
    contentError: resolution.contentError,
    ttfbMs: input.ttfbMs,
    ttfbSampleCount: input.ttfbSampleCount,
    parsed: resolution.parsed,
    robotsTxt: isBlocked
      ? { exists: null, allowsIndexing: null, reason: 'This site blocks automated checks' }
      : input.robotsTxt,
    sitemapXml: isBlocked
      ? { exists: null, reason: 'This site blocks automated checks' }
      : input.sitemapXml,
    speed: isBlocked ? null : input.speed,
    speedReason: isBlocked ? 'This site blocks automated checks' : input.speedReason,
  });

  return {
    ...resolution,
    findings,
  };
}

export interface ExecuteAuditOptions {
  deadlineMs?: number;
  deps?: {
    validateUrl?: (url: string) => Promise<URL>;
    fetchHtml?: (
      url: string,
      opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; headersOnly?: boolean; signal?: AbortSignal }
    ) => Promise<SafeFetchResult>;
    renderJs?: (url: string, signal?: AbortSignal) => Promise<string>;
    runSpeed?: (
      url: string,
      signal?: AbortSignal
    ) => Promise<{ speed: SpeedMetrics | null; reason: string | null }>;
  };
}

export async function executeFullSiteAudit(
  rawUrl: string,
  options: ExecuteAuditOptions = {}
): Promise<AuditResult> {
  const deadlineMs = options.deadlineMs ?? AUDIT_OVERALL_DEADLINE_MS;
  const validateUrl = options.deps?.validateUrl ?? validatePublicTargetUrl;
  const fetchHtml = options.deps?.fetchHtml ?? fetchWithSsrfProtection;
  const renderJs = options.deps?.renderJs ?? renderPageWithPlaywright;
  const runSpeed = options.deps?.runSpeed ?? runLighthouseAudit;

  // SSRF checks throw SsrfBlockedError -> handled by Express as 403/400.
  // Dead/unreachable public domains return partial AuditResult (never 500).
  const parsedInput = await validateUrl(rawUrl).catch((err) => {
    if (
      err instanceof SsrfBlockedError ||
      (err && typeof err === 'object' && 'statusCode' in err && Number((err as { statusCode: number }).statusCode) === 400)
    ) {
      throw err;
    }
    return { error: err instanceof Error ? err.message : 'Could not reach target domain.' };
  });

  if ('error' in parsedInput) {
    const findings = buildAutomatedFindings({
      isHttps: rawUrl.toLowerCase().startsWith('https://') ? true : null,
      fetchError: parsedInput.error,
      ttfbMs: null,
      ttfbSampleCount: 0,
      parsed: null,
      robotsTxt: { exists: null, allowsIndexing: null, reason: parsedInput.error },
      sitemapXml: { exists: null, reason: parsedInput.error },
      speed: null,
      speedReason: parsedInput.error,
    });

    return AuditResultSchema.parse({
      schemaVersion: '1.0',
      requestedUrl: rawUrl,
      finalUrl: null,
      auditedAt: new Date().toISOString(),
      httpStatus: null,
      ttfbMs: null,
      ttfbSamplesMs: [],
      htmlBytes: null,
      isHttps: rawUrl.toLowerCase().startsWith('https://') ? true : null,
      fetchError: parsedInput.error,
      contentSource: 'raw',
      auditNotes: [],
      parsed: null,
      robotsTxt: { exists: null, allowsIndexing: null, reason: parsedInput.error },
      sitemapXml: { exists: null, reason: parsedInput.error },
      speed: null,
      speedReason: parsedInput.error,
      findings,
    });
  }

  const state: {
    finalUrl: string | null;
    httpStatus: number | null;
    ttfbMs: number | null;
    ttfbSamplesMs: number[];
    htmlBytes: number | null;
    isHttps: boolean | null;
    fetchError: string | null;
    rawHtml: string;
    contentResolution: HtmlContentResolution | null;
    robotsTxt: AuditResult['robotsTxt'];
    robotsContent: string | null;
    sitemapXml: AuditResult['sitemapXml'];
    llmsTxt: AiReadinessResult['llmsTxt'];
    speed: SpeedMetrics | null;
    speedReason: string | null;
  } = {
    finalUrl: parsedInput.toString(),
    httpStatus: null,
    ttfbMs: null,
    ttfbSamplesMs: [],
    htmlBytes: null,
    isHttps: parsedInput.protocol === 'https:',
    fetchError: null,
    rawHtml: '',
    contentResolution: null,
    robotsTxt: { exists: null, allowsIndexing: null },
    robotsContent: null,
    sitemapXml: { exists: null },
    llmsTxt: { exists: null, url: null, bytes: null, preview: null },
    speed: null,
    speedReason: null,
  };

  const deadlineController = new AbortController();
  let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const buildResultFromState = (): AuditResult => {
    const resolution = state.contentResolution;
    const notes: AuditNote[] = [...(resolution?.auditNotes ?? [])];
    if (timedOut) {
      notes.push({
        code: 'timeout',
        message: 'Audit took too long; partial results',
      });
    }

    const contentError =
      resolution?.contentError ??
      (timedOut && !resolution ? 'Audit took too long; partial results' : null);

    const robotsTxt: AuditResult['robotsTxt'] =
      state.robotsTxt.exists === null && !state.robotsTxt.reason && timedOut
        ? { ...state.robotsTxt, reason: 'Audit took too long; partial results' }
        : state.robotsTxt;

    const sitemapXml: AuditResult['sitemapXml'] =
      state.sitemapXml.exists === null && !state.sitemapXml.reason && timedOut
        ? { ...state.sitemapXml, reason: 'Audit took too long; partial results' }
        : state.sitemapXml;

    const speedReason =
      state.speedReason ??
      (state.speed === null && timedOut ? 'Audit took too long; partial results' : null);

    const parsedFacts = resolution?.parsed ?? null;
    const findings = buildAutomatedFindings({
      isHttps: state.isHttps,
      fetchError: state.fetchError,
      contentError,
      ttfbMs: state.ttfbMs,
      ttfbSampleCount: state.ttfbSamplesMs.length,
      parsed: parsedFacts,
      robotsTxt,
      sitemapXml,
      speed: state.speed,
      speedReason,
    });

    const aiReadiness: AiReadinessResult = {
      robotsChecked: robotsTxt.exists !== null,
      botAccess:
        robotsTxt.exists === null
          ? AI_CRAWLER_BOTS.map((b) => ({ ...b, status: 'unknown' }))
          : parseRobotsAiBots(state.robotsContent ?? ''),
      llmsTxt:
        state.llmsTxt.exists === null && !state.llmsTxt.reason && timedOut
          ? { ...state.llmsTxt, reason: 'Audit took too long; partial results' }
          : state.llmsTxt,
      entityCompleteness: buildEntityCompletenessFromParsed(parsedFacts),
    };

    return AuditResultSchema.parse({
      schemaVersion: '1.0',
      requestedUrl: rawUrl,
      finalUrl: state.finalUrl,
      auditedAt: new Date().toISOString(),
      httpStatus: state.httpStatus,
      ttfbMs: state.ttfbMs,
      ttfbSamplesMs: state.ttfbSamplesMs,
      htmlBytes: state.htmlBytes,
      isHttps: state.isHttps,
      fetchError: state.fetchError,
      contentSource: resolution?.contentSource ?? 'raw',
      auditNotes: notes,
      ...(resolution?.redirectedFromHost
        ? { redirectedFromHost: resolution.redirectedFromHost }
        : {}),
      aiReadiness,
      parsed: parsedFacts,
      robotsTxt,
      sitemapXml,
      speed: state.speed,
      speedReason,
      findings,
    });
  };

  const runPipeline = async (): Promise<AuditResult> => {
    try {
      const pageResp = await fetchHtml(parsedInput.toString(), {
        timeoutMs: 15000,
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 5,
        signal: deadlineController.signal,
      });
      state.finalUrl = pageResp.finalUrl;
      state.httpStatus = pageResp.statusCode;
      state.ttfbSamplesMs.push(pageResp.ttfbMs);
      state.htmlBytes = pageResp.bytes;
      state.isHttps = new URL(pageResp.finalUrl).protocol === 'https:';
      state.rawHtml = pageResp.text;

      if (pageResp.statusCode >= 400) {
        state.fetchError = `Website returned HTTP ${pageResp.statusCode}.`;
      } else if (!pageResp.text.trim()) {
        state.fetchError = 'Website returned an empty HTML document.';
      }

      // Measure 2 more sequential requests to the resolved endpoint (total 3 samples, discard nothing, median)
      for (let i = 0; i < 2; i++) {
        if (deadlineController.signal.aborted) break;
        try {
          const probeResp = await fetchHtml(state.finalUrl, {
            timeoutMs: 10000,
            maxRedirects: 5,
            headersOnly: true,
            signal: deadlineController.signal,
          });
          state.ttfbSamplesMs.push(probeResp.ttfbMs);
        } catch {
          // Keep previously captured samples if an additional probe fails
        }
      }

      if (state.ttfbSamplesMs.length > 0) {
        const sorted = [...state.ttfbSamplesMs].sort((a, b) => a - b);
        state.ttfbMs = Math.round(sorted[Math.floor(sorted.length / 2)]);
      }
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw err;
      }
      if (!deadlineController.signal.aborted) {
        state.fetchError = err instanceof Error ? err.message : 'Unable to fetch target HTML.';
      }
    }

    if (deadlineController.signal.aborted) {
      return buildResultFromState();
    }

    state.contentResolution = await resolveHtmlContent({
      requestedUrl: rawUrl,
      finalUrl: state.finalUrl,
      httpStatus: state.httpStatus,
      html: state.rawHtml,
      fetchError: state.fetchError,
      renderJsShell: (url) => renderJs(url, deadlineController.signal),
    });

    if (deadlineController.signal.aborted) {
      return buildResultFromState();
    }

    const isBlocked = state.contentResolution.contentSource === 'blocked';
    const isSoft404 = state.contentResolution.auditNotes.some((n) => n.code === 'soft-404');

    // Check robots.txt and sitemap.xml relative to final origin (skip when blocked by bot wall)
    const originUrl = new URL(state.finalUrl || parsedInput.toString()).origin;

    if (isBlocked) {
      state.robotsTxt = {
        exists: null,
        allowsIndexing: null,
        reason: 'This site blocks automated checks',
      };
      state.sitemapXml = {
        exists: null,
        reason: 'This site blocks automated checks',
      };
      state.llmsTxt = {
        exists: null,
        url: `${originUrl}/llms.txt`,
        bytes: null,
        preview: null,
        reason: 'This site blocks automated checks',
      };
    } else if (!state.fetchError || state.httpStatus !== null) {
      try {
        const robotsResp = await fetchHtml(`${originUrl}/robots.txt`, {
          timeoutMs: 10000,
          maxBytes: 512 * 1024,
          maxRedirects: 3,
          signal: deadlineController.signal,
        });
        if (robotsResp.statusCode >= 200 && robotsResp.statusCode < 300 && !/<html/i.test(robotsResp.text)) {
          state.robotsTxt = {
            exists: true,
            allowsIndexing: parseRobotsAllowsIndexing(robotsResp.text),
          };
          state.robotsContent = robotsResp.text;
        } else {
          state.robotsTxt = { exists: false, allowsIndexing: true };
          state.robotsContent = '';
        }
      } catch (err) {
        if (!deadlineController.signal.aborted) {
          state.robotsTxt = {
            exists: null,
            allowsIndexing: null,
            reason: err instanceof Error ? err.message : 'Unable to check robots.txt',
          };
        }
      }

      if (!deadlineController.signal.aborted) {
        try {
          const sitemapResp = await fetchHtml(`${originUrl}/sitemap.xml`, {
            timeoutMs: 10000,
            maxBytes: 2 * 1024 * 1024,
            maxRedirects: 3,
            signal: deadlineController.signal,
          });
          const looksXml =
            sitemapResp.statusCode >= 200 &&
            sitemapResp.statusCode < 300 &&
            (/<(urlset|sitemapindex)\b/i.test(sitemapResp.text) ||
              /xml/i.test(sitemapResp.contentType));
          state.sitemapXml = {
            exists: looksXml,
            reason: looksXml ? undefined : `No valid sitemap.xml (HTTP ${sitemapResp.statusCode})`,
          };
        } catch (err) {
          if (!deadlineController.signal.aborted) {
            state.sitemapXml = {
              exists: null,
              reason: err instanceof Error ? err.message : 'Unable to check sitemap.xml',
            };
          }
        }
      }

      if (!deadlineController.signal.aborted) {
        try {
          const llmsUrl = `${originUrl}/llms.txt`;
          const llmsResp = await fetchHtml(llmsUrl, {
            timeoutMs: 8000,
            maxBytes: 128 * 1024,
            maxRedirects: 3,
            signal: deadlineController.signal,
          });
          const trimmed = llmsResp.text.trim();
          const looksValidLlms =
            llmsResp.statusCode >= 200 &&
            llmsResp.statusCode < 300 &&
            trimmed.length > 0 &&
            !/^\s*<!doctype\s+html/i.test(trimmed) &&
            !/^\s*<html\b/i.test(trimmed);
          state.llmsTxt = {
            exists: looksValidLlms,
            url: llmsUrl,
            bytes: looksValidLlms ? llmsResp.bytes : null,
            preview: looksValidLlms ? trimmed.slice(0, 600) : null,
            reason: looksValidLlms ? undefined : `No /llms.txt found (HTTP ${llmsResp.statusCode})`,
          };
        } catch (err) {
          if (!deadlineController.signal.aborted) {
            state.llmsTxt = {
              exists: null,
              url: `${originUrl}/llms.txt`,
              bytes: null,
              preview: null,
              reason: err instanceof Error ? err.message : 'Unable to check /llms.txt',
            };
          }
        }
      }
    } else {
      state.robotsTxt = { exists: null, allowsIndexing: null, reason: state.fetchError };
      state.sitemapXml = { exists: null, reason: state.fetchError };
      state.llmsTxt = {
        exists: null,
        url: `${originUrl}/llms.txt`,
        bytes: null,
        preview: null,
        reason: state.fetchError,
      };
    }

    if (deadlineController.signal.aborted) {
      return buildResultFromState();
    }

    // Run open-source Lighthouse if main HTML loaded cleanly and was not blocked/soft-404
    if (isBlocked) {
      state.speedReason = 'This site blocks automated checks';
    } else if (isSoft404) {
      state.speedReason = 'Skipped speed test because the page returned a soft 404.';
    } else if (!state.fetchError && state.finalUrl) {
      const lh = await runSpeed(state.finalUrl, deadlineController.signal);
      if (!deadlineController.signal.aborted) {
        state.speed = lh.speed;
        state.speedReason = lh.reason;
      }
    } else {
      state.speedReason = state.fetchError || 'Skipped speed test because main page did not load.';
    }

    return buildResultFromState();
  };

  try {
    const deadlinePromise = new Promise<AuditResult>((resolve) => {
      deadlineHandle = setTimeout(() => {
        timedOut = true;
        deadlineController.abort();
        resolve(buildResultFromState());
      }, deadlineMs);
    });

    return await Promise.race([runPipeline(), deadlinePromise]);
  } finally {
    if (deadlineHandle) clearTimeout(deadlineHandle);
  }
}
