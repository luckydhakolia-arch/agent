# Eggoz SEO / AEO Engine

An always-on search and answer-engine monitor for eggoz.in and the Eggoz brand. Runs on GitHub Actions cron, commits its findings back to this repo as JSON, and renders them in a single-file dashboard.

No server. No hosting bill. Runs whether your laptop is on or not.

> **Where this lives.** The engine is the `eggoz-seo-aeo/` subdirectory of a shared repo. The two GitHub Actions workflows sit at the repo root (`.github/workflows/daily.yml`, `weekly.yml`) because Actions only runs workflows from there — each pins `working-directory: eggoz-seo-aeo`, so every `npm` and `git add data/` command runs inside this folder. Run any local command (`npm ci`, `npm run daily`, `npx serve .`) from inside `eggoz-seo-aeo/`. Because Actions only exposes `workflow_dispatch` and cron from the repo's **default branch**, the workflows become triggerable once this branch is merged there.

---

## What it does

**Daily, 07:00 IST** — pulls Google Search Console (28-day window against the previous 28 days), runs Lighthouse on priority pages, crawls the sitemap for technical and extractability issues, and fires alerts on threshold breaches.

**Weekly, Monday 07:30 IST** — fires a fixed panel of 45 buyer questions at Perplexity and Gemini, records whether Eggoz was mentioned and which domains got cited, checks Reddit for category threads, analyses schema gaps, generates `llms.txt`, and writes content briefs and full drafts for the highest-value gaps. Every draft passes an ASCI Addendum II check before it lands.

The single most useful output is the **citation gap** — domains that answer engines cite for egg questions in India that never mention Eggoz. That is an outreach list, not a metric. Getting cited by LLMs is earned media; you cannot schema your way in.

---

## Setup

### 1. Repo

The engine is already committed inside this repo (`eggoz-seo-aeo/`), with its workflows at the repo root. Keep the repo **private** — the data it commits back is competitive intelligence.

Two things must be true before a run can commit its results:

- **Settings → Actions → General → Workflow permissions** → select *Read and write permissions*. Without this the cron job cannot push its JSON back.
- The workflows must exist on the repo's **default branch** for the Actions tab to show *Run workflow* and for cron to fire. If this is still on a feature branch, merge it to the default branch first.

### 2. Google Search Console access

This is the fiddliest step and the one worth doing properly, because GSC is free and gives real data.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Google Search Console API** and **PageSpeed Insights API**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Name it `seo-engine`. Skip the optional role steps.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A file downloads. This is your `GSC_SERVICE_ACCOUNT_JSON`.
5. Copy the service account email — it looks like `seo-engine@your-project.iam.gserviceaccount.com`.
6. In [Search Console](https://search.google.com/search-console) → Settings → **Users and permissions → Add user** → paste that email, permission **Full**.
7. **Credentials → Create credentials → API key**. That is your `PAGESPEED_API_KEY`.

Check `config/site.json`: `gscProperty` must exactly match how the property is registered. Domain properties are `sc-domain:eggoz.in`. URL-prefix properties are `https://eggoz.in/`.

### 3. Secrets

**Settings → Secrets and variables → Actions → New repository secret**, one at a time:

| Secret | Required | Where from |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON` | yes | the whole JSON file contents, pasted in |
| `PAGESPEED_API_KEY` | yes | Google Cloud API key |
| `ANTHROPIC_API_KEY` | yes | console.anthropic.com |
| `GEMINI_API_KEY` | yes | aistudio.google.com — free tier |
| `PERPLEXITY_API_KEY` | optional | perplexity.ai/settings/api |
| `ALERT_WEBHOOK` | optional | Slack or Google Chat incoming webhook |

### 4. First run

Actions tab → **SEO daily** → *Run workflow*. It takes 5–15 minutes. Then run **AEO weekly** the same way — that one takes 30–90 minutes because it makes ~90 answer-engine calls plus generation.

### 5. Dashboard

```bash
npx serve .
```

Then open `http://localhost:3000/dashboard/`. Opening `index.html` directly with `file://` will not work — browsers block local JSON reads — but the dashboard offers a file picker as a fallback so you can drop `data/latest.json` in by hand.

---

## What it costs

| Service | Usage | Monthly |
|---|---|---|
| GitHub Actions | ~250 min | free (2,000 min included) |
| Search Console API | daily | free |
| PageSpeed Insights | ~120 calls | free (25k/day) |
| Gemini | ~180 calls | free tier |
| Reddit | ~24 calls | free |
| Perplexity Sonar | ~180 calls | ~₹350 |
| Anthropic (Haiku extraction) | ~200 calls | ~₹250 |
| Anthropic (Sonnet briefs + drafts) | ~64 calls | ~₹700 |

**Roughly ₹1,300/month.** Set a spend cap in the Anthropic console so a runaway loop cannot surprise you.

To cut it further: drop Perplexity and run Gemini alone, or set `withDrafts: false` in `run-weekly.mjs` to generate briefs without full drafts, which is about 70% of the cost.

---

## Tuning

- **`config/site.json`** — domain, competitors, priority pages, alert thresholds.
- **`config/queries.json`** — the AEO prompt panel. **Add prompts, avoid editing existing ones.** Changing a prompt breaks trend comparability with every previous week.
- **`config/keywords.json`** — buckets used to categorise GSC queries and seed briefs.

Cron times are UTC in the workflow files. `30 1 * * *` is 07:00 IST.

---

## What this does not do

**Competitor rankings.** Tracking where Licious ranks on Google needs a SERP API (SerpAPI, DataForSEO) at roughly ₹4,000/month minimum. Outside the budget. What you get instead is competitor visibility *inside answer engines*, via `shareOfVoice`, which is arguably the more useful half now.

**Google AI Overviews directly.** No API exposes them. Gemini with search grounding is the closest free proxy and correlates reasonably, but it is a proxy.

**Instagram.** The social module belongs inside the existing Social Command Center rather than here, and needs the Meta Business Verification you already scoped. Add it as a collector in `scripts/lib/` when that access lands.

**Publishing.** Drafts land in `data/drafts/` as Markdown. Nothing auto-publishes. A generation engine that can publish without a human reading the output is a liability, especially with ASCI in play.

---

## Structure

```
.github/workflows/     daily.yml, weekly.yml — the cron
config/                site, keywords, AEO prompt panel
scripts/
  lib/                 collectors: gsc, psi, crawl, aeo, reddit + store, claude, alert
  analysers/           asci (compliance gate), briefs (generation), schema (JSON-LD, llms.txt)
  run-daily.mjs        orchestrator
  run-weekly.mjs       orchestrator
data/                  committed output — latest.json, history.json, daily/, weekly/, drafts/
dashboard/index.html   single-file dashboard
```

Collectors fail independently. If Search Console errors, the crawl still runs and the report still commits with an error recorded against that section.
