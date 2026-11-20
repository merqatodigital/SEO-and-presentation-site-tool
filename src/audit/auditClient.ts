import { AuditResult, AuditResultSchema } from './types';

function normalizeAuditEndpoint(captureUrl: string): string {
  const base = (captureUrl || '/api').trim().replace(/\/+$/, '');
  if (!base || base === '/api') return '/api/audit';
  return `${base}/audit`;
}

export async function runSiteAudit(
  websiteUrl: string,
  captureUrl = '/api',
  captureToken = '',
  signal?: AbortSignal
): Promise<AuditResult> {
  const trimmed = websiteUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a website URL to run the audit.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  const endpoint = normalizeAuditEndpoint(captureUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (captureToken.trim()) {
    headers.Authorization = `Bearer ${captureToken.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: withScheme }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const isStaleLocalOnHttps =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      /^http:\/\/localhost:8787/i.test(captureUrl);

    if (isStaleLocalOnHttps) {
      response = await fetch('/api/audit', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: withScheme }),
        signal,
      });
    } else {
      throw new Error(
        'Could not reach the audit server. Make sure the server is running or switch Capture URL to /api in Settings.'
      );
    }
  }

  const text = await response.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Server token missing or wrong. Check Settings.');
    }
    const serverErr =
      parsedBody &&
      typeof parsedBody === 'object' &&
      'error' in parsedBody &&
      typeof (parsedBody as { error?: unknown }).error === 'string'
        ? (parsedBody as { error: string }).error
        : text || response.statusText;
    throw new Error(serverErr || `Audit request failed (${response.status}).`);
  }

  const validated = AuditResultSchema.safeParse(parsedBody);
  if (!validated.success) {
    throw new Error('The audit server returned an unexpected response format.');
  }

  return validated.data;
}
