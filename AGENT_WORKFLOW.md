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

## 2. MCP Setup for OpenCode & Hermes Agent

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

### Exposed MCP Tools

| Tool | Purpose |
| --- | --- |
| `tourforge_audit_url` | Runs `/api/audit` (or local `enqueueAudit`), computes deterministic `Scorecard`, `AiReadinessSummary`, and `RepoFileChangeAction[]`. |
| `tourforge_capture_site` | Captures 3–6 desktop screenshots and visible DOM facts via `/api/capture`. |
| `tourforge_generate_repo_fixes` | Produces ready-to-commit `public/robots.txt`, `public/llms.txt`, `<script type="application/ld+json">`, and a GitHub Issue checklist. |
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
- `report.md` — Full deterministic Scorecard, category scores, AI readiness metrics, and mapped repo changes (`[P0]` / `[P1]` / `[P2]`).
- `github-issue.md` — Ready-to-post GitHub Issue / PR comment body with file paths and checkboxes.
- `tourforge-bundle.json` — Valid `FullProjectBundle` JSON importable directly into the TourForge Lite UI (**Step 1 → Import JSON**).
- `generated/robots.txt`, `generated/llms.txt`, `generated/schema.jsonld` — Ready-to-commit snippets for a draft PR.

Add `--ai` (with `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, or `OLLAMA_URL`) to also append an agent-written **Executive Narrative** verified by numeric grounding.

---

## 4. Recommended GitHub Source-of-Truth Loop

1. **Pull `main`** of the website's GitHub repository.
2. **Audit live/staging URL** via `tourforge_audit_url` (or `npm run audit:cli`).
3. **Inspect mapped file targets** (`public/robots.txt`, `public/llms.txt`, `index.html` / `app/layout.tsx`, Hero `<img>`, header CTA components) against actual files in the checked-out repo.
4. **Publish for team visibility**:
   - Open/update a GitHub Issue using `github-issue.md` (`gh issue create --body-file github-issue.md`), **or**
   - Commit `generated/*` patches into a Draft PR + attach `tourforge-bundle.json` so non-technical teammates can open it inside TourForge Lite to view the Scorecard and print the PDF Proposal.
5. **Automate weekly regression checks** using `.github/workflows/site-audit.yml`.
