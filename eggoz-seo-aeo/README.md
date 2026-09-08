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

## Google-free mode

Search Console is the one input you cannot self-serve: the service account has to
be added to the property by a **verified owner**, and if you are only a Full user
you cannot grant it yourself. Rather than leave the engine dead until someone else
acts, there is a third run that uses **no Google credential of any kind** — no
service account, no PageSpeed key, no Gemini key.

```bash
npm run free
```

It replaces the two Google collectors with credential-free equivalents:

| Google collector | Replaced by | What you lose |
|---|---|---|
| Search Console (`seo`) | **Coverage discovery** — tracked keyword buckets matched against your own crawl, plus long pages with no question-shaped headings. Or connect the real thing with **OAuth as yourself** (below). | Real demand, unless you connect it. Coverage tells you what you have *no content for*; it cannot tell you what people search for or where you rank. |
| PageSpeed / Lighthouse (`psi`) | **HTTP performance probe** — server response time, transferred page weight, render-blocking scripts, images missing dimensions | LCP, CLS and INP. Those need a real browser; the probe never invents a 0-100 score. |
| Gemini (answer engine) | **Claude** with web search, and Perplexity if you have it | One engine's perspective. The 45-prompt panel is unchanged, so trends stay comparable. |

It degrades rather than fails, so it is useful before you hold any key at all:

| You have | You get |
|---|---|
| **no keys** | sitemap crawl, performance probe, coverage + extractability gaps, schema gaps, paste-ready JSON-LD, `llms.txt` |
| `ANTHROPIC_API_KEY` | the above, plus the answer-engine panel, share-of-voice, citation gap, and briefs + drafts behind the ASCI gate |
| `PERPLEXITY_API_KEY` | a second, citation-bearing answer engine |

Both keys come from **your own accounts** (console.anthropic.com, perplexity.ai) —
no organisation ownership required. Sections that cannot run are reported as
`skipped` with the reason, and raise a *low* notice rather than a false alarm; a
run with no engine keys reports "not measured", never "0% mention rate".

The cron lives at `.github/workflows/free.yml` and needs no Google secret. Run it
instead of `SEO daily` while Search Console access is pending, and switch back
(or run both) once an owner grants the service account.

### Search Console without a service account

Search Console data only exists inside Google — nothing free replaces it. What
you *can* drop is the dependency on **other people**. The service-account path
needs a **verified owner** to add the robot as a user. If you are a Full or
Restricted user you cannot do that yourself — but you can already *read* the
Performance data, and that is all the engine needs.

So authorise as yourself instead:

```bash
npm run auth:gsc
```

It walks you through creating an OAuth client **in your own Google Cloud
project** (free, and needs no access to anyone else's project), opens the
consent screen, and prints three values to paste into GitHub secrets:

| Secret | |
|---|---|
| `GSC_OAUTH_CLIENT_ID` | from your OAuth client |
| `GSC_OAUTH_CLIENT_SECRET` | from your OAuth client |
| `GSC_OAUTH_REFRESH_TOKEN` | printed once by `auth:gsc` — treat it like a password |

What this removes: no service account, no verified-owner grant, no admin on
someone else's Cloud project, no `gscProperty` to get right — the run calls
`sites.list` and **auto-selects the property** your account can actually read,
preferring domain properties and resolving a `.com`/`.in` mix-up on its own. The
chosen property and permission level are printed each run and stored on the
report as `seo.property` / `seo.auth`.

Both auth paths share one analyser (`lib/gsc-analyse.mjs`), so a service-account
run and an OAuth run produce identical reports. Coverage discovery keeps running
alongside either: one tells you what you rank for, the other what you have no
content for.

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
                       credential-free: perf (no PageSpeed key), discover (no Search Console)
                       gsc-oauth (Search Console as yourself) + gsc-analyse (shared)
  analysers/           asci (compliance gate), briefs (generation), schema (JSON-LD, llms.txt)
  run-daily.mjs        orchestrator
  run-weekly.mjs       orchestrator
  run-free.mjs         orchestrator — Google-free, runs with zero secrets
  auth-gsc.mjs         one-time local OAuth helper (npm run auth:gsc)
data/                  committed output — latest.json, history.json, daily/, weekly/, drafts/
dashboard/index.html   single-file dashboard
```

Collectors fail independently. If Search Console errors, the crawl still runs and the report still commits with an error recorded against that section.
