# GMERICA Market Dashboard — Project Reference

## Overview
Pre-market trading dashboard based on Joseph Granville's 1960 timing system.
React + Vite + Tailwind v4, deployed on Vercel. This is a fork of
`jusjit/granville-market-dashboard` (the owner is a friend who blessed the fork);
all of the original author's private infrastructure (Supabase, Alma email
pipeline, geo-regime aggregator, password gate) has been **removed** — do not
look for it.

- **Live site**: https://gmerica-market-dashboard.vercel.app/
- **Repo**: https://github.com/JimmyERICA/gmerica-market-dashboard (public, `main` auto-deploys to Vercel)
- **Owner**: GitHub user JimmyERICA — a beginner; explain steps plainly, and when
  they must copy/paste a value, spell out exactly what it starts/ends with
  (they once pasted whole `KEY=value` lines into GitHub secret fields).
- Commits use the noreply email `302634369+JimmyERICA@users.noreply.github.com`
  (set in repo-local git config; do not switch back to a personal email).

## Tech Stack
- React 19, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), Recharts, Lucide React
- Vercel serverless functions in `api/` (Node), GitHub Actions for the daily AI synthesis
- No database. No Supabase. The only persisted artifact is `public/synthesis.json`.

## Local Dev
Two processes:

```
npm run dev:api        # api/* handlers on port 3001 (reads .env)
npm run dev            # Vite on port 5173, proxies /api/* to 3001
```

Do NOT use `vercel dev` (broken on Windows with Vite).
`local-api-server.mjs` loads `.env` and maps `VITE_*` keys to plain names.

## Environment Variables

### `.env` (local, gitignored — never commit)
- `VITE_FINNHUB_KEY` — Finnhub free tier (ETF quotes)
- `VITE_FRED_KEY` — FRED API (macro series)
- `GEMINI_KEY` — Google Gemini free tier, new `AQ.`-prefix key format (daily synthesis)
- `TRADIER_KEY` — NOT set. Optional future upgrade (see Vol section).

### GitHub repo secrets (Settings → Secrets → Actions)
`FINNHUB_KEY`, `FRED_KEY`, `GEMINI_KEY` — used only by the daily-synthesis workflow.

### Vercel project env vars
`FINNHUB_KEY`, `FRED_KEY` — used by the serverless functions. Gemini is NOT
needed on Vercel (synthesis is pre-generated, see below).

## Daily AI Synthesis (replaces the original's 1min.ai/Supabase design)
- `scripts/generate-synthesis.mjs` recomputes the Granville + macro signals
  server-side (it patches `globalThis.fetch` to route the client libs'
  relative `/api/*` calls to the handlers in-process), builds the prompt,
  calls Gemini (`gemini-flash-latest` via `generativelanguage.googleapis.com`,
  header `x-goog-api-key`), and writes `public/synthesis.json`.
- `.github/workflows/daily-synthesis.yml` runs it weekdays 13:15 UTC
  (9:15am ET in summer; ⚠ 8:15am EST after the November DST change — shift the
  cron to 14:15 UTC in winter if the timing matters) and commits the JSON with
  the github-actions bot. That commit auto-triggers a Vercel redeploy.
- The frontend (`src/lib/synthesis.js`) just fetches `/synthesis.json` — no AI
  call ever happens on page load. `SynthesisPanel` shows the generatedAt time.
- Local manual run: `npm run generate:synthesis`.

## API Routes (`api/*.js` — Vercel serverless)
- `api/finnhub.js` — GET `?symbols=RSP,SPY,...` → `[{symbol, price, prevClose, pctChange}]`. Finnhub free tier: ETFs only, no CBOE indices.
- `api/fred.js` — GET `?series=BAMLH0A0HYM2,...` → FRED observations (CORS-blocked from browsers, hence the proxy).
- `api/vol.js` — vol complex. **Two modes**: with `TRADIER_KEY` it uses Tradier
  (real-time CBOE indices + TLT ATM IV); without it (current state) it falls
  back to Yahoo Finance's public chart endpoint
  (`query1.finance.yahoo.com/v8/finance/chart/^VIX?interval=1d&range=1mo`,
  needs a browser User-Agent, `range=1mo` because short ranges return only one
  close for some indices). Yahoo mode returns `tltIV: null` (options data not
  freely available), so the Bond Vol tile shows "unavailable" — that is
  expected, not a bug.
- `api/tradier.js` — SPX options vol surface. Requires `TRADIER_KEY`; the Vol
  Surface panel intentionally shows "unavailable" without it. Owner declined
  Tradier signup (asks for SSN). If a key ever appears, everything upgrades
  with no code changes.

## Dashboard Sections (top to bottom)
1. AI Synthesis (static `synthesis.json`, Gemini, daily)
2. Granville Composite gauge (0–100) + divergence warning
3. 7 Granville signal cards + Signal Log
4. Macro Conditions (vol/dollar/risk tiles + FRED rates & credit)
5. Vol Surface (Tradier-only, currently "unavailable")

## Granville Scoring (src/lib/signals.js)
- 7 signals; ratio vs prior close, ±0.5% neutral band (transport ±0.3%);
  Bull=20 / Neutral=10 / Bear=0; breadth (RSP/SPY) double-weighted (40/20/0).
- `MAX_RAW = 160`; composite = round(raw/160×100).
- Volatility signal is absolute VIX level: ≤17 bull, ≥25 bear.
- Divergence rule: SPY up while RSP/SPY down → composite capped at 60.
- Phases: ≥67 Bull 1/2/3, ≤33 Bear 1/2/3 (by delta), else Transitional.
- NOTE: `src/lib/*.js` imports use explicit `.js` extensions so plain Node
  (the synthesis script) can import them — keep it that way.

## Known Gotchas
- Finnhub free tier: no `^VIX`/CBOE indices, no MOVE. ETF proxies only.
- FRED cannot be called from the browser (CORS) — always via `/api/fred`.
- Yahoo chart endpoint is unofficial: stable for years but could break; the
  VIX tiles/signal then degrade to "unavailable" until the source is swapped.
- Node.js LTS was installed via winget on this machine (2026-07-11); shells
  started before an installation may need PATH refreshed
  (`[System.Environment]::GetEnvironmentVariable("PATH","Machine")`).

## History note
Original upstream: https://github.com/jusjit/granville-market-dashboard
(no git remote to it anymore; `origin` = the GMERICA repo). Early commits in
history mention Alma/Supabase/geo-regime — all deleted on 2026-07-11.
