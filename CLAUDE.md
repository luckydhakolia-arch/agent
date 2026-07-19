# Social Media Content Agent

An autonomous AI agent that generates platform-optimised social media content 24x7, powered by Claude claude-opus-4-7 with adaptive thinking and tool use.

## Architecture

```
main.py                   ← entry point: wires everything, handles signals
src/
  config.py               ← Config + SchedulerConfig (reads .env)
  database.py             ← async SQLite via aiosqlite (posts + trends)
  platforms.py            ← per-platform constraints and best practices
  tools.py                ← 6 tool definitions + dispatch + implementations
  agent.py                ← SocialMediaAgent: _run_loop() agentic tool-use loop
  scheduler.py            ← ContentScheduler: APScheduler jobs for 24x7 ops
```

### Agent loop (`src/agent.py`)

`_run_loop()` implements the manual tool-use loop:
1. Call `claude-opus-4-7` with `thinking: {type: "adaptive"}` and a cached system prompt
2. If `stop_reason == "tool_use"`, execute all requested tools via `execute_tool()`
3. Append results as a `user` turn and repeat
4. Break on `end_turn` or when the 25-call safety cap is hit

The system prompt is marked `cache_control: {type: "ephemeral"}` so it is served from Anthropic's prompt cache (5-minute TTL) on every call after the first, avoiding re-tokenisation of the ~800-token block on every API request.

### Tools (`src/tools.py`)

| Tool | Purpose |
|---|---|
| `search_trends` | Simulated trend search (stub — replace with Twitter v2 / Google Trends) |
| `save_post` | Persist a generated post to SQLite |
| `get_pending_posts` | Retrieve queued/published posts |
| `save_trend` | Persist a discovered trend |
| `get_recent_trends` | Fetch the latest stored trends |
| `get_content_stats` | Aggregate counts by platform and status |

### Scheduler (`src/scheduler.py`)

Four recurring APScheduler jobs:

| Job | Trigger | Description |
|---|---|---|
| `trend_research` | Every N hours | Research and store trends for all enabled platforms |
| `content_{platform}` | Every N hours (per platform) | Generate all content types for that platform |
| `calendar_planning` | Daily at 06:00 UTC | Plan a 7-day content calendar with scheduled timestamps |
| `stats_report` | Every hour | Print a Rich table of content counts |

An abbreviated startup cycle runs immediately on `start()` so the agent produces content before the first scheduled interval fires.

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

# 3. Run
python main.py
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Your Anthropic API key |
| `DATABASE_PATH` | `social_media_agent.db` | SQLite database file path |
| `LOG_LEVEL` | `INFO` | Python logging level |
| `ENABLED_PLATFORMS` | `twitter,linkedin,instagram,facebook` | Comma-separated active platforms |
| `TREND_RESEARCH_INTERVAL_HOURS` | `6` | How often to research trends |
| `CONTENT_GEN_INTERVAL_HOURS` | `4` | How often to generate content per platform |

## Running modes

```bash
# 24x7 continuous mode (default)
python main.py

# Single cycle and exit — good for testing or CI
python main.py --once
```

## Connecting real trend data

`src/tools.py → _search_trends()` currently returns simulated data. To connect live sources:

```python
# Twitter v2 Trends
import tweepy
client = tweepy.Client(bearer_token=os.environ["TWITTER_BEARER_TOKEN"])
trends = client.get_place_trends(id=1)  # WOEID 1 = worldwide

# Google Trends (unofficial)
from pytrends.request import TrendReq
pytrends = TrendReq()
pytrends.build_payload([query], timeframe="now 1-d")
data = pytrends.interest_over_time()
```

Replace the return value in `_search_trends()` with the live API response, shaped to match the existing dict structure so the agent's prompts and tool result handling require no changes.

## Extending platforms

Add a new entry to `PLATFORM_CONFIGS` in `src/platforms.py` and include the platform key in `ENABLED_PLATFORMS`. The scheduler automatically creates a content generation job for every enabled platform.

## Database schema

**`posts`**: id, platform, content, hashtags (JSON), media_desc, scheduled_for, content_type, topic_category, status (pending/published/failed), created_at, published_at

**`trends`**: id, topic, platforms (JSON), hashtags (JSON), description, relevance_score, discovered_at

## ASCEND (separate app)

`ascend/` contains ASCEND — a self-contained, single-file fitness app for the
Phase 1: FOUNDATION training program (see `ascend/README.md`). It is unrelated
to the social media agent above: no Python, no build step — open
`ascend/index.html` in a browser.
