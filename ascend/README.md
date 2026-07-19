# ASCEND — Phase 1: FOUNDATION

A local-first, single-file training companion for the 8-week Phase 1 program:
dumbbells + bodyweight, 3 rotating sessions/week (A/B/C), 35–45 min each.

**Run it:** open `index.html` in any modern browser. No server, no build step,
no dependencies. All data lives in the browser's `localStorage` (use
Sync → Backup to export/restore).

## What's inside

- **Hard-coded program data** — the authoritative Phase 1 content (sessions,
  weekly progression, warm-up, Boss Fights, coach's notes) lives in the
  `PROGRAM` object, not generated text.
- **Session player** — per-week set/rep/RPE prescription (deload on week 6,
  4/3 set split on weeks 5 & 7), weight/rep logging with last-session
  prefill, warm-up checklist, and an automatic rest timer (90 s compounds,
  45–60 s core/carries). **Reschedule** is deliberately more prominent than
  Skip; reschedule keeps the session next in rotation, skip advances it.
- **Boss Fights** — standalone test sessions at the end of weeks 4 and 8;
  all five metrics charted and compared over time.
- **Daily Quest** — protein 110–130 g, 8,000 steps, 7 h sleep, vitamin D;
  steps and sleep auto-fill from synced health data.
- **Gamification** — XP/levels, quest streak, STR (total tonnage) and END
  (7-day active energy) stats.
- **Health sync (Route A file bridge)** — Apple Health has no web API, so
  import happens by file:
  - **Shortcut JSON** matching the documented schema (shown in the Sync tab);
  - **Apple Health `export.xml`**, parsed in a streaming pass with a progress
    bar (only the six relevant record types are read);
  - **generic CSV** (e.g. a Gabit export) with a remembered column mapping.

  Imports are idempotent — records merge on `date`, updates overwrite, never
  duplicate — and every metric is optional.
- **LOW MANA readiness** — a 7-day rolling HRV baseline; when today's HRV is
  more than 1 SD below it, the app flags LOW MANA and pre-selects a
  reduced-volume session (2 sets, RPE capped at 6).

## Architecture note (Route C seam)

Every read/write of health metrics goes through the `HealthProvider`
abstraction. `FileImportProvider` is the active web implementation;
`NativeHealthProvider` is a stub that throws on web. If true background sync
is ever wanted, wrap the app with Capacitor and swap in a real native
provider — a one-file change, not a rewrite. Do not let any other code touch
health data directly.

## Testing

`smoke` coverage lives in the session scratchpad (Playwright, headless
Chromium): onboarding, prescription math, rotation/reschedule/skip semantics,
JSON/XML/CSV import + idempotency, LOW MANA detection, chart rendering, and
localStorage persistence.
