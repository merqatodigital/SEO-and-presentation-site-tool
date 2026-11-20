import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type express from 'express';

export const CHROME_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const CHROMIUM_FLAGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
] as const;

export const DEFAULT_RELAY_ALLOWED_HOSTS = ['openrouter.ai', 'integrate.api.nvidia.com'] as const;

export class SsrfBlockedError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function stripIpv6Brackets(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/^\[|\]$/g, '');
}

function parseIpv6ToWords(ip: string): number[] | null {
  const clean = stripIpv6Brackets(ip.split('%')[0]);
  if (!net.isIPv6(clean)) return null;

  let working = clean;
  // Convert trailing embedded IPv4 dotted quad (e.g. ::ffff:127.0.0.1) to two hex groups
  const lastColon = working.lastIndexOf(':');
  const tail = lastColon >= 0 ? working.slice(lastColon + 1) : '';
  if (tail.includes('.')) {
    if (!net.isIPv4(tail)) return null;
    const octets = tail.split('.').map(Number);
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const parts = working.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];

  const totalExplicit = left.length + right.length;
  if (parts.length === 1 && totalExplicit !== 8) return null;
  if (parts.length === 2 && totalExplicit > 8) return null;

  const zerosNeeded = parts.length === 2 ? 8 - totalExplicit : 0;
  const groups = [...left, ...Array(zerosNeeded).fill('0'), ...right];
  if (groups.length !== 8) return null;

  const words = groups.map((g) => parseInt(g, 16));
  if (words.some((w) => Number.isNaN(w) || w < 0 || w > 0xffff)) return null;
  return words;
}

function isPrivateIpv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved 240/4
  return false;
}

function wordsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateOrBlockedIp(rawIp: string): boolean {
  const ip = stripIpv6Brackets(rawIp.split('%')[0]);
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }

  const words = parseIpv6ToWords(ip);
  if (!words) return false;

  // :: (unspecified) and ::1 (loopback)
  const prefixZero = words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0;
  if (prefixZero && words[6] === 0 && (words[7] === 0 || words[7] === 1)) {
    return true;
  }

  // IPv4-mapped ::ffff:0:0/96 (both dotted and hex canonical forms)
  if (
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0xffff
  ) {
    return isPrivateIpv4(wordsToIpv4(words[6], words[7]));
  }

  // IPv4-compatible ::/96 (when non-zero IPv4 embedded)
  if (prefixZero && (words[6] !== 0 || words[7] > 1)) {
    return isPrivateIpv4(wordsToIpv4(words[6], words[7]));
  }

  // Unique local fc00::/7
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // Link-local fe80::/10
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // Deprecated site-local fec0::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true;

  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
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

  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('URLs containing embedded credentials are not allowed.', 403);
  }

  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    throw new SsrfBlockedError(`Port ${parsed.port} is not allowed. Only ports 80 and 443 are permitted.`, 403);
  }

  const hostname = stripIpv6Brackets(parsed.hostname);
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new SsrfBlockedError('Blocked local or private network URL.', 403);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new SsrfBlockedError('Blocked private or reserved IP address.', 403);
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
    if (err instanceof SsrfBlockedError) {
      throw err;
    }
    if (err && typeof err === 'object' && 'statusCode' in err && Number((err as { statusCode: number }).statusCode) === 422) {
      throw err;
    }
    throw Object.assign(
      new Error(`Could not reach domain "${hostname}". Verify the URL and try again.`),
      { statusCode: 422 }
    );
  }

  return parsed;
}

export function sendTargetUrlError(res: express.Response, err: unknown): void {
  if (err instanceof SsrfBlockedError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const status =
    err && typeof err === 'object' && 'statusCode' in err
      ? Number((err as { statusCode: number }).statusCode)
      : 400;
  res.status(status).json({
    error: err instanceof Error ? err.message : 'Blocked or invalid target URL.',
  });
}

function sha256Digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function isBearerTokenValid(authHeader: string | undefined, expectedToken: string): boolean {
  const cleanExpected = expectedToken.trim();
  if (!cleanExpected) return true;
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const presented = match[1].trim();
  if (!presented) return false;

  return crypto.timingSafeEqual(sha256Digest(presented), sha256Digest(cleanExpected));
}

export function requireCaptureToken(
  req: express.Request,
  res: express.Response,
  expectedToken: string
): boolean {
  if (!isBearerTokenValid(req.headers.authorization, expectedToken)) {
    res.status(401).json({ error: 'Invalid or missing capture bearer token.' });
    return false;
  }
  return true;
}

export function parseAllowedRelayHosts(rawEnv?: string): Set<string> {
  const trimmed = (rawEnv || '').trim();
  if (!trimmed) {
    return new Set(DEFAULT_RELAY_ALLOWED_HOSTS);
  }
  const entries = trimmed
    .split(',')
    .map((h) => stripIpv6Brackets(h).trim().toLowerCase())
    .filter(Boolean);
  return new Set(entries.length > 0 ? entries : DEFAULT_RELAY_ALLOWED_HOSTS);
}

export function isAllowedRelayHost(hostname: string, allowedHosts: Set<string>): boolean {
  const clean = stripIpv6Brackets(hostname).toLowerCase();
  return allowedHosts.has(clean);
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly store = new Map<string, number[]>();

  constructor(options: { windowMs?: number; maxKeys?: number } = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  check(bucketKey: string, limit: number, now = Date.now()): boolean {
    const prev = this.store.get(bucketKey) || [];
    const fresh = prev.filter((ts) => now - ts < this.windowMs);

    if (fresh.length >= limit) {
      this.store.set(bucketKey, fresh);
      return false;
    }

    if (!this.store.has(bucketKey) && this.store.size >= this.maxKeys) {
      this.prune(now);
      if (this.store.size >= this.maxKeys) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          this.store.delete(oldestKey);
        }
      }
    }

    fresh.push(now);
    this.store.set(bucketKey, fresh);
    return true;
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, timestamps] of this.store.entries()) {
      const fresh = timestamps.filter((ts) => now - ts < this.windowMs);
      if (fresh.length === 0) {
        this.store.delete(key);
        removed++;
      } else if (fresh.length !== timestamps.length) {
        this.store.set(key, fresh);
      }
    }
    return removed;
  }

  size(): number {
    return this.store.size;
  }
}

export interface RoutablePageLike {
  mainFrame: () => unknown;
  route: (
    url: string,
    handler: (route: {
      request: () => {
        url: () => string;
        isNavigationRequest: () => boolean;
        frame: () => unknown;
      };
      continue: () => Promise<void>;
      abort: (errorCode?: string) => Promise<void>;
    }) => Promise<void> | void
  ) => Promise<unknown>;
}

export async function attachPublicUrlRouteFilter(
  page: RoutablePageLike
): Promise<{ getBlockedNavigationError: () => string | null }> {
  let blockedNavigationError: string | null = null;

  await page.route('**/*', async (route) => {
    const req = route.request();
    const reqUrl = req.url();

    if (
      reqUrl.startsWith('data:') ||
      reqUrl.startsWith('blob:') ||
      reqUrl === 'about:blank'
    ) {
      await route.continue().catch(() => {});
      return;
    }

    if (!/^https?:\/\//i.test(reqUrl)) {
      await route.continue().catch(() => {});
      return;
    }

    try {
      await validatePublicTargetUrl(reqUrl);
      await route.continue().catch(() => {});
    } catch (err) {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        blockedNavigationError =
          err instanceof Error ? err.message : 'Blocked private or disallowed navigation URL.';
      }
      await route.abort('accessdenied').catch(() => {});
    }
  });

  return {
    getBlockedNavigationError: () => blockedNavigationError,
  };
}
