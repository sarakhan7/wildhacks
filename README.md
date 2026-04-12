This is a [Next.js](https://nextjs.org) app with a Python [FastAPI](https://fastapi.tiangolo.com/) backend for building audits and related APIs.

## Prerequisites

- Node.js (see `package.json` engines if added later)
- Python 3.11+ recommended

## Install

From the repository root:

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

Copy or configure `.env` as needed (see `backend/app/config.py` for variables such as `GEMINI_API_KEY`, `NOAA_API_TOKEN`, and Supabase settings).

### `PROD`: live APIs vs fixtures (single switch)

Set **`PROD`** in `.env` for both Next.js and the Python backend (same file is fine).

| `PROD` | Behavior |
|--------|----------|
| **`true`** (default if unset) | Calls **Gemini**, **NOAA** (when `NOAA_API_TOKEN` is set), etc. After each successful response, **fixture files are written and overwrite** any previous file for that call. |
| **`false`** | **No Gemini HTTP** (reads `gemini_recordings/*.json`). **No NOAA HTTP** if `weather_recordings/monthly_features.json` exists; otherwise uses the fast synthetic weather fallback. API keys can stay in `.env`; they are unused on paths that read fixtures. |

**Gemini files** under **`gemini_recordings/`** (each run overwrites that operation’s file):

| File | Source |
|------|--------|
| `ocr.extract.json` | Backend bill OCR |
| `reasoning.diagnose.json` | Backend hypotheses JSON |
| `reasoning.select_recommendations.json` | Backend ECM selection JSON |
| `reasoning.write_report.json` | Backend report markdown |
| `next.extractUtilityData.json` | Next.js bill OCR |
| `next.generateAuditReport.json` | Next.js report markdown |

With **`PROD=false`**, a missing Gemini fixture for a code path that runs raises a clear error until you have recorded it with **`PROD=true`**.

**Weather:** with **`PROD=true`**, resolved monthly rows are saved to **`weather_recordings/monthly_features.json`** (overwritten each audit). With **`PROD=false`**, that file is used if present; if missing, synthetic HDD/CDD is used (no HTTP).

### Gemini I/O logging (optional)

Set `AUDITAI_LOG_GEMINI=true` for truncated console / `auditai.gemini` logs (does not write fixture files).

## Run frontend and backend

Use two terminals, both from the repo root:

**Terminal 1 (API, port 8000):**

```bash
npm run backend:dev
```

**Terminal 2 (Next.js, default port 3000):**

```bash
npm run dev
```

The app proxies to the API using `AUDITAI_BACKEND_URL` when set; otherwise it defaults to `http://127.0.0.1:8000`. Open the URL printed by Next.js (often [http://localhost:3000](http://localhost:3000)).

Check the API with [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health).

Production-style API without reload:

```bash
npm run backend:start
```

## Project layout

- `src/` – Next.js frontend and API routes
- `backend/` – FastAPI application (`backend.app.main:app`)

## Fork and stay in sync with upstream

If you deploy from your own fork (for example DigitalOcean only sees your repos), keep **`sarakhan7/wildhacks`** as the canonical upstream.

1. Fork the repo on GitHub to your account.
2. Point your local clone at the fork and add upstream. The fork repo name can differ from upstream (example: `wildhacks26`):

   ```bash
   git remote set-url origin git@github.com:Krrithen/wildhacks26.git
   git remote add upstream https://github.com/sarakhan7/wildhacks.git
   ```

   If `upstream` already exists, use `git remote set-url upstream https://github.com/sarakhan7/wildhacks.git` instead of `add`.

3. **GitHub Actions** (`.github/workflows/sync-upstream.yml`): merges **`upstream/main`** into **`main`** on your fork, then pushes to **`origin`**. It runs **every hour** (at minute 0 UTC; GitHub may delay runs slightly under load) and on **manual** “Run workflow” from the Actions tab. The job is **skipped** on `sarakhan7/wildhacks` itself so the canonical repo is not affected if this file is merged there.
4. On a fork, GitHub may **disable scheduled workflows** until you enable Actions for the repository (Settings → Actions → General). **Workflow dispatch** still works for a manual sync anytime.
5. If upstream changes conflict with commits only on your fork, the workflow run will fail until you resolve conflicts locally, merge or rebase, and push.

## Learn more

- [Next.js documentation](https://nextjs.org/docs)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
