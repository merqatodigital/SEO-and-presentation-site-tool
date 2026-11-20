import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';
import {
  SsrfBlockedError,
  enqueueAudit,
  resolveChromiumExecutable,
  validatePublicTargetUrl,
} from './serverAudit.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN?.trim() || '';

// Per-IP sliding-window rate limiter for POST /api/audit (max 10 requests / 60s)
const AUDIT_RATE_WINDOW_MS = 60_000;
const AUDIT_RATE_MAX = 10;
const auditRateMap = new Map<string, number[]>();

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkAuditRateLimit(ip: string): boolean {
  const now = Date.now();
  const prev = auditRateMap.get(ip) || [];
  const fresh = prev.filter((ts) => now - ts < AUDIT_RATE_WINDOW_MS);
  if (fresh.length >= AUDIT_RATE_MAX) {
    auditRateMap.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  auditRateMap.set(ip, fresh);
  return true;
}

const app = express();
app.use(express.json({ limit: '25mb' }));

app.post('/api/relay', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const method = req.body?.method === 'GET' ? 'GET' : 'POST';
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const payload = req.body?.body;

  if (!rawUrl) {
    res.status(400).json({ error: 'Target API URL is required.' });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = await validatePublicTargetUrl(rawUrl);
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : 400;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Blocked URL.' });
    return;
  }

  if (targetUrl.protocol !== 'https:') {
    res.status(403).json({ error: 'Relay only allows HTTPS external API endpoints.' });
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

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      redirect: 'manual',
      body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to reach upstream AI provider.',
    });
  }
});

app.post('/api/audit', async (req, res) => {
  if (CAPTURE_TOKEN) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${CAPTURE_TOKEN}`) {
      res.status(401).json({ error: 'Invalid or missing capture bearer token.' });
      return;
    }
  }

  const clientIp = getClientIp(req);
  if (!checkAuditRateLimit(clientIp)) {
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

  try {
    const result = await enqueueAudit(rawUrl);
    res.json(result);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : 400;
    res.status(status).json({
      error: err instanceof Error ? err.message : 'Invalid audit request.',
    });
  }
});

app.post('/api/capture', async (req, res) => {
  if (CAPTURE_TOKEN) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${CAPTURE_TOKEN}`) {
      res.status(401).json({ error: 'Invalid or missing capture bearer token.' });
      return;
    }
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
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : 400;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Blocked URL.' });
    return;
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const executablePath = resolveChromiumExecutable();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    const response = await page.goto(targetUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Re-validate final URL after redirects to guard against SSRF redirect chains
    await validatePublicTargetUrl(page.url());

    if (response && response.status() >= 400) {
      if (response.status() === 403 || response.status() === 401) {
        res.status(403).json({
          error: `Target website blocked automated access (HTTP ${response.status()}). Upload screenshots manually below instead.`,
        });
        return;
      }
      if (response.status() === 404) {
        res.status(422).json({ error: `Website page not found (HTTP 404). Check the URL.` });
        return;
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

    res.json({
      title: facts.title,
      description: facts.description,
      headings: facts.headings,
      ctas: facts.ctas,
      shots,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to capture website.';
    if (err instanceof SsrfBlockedError) {
      res.status(err.statusCode).json({ error: message });
      return;
    }
    if (/timeout/i.test(message)) {
      res.status(504).json({
        error: 'Capture timed out while loading the website. The site may be slow or blocking automated access.',
      });
      return;
    }
    res.status(422).json({ error: message });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

async function startServer() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TourForge Lite server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
