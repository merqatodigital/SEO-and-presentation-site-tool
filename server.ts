import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';
import {
  AuditJobSkippedError,
  AuditQueueFullError,
  enqueueAudit,
  resolveChromiumExecutable,
} from './serverAudit.ts';
import {
  CHROME_USER_AGENT,
  CHROMIUM_FLAGS,
  SlidingWindowRateLimiter,
  SsrfBlockedError,
  attachPublicUrlRouteFilter,
  parseAllowedRelayHosts,
  requireCaptureToken,
  sanitizePlaywrightNavigationError,
  sendTargetUrlError,
  validatePublicTargetUrl,
  validateRelayUrlBeforeDns,
} from './serverShared.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN?.trim() || '';
const TRUST_PROXY = process.env.TRUST_PROXY?.trim().toLowerCase() === 'true';
const RELAY_ALLOWED_HOSTS = parseAllowedRelayHosts(process.env.RELAY_ALLOWED_HOSTS);

const AUDIT_RATE_MAX = 10;
const CAPTURE_RATE_MAX = 5;
const RELAY_RATE_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const RELAY_TIMEOUT_MS = 60_000;
const RELAY_MAX_BYTES = 2 * 1024 * 1024;
const CAPTURE_CONCURRENCY_MAX = 2;
const CAPTURE_HARD_DEADLINE_MS = 45_000;

const rateLimiter = new SlidingWindowRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxKeys: 10_000,
});
setInterval(() => {
  rateLimiter.prune();
}, RATE_LIMIT_WINDOW_MS).unref();

function getClientIp(req: express.Request): string {
  if (TRUST_PROXY) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}

function isAllowedRelayContentType(rawContentType: string | null): boolean {
  if (!rawContentType) return true;
  const mediaType = rawContentType.split(';')[0].trim().toLowerCase();
  if (!mediaType) return true;
  return (
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    mediaType === 'text/event-stream'
  );
}

const app = express();
if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

if (process.env.NODE_ENV === 'production') {
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
}

const smallJsonParser = express.json({ limit: '64kb' });
const relayJsonParser = express.json({ limit: '25mb' });

let activeCaptureCount = 0;

function relayPreAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!requireCaptureToken(req, res, CAPTURE_TOKEN)) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!rateLimiter.check(`relay:${clientIp}`, RELAY_RATE_MAX)) {
    res.status(429).json({
      error: 'Rate limit exceeded (60 relay requests per minute). Please wait a moment and retry.',
    });
    return;
  }

  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    chromium: resolveChromiumExecutable(),
    node: process.version,
    uptime: Math.floor(process.uptime()),
  });
});

app.post('/api/relay', relayPreAuthMiddleware, relayJsonParser, async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const method = req.body?.method === 'GET' ? 'GET' : 'POST';
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const payload = req.body?.body;

  if (!rawUrl) {
    res.status(400).json({ error: 'Target API URL is required.' });
    return;
  }

  try {
    validateRelayUrlBeforeDns(rawUrl, RELAY_ALLOWED_HOSTS);
  } catch (err) {
    sendTargetUrlError(res, err);
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = await validatePublicTargetUrl(rawUrl);
  } catch (err) {
    sendTargetUrlError(res, err);
    return;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
      body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => {});
      res.status(502).json({ error: 'Upstream AI endpoint returned an unexpected redirect.' });
      return;
    }

    const upstreamContentType = upstream.headers.get('content-type');
    if (!isAllowedRelayContentType(upstreamContentType)) {
      await upstream.body?.cancel().catch(() => {});
      res.status(502).json({ error: 'Upstream AI returned an unsupported content type.' });
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > RELAY_MAX_BYTES) {
          await reader.cancel().catch(() => {});
          controller.abort();
          res.status(502).json({ error: 'Upstream AI response exceeded 2 MB limit.' });
          return;
        }
        chunks.push(Buffer.from(value));
      }
    }

    const bodyText = Buffer.concat(chunks).toString('utf8');
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstreamContentType?.split(';')[0].trim() || 'application/json'
    );
    res.send(bodyText);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      res.status(504).json({ error: 'Upstream AI provider timed out after 60s.' });
      return;
    }
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to reach upstream AI provider.',
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
});

app.post('/api/audit', smallJsonParser, async (req, res) => {
  if (!requireCaptureToken(req, res, CAPTURE_TOKEN)) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!rateLimiter.check(`audit:${clientIp}`, AUDIT_RATE_MAX)) {
    res.status(429).json({
      error: 'Rate limit exceeded (10 audits per minute). Please wait a moment and retry.',
    });
    return;
  }

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!rawUrl) {
    res.status(400).json({ error: 'Website URL is required.' });
    return;
  }

  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    res.status(503).json({ error: 'No Chromium found. Set PLAYWRIGHT_EXECUTABLE_PATH.' });
    return;
  }

  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
    }
  });

  try {
    const result = await enqueueAudit(rawUrl, {
      shouldSkip: () => clientDisconnected || res.closed || req.socket.destroyed,
    });
    if (!res.headersSent && !clientDisconnected) {
      res.json(result);
    }
  } catch (err) {
    if (err instanceof AuditJobSkippedError || res.headersSent || clientDisconnected) {
      return;
    }
    if (err instanceof AuditQueueFullError) {
      res.status(503).json({ error: err.message });
      return;
    }
    sendTargetUrlError(res, err);
  }
});

app.post('/api/capture', smallJsonParser, async (req, res) => {
  if (!requireCaptureToken(req, res, CAPTURE_TOKEN)) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!rateLimiter.check(`capture:${clientIp}`, CAPTURE_RATE_MAX)) {
    res.status(429).json({
      error: 'Rate limit exceeded (5 captures per minute). Please wait a moment and retry.',
    });
    return;
  }

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const requestedShots = Number(req.body?.shots);
  const shotCount = Number.isFinite(requestedShots)
    ? Math.min(6, Math.max(3, Math.round(requestedShots)))
    : 5;

  if (!rawUrl) {
    res.status(400).json({ error: 'Website URL is required.' });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = await validatePublicTargetUrl(rawUrl);
  } catch (err) {
    sendTargetUrlError(res, err);
    return;
  }

  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    res.status(503).json({ error: 'No Chromium found. Set PLAYWRIGHT_EXECUTABLE_PATH.' });
    return;
  }

  if (activeCaptureCount >= CAPTURE_CONCURRENCY_MAX) {
    res.status(503).json({ error: 'Capture queue is full, try again in a minute.' });
    return;
  }

  activeCaptureCount++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const routeFilterHolder: { getBlockedError: (() => string | null) | null } = {
    getBlockedError: null,
  };

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
        timedOut = true;
        void closeBrowserSafely();
        reject(new Error('Capture timed out after 45 seconds.'));
      }, CAPTURE_HARD_DEADLINE_MS);
    });

    const captureWork = async () => {
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
      routeFilterHolder.getBlockedError = routeFilter.getBlockedNavigationError;

      const response = await page.goto(targetUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      const blockedNavigationError = routeFilter.getBlockedNavigationError();
      if (blockedNavigationError) {
        throw new SsrfBlockedError(blockedNavigationError, 403);
      }

      // Re-validate final URL after redirects to guard against SSRF redirect chains
      await validatePublicTargetUrl(page.url());

      if (response && response.status() >= 400) {
        if (response.status() === 403 || response.status() === 401) {
          return {
            status: 403 as const,
            body: {
              error: `Target website blocked automated access (HTTP ${response.status()}). Upload screenshots manually below instead.`,
            },
          };
        }
        if (response.status() === 404) {
          return {
            status: 422 as const,
            body: { error: 'Website page not found (HTTP 404). Check the URL.' },
          };
        }
      }

      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);

      const facts = await page.evaluate(() => {
        const title = (document.title || '').trim();
        const metaDesc =
          document.querySelector('meta[name="description"]')?.getAttribute('content') ||
          document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
          '';

        const headings: string[] = [];
        const seenHeadings = new Set<string>();
        for (const el of Array.from(document.querySelectorAll('h1, h2, h3'))) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.visibility === 'hidden' ||
            style.display === 'none'
          ) {
            continue;
          }
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length >= 2 && text.length <= 140 && !seenHeadings.has(text)) {
            seenHeadings.add(text);
            headings.push(text);
            if (headings.length >= 16) break;
          }
        }

        const ctas: string[] = [];
        const seenCtas = new Set<string>();
        for (const el of Array.from(
          document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')
        )) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.visibility === 'hidden' ||
            style.display === 'none'
          ) {
            continue;
          }
          const raw =
            el instanceof HTMLInputElement
              ? el.value
              : el.textContent || el.getAttribute('aria-label') || '';
          const text = raw.replace(/\s+/g, ' ').trim();
          if (text.length >= 2 && text.length <= 55 && !seenCtas.has(text)) {
            seenCtas.add(text);
            ctas.push(text);
            if (ctas.length >= 16) break;
          }
        }

        const scrollHeight = Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0,
          800
        );

        return {
          title,
          description: metaDesc.replace(/\s+/g, ' ').trim(),
          headings,
          ctas,
          scrollHeight,
          viewportHeight: window.innerHeight || 800,
        };
      });

      const maxScroll = Math.max(0, facts.scrollHeight - facts.viewportHeight);
      const scrollPositions: number[] = [];

      if (maxScroll < 120) {
        scrollPositions.push(0, 0, 0);
      } else {
        for (let i = 0; i < shotCount; i++) {
          const ratio = shotCount === 1 ? 0 : i / (shotCount - 1);
          scrollPositions.push(Math.round(maxScroll * ratio));
        }
      }

      const sectionLabels = [
        '01-hero.jpg',
        '02-overview.jpg',
        '03-sections.jpg',
        '04-details.jpg',
        '05-footer.jpg',
        '06-extra.jpg',
      ];
      const shots: Array<{ name: string; dataUrl: string }> = [];

      for (let i = 0; i < scrollPositions.length; i++) {
        const y = scrollPositions[i];
        await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'instant' }), y);
        await page.waitForTimeout(350);
        const buffer = await page.screenshot({
          type: 'jpeg',
          quality: 82,
        });
        shots.push({
          name: sectionLabels[i] || `0${i + 1}-section.jpg`,
          dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        });
      }

      return {
        status: 200 as const,
        body: {
          title: facts.title,
          description: facts.description,
          headings: facts.headings,
          ctas: facts.ctas,
          shots,
        },
      };
    };

    const outcome = await Promise.race([captureWork(), deadlinePromise]);
    if (!res.headersSent) {
      res.status(outcome.status).json(outcome.body);
    }
  } catch (err) {
    if (res.headersSent) return;
    const blockedNavMessage = routeFilterHolder.getBlockedError?.();
    if (blockedNavMessage) {
      res.status(403).json({ error: blockedNavMessage });
      return;
    }
    const rawMessage = err instanceof Error ? err.message : 'Unable to capture website.';
    if (err instanceof SsrfBlockedError) {
      res.status(err.statusCode).json({ error: rawMessage });
      return;
    }
    if (timedOut || /timeout/i.test(rawMessage)) {
      res.status(504).json({
        error:
          'Capture timed out while loading the website. The site may be slow or blocking automated access.',
      });
      return;
    }
    res.status(422).json({ error: sanitizePlaywrightNavigationError(rawMessage) });
  } finally {
    if (deadlineHandle) clearTimeout(deadlineHandle);
    activeCaptureCount = Math.max(0, activeCaptureCount - 1);
    await closeBrowserSafely();
  }
});

// Return JSON errors for malformed JSON or oversized bodies on API routes
app.use(
  '/api',
  (
    err: Error & { status?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err.type === 'entity.too.large' || err.status === 413) {
      res.status(413).json({ error: 'Request payload too large.' });
      return;
    }
    if (err instanceof SyntaxError && err.status === 400) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    next(err);
  }
);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production' && CAPTURE_TOKEN.length < 32) {
    console.error(
      'ERROR: CAPTURE_TOKEN must be at least 32 characters when NODE_ENV=production (e.g. `openssl rand -hex 32`). Refusing to start without strong API authentication.'
    );
    process.exit(1);
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const resolvedChromium = resolveChromiumExecutable();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TourForge Lite server listening on http://0.0.0.0:${PORT}`);
    console.log(
      `Chromium executable: ${resolvedChromium ?? 'None found (set PLAYWRIGHT_EXECUTABLE_PATH)'}`
    );
  });
}

void startServer();
