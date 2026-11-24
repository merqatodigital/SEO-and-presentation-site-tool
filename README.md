# TourForge Lite

> **Release v0.1.0:** Added the 100% passive security & headers audit layer, 10%-weighted `Passive Security & Headers` scorecard category, ready-to-commit server header snippets, and embeddable "Security Passed" badge.

TourForge Lite turns a client website URL or uploaded screenshots and a short brief into an **evidence-based visibility audit, one-page RAG scorecard, outcome-first walkthrough player, and editable 2027 digital proposal**.

- **Deterministic Audit Engine**: All HTML, SEO, contact/CTA, passive security/header, NAP consistency, median TTFB, and Lighthouse mobile speed checks run deterministically in TypeScript (`src/audit/*`, Cheerio, and open-source Lighthouse).
- **BYOK AI Generation**: Walkthrough narration and highlight coordinates use a single OpenAI-compatible client (`POST {baseUrl}/chat/completions`) configured via browser `localStorage` (OpenRouter, NVIDIA NIM, local Ollama, or any custom endpoint).

---

## Quick Start (Local Development)

### Prerequisites
- **Node.js 22+**
- **Chromium** installed locally (or set `PLAYWRIGHT_EXECUTABLE_PATH`)

### Install & Run

```bash
npm install
npm run dev
```

The app and API server run together on `http://localhost:3000`.

### Verify & Test

```bash
npm run lint      # TypeScript type check (tsc --noEmit)
npm run selftest  # Unit tests for audit scoring, NAP, HTML/CTA, JSON-LD, and migration
npm run build     # Production Vite bundle -> dist/
npm start         # Serve production build via NODE_ENV=production tsx server.ts
```

---

## Docker

Build and run TourForge Lite in a self-contained container with Chromium and system fonts:

```bash
docker build -t tourforge-lite .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e CAPTURE_TOKEN=your-optional-token \
  tourforge-lite
```

---

## Environment Variables

Copy `.env.example` to `.env` if needed:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | Port the Express server listens on. |
| `CAPTURE_TOKEN` | Yes in prod | `""` | Bearer token (>= 32 chars required when `NODE_ENV=production`; generate via `openssl rand -hex 32`) protecting `/api/audit`, `/api/capture`, and `/api/relay`. |
| `PLAYWRIGHT_EXECUTABLE_PATH` | No | Auto-detected | Path to Chromium binary. Checked before `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome-stable`, and `/ms-playwright/*`. |
| `TRUST_PROXY` | No | `false` | Set `true` only behind a trusted reverse proxy (`app.set('trust proxy', 1)`) to honor `X-Forwarded-For` for rate limits. |
| `RELAY_ALLOWED_HOSTS` | No | `openrouter.ai,integrate.api.nvidia.com` | Comma-separated hostnames allowed by `/api/relay`. Custom providers must be added here. |

---

## API Endpoints

### `GET /api/health`
Returns server liveness, resolved Chromium binary path, Node version, and process uptime.

**Response (`200 OK`)**
```json
{
  "ok": true,
  "chromium": "/usr/bin/chromium",
  "node": "v22.14.0",
  "uptime": 42
}
```

### `POST /api/audit`
Runs SSRF-protected HTML parsing (Cheerio), 3-request median TTFB timing, `/robots.txt` + `/sitemap.xml` checks, and mobile Lighthouse audit through a concurrency-1 queue (rate-limited to 10 req/min per IP).

**Request**
```json
{
  "url": "https://example.com"
}
```

**Response (`200 OK`)**
```json
{
  "schemaVersion": "1.0",
  "requestedUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "auditedAt": "2026-11-19T00:00:00.000Z",
  "httpStatus": 200,
  "ttfbMs": 22,
  "ttfbSamplesMs": [28, 22, 19],
  "htmlBytes": 1256,
  "isHttps": true,
  "fetchError": null,
  "parsed": { "title": "Example Domain", "h1Count": 1, "ctaTexts": [] },
  "robotsTxt": { "exists": false, "allowsIndexing": true },
  "sitemapXml": { "exists": false, "reason": "No valid sitemap.xml (HTTP 404)" },
  "speed": {
    "scores": { "performance": 100, "seo": 80, "accessibility": 96, "bestPractices": 100 },
    "fcpMs": 850,
    "lcpMs": 920,
    "cls": 0,
    "tbtMs": 0,
    "speedIndexMs": 850,
    "totalByteWeight": 2150,
    "opportunities": []
  },
  "speedReason": null,
  "security": {
    "checkedAt": "2026-11-23T00:00:00.000Z",
    "headersChecked": true,
    "tls": { "isHttps": true, "protocol": "TLSv1.3", "certificateValid": true, "hstsEnabled": false, "hstsMaxAge": null },
    "headerChecks": [],
    "mixedContent": { "activeUrls": [], "passiveUrls": [], "count": 0 },
    "cookies": { "total": 0, "missingSecure": [], "missingHttpOnly": [], "missingSameSite": [], "weakSameSite": [] },
    "secrets": { "count": 0, "findings": [] },
    "exposureHints": { "count": 0, "hints": [] },
    "sourceMaps": { "count": 0, "urls": [] },
    "thirdPartyScripts": [],
    "forms": { "totalForms": 0, "postFormsWithoutCsrfHint": 0, "sensitiveInputsWithoutAutocompleteOff": 0 },
    "findings": [],
    "highSeverityCount": 2,
    "badgeEligible": false
  },
  "findings": []
}
```

If no Chromium binary is available, returns `503 Service Unavailable`:
```json
{
  "error": "No Chromium found. Set PLAYWRIGHT_EXECUTABLE_PATH."
}
```

### `POST /api/capture`
Launches headless Chromium to extract page facts (`title`, `description`, `headings`, `ctas`) and capture 3–6 full-width JPEG viewport screenshots across scroll positions.

**Request**
```json
{
  "url": "https://example.com",
  "shots": 5
}
```

**Response (`200 OK`)**
```json
{
  "title": "Example Domain",
  "description": "",
  "headings": ["Example Domain"],
  "ctas": ["Learn more"],
  "shots": [
    { "name": "01-hero.jpg", "dataUrl": "data:image/jpeg;base64,..." }
  ]
}
```

### `POST /api/relay`
HTTPS-only CORS relay for allowlisted AI providers (`RELAY_ALLOWED_HOSTS`, defaulting to `openrouter.ai,integrate.api.nvidia.com`). Requires `CAPTURE_TOKEN` when configured, enforces a 60s timeout, a 2 MB response cap, and `application/json` / `text/event-stream` responses. API keys are forwarded per-request and never stored or logged on the server.

**Request**
```json
{
  "url": "https://openrouter.ai/api/v1/models",
  "method": "GET",
  "apiKey": "sk-or-..."
}
```

**Response (`200 OK`)**
Proxies the upstream JSON status and body directly:
```json
{
  "data": []
}
```

---

## Passive security audit

**All checks in this layer are strictly passive.** TourForge Lite inspects only the public HTML, response headers, `robots.txt`, and single-endpoint TLS metadata already retrieved by `/api/audit`. It never performs port scanning, directory brute-forcing, vulnerability exploitation, or authentication bypasses.

### What is checked
- **Security Headers**: Evaluates `Content-Security-Policy` (flags missing CSP or weak directives like `'unsafe-eval'`, `'unsafe-inline'` without nonce/hash, wildcard `*`, or `http:`), `Strict-Transport-Security` (missing, HTTP-only, short `max-age`, or missing `includeSubDomains`), `X-Content-Type-Options` (`nosniff`), `X-Frame-Options` (`DENY` / `SAMEORIGIN`, or satisfied via CSP `frame-ancestors`), `Referrer-Policy`, and `Permissions-Policy`.
- **TLS State**: Records HTTPS active state, negotiated TLS protocol (`TLSv1.3`, etc.), certificate validity/expiration, and active HSTS status/`max-age`.
- **Active vs. Passive Mixed Content**: On HTTPS pages, flags `http://` scripts, stylesheets, iframes, objects/embeds, and form actions as high-severity active mixed content (`fail`), and `http://` media (`img`, `video`, `audio`, `source`) as medium-severity passive mixed content (`warn`), while ignoring benign XML namespace URIs (`http://www.w3.org/...`, `http://schema.org`).
- **Cookie Flags**: Inspects `Set-Cookie` headers for missing `Secure`, `HttpOnly`, and `SameSite` attributes, plus `SameSite=None` without `Secure`.
- **Secret Redaction**: Scans HTML and inline scripts for exposed credential patterns (private key blocks, AWS `AKIA` keys, GitHub tokens, Stripe secret/restricted keys, Slack tokens, OpenRouter/OpenAI keys, and DB URIs with embedded passwords) and always redacts matched values (`prefix…***`) before storing evidence.
- **`.git` / `.env` / Backup Exposure Hints**: Passively scans fetched HTML, `robots.txt`, and `Server` / `X-Powered-By` headers for directory listings (`Index of /`), links/references to `.git/*`, `.env*`, `*.bak`, or SQL dumps, and verbose server version banners.
- **Source Maps**: Detects public `sourceMappingURL=` comments and `.map` script/stylesheet references shipped to production.
- **Third-Party Scripts & SRI**: Builds an inventory of external `<script src>` dependencies, extracts library names and versions where detectable, flags legacy versions (e.g., jQuery `< 3.5`, Bootstrap `< 4`, AngularJS `1.x`), and checks Subresource Integrity (`integrity="..."`).
- **Form Autocomplete & CSRF Hints**: Flags password or sensitive payment/secret inputs lacking explicit safe `autocomplete` attributes (`off`, `new-password`, `current-password`, `one-time-code`) and `POST` forms without a visible anti-CSRF hidden token field.

### Scorecard Weighting & Rules
- `Passive Security & Headers` (`security`) contributes **10%** of the weighted overall scorecard (`gbp` 25%, `seo` 20%, `contact` 20%, `speed` 15%, `social` 10%, `security` 10%).
- Reuses TourForge Lite's global data-completeness rules: if `<50%` of security checks are measurable (e.g., headers unavailable or site behind a bot challenge), `securityScore` is marked **Insufficient data** and excluded via weight renormalization; overall score remains **Provisional** whenever total measured completeness is `<70%`.

### Audit JSON & CLI `report.md` Fields
- **Audit JSON (`/api/audit` & exported bundles)**: Adds `audit.security` (`PassiveSecurityAudit`), `category: "security"` findings with optional `severity` (`high | medium | low | info`) in `audit.findings`, and `scorecard.securityScore` (`CategoryScore`).
- **CLI `report.md` (`npm run audit:cli`)**: Appends a **`## Passive Security & Headers Audit`** summary and header status table, maps failing/warning security checks into **`## Required Changes in GitHub Repository`**, and writes ready-to-commit snippets into `generated/security-headers/{vercel.json,next.config.js,_headers,nginx.conf}` (plus `generated/security-badge.{html,svg}` when eligible).

### Embeddable `"Security Passed"` Badge
When `headersChecked === true` and `highSeverityCount === 0` (`audit.security.badgeEligible === true`), the **Scorecard** tab displays a live `"Security Passed"` SVG badge inside the **Passive Security & Headers** panel. Click **Copy embed HTML** to copy a self-contained `<a><svg>…</svg></a>` snippet the site owner can paste directly into their site footer or trust page.

---

## Container hardening

1. **Generate a strong bearer token** (`NODE_ENV=production` refuses to start if `CAPTURE_TOKEN` is shorter than 32 characters):
   ```bash
   export CAPTURE_TOKEN=$(openssl rand -hex 32)
   ```
2. **Run Docker with dropped capabilities, no privilege escalation, and memory/PID caps**:
   ```bash
   docker run --rm -p 3000:3000 \
     --cap-drop ALL \
     --security-opt no-new-privileges \
     --memory 1500m \
     --pids-limit 300 \
     -e NODE_ENV=production \
     -e PORT=3000 \
     -e CAPTURE_TOKEN="$CAPTURE_TOKEN" \
     tourforge-lite
   ```
3. **Egress firewall rules (IPv4 and IPv6)**: Block all outbound container/host traffic to private, reserved, transition, and link-local ranges before packets leave the runtime (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, and IPv6 `::1/128`, `::/128`, `::ffff:0:0/96`, `64:ff9b::/96`, `2002::/16`, `2001::/32`, `2001:db8::/32`, `fc00::/7`, `fe80::/10`, `ff00::/8`).
   - Application-layer DNS lookup (`validatePublicTargetUrl`) validates resolved IPs before requests, while host/network egress rules block `TTL=0` DNS rebinding and any Chromium subrequests at the kernel level.
4. **Reverse proxy timeouts & trust**: Set upstream read/send timeouts to `>= 180s` (above `/api/audit`'s 150s hard deadline so partial results return cleanly instead of proxy `504`). Keep `TRUST_PROXY=false` unless behind a single trusted reverse proxy that strips/sets `X-Forwarded-For`.
5. **Custom AI endpoints**: Set `RELAY_ALLOWED_HOSTS` (comma-separated) if using custom OpenAI-compatible hosts beyond `openrouter.ai,integrate.api.nvidia.com`.

---

## Bounded Auto-Fix & Preview Re-Audit

TourForge Lite can apply **only** deterministic allowlisted fixes it already generates (`vercel.json`, `next.config.js`, `_headers`, `nginx.conf`, `public/robots.txt`, `public/llms.txt`, `public/schema.jsonld`, `generated/security-badge.html`, and explicit `TOURFORGE:*` metadata placeholders in `index.html` / `app/layout.tsx`). It never edits `.env*`, secrets, lockfiles, or application source code, never deletes files, and never pushes to `main`. Unknown or ambiguous findings remain as GitHub Issues.

```bash
# 1. Dry-run by default: shallow-clones repo, generates ApplyPlan + diff without pushing
npm run fix:repo -- --repo owner/client-repo --audit ./audits/client/tourforge-bundle.json --dry-run

# 2. Apply explicitly: runs repo lint/build (aborts with no push on failure), pushes fix/tourforge-<date>, opens a Draft PR via gh
npm run fix:repo -- --repo owner/client-repo --audit ./audits/client/tourforge-bundle.json --apply

# 3. Verify against the PR preview deployment and post "before X -> after Y" category deltas to the PR
npm run verify:fix -- --url https://preview-url.example --bundle ./audits/client/tourforge-bundle.json --pr 42 --repo owner/client-repo
```

---

## Handoff to Agents

The entire audit, scoring, NAP matching, bounded fix planning, and JSON-LD generation layer in `src/audit/*` and `src/fix/*` is **pure, portable TypeScript** with **zero DOM/browser, React, or AI SDK dependencies**:

- `src/audit/types.ts` — Canonical Zod schemas and TypeScript contracts (`AuditResult`, `AuditFinding`, `SecurityFinding`, `PassiveSecurityAudit`, `ManualFootprint`, `AuditAssumptions`, `Scorecard`, `ProspectEntry`).
- `src/audit/htmlFindings.ts` — Pure Cheerio HTML extraction, CTA matching, client name derivation, and deterministic automated check evaluation.
- `src/audit/securityFindings.ts` — Pure passive security header, TLS, mixed-content, cookie, redacted-secret, exposure-hint, source-map, third-party script, form/CSRF, and `"Security Passed"` badge evaluator.
- `src/audit/nap.ts` — Pure business name, phone, and address token normalization plus directory consistency findings.
- `src/audit/scorecard.ts` — Deterministic weighted category scoring (`securityScore` at 10%), `<50%` insufficient-data exclusion, `<70%` provisional flag, Fix First sorting, ignored-leads range math, and outreach summary generator.
- `src/audit/githubReport.ts` — Repo file change mapping, `vercel.json` / `next.config.js` / `_headers` / `nginx.conf` security header snippets, Markdown reports, and bundle export builders.
- `src/fix/plan.ts` — Pure `ApplyPlan` generator, strict path allowlist (`ALLOWLISTED_FIX_PATHS`), non-destructive config mergers, placeholder replacer, and secret redactor.
- `src/audit/jsonLd.ts` — Schema JSON-LD builder and `JSON.parse` validator.
- `src/audit/bundleMigration.ts` — Backward-compatible `v1`/`v2` project JSON import migration.

External worker queues, CLI runners, or agent pipelines can import `src/audit/*` and `src/fix/plan.ts` directly in Node/Bun/edge workers with strict Zod-validated JSON inputs and outputs.
