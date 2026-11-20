import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import lighthouse from 'lighthouse';
import { buildAutomatedFindings, parseHtmlWithCheerio } from './src/audit/htmlFindings.ts';
import {
  AuditResult,
  AuditResultSchema,
  ParsedHtmlFacts,
  SpeedMetrics,
  SpeedOpportunity,
} from './src/audit/types.ts';

export const PLAYWRIGHT_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
].filter((candidate): candidate is string => Boolean(candidate));

export function resolveChromiumExecutable(): string | undefined {
  for (const candidate of PLAYWRIGHT_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') ||
      normalized.startsWith('::ffff:169.254.') ||
      normalized.startsWith('::ffff:172.')
    ) {
      if (normalized.startsWith('::ffff:172.')) {
        const oct = Number(normalized.split('.')[1]);
        return oct >= 16 && oct <= 31;
      }
      return true;
    }
  }
  return false;
}

export class SsrfBlockedError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function validatePublicTargetUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Invalid website URL.'), { statusCode: 400 });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('Only http:// and https:// URLs are allowed.', 403);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new SsrfBlockedError('Blocked local or private network URL.', 403);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new SsrfBlockedError('Blocked private IP address.', 403);
    }
    return parsed;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) {
      throw Object.assign(new Error(`Could not resolve domain "${hostname}".`), { statusCode: 422 });
    }
    for (const addr of addresses) {
      if (isPrivateOrBlockedIp(addr.address)) {
        throw new SsrfBlockedError('Blocked URL resolving to a private network address.', 403);
      }
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError || (err && typeof err === 'object' && 'statusCode' in err)) {
      throw err;
    }
    throw Object.assign(
      new Error(`Could not reach domain "${hostname}". Verify the URL and try again.`),
      { statusCode: 422 }
    );
  }

  return parsed;
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
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; headersOnly?: boolean } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const headersOnly = options.headersOnly ?? false;

  let currentUrl = initialUrl;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await validatePublicTargetUrl(currentUrl);
      const startTime = Date.now();
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
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
  targetUrl: string
): Promise<{ speed: SpeedMetrics | null; reason: string | null }> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    return {
      speed: null,
      reason: 'Headless Chromium binary was not found on the server.',
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
    proc = spawn(executablePath, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--user-data-dir=${userDataDir}`,
    ]);

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

    const timeoutPromise = new Promise<SpeedMetrics>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Speed audit timed out after 90 seconds.'));
      }, 90000);
    });

    const speed = await Promise.race([runPromise, timeoutPromise]);
    return { speed, reason: null };
  } catch (err) {
    return {
      speed: null,
      reason: err instanceof Error ? err.message : 'Speed test failed to complete.',
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failure
    }
  }
}

// Strict concurrency-1 queue for CPU-heavy Lighthouse audits
let auditQueueTail: Promise<unknown> = Promise.resolve();

export function enqueueAudit(rawUrl: string): Promise<AuditResult> {
  const next = auditQueueTail.then(
    () => executeFullSiteAudit(rawUrl),
    () => executeFullSiteAudit(rawUrl)
  );
  auditQueueTail = next.catch(() => {});
  return next;
}

export async function executeFullSiteAudit(rawUrl: string): Promise<AuditResult> {
  // SSRF checks throw SsrfBlockedError -> handled by Express as 403/400.
  // Dead/unreachable public domains return partial AuditResult (never 500).
  const parsedInput = await validatePublicTargetUrl(rawUrl).catch((err) => {
    if (err instanceof SsrfBlockedError || (err && typeof err === 'object' && 'statusCode' in err && Number((err as { statusCode: number }).statusCode) === 400)) {
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
      parsed: null,
      robotsTxt: { exists: null, allowsIndexing: null, reason: parsedInput.error },
      sitemapXml: { exists: null, reason: parsedInput.error },
      speed: null,
      speedReason: parsedInput.error,
      findings,
    });
  }

  let finalUrl: string | null = parsedInput.toString();
  let httpStatus: number | null = null;
  let ttfbMs: number | null = null;
  const ttfbSamplesMs: number[] = [];
  let htmlBytes: number | null = null;
  let isHttps: boolean | null = parsedInput.protocol === 'https:';
  let fetchError: string | null = null;
  let parsedHtml: ParsedHtmlFacts | null = null;

  try {
    const pageResp = await fetchWithSsrfProtection(parsedInput.toString(), {
      timeoutMs: 15000,
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 5,
    });
    finalUrl = pageResp.finalUrl;
    httpStatus = pageResp.statusCode;
    ttfbSamplesMs.push(pageResp.ttfbMs);
    htmlBytes = pageResp.bytes;
    isHttps = new URL(pageResp.finalUrl).protocol === 'https:';

    if (pageResp.statusCode >= 400) {
      fetchError = `Website returned HTTP ${pageResp.statusCode}.`;
    } else if (pageResp.text.trim()) {
      parsedHtml = parseHtmlWithCheerio(pageResp.text);
    } else {
      fetchError = 'Website returned an empty HTML document.';
    }

    // Measure 2 more sequential requests to the resolved endpoint (total 3 samples, discard nothing, median)
    for (let i = 0; i < 2; i++) {
      try {
        const probeResp = await fetchWithSsrfProtection(finalUrl, {
          timeoutMs: 10000,
          maxRedirects: 5,
          headersOnly: true,
        });
        ttfbSamplesMs.push(probeResp.ttfbMs);
      } catch {
        // Keep previously captured samples if an additional probe fails
      }
    }

    if (ttfbSamplesMs.length > 0) {
      const sorted = [...ttfbSamplesMs].sort((a, b) => a - b);
      ttfbMs = Math.round(sorted[Math.floor(sorted.length / 2)]);
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw err;
    }
    fetchError = err instanceof Error ? err.message : 'Unable to fetch target HTML.';
  }

  // Check robots.txt and sitemap.xml relative to final origin
  const originUrl = new URL(finalUrl || parsedInput.toString()).origin;
  let robotsTxt: AuditResult['robotsTxt'] = { exists: null, allowsIndexing: null };
  let sitemapXml: AuditResult['sitemapXml'] = { exists: null };

  if (!fetchError || httpStatus !== null) {
    try {
      const robotsResp = await fetchWithSsrfProtection(`${originUrl}/robots.txt`, {
        timeoutMs: 10000,
        maxBytes: 512 * 1024,
        maxRedirects: 3,
      });
      if (robotsResp.statusCode >= 200 && robotsResp.statusCode < 300 && !/<html/i.test(robotsResp.text)) {
        robotsTxt = {
          exists: true,
          allowsIndexing: parseRobotsAllowsIndexing(robotsResp.text),
        };
      } else {
        robotsTxt = { exists: false, allowsIndexing: true };
      }
    } catch (err) {
      robotsTxt = {
        exists: null,
        allowsIndexing: null,
        reason: err instanceof Error ? err.message : 'Unable to check robots.txt',
      };
    }

    try {
      const sitemapResp = await fetchWithSsrfProtection(`${originUrl}/sitemap.xml`, {
        timeoutMs: 10000,
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 3,
      });
      const looksXml =
        sitemapResp.statusCode >= 200 &&
        sitemapResp.statusCode < 300 &&
        (/<(urlset|sitemapindex)\b/i.test(sitemapResp.text) ||
          /xml/i.test(sitemapResp.contentType));
      sitemapXml = {
        exists: looksXml,
        reason: looksXml ? undefined : `No valid sitemap.xml (HTTP ${sitemapResp.statusCode})`,
      };
    } catch (err) {
      sitemapXml = {
        exists: null,
        reason: err instanceof Error ? err.message : 'Unable to check sitemap.xml',
      };
    }
  } else {
    robotsTxt = { exists: null, allowsIndexing: null, reason: fetchError };
    sitemapXml = { exists: null, reason: fetchError };
  }

  // Run open-source Lighthouse if main HTML loaded cleanly
  let speed: SpeedMetrics | null = null;
  let speedReason: string | null = null;
  if (!fetchError && finalUrl) {
    const lh = await runLighthouseAudit(finalUrl);
    speed = lh.speed;
    speedReason = lh.reason;
  } else {
    speedReason = fetchError || 'Skipped speed test because main page did not load.';
  }

  const findings = buildAutomatedFindings({
    isHttps,
    fetchError,
    ttfbMs,
    ttfbSampleCount: ttfbSamplesMs.length,
    parsed: parsedHtml,
    robotsTxt,
    sitemapXml,
    speed,
    speedReason,
  });

  return AuditResultSchema.parse({
    schemaVersion: '1.0',
    requestedUrl: rawUrl,
    finalUrl,
    auditedAt: new Date().toISOString(),
    httpStatus,
    ttfbMs,
    ttfbSamplesMs,
    htmlBytes,
    isHttps,
    fetchError,
    parsed: parsedHtml,
    robotsTxt,
    sitemapXml,
    speed,
    speedReason,
    findings,
  });
}
