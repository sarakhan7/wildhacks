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

**If `GET /` returns 404 in development** but `npm run build` succeeds, the app routes are fine; the dev server is usually in a bad state. From the **repository root** (where `package.json` and `src/app/` live): stop `next dev`, run `rm -rf .next`, then `npm run dev` again. If you see many **`EMFILE: too many open files`** lines, raise the file limit (e.g. `ulimit -n 10240`) in that terminal. As a fallback, use **`npm run dev:webpack`** (webpack dev server instead of Turbopack). Confirm nothing else is bound to port **3000** serving a different app.

Check the API with [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health).

Production-style API without reload:

```bash
npm run backend:start
```

## Project layout

- `src/` – Next.js frontend and API routes
- `backend/` – FastAPI application (`backend.app.main:app`)

### ElevenLabs “Audit manager” on `/report`

The report page embeds the [ElevenLabs Convai widget](https://elevenlabs.io/docs/agents-platform/customization/widget) via **`@elevenlabs/convai-widget-embed`**. On `/report`, the assistant sits in **`report-assistant-below-download`** under **Download PDF**. The embed uses **`variant="full"`** and CSS in **`globals.css`** so `<elevenlabs-convai>` is **anchored** in **`.audit-manager-convai-anchor`** (absolute fill, min-height) instead of only floating at the viewport corner. **`placement`** is still set with **`setAttribute`**. Optional env (default **`bottom-left`**):

```bash
NEXT_PUBLIC_ELEVENLABS_WIDGET_PLACEMENT=bottom-left
```

Allowed values: `top-left`, `top`, `top-right`, `bottom-left`, `bottom`, `bottom-right`. If the corner does not change, check the agent **Widget** tab in the ElevenLabs dashboard (UI can override embed defaults).

```bash
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your_agent_id
```

#### Default: `dynamic-variables` (no Security override)

**Do not** set `NEXT_PUBLIC_ELEVENLABS_USE_OVERRIDE_PROMPT` (or set it to anything other than `true`). The app sends JSON on the **`dynamic-variables`** attribute with `report_part_1` … `report_part_6` and `building_address` (see `ELEVENLABS_DYNAMIC_VARIABLE_KEYS` in `src/lib/elevenlabs-report-chunks.ts`). Your agent **system prompt** in the dashboard must include the matching placeholders: `{{report_part_1}}` … `{{report_part_6}}` and `{{building_address}}` (case-sensitive). If those lines are missing, the model will not see the report even though **Client data** lists the variables.

Minimal tail to paste after your instructions:

```text
Building (may be empty):
{{building_address}}

--- Report part 1 ---
{{report_part_1}}
--- Report part 2 ---
{{report_part_2}}
--- Report part 3 ---
{{report_part_3}}
--- Report part 4 ---
{{report_part_4}}
--- Report part 5 ---
{{report_part_5}}
--- Report part 6 ---
{{report_part_6}}
```

#### Optional: `override-prompt` (full prompt from the app)

Set:

```bash
NEXT_PUBLIC_ELEVENLABS_USE_OVERRIDE_PROMPT=true
```

The app builds instructions + report in **`src/lib/elevenlabs-override-prompt.ts`** and sends **`override-prompt`** on `<elevenlabs-convai>` ([Overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides)). You do **not** need `{{report_part_*}}` in the dashboard for this mode.

**Required on the agent:** **Security** tab → enable **System prompt** overrides. If overrides are disabled, ElevenLabs returns an error such as **`Override for field 'prompt' is not allowed by config`** — either enable that toggle or remove `NEXT_PUBLIC_ELEVENLABS_USE_OVERRIDE_PROMPT` and use the default `dynamic-variables` mode instead.

Allowlist your site domain under **Security** if the widget requires it.

In **`NODE_ENV=development`**, the console logs which mode is active and a payload summary.

If **`reportMarkdown`** is empty, the assistant receives placeholders only. Large reports are truncated for the widget payload (`dynamic-variables`) or for **`ELEVENLABS_MAX_OVERRIDE_PROMPT_CHARS`** (~1.8M) in override mode.

**Limits:** ElevenLabs documents about **2MB** for the combined system prompt; the **LLM** you pick has its own context window and pricing. See [Models / LLM](https://elevenlabs.io/docs/agents-platform/customization/llm).

## Fork and stay in sync with upstream

If you deploy from your own fork (for example DigitalOcean only sees your repos), keep **`sarakhan7/wildhacks`** as the canonical upstream.

1. Fork the repo on GitHub to your account.
2. Point your local clone at the fork and add upstream. The fork repo name can differ from upstream (example: `wildhacks26`):

   ```bash
   git remote set-url origin git@github.com:Krrithen/wildhacks26.git
   git remote add upstream https://github.com/sarakhan7/wildhacks.git
   ```

   If `upstream` already exists, use `git remote set-url upstream https://github.com/sarakhan7/wildhacks.git` instead of `add`.

3. **Manual Sync**: If you want to pull the latest changes from upstream:
   ```bash
   git fetch upstream
   git merge upstream/main
   ```
   Resolve any conflicts, then `git push origin main`.

## Learn more

- [Next.js documentation](https://nextjs.org/docs)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
