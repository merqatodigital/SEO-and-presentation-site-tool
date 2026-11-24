# TourForge Lite — Agent & GitHub Source-of-Truth Workflow

Connect **OpenCode**, **Hermes Agent**, or CI pipelines directly to TourForge Lite so agents can scan live websites deterministically, map every failure back to concrete files in your GitHub repository, and publish audit bundles that teammates can view in the TourForge web UI.

---

## 1. Shared Internal Server Setup

Run TourForge Lite once on an internal VM/container (Docker or Node 22) so all agents and team members share the same Chromium + audit worker:

```bash
docker build -t tourforge-lite .
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e CAPTURE_TOKEN="$(openssl rand -hex 32)" \
  -e OLLAMA_URL="http://127.0.0.1:11434" \
  tourforge-lite
```

Verify health:

```bash
curl -s http://127.0.0.1:3000/api/health
```

---

## 2. MCP Setup for OpenCode, Hermes Agent & Maus

TourForge Lite includes a zero-dependency **MCP (Model Context Protocol)** server over stdio (`npm run mcp`). It works either **in-process** (using local Chromium) or **against your shared server** when `TOURFORGE_SERVER_URL` is set.

### Example `opencode.json` (project root or `~/.config/opencode/opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tourforge": {
      "type": "local",
      "command": ["npx", "tsx", "/ABS/PATH/TO/tourforge-lite/scripts/mcp-server.ts"],
      "enabled": true,
      "environment": {
        "TOURFORGE_SERVER_URL": "https://your-internal-tourforge-host",
        "CAPTURE_TOKEN": "YOUR_CAPTURE_TOKEN"
      }
    }
  }
}
```

### Example Hermes Agent MCP entry

```yaml
mcp_servers:
  tourforge:
    command: npx
    args:
      - tsx
      - /ABS/PATH/TO/tourforge-lite/scripts/mcp-server.ts
    env:
      TOURFORGE_SERVER_URL: https://your-internal-tourforge-host
      CAPTURE_TOKEN: YOUR_CAPTURE_TOKEN
```

### Example Maus custom-MCP config

```json
{
  "mcpServers": {
    "tourforge": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/TO/tourforge-lite/scripts/mcp-server.ts"],
      "env": {
        "TOURFORGE_SERVER_URL": "https://your-internal-tourforge-host",
        "CAPTURE_TOKEN": "YOUR_CAPTURE_TOKEN"
      }
    }
  }
}
```

### Exposed MCP Tools

| Tool | Purpose |
| --- | --- |
| `tourforge_audit_url` | Runs `/api/audit` (or local `enqueueAudit`), computes deterministic `Scorecard` (including `scorecard.securityScore`), `AiReadinessSummary`, `security` (`PassiveSecurityAudit` with TLS, headers, mixed content, cookies, redacted secrets, source maps, third-party scripts, form/CSRF hints), `securityBadge` (`{ eligible, htmlSnippet, svg }`), and `RepoFileChangeAction[]`. |
| `tourforge_capture_site` | Captures 3–6 desktop screenshots and visible DOM facts via `/api/capture`. |
| `tourforge_generate_repo_fixes` | Produces ready-to-commit `public/robots.txt`, `public/llms.txt`, `<script type="application/ld+json">`, security header configs (`vercel.json`, `next.config.js`, `_headers`, `nginx.conf`), `security-badge.html` (when `badgeEligible` is true), and a GitHub Issue checklist. |
| `tourforge_apply_repo_fixes` | Builds a bounded `ApplyPlan` (`dryRun: true` by default) for allowlisted static/config/metadata fixes and opens a Draft PR on a `fix/*` branch only when explicitly invoked with `dryRun: false`. Never runs automatically from `tourforge_audit_url`. |
| `tourforge_export_bundle` | Outputs a complete `tourforge-bundle.json` file that any teammate can import via **Import JSON** in the TourForge Lite UI. |

---

## 3. Headless CLI (For Terminal Agents & Scripts)

Agents can also run a single command to generate every file in one pass:

```bash
npm run audit:cli -- \
  --url https://client-website.com \
  --client "Client Name" \
  --type "Boutique Resort" \
  --repo owner/client-website-repo \
  --server http://127.0.0.1:3000 \
  --token "$CAPTURE_TOKEN" \
  --out ./audits/client-slug
```

Outputs created in `./audits/client-slug/`:
- `report.md` — Full deterministic Scorecard, category scores (including `Passive Security & Headers` at 10% weight), AI readiness metrics, `## Passive Security & Headers Audit` table, and mapped repo changes (`[P0]` / `[P1]` / `[P2]`).
- `github-issue.md` — Ready-to-post GitHub Issue / PR comment body with passive security score, file paths, and checkboxes.
- `tourforge-bundle.json` — Valid `FullProjectBundle` JSON importable directly into the TourForge Lite UI (**Step 1 → Import JSON**).
- `generated/robots.txt`, `generated/llms.txt`, `generated/schema.jsonld` — Ready-to-commit SEO/AI snippets for a draft PR.
- `generated/security-headers/{vercel.json,next.config.js,_headers,nginx.conf}` — Ready-to-commit HTTP security header configs tailored to missing/weak headers.
- `generated/security-badge.html` & `generated/security-badge.svg` — Embeddable `"Security Passed"` trust badge emitted automatically when `badgeEligible === true` (headers checked and zero high-severity passive findings).

Add `--ai` (with `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, or `OLLAMA_URL`) to also append an agent-written **Executive Narrative** verified by numeric grounding.

### Bounded Repo Auto-Fix & Preview Verification CLIs

Apply only allowlisted deterministic fixes (`vercel.json`, `next.config.js`, `_headers`, `nginx.conf`, `public/robots.txt`, `public/llms.txt`, `public/schema.jsonld`, `generated/security-badge.html`, and `TOURFORGE` placeholders in `index.html` / `app/layout.tsx`). Default mode is `--dry-run`; pass `--apply` to push a `fix/tourforge-*` branch and open a Draft PR via `gh`:

```bash
# 1. Inspect plan + diff locally (no push, no PR)
npm run fix:repo -- --repo owner/client-website-repo --audit ./audits/client-slug/tourforge-bundle.json

# 2. Apply safe fixes on fix/tourforge-YYYY-MM-DD, run repo lint/build, push branch, and open Draft PR
npm run fix:repo -- --repo owner/client-website-repo --audit ./audits/client-slug/tourforge-bundle.json --apply

# 3. Re-audit the deployed preview URL and post a "before X -> after Y" proof comment to the PR
npm run verify:fix -- --url https://preview-pr-12.client-website.com --bundle ./audits/client-slug/tourforge-bundle.json --pr 12 --repo owner/client-website-repo
```

---

## 4. Recommended GitHub Source-of-Truth Loop

1. **Pull `main`** of the website's GitHub repository.
2. **Audit live/staging URL** via `tourforge_audit_url` (or `npm run audit:cli`).
3. **Preview bounded fixes** (`npm run fix:repo -- --dry-run` or `tourforge_apply_repo_fixes`) to review `ApplyPlan` and unified diffs. Unknown/ambiguous findings remain in `unhandledFindings` as GitHub Issues.
4. **Publish for team visibility**:
   - Open/update a GitHub Issue using `github-issue.md` (`gh issue create --body-file github-issue.md`) for code-level changes, **and/or**
   - Run `npm run fix:repo -- --apply` (or `tourforge_apply_repo_fixes` with `dryRun: false`) to open a Draft PR on `fix/tourforge-*`, then confirm with `npm run verify:fix` against the preview deployment.
5. **Automate weekly regression checks** using `.github/workflows/site-audit.yml`.
