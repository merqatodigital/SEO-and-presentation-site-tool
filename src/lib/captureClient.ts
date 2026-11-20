import { z } from 'zod';
import { PageFacts, ScreenshotAsset } from '../types/tour';

const CaptureResponseSchema = z.object({
  title: z.string().optional().default(''),
  description: z.string().optional().default(''),
  headings: z.array(z.string()).optional().default([]),
  ctas: z.array(z.string()).optional().default([]),
  shots: z
    .array(
      z.object({
        name: z.string().min(1),
        dataUrl: z.string().min(1),
      })
    )
    .min(1, 'Capture server returned no screenshots.'),
});

export interface CaptureSiteResult {
  pageFacts: PageFacts;
  screenshots: ScreenshotAsset[];
}

function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a website URL to capture.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid website URL (for example, https://example.com).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// website URLs can be captured.');
  }
  return parsed.toString();
}

function normalizeCaptureServerUrl(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Configure a Capture server URL in Settings first.');
  }
  return trimmed;
}

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1280,
        height: img.naturalHeight || 760,
      });
    img.onerror = () => resolve({ width: 1280, height: 760 });
    img.src = dataUrl;
  });
}

async function postCapture(
  endpoint: string,
  headers: Record<string, string>,
  targetUrl: string,
  shots: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 45000);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: targetUrl, shots }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function captureWebsite({
  captureUrl,
  captureToken,
  websiteUrl,
  shots = 5,
}: {
  captureUrl: string;
  captureToken?: string;
  websiteUrl: string;
  shots?: number;
}): Promise<CaptureSiteResult> {
  const baseUrl = normalizeCaptureServerUrl(captureUrl || '/api');
  const targetUrl = normalizeTargetUrl(websiteUrl);
  const endpoint = `${baseUrl}/capture`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (captureToken && captureToken.trim()) {
    headers.Authorization = `Bearer ${captureToken.trim()}`;
  }

  let response: Response;
  try {
    response = await postCapture(endpoint, headers, targetUrl, shots);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        'Capture timed out after 45 seconds. The target website may be slow or blocking automated visits.'
      );
    }

    const isStaleLocalDefaultOnHttps =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      /^http:\/\/localhost:8787$/i.test(baseUrl);

    if (isStaleLocalDefaultOnHttps) {
      try {
        response = await postCapture('/api/capture', headers, targetUrl, shots);
      } catch (fallbackErr) {
        if (fallbackErr instanceof DOMException && fallbackErr.name === 'AbortError') {
          throw new Error(
            'Capture timed out after 45 seconds. The target website may be slow or blocking automated visits.'
          );
        }
        throw new Error(
          'Capture server unreachable. Switch Capture server URL to /api in Settings or upload screenshots manually below.'
        );
      }
    } else {
      throw new Error(
        `Capture server unreachable at ${baseUrl}. Make sure the capture server is running, CORS is enabled, and the URL in Settings is correct — or upload screenshots manually below.`
      );
    }
  }

  const rawText = await response.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(rawText);
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    const serverErr =
      parsedBody &&
      typeof parsedBody === 'object' &&
      'error' in parsedBody &&
      typeof (parsedBody as { error?: unknown }).error === 'string'
        ? (parsedBody as { error: string }).error
        : rawText || response.statusText;

    if (response.status === 401) {
      throw new Error(
        `Capture server rejected authentication (401). Check your Capture token in Settings. ${serverErr}`
      );
    }
    if (response.status === 408 || response.status === 504) {
      throw new Error(`Capture timed out while loading the target site: ${serverErr}`);
    }
    if (
      response.status === 403 ||
      response.status === 400 ||
      response.status === 422 ||
      /block|forbidden|private|localhost|denied|disallow|bot|captcha|cloudflare/i.test(serverErr)
    ) {
      throw new Error(`URL blocked or rejected by capture server (${response.status}): ${serverErr}`);
    }
    throw new Error(`Capture server error (${response.status}): ${serverErr}`);
  }

  const validated = CaptureResponseSchema.safeParse(parsedBody);
  if (!validated.success) {
    throw new Error(
      'Capture server returned an unexpected response shape. Expected { title, description, headings, ctas, shots }.'
    );
  }

  const data = validated.data;
  const limitedShots = data.shots.slice(0, 6);

  const screenshots: ScreenshotAsset[] = await Promise.all(
    limitedShots.map(async (shot, idx) => {
      const dims = await getImageDimensions(shot.dataUrl);
      return {
        id: `captured-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        name: shot.name,
        dataUrl: shot.dataUrl,
        width: dims.width,
        height: dims.height,
      };
    })
  );

  const pageFacts: PageFacts = {
    url: targetUrl,
    title: data.title.trim(),
    description: data.description.trim(),
    headings: data.headings.map((h) => h.trim()).filter(Boolean),
    ctas: data.ctas.map((c) => c.trim()).filter(Boolean),
  };

  return { pageFacts, screenshots };
}

export async function testCaptureServer(
  captureUrl: string,
  captureToken = ''
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = normalizeCaptureServerUrl(captureUrl || '/api');
  const endpoint = `${baseUrl}/capture`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (captureToken.trim()) {
    headers.Authorization = `Bearer ${captureToken.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (res.status === 401) {
      return { ok: false, message: `Reached ${endpoint}, but capture token was rejected (401).` };
    }
    return { ok: true, message: `Capture server reachable at ${endpoint}.` };
  } catch {
    window.clearTimeout(timeoutId);
    const isHttpsToLocal =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
    if (isHttpsToLocal) {
      return {
        ok: false,
        message: `Cannot reach ${baseUrl} from this HTTPS page (either no local server is running on that port, or the browser blocked http://localhost). Use Built-in (/api) or expose localhost via an HTTPS tunnel.`,
      };
    }
    return {
      ok: false,
      message: `Capture server unreachable at ${endpoint}.`,
    };
  }
}
