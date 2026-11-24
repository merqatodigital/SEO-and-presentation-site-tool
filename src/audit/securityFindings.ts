import * as cheerio from 'cheerio';
import {
  FindingStatus,
  PassiveSecurityAudit,
  PassiveSecurityHeaderCheck,
  SecurityFinding,
  SecuritySeverity,
  ThirdPartyScriptItem,
} from './types';

export interface PassiveTlsInfo {
  protocol?: string | null;
  cipher?: string | null;
  certificateValid?: boolean | null;
  validTo?: string | null;
}

export interface PassiveSecurityInput {
  finalUrl: string | null;
  isHttps: boolean | null;
  html: string;
  headers?: Record<string, string>;
  setCookies?: string[];
  robotsTxtContent?: string | null;
  tlsInfo?: PassiveTlsInfo | null;
  headersChecked?: boolean;
  contentBlocked?: boolean;
}

function normalizeHeaders(raw?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      out[k.toLowerCase().trim()] = v.trim();
    }
  }
  return out;
}

function truncatePreview(val: string | undefined, max = 110): string | null {
  if (!val) return null;
  const clean = val.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseHstsMaxAge(headerVal: string | undefined): number | null {
  if (!headerVal) return null;
  const match = headerVal.match(/max-age\s*=\s*(\d+)/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function extractDirective(csp: string, name: string): string | null {
  const directives = csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const d of directives) {
    const tokens = d.split(/\s+/);
    if (tokens[0]?.toLowerCase() === name.toLowerCase()) {
      return tokens.slice(1).join(' ');
    }
  }
  return null;
}

function redactSecretValue(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.length <= 10) return '***';
  return `${clean.slice(0, 7)}…***`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseScriptLibraryAndVersion(
  srcUrl: string
): { library: string | null; version: string | null } {
  try {
    const parsed = new URL(srcUrl, 'https://example.invalid');
    const pathLower = parsed.pathname.toLowerCase();
    const full = `${parsed.pathname}${parsed.search}`;

    // Check npm CDN style: /npm/pkg@1.2.3/, /npm/@scope/pkg@1.2.3/, or /libs/pkg/1.2.3/
    const npmScopedMatch = parsed.pathname.match(
      /\/(@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)@(\d+\.\d+(?:\.\d+)?)/i
    );
    if (npmScopedMatch) {
      return {
        library: npmScopedMatch[1],
        version: npmScopedMatch[2],
      };
    }

    const cdnjsMatch = parsed.pathname.match(/\/libs\/([a-z0-9._-]+)\/(\d+\.\d+(?:\.\d+)?)\//i);
    if (cdnjsMatch) {
      return {
        library: cdnjsMatch[1],
        version: cdnjsMatch[2],
      };
    }

    // Known library filenames like jquery-3.6.0.min.js or bootstrap.min.js?ver=5.3.2
    const fileMatch = pathLower.match(
      /\/([a-z0-9._-]+?)(?:[-_.]v?(\d+\.\d+(?:\.\d+)?))?(?:\.min)?\.m?js$/i
    );
    const queryVerMatch = full.match(/[?&](?:v|ver|version)=v?(\d+\.\d+(?:\.\d+)?)/i);
    const pathVerMatch = parsed.pathname.match(/\/v?(\d+\.\d+(?:\.\d+)?)\//i);

    const library = fileMatch?.[1] || null;
    const version = fileMatch?.[2] || queryVerMatch?.[1] || pathVerMatch?.[1] || null;
    return { library, version };
  } catch {
    return { library: null, version: null };
  }
}

function isVersionBelow(version: string, targetMajor: number, targetMinor: number): boolean {
  const parts = version.split('.').map((p) => Number(p));
  const maj = parts[0] ?? 0;
  const min = parts[1] ?? 0;
  if (maj < targetMajor) return true;
  if (maj === targetMajor && min < targetMinor) return true;
  return false;
}

function isLegacyLibraryVersion(library: string | null, version: string | null): boolean {
  if (!library || !version) return false;
  const lib = library.toLowerCase();
  if (lib.includes('jquery') && !lib.includes('migrate') && isVersionBelow(version, 3, 5)) {
    return true;
  }
  if (lib.includes('bootstrap') && isVersionBelow(version, 4, 0)) {
    return true;
  }
  if (lib === 'angular' || lib === 'angularjs') {
    const major = Number(version.split('.')[0] ?? 0);
    if (major >= 1 && major < 2) return true;
  }
  return false;
}

const SECRET_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  {
    type: 'Private Key Block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    type: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    type: 'GitHub Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  },
  {
    type: 'Stripe Secret / Restricted Key',
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g,
  },
  {
    type: 'Slack API Token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    type: 'LLM / Bearer Secret Key',
    regex: /\bsk-or-v1-[0-9a-f]{32,}\b|\bsk-proj-[A-Za-z0-9_-]{24,}\b/gi,
  },
  {
    type: 'Database URI with Embedded Password',
    regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s"'<>]+:[^@\s"'<>]+@[^/\s"'<>]+/gi,
  },
];

const IGNORED_MIXED_XML_PREFIXES = [
  'http://www.w3.org/',
  'http://schema.org',
  'http://schemas.',
  'http://purl.org/',
  'http://opengraphprotocol.org/',
];

function isXmlNamespaceUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return IGNORED_MIXED_XML_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function makeSecurityFinding(
  id: string,
  label: string,
  status: FindingStatus,
  severity: SecuritySeverity,
  weight: number,
  evidence: string,
  fix: string,
  businessImpact: string
): SecurityFinding {
  return {
    id,
    category: 'security',
    label,
    status,
    severity,
    weight,
    evidence,
    fix,
    businessImpact,
  };
}

export function analyzePassiveSecurity(input: PassiveSecurityInput): PassiveSecurityAudit {
  const checkedAt = new Date().toISOString();
  const headers = normalizeHeaders(input.headers);
  const headersChecked =
    input.headersChecked ?? (Object.keys(headers).length > 0 && !input.contentBlocked);
  const blocked = Boolean(input.contentBlocked);
  const hasHtml = Boolean(input.html && input.html.trim().length > 0 && !blocked);
  const $ = hasHtml ? cheerio.load(input.html) : null;

  const targetHost = (() => {
    if (!input.finalUrl) return '';
    try {
      return new URL(input.finalUrl).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  })();

  // 1. Security Headers + TLS
  const cspRaw = headers['content-security-policy'];
  const hstsRaw = headers['strict-transport-security'];
  const xctoRaw = headers['x-content-type-options'];
  const xfoRaw = headers['x-frame-options'];
  const referrerRaw = headers['referrer-policy'];
  const permissionsRaw = headers['permissions-policy'] || headers['feature-policy'];

  const hstsMaxAge = parseHstsMaxAge(hstsRaw);
  const hstsEnabled = Boolean(input.isHttps && hstsRaw && (hstsMaxAge === null || hstsMaxAge > 0));

  const headerChecks: PassiveSecurityHeaderCheck[] = [];
  const findings: SecurityFinding[] = [];

  if (blocked || !headersChecked) {
    const reason = blocked
      ? 'This site blocks automated checks'
      : 'Response headers were unavailable for passive inspection';
    for (const headerName of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      headerChecks.push({
        header: headerName,
        present: false,
        status: 'unknown',
        valuePreview: null,
        detail: reason,
      });
    }

    findings.push(
      makeSecurityFinding('sec-csp', 'Content-Security-Policy (CSP)', 'unknown', 'info', 5, reason, 'Verify headers from origin server.', 'Prevents cross-site script injection.'),
      makeSecurityFinding('sec-hsts', 'HTTPS Strict-Transport-Security (HSTS)', 'unknown', 'info', 4, reason, 'Enable HSTS over HTTPS.', 'Prevents TLS downgrade attacks.'),
      makeSecurityFinding('sec-xcto', 'X-Content-Type-Options (nosniff)', 'unknown', 'info', 2, reason, 'Set X-Content-Type-Options: nosniff.', 'Blocks MIME-type sniffing.'),
      makeSecurityFinding('sec-xfo', 'Clickjacking protection (X-Frame-Options / frame-ancestors)', 'unknown', 'info', 3, reason, 'Set X-Frame-Options or CSP frame-ancestors.', 'Prevents clickjacking overlays.'),
      makeSecurityFinding('sec-referrer', 'Referrer-Policy header', 'unknown', 'info', 2, reason, 'Set Referrer-Policy: strict-origin-when-cross-origin.', 'Protects URL tokens in referrer headers.'),
      makeSecurityFinding('sec-permissions', 'Permissions-Policy header', 'unknown', 'info', 1, reason, 'Restrict unused browser features via Permissions-Policy.', 'Limits abuse of camera/mic/geolocation APIs.')
    );
  } else {
    // 1a. CSP
    let cspStatus: FindingStatus = 'pass';
    let cspSeverity: SecuritySeverity = 'info';
    let cspDetail = 'CSP header configured without unsafe directives.';
    if (!cspRaw) {
      cspStatus = 'fail';
      cspSeverity = 'high';
      cspDetail = 'Missing Content-Security-Policy header.';
    } else {
      const defaultSrc = extractDirective(cspRaw, 'default-src') ?? '';
      const scriptSrc = extractDirective(cspRaw, 'script-src') ?? defaultSrc;
      const weakIssues: string[] = [];
      if (/\bunsafe-eval\b/i.test(scriptSrc)) weakIssues.push("'unsafe-eval'");
      if (/\bunsafe-inline\b/i.test(scriptSrc) && !/'(?:nonce-|sha\d+-)/i.test(scriptSrc)) {
        weakIssues.push("'unsafe-inline' without nonce/hash");
      }
      if (/(?:^|\s)\*(?:\s|$)/.test(scriptSrc)) weakIssues.push('wildcard * script source');
      if (/\bhttp:/i.test(scriptSrc)) weakIssues.push('plain http: allowed');
      if (weakIssues.length > 0) {
        cspStatus = 'warn';
        cspSeverity = 'medium';
        cspDetail = `Weak CSP script/default rules (${weakIssues.join(', ')}).`;
      }
    }
    headerChecks.push({
      header: 'Content-Security-Policy',
      present: Boolean(cspRaw),
      status: cspStatus,
      valuePreview: truncatePreview(cspRaw),
      detail: cspDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-csp',
        'Content-Security-Policy (CSP)',
        cspStatus,
        cspSeverity,
        5,
        cspDetail,
        'Configure a strict Content-Security-Policy header restricting script-src and frame-ancestors.',
        'Weak or missing CSP leaves visitors exposed if third-party scripts or inputs are compromised.'
      )
    );

    // 1b. HSTS
    let hstsStatus: FindingStatus = 'pass';
    let hstsSeverity: SecuritySeverity = 'info';
    let hstsDetail = hstsRaw
      ? `HSTS active (max-age=${hstsMaxAge ?? 'set'}${/includeSubDomains/i.test(hstsRaw) ? ', includeSubDomains' : ''}).`
      : 'HSTS header configured.';
    if (input.isHttps === false) {
      hstsStatus = 'fail';
      hstsSeverity = 'high';
      hstsDetail = 'Site served over plain HTTP; HSTS cannot protect connections.';
    } else if (!hstsRaw) {
      hstsStatus = 'fail';
      hstsSeverity = 'high';
      hstsDetail = 'Missing Strict-Transport-Security header over HTTPS.';
    } else if (hstsMaxAge === null || hstsMaxAge < 15_552_000) {
      hstsStatus = 'warn';
      hstsSeverity = 'medium';
      hstsDetail = `HSTS max-age is short (${hstsMaxAge ?? 0}s; recommend >= 31536000).`;
    } else if (!/includeSubDomains/i.test(hstsRaw)) {
      hstsStatus = 'warn';
      hstsSeverity = 'low';
      hstsDetail = 'HSTS active, but missing includeSubDomains directive.';
    }
    headerChecks.push({
      header: 'Strict-Transport-Security',
      present: Boolean(hstsRaw),
      status: hstsStatus,
      valuePreview: truncatePreview(hstsRaw),
      detail: hstsDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-hsts',
        'HTTPS Strict-Transport-Security (HSTS)',
        hstsStatus,
        hstsSeverity,
        4,
        hstsDetail,
        'Serve over HTTPS with Strict-Transport-Security: max-age=31536000; includeSubDomains.',
        'Missing HSTS exposes first-hop traffic to TLS stripping attacks.'
      )
    );

    // 1c. X-Content-Type-Options
    const xctoOk = Boolean(xctoRaw && xctoRaw.toLowerCase().includes('nosniff'));
    const xctoStatus: FindingStatus = xctoOk ? 'pass' : 'warn';
    const xctoDetail = xctoOk
      ? 'X-Content-Type-Options: nosniff set.'
      : xctoRaw
      ? `Unexpected X-Content-Type-Options value (${xctoRaw}).`
      : 'Missing X-Content-Type-Options: nosniff header.';
    headerChecks.push({
      header: 'X-Content-Type-Options',
      present: Boolean(xctoRaw),
      status: xctoStatus,
      valuePreview: truncatePreview(xctoRaw),
      detail: xctoDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-xcto',
        'X-Content-Type-Options (nosniff)',
        xctoStatus,
        xctoOk ? 'info' : 'medium',
        2,
        xctoDetail,
        'Add header X-Content-Type-Options: nosniff.',
        'Prevents browsers from MIME-sniffing uploaded or static files as executable scripts.'
      )
    );

    // 1d. X-Frame-Options / frame-ancestors
    const frameAncestors = cspRaw ? extractDirective(cspRaw, 'frame-ancestors') : null;
    const xfoValid = Boolean(xfoRaw && /^(deny|sameorigin)$/i.test(xfoRaw.trim()));
    const frameAncestorsValid = Boolean(frameAncestors && !/^\*$/.test(frameAncestors.trim()));
    const xfoOk = xfoValid || frameAncestorsValid;
    const xfoStatus: FindingStatus = xfoOk ? 'pass' : 'warn';
    const xfoDetail = frameAncestorsValid
      ? `Protected via CSP frame-ancestors (${frameAncestors}).`
      : xfoValid
      ? `X-Frame-Options: ${xfoRaw!.trim()}.`
      : 'Missing X-Frame-Options (DENY/SAMEORIGIN) and CSP frame-ancestors.';
    headerChecks.push({
      header: 'X-Frame-Options',
      present: Boolean(xfoRaw || frameAncestorsValid),
      status: xfoStatus,
      valuePreview: truncatePreview(xfoRaw || (frameAncestors ? `frame-ancestors ${frameAncestors}` : undefined)),
      detail: xfoDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-xfo',
        'Clickjacking protection (X-Frame-Options / frame-ancestors)',
        xfoStatus,
        xfoOk ? 'info' : 'medium',
        3,
        xfoDetail,
        'Add X-Frame-Options: DENY (or SAMEORIGIN) and CSP frame-ancestors.',
        'Without framing restrictions, attackers can overlay invisible booking/login forms.'
      )
    );

    // 1e. Referrer-Policy
    const safeReferrer =
      referrerRaw &&
      /^(no-referrer|same-origin|strict-origin|strict-origin-when-cross-origin|origin-when-cross-origin)$/i.test(
        referrerRaw.split(',')[0].trim()
      );
    const refStatus: FindingStatus = safeReferrer ? 'pass' : 'warn';
    const refDetail = safeReferrer
      ? `Referrer-Policy: ${referrerRaw}.`
      : referrerRaw
      ? `Weak Referrer-Policy (${referrerRaw}).`
      : 'Missing Referrer-Policy header.';
    headerChecks.push({
      header: 'Referrer-Policy',
      present: Boolean(referrerRaw),
      status: refStatus,
      valuePreview: truncatePreview(referrerRaw),
      detail: refDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-referrer',
        'Referrer-Policy header',
        refStatus,
        safeReferrer ? 'info' : 'low',
        2,
        refDetail,
        'Set Referrer-Policy: strict-origin-when-cross-origin (or no-referrer).',
        'Limits leakage of URL query parameters to third-party origins.'
      )
    );

    // 1f. Permissions-Policy
    const permOk = Boolean(permissionsRaw && permissionsRaw.length > 0);
    const permStatus: FindingStatus = permOk ? 'pass' : 'warn';
    const permDetail = permOk
      ? 'Permissions-Policy header present.'
      : 'Missing Permissions-Policy header.';
    headerChecks.push({
      header: 'Permissions-Policy',
      present: permOk,
      status: permStatus,
      valuePreview: truncatePreview(permissionsRaw),
      detail: permDetail,
    });
    findings.push(
      makeSecurityFinding(
        'sec-permissions',
        'Permissions-Policy header',
        permStatus,
        permOk ? 'info' : 'low',
        1,
        permDetail,
        'Set Permissions-Policy: camera=(), microphone=(), geolocation=() as needed.',
        'Reduces blast radius if embedded third-party widgets try accessing device sensors.'
      )
    );
  }

  // 2. Cookies missing Secure / HttpOnly / SameSite
  const cookieHeaders = (input.setCookies ?? []).filter((c) => c.trim().length > 0);
  const missingSecure: string[] = [];
  const missingHttpOnly: string[] = [];
  const missingSameSite: string[] = [];
  const weakSameSite: string[] = [];

  for (const rawCookie of cookieHeaders) {
    const cookieName = rawCookie.split('=')[0]?.trim() || 'cookie';
    const parts = rawCookie.split(';').slice(1).map((p) => p.trim().toLowerCase());
    const hasSecure = parts.some((p) => p === 'secure');
    const hasHttpOnly = parts.some((p) => p === 'httponly');
    const sameSitePart = parts.find((p) => p.startsWith('samesite='));

    if (!hasSecure) missingSecure.push(cookieName);
    if (!hasHttpOnly) missingHttpOnly.push(cookieName);
    if (!sameSitePart) {
      missingSameSite.push(cookieName);
    } else if (sameSitePart === 'samesite=none' && !hasSecure) {
      weakSameSite.push(cookieName);
    }
  }

  if (blocked || !headersChecked) {
    findings.push(
      makeSecurityFinding(
        'sec-cookies',
        'Cookie security attributes (Secure, HttpOnly, SameSite)',
        'unknown',
        'info',
        4,
        blocked ? 'This site blocks automated checks' : 'Response headers unavailable',
        'Inspect Set-Cookie attributes on server responses.',
        'Protects session identifiers against theft and CSRF.'
      )
    );
  } else if (cookieHeaders.length === 0) {
    findings.push(
      makeSecurityFinding(
        'sec-cookies',
        'Cookie security attributes (Secure, HttpOnly, SameSite)',
        'pass',
        'info',
        4,
        'No Set-Cookie headers emitted on initial page load',
        'None required.',
        'Stateless public landing pages minimize session cookie exposure.'
      )
    );
  } else {
    const hasHighCookieRisk = missingSecure.length > 0 || weakSameSite.length > 0;
    const hasMedCookieRisk = missingHttpOnly.length > 0 || missingSameSite.length > 0;
    const cookieStatus: FindingStatus = hasHighCookieRisk
      ? 'fail'
      : hasMedCookieRisk
      ? 'warn'
      : 'pass';
    const cookieSeverity: SecuritySeverity = hasHighCookieRisk
      ? 'high'
      : hasMedCookieRisk
      ? 'medium'
      : 'info';
    const issues: string[] = [];
    if (missingSecure.length) issues.push(`missing Secure (${missingSecure.join(', ')})`);
    if (missingHttpOnly.length) issues.push(`missing HttpOnly (${missingHttpOnly.join(', ')})`);
    if (missingSameSite.length) issues.push(`missing SameSite (${missingSameSite.join(', ')})`);
    if (weakSameSite.length) issues.push(`SameSite=None without Secure (${weakSameSite.join(', ')})`);

    findings.push(
      makeSecurityFinding(
        'sec-cookies',
        'Cookie security attributes (Secure, HttpOnly, SameSite)',
        cookieStatus,
        cookieSeverity,
        4,
        issues.length > 0
          ? `${cookieHeaders.length} cookie(s) inspected: ${issues.join('; ')}`
          : `All ${cookieHeaders.length} cookie(s) enforce Secure, HttpOnly, and SameSite`,
        'Set Secure; HttpOnly; SameSite=Lax (or Strict) on session and auth cookies.',
        'Cookies missing Secure/HttpOnly/SameSite can be intercepted or forged across sites.'
      )
    );
  }

  // HTML-dependent checks
  const activeMixedUrls: string[] = [];
  const passiveMixedUrls: string[] = [];
  const secretFindings: Array<{ type: string; previewRedacted: string }> = [];
  const exposureHints: string[] = [];
  const sourceMapUrls: string[] = [];
  const thirdPartyScripts: ThirdPartyScriptItem[] = [];
  let totalForms = 0;
  let postFormsWithoutCsrfHint = 0;
  let sensitiveInputsWithoutAutocompleteOff = 0;

  if (!$) {
    const unavailableReason = blocked
      ? 'This site blocks automated checks'
      : 'HTML document unavailable for passive security inspection';
    findings.push(
      makeSecurityFinding('sec-mixed-content', 'Mixed-content http:// assets on HTTPS', 'unknown', 'info', 4, unavailableReason, 'Serve all assets over https://.', 'Mixed content triggers browser security warnings.'),
      makeSecurityFinding('sec-secrets', 'Exposed secrets or keys in HTML / inline JS', 'unknown', 'info', 5, unavailableReason, 'Keep all private keys and API secrets server-side.', 'Public secrets allow unauthorized API/account usage.'),
      makeSecurityFinding('sec-exposure-hints', 'Sensitive file / config / version exposure hints', 'unknown', 'info', 4, unavailableReason, 'Remove .git/.env references and verbose version headers.', 'Exposure hints assist automated exploitation.'),
      makeSecurityFinding('sec-source-maps', 'Production source maps exposed', 'unknown', 'info', 2, unavailableReason, 'Disable public .map emission in production builds.', 'Source maps expose unminified internal client code.'),
      makeSecurityFinding('sec-third-party-scripts', 'Third-party script inventory & SRI integrity', 'unknown', 'info', 2, unavailableReason, 'Pin third-party scripts and add SRI integrity hashes.', 'Unpinned external scripts increase supply-chain risk.'),
      makeSecurityFinding('sec-forms', 'Form autocomplete & CSRF token hints', 'unknown', 'info', 2, unavailableReason, 'Add anti-CSRF tokens and explicit autocomplete attributes.', 'Improves credential handling and request forgery resilience.')
    );
  } else {
    // 3. Mixed Content URLs
    if (input.isHttps) {
      const seenActive = new Set<string>();
      const seenPassive = new Set<string>();
      const recordMixed = (rawVal: string | undefined, isActive: boolean) => {
        if (!rawVal) return;
        const val = rawVal.trim();
        if (!/^http:\/\//i.test(val) || isXmlNamespaceUrl(val)) return;
        if (isActive) {
          if (!seenActive.has(val)) {
            seenActive.add(val);
            activeMixedUrls.push(val);
          }
        } else if (!seenPassive.has(val)) {
          seenPassive.add(val);
          passiveMixedUrls.push(val);
        }
      };

      $('script[src]').each((_i, el) => recordMixed($(el).attr('src'), true));
      $('iframe[src]').each((_i, el) => recordMixed($(el).attr('src'), true));
      $('object[data], embed[src]').each((_i, el) =>
        recordMixed($(el).attr('data') || $(el).attr('src'), true)
      );
      $('link[href]').each((_i, el) => {
        const rel = ($(el).attr('rel') || '').toLowerCase();
        if (rel.includes('stylesheet') || rel.includes('preload') || rel.includes('modulepreload')) {
          recordMixed($(el).attr('href'), true);
        }
      });
      $('form[action]').each((_i, el) => recordMixed($(el).attr('action'), true));

      $('img[src], video[src], audio[src], source[src], video[poster]').each((_i, el) =>
        recordMixed($(el).attr('src') || $(el).attr('poster'), false)
      );
    }

    const totalMixed = activeMixedUrls.length + passiveMixedUrls.length;
    const mixedStatus: FindingStatus =
      input.isHttps === false
        ? 'fail'
        : activeMixedUrls.length > 0
        ? 'fail'
        : passiveMixedUrls.length > 0
        ? 'warn'
        : 'pass';
    const mixedSeverity: SecuritySeverity =
      input.isHttps === false || activeMixedUrls.length > 0
        ? 'high'
        : passiveMixedUrls.length > 0
        ? 'medium'
        : 'info';
    findings.push(
      makeSecurityFinding(
        'sec-mixed-content',
        'Mixed-content http:// assets on HTTPS',
        mixedStatus,
        mixedSeverity,
        4,
        input.isHttps === false
          ? 'Page loaded over HTTP instead of HTTPS'
          : totalMixed === 0
          ? 'No insecure http:// subresources detected'
          : `${activeMixedUrls.length} active and ${passiveMixedUrls.length} passive http:// asset URL(s) detected`,
        'Upgrade all script, stylesheet, form action, and media URLs to https://.',
        'Mixed active content is blocked by browsers and degrades visitor trust.'
      )
    );

    // 4. Exposed Secrets in HTML / Inline JS
    const seenSecrets = new Set<string>();
    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(input.html)) !== null) {
        const redacted = redactSecretValue(match[0]);
        const key = `${pattern.type}:${redacted}`;
        if (!seenSecrets.has(key)) {
          seenSecrets.add(key);
          secretFindings.push({ type: pattern.type, previewRedacted: redacted });
        }
        if (secretFindings.length >= 15) break;
      }
      if (secretFindings.length >= 15) break;
    }

    findings.push(
      makeSecurityFinding(
        'sec-secrets',
        'Exposed secrets or keys in HTML / inline JS',
        secretFindings.length > 0 ? 'fail' : 'pass',
        secretFindings.length > 0 ? 'high' : 'info',
        5,
        secretFindings.length > 0
          ? `${secretFindings.length} secret pattern(s) flagged (${secretFindings.map((s) => `${s.type}: ${s.previewRedacted}`).slice(0, 3).join('; ')})`
          : 'No API secrets or private keys detected in HTML/inline JS',
        'Revoke exposed credentials immediately and move secret keys to server-side environment variables.',
        'Client-side secrets allow anyone viewing page source to misuse paid APIs or backend services.'
      )
    );

    // 5. .git / .env / backup-file exposure hints (100% passive inspection of fetched HTML/headers/robots.txt)
    const highHints: string[] = [];
    const lowHints: string[] = [];

    if (/Index of \//i.test(input.html) && /Parent Directory/i.test(input.html)) {
      highHints.push('Directory listing pattern ("Index of /") visible in HTML');
    }
    const sensitivePathRegex =
      /(?:^|["'\s(])(\/?(?:\.git\/(?:config|HEAD|index)|\.env(?:\.(?:local|production|staging|development))?|wp-config\.php(?:\.bak|~)|config\.php\.bak|backup\.(?:sql|zip|tar\.gz)|database\.(?:sql|sqlite)|dump\.sql))(?=["'\s)]|$)/gi;
    let hintMatch: RegExpExecArray | null;
    const seenHintStrings = new Set<string>();
    while ((hintMatch = sensitivePathRegex.exec(input.html)) !== null) {
      const found = hintMatch[1];
      if (!seenHintStrings.has(found)) {
        seenHintStrings.add(found);
        highHints.push(`HTML references sensitive path "${found}"`);
      }
      if (highHints.length >= 8) break;
    }

    if (input.robotsTxtContent) {
      const robotsLeakRegex = /^(?:disallow|allow):\s*(\S*(?:\.git|\.env|\.sql|\.bak|backup|\.zip)\S*)/gim;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = robotsLeakRegex.exec(input.robotsTxtContent)) !== null) {
        const pathHint = `robots.txt exposes sensitive path hint (${rMatch[1]})`;
        if (!seenHintStrings.has(pathHint)) {
          seenHintStrings.add(pathHint);
          lowHints.push(pathHint);
        }
      }
    }

    if (headers['x-powered-by']) {
      lowHints.push(`X-Powered-By banner exposed (${headers['x-powered-by']})`);
    }
    if (headers['server'] && /\d+\.\d+/.test(headers['server'])) {
      lowHints.push(`Detailed Server version banner (${headers['server']})`);
    }

    exposureHints.push(...highHints, ...lowHints);
    const expStatus: FindingStatus =
      highHints.length > 0 ? 'fail' : lowHints.length > 0 ? 'warn' : 'pass';
    const expSeverity: SecuritySeverity =
      highHints.length > 0 ? 'high' : lowHints.length > 0 ? 'low' : 'info';
    findings.push(
      makeSecurityFinding(
        'sec-exposure-hints',
        'Sensitive file / config / version exposure hints',
        expStatus,
        expSeverity,
        highHints.length > 0 ? 5 : 2,
        exposureHints.length > 0
          ? exposureHints.slice(0, 3).join('; ')
          : 'No .git, .env, backup file, or server version leaks spotted in page source',
        'Remove links/comments referencing .git/.env/backups, block dotfiles at the web server, and suppress X-Powered-By.',
        'Exposed repository metadata or environment files can leak server credentials.'
      )
    );

    // 6. Source Maps shipped to production
    const seenMaps = new Set<string>();
    const mapCommentRegex = /[#@]\s*sourceMappingURL=([^\s"'<>]+)/gi;
    let mapMatch: RegExpExecArray | null;
    while ((mapMatch = mapCommentRegex.exec(input.html)) !== null) {
      const mapUrl = mapMatch[1].trim();
      if (mapUrl && !seenMaps.has(mapUrl)) {
        seenMaps.add(mapUrl);
        sourceMapUrls.push(mapUrl);
      }
    }
    $('script[src$=".map"], link[href$=".map"]').each((_i, el) => {
      const u = ($(el).attr('src') || $(el).attr('href') || '').trim();
      if (u && !seenMaps.has(u)) {
        seenMaps.add(u);
        sourceMapUrls.push(u);
      }
    });

    findings.push(
      makeSecurityFinding(
        'sec-source-maps',
        'Production source maps exposed',
        sourceMapUrls.length > 0 ? 'warn' : 'pass',
        sourceMapUrls.length > 0 ? 'medium' : 'info',
        2,
        sourceMapUrls.length > 0
          ? `${sourceMapUrls.length} sourceMappingURL / .map reference(s) exposed (${sourceMapUrls.slice(0, 2).join(', ')})`
          : 'No production source maps detected in HTML/inline assets',
        'Disable public source map generation (e.g., Vite build.sourcemap: false) or keep .map files private.',
        'Public source maps reveal internal source structure and business logic.'
      )
    );

    // 7. Third-party script inventory with versions
    const seenScriptUrls = new Set<string>();
    let missingSriCount = 0;
    const legacyScripts: string[] = [];

    $('script[src]').each((_i, el) => {
      const rawSrc = ($(el).attr('src') || '').trim();
      if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) return;
      try {
        const resolved = new URL(rawSrc, input.finalUrl || 'https://example.invalid');
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
        const scriptHost = resolved.hostname.replace(/^www\./i, '').toLowerCase();
        if (targetHost && (scriptHost === targetHost || scriptHost.endsWith(`.${targetHost}`))) {
          return;
        }
        const normalizedSrc = resolved.toString();
        if (seenScriptUrls.has(normalizedSrc)) return;
        seenScriptUrls.add(normalizedSrc);

        const { library, version } = parseScriptLibraryAndVersion(normalizedSrc);
        const hasSri = Boolean($(el).attr('integrity')?.trim());
        if (!hasSri) missingSriCount++;
        if (isLegacyLibraryVersion(library, version)) {
          legacyScripts.push(`${library}@${version}`);
        }
        thirdPartyScripts.push({
          src: normalizedSrc,
          host: scriptHost,
          library,
          version,
          hasSri,
        });
      } catch {
        // Ignore unparseable script URLs
      }
    });

    const scriptStatus: FindingStatus =
      legacyScripts.length > 0 || missingSriCount > 0 ? 'warn' : 'pass';
    const scriptSeverity: SecuritySeverity =
      legacyScripts.length > 0 ? 'medium' : missingSriCount > 0 ? 'low' : 'info';
    findings.push(
      makeSecurityFinding(
        'sec-third-party-scripts',
        'Third-party script inventory & SRI integrity',
        scriptStatus,
        scriptSeverity,
        legacyScripts.length > 0 ? 3 : 2,
        thirdPartyScripts.length === 0
          ? 'No external third-party scripts loaded'
          : `${thirdPartyScripts.length} third-party script(s) (${missingSriCount} missing SRI integrity${legacyScripts.length > 0 ? `; outdated: ${legacyScripts.join(', ')}` : ''})`,
        'Upgrade outdated libraries and add Subresource Integrity (integrity="sha384-...") + crossorigin="anonymous" on CDN scripts.',
        'Outdated or unverified external scripts expose visitors if a third-party CDN is tampered with.'
      )
    );

    // 8. Form autocomplete and CSRF hints
    const forms = $('form');
    totalForms = forms.length;
    forms.each((_i, formEl) => {
      const form = $(formEl);
      const method = (form.attr('method') || 'get').trim().toLowerCase();
      if (method === 'post') {
        const hasCsrfHidden = form
          .find('input[type="hidden"]')
          .toArray()
          .some((inp) =>
            /(?:csrf|xsrf|_token|authenticity_token|__requestverificationtoken|nonce)/i.test(
              ($(inp).attr('name') || '') + ' ' + ($(inp).attr('id') || '')
            )
          );
        if (!hasCsrfHidden) {
          postFormsWithoutCsrfHint++;
        }
      }

      form.find('input').each((_j, inp) => {
        const type = ($(inp).attr('type') || 'text').trim().toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button') return;
        const nameAndId = `${$(inp).attr('name') || ''} ${$(inp).attr('id') || ''}`;
        const isSensitive =
          type === 'password' ||
          /(?:password|passwd|pwd|cvv|cvc|cardnumber|card_number|ssn|pin|secret|api_key)/i.test(
            nameAndId
          );
        if (!isSensitive) return;

        const autocomplete = ($(inp).attr('autocomplete') || '').trim().toLowerCase();
        const safeAc =
          autocomplete === 'off' ||
          autocomplete === 'new-password' ||
          autocomplete === 'current-password' ||
          autocomplete === 'one-time-code';
        if (!safeAc) {
          sensitiveInputsWithoutAutocompleteOff++;
        }
      });
    });

    const formIssues: string[] = [];
    if (sensitiveInputsWithoutAutocompleteOff > 0) {
      formIssues.push(
        `${sensitiveInputsWithoutAutocompleteOff} sensitive input(s) missing explicit autocomplete directive`
      );
    }
    if (postFormsWithoutCsrfHint > 0) {
      formIssues.push(
        `${postFormsWithoutCsrfHint} POST form(s) without visible hidden CSRF token field`
      );
    }

    const formStatus: FindingStatus = formIssues.length > 0 ? 'warn' : 'pass';
    const formSeverity: SecuritySeverity =
      sensitiveInputsWithoutAutocompleteOff > 0 ? 'medium' : formIssues.length > 0 ? 'low' : 'info';
    findings.push(
      makeSecurityFinding(
        'sec-forms',
        'Form autocomplete & CSRF hints',
        formStatus,
        formSeverity,
        2,
        totalForms === 0
          ? 'No HTML forms present on page'
          : formIssues.length > 0
          ? `${totalForms} form(s) checked: ${formIssues.join('; ')}`
          : `All ${totalForms} form(s) follow autocomplete & CSRF hygiene hints`,
        'Set autocomplete="current-password" / "off" on sensitive fields and include anti-CSRF tokens on POST forms.',
        'Proper form attributes reduce shared-device credential caching and cross-site submission risks.'
      )
    );
  }

  const highSeverityCount = findings.filter(
    (f) => (f.status === 'fail' || f.status === 'warn') && f.severity === 'high'
  ).length;
  const badgeEligible = headersChecked && !blocked && highSeverityCount === 0;

  return {
    checkedAt,
    headersChecked,
    tls: {
      isHttps: input.isHttps,
      protocol: input.tlsInfo?.protocol ?? null,
      certificateValid: input.tlsInfo?.certificateValid ?? null,
      validTo: input.tlsInfo?.validTo ?? null,
      hstsEnabled,
      hstsMaxAge,
    },
    headerChecks,
    mixedContent: {
      activeUrls: activeMixedUrls,
      passiveUrls: passiveMixedUrls,
      count: activeMixedUrls.length + passiveMixedUrls.length,
    },
    cookies: {
      total: cookieHeaders.length,
      missingSecure,
      missingHttpOnly,
      missingSameSite,
      weakSameSite,
    },
    secrets: {
      count: secretFindings.length,
      findings: secretFindings,
    },
    exposureHints: {
      count: exposureHints.length,
      hints: exposureHints,
    },
    sourceMaps: {
      count: sourceMapUrls.length,
      urls: sourceMapUrls,
    },
    thirdPartyScripts,
    forms: {
      totalForms,
      postFormsWithoutCsrfHint,
      sensitiveInputsWithoutAutocompleteOff,
    },
    findings,
    highSeverityCount,
    badgeEligible,
  };
}

export function buildSecurityBadgeSvg(siteLabel: string, securityScore: number | null): string {
  const safeName = escapeHtmlAttr(siteLabel.trim() || 'Verified Site');
  const scoreText = securityScore !== null ? `${securityScore}/100` : 'PASS';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="248" height="36" role="img" aria-label="Security Passed - ${safeName}">
  <rect width="248" height="36" rx="6" fill="#0F172A"/>
  <rect x="1" y="1" width="246" height="34" rx="5" fill="none" stroke="#10B981" stroke-width="1.5"/>
  <circle cx="20" cy="18" r="7" fill="#10B981"/>
  <path d="M16.8 18.2l2.1 2.1 4.3-4.5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="35" y="16" fill="#F8FAFC" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="700">Security Passed</text>
  <text x="35" y="28" fill="#94A3B8" font-family="system-ui,-apple-system,sans-serif" font-size="9.5">${safeName.slice(0, 26)}</text>
  <rect x="188" y="8" width="50" height="20" rx="4" fill="#065F46"/>
  <text x="213" y="21.5" text-anchor="middle" fill="#D1FAE5" font-family="ui-monospace,monospace" font-size="10.5" font-weight="700">${scoreText}</text>
</svg>`;
}

export function buildSecurityBadgeSnippet(
  siteLabel: string,
  siteUrl: string | null | undefined,
  securityScore: number | null
): string {
  const svg = buildSecurityBadgeSvg(siteLabel, securityScore);
  const safeHref =
    siteUrl && /^https?:\/\//i.test(siteUrl.trim()) ? escapeHtmlAttr(siteUrl.trim()) : '#';
  const safeTitle = escapeHtmlAttr(
    `Passive Security Check Passed (${siteLabel.trim() || 'Website'})`
  );
  return `<a href="${safeHref}" title="${safeTitle}" style="display:inline-block;text-decoration:none;">\n${svg}\n</a>`;
}
