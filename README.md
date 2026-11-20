# TourForge Lite

TourForge Lite turns a client website URL or uploaded screenshots and a short brief into an **evidence-based visibility audit, one-page RAG scorecard, outcome-first walkthrough player, and editable 2027 digital proposal**.

- **Deterministic Audit Engine**: All HTML, SEO, contact/CTA, NAP consistency, median TTFB, and Lighthouse mobile speed checks run deterministically in TypeScript (`src/audit/*`, Cheerio, and open-source Lighthouse).
- **BYOK AI Generation**: Walkthrough narration and highlight coordinates use a single OpenAI-compatible client (`POST {baseUrl}/chat/completions`) configured via browser `localStorage` (OpenRouter, NVIDIA NIM, or any custom endpoint).

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

## Handoff to Agents

The entire audit, scoring, NAP matching, and JSON-LD generation layer in `src/audit/*` is **pure, portable TypeScript** with **zero DOM/browser, React, or AI SDK dependencies**:

- `src/audit/types.ts` — Canonical Zod schemas and TypeScript contracts (`AuditResult`, `AuditFinding`, `ManualFootprint`, `AuditAssumptions`, `Scorecard`, `ProspectEntry`).
- `src/audit/htmlFindings.ts` — Pure Cheerio HTML extraction, CTA matching, client name derivation, and deterministic automated check evaluation.
- `src/audit/nap.ts` — Pure business name, phone, and address token normalization plus directory consistency findings.
- `src/audit/scorecard.ts` — Deterministic weighted category scoring, `<50%` insufficient-data exclusion, `<70%` provisional flag, Fix First sorting, ignored-leads range math, and outreach summary generator.
- `src/audit/jsonLd.ts` — Schema JSON-LD builder and `JSON.parse` validator.
- `src/audit/bundleMigration.ts` — Backward-compatible `v1`/`v2` project JSON import migration.

External worker queues, CLI runners, or agent pipelines can import `src/audit/*` directly in Node/Bun/edge workers with strict Zod-validated JSON inputs and outputs.
