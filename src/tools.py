"""Tool definitions and dispatch for the Social Media Agent."""
import json
import logging
from datetime import datetime
from typing import Any

from .database import Database

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ definitions

TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "search_trends",
        "description": (
            "Search for current trending topics, viral content, and popular hashtags "
            "for a given platform and query. Returns a list of trending topics with "
            "engagement signals and related hashtags. Use this before generating content "
            "to ground posts in what is actually resonating right now."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Search topic or keyword (e.g. 'AI tools', 'remote work tips', "
                        "'sustainable living')"
                    ),
                },
                "platform": {
                    "type": "string",
                    "enum": ["twitter", "linkedin", "instagram", "facebook", "general"],
                    "description": "Platform context for the trend search",
                },
                "time_range": {
                    "type": "string",
                    "enum": ["hour", "day", "week"],
                    "description": "Recency window for trends",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "save_post",
        "description": (
            "Save a generated social media post to the content database. "
            "Call this every time you finish creating a post — it persists the content "
            "for the scheduler to queue and publish."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["twitter", "linkedin", "instagram", "facebook"],
                    "description": "Target platform",
                },
                "content": {
                    "type": "string",
                    "description": "Full post text, formatted for the platform",
                },
                "hashtags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Hashtags to include (without the # symbol)",
                },
                "media_desc": {
                    "type": "string",
                    "description": (
                        "Description of the ideal image/video to accompany this post "
                        "(for a human or image-generation tool to act on)"
                    ),
                },
                "scheduled_for": {
                    "type": "string",
                    "description": (
                        "ISO 8601 UTC datetime when the post should go live "
                        "(e.g. '2025-01-15T09:00:00Z'). Omit to queue without a time."
                    ),
                },
                "content_type": {
                    "type": "string",
                    "enum": ["post", "story", "thread", "reel", "article", "carousel"],
                    "description": "Format of the content",
                },
                "topic_category": {
                    "type": "string",
                    "description": (
                        "Topic bucket for this post "
                        "(e.g. 'industry-news', 'tips-and-tricks', 'behind-the-scenes', "
                        "'trending-moment', 'product-highlight')"
                    ),
                },
            },
            "required": ["platform", "content"],
        },
    },
    {
        "name": "get_pending_posts",
        "description": (
            "Retrieve queued posts from the database. Use this to avoid duplicating "
            "content that is already scheduled or to review what has been generated."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["twitter", "linkedin", "instagram", "facebook", "all"],
                    "description": "Filter by platform, or 'all' for every platform",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of posts to return",
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "published", "failed", "all"],
                    "description": "Filter by post status",
                },
            },
            "required": [],
        },
    },
    {
        "name": "save_trend",
        "description": (
            "Persist a discovered trend to the database so future content-generation "
            "cycles can reference it without re-searching."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The trend topic or theme",
                },
                "platforms": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Platforms where this trend is active",
                },
                "hashtags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Associated trending hashtags (without #)",
                },
                "description": {
                    "type": "string",
                    "description": "Why this is trending and how to use it in content",
                },
                "relevance_score": {
                    "type": "number",
                    "description": "Relevance to your brand/audience, 0 (low) – 10 (high)",
                },
            },
            "required": ["topic", "platforms"],
        },
    },
    {
        "name": "get_recent_trends",
        "description": (
            "Fetch the most recently saved trends from the database. "
            "Call this at the start of a content-generation cycle to incorporate "
            "trends discovered in the last research pass."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "description": "Optional — filter trends to a specific platform",
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of trends to retrieve (default 5)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_content_stats",
        "description": (
            "Return aggregate statistics about all generated content: "
            "total posts, breakdown by platform, breakdown by status, "
            "and total trends stored. Use this to understand content coverage."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]

# ------------------------------------------------------------------ dispatch

async def execute_tool(
    name: str, tool_input: dict[str, Any], db: Database
) -> Any:
    """Route a tool call to its implementation and return the result."""
    handlers = {
        "search_trends": _search_trends,
        "save_post": _save_post,
        "get_pending_posts": _get_pending_posts,
        "save_trend": _save_trend,
        "get_recent_trends": _get_recent_trends,
        "get_content_stats": _get_content_stats,
    }
    handler = handlers.get(name)
    if handler is None:
        raise ValueError(f"Unknown tool: {name}")
    return await handler(tool_input, db)


# ---------------------------------------------------------------- tool impls

async def _search_trends(tool_input: dict, db: Database) -> dict:  # noqa: ARG001
    """
    Trend search stub — replace with real social-media API calls
    (Twitter v2 Trends, Google Trends, etc.) when API credentials are available.
    """
    query = tool_input.get("query", "")
    platform = tool_input.get("platform", "general")
    time_range = tool_input.get("time_range", "day")

    # Representative simulated response — swap for a live API in production
    result = {
        "query": query,
        "platform": platform,
        "time_range": time_range,
        "timestamp": datetime.utcnow().isoformat(),
        "trends": [
            {
                "topic": query,
                "volume": 32_000,
                "growth_pct": "+127%",
                "sentiment": "positive",
                "related_hashtags": [
                    query.lower().replace(" ", ""),
                    "trending",
                    platform,
                ],
                "sample_posts": [
                    f"Everyone is talking about {query} right now",
                    f"Why {query} matters for {platform} marketers",
                ],
            },
            {
                "topic": "AI productivity",
                "volume": 145_000,
                "growth_pct": "+38%",
                "sentiment": "positive",
                "related_hashtags": ["AI", "productivity", "futureofwork"],
                "sample_posts": [
                    "AI tools are changing how teams work",
                    "Top 5 AI productivity hacks you need today",
                ],
            },
            {
                "topic": "Creator economy",
                "volume": 67_000,
                "growth_pct": "+22%",
                "sentiment": "mixed",
                "related_hashtags": ["creatoreconomy", "contentcreator", "digitalmarketing"],
                "sample_posts": [
                    "The creator economy hit $250B last year — here's what's next",
                    "Monetising your audience in 2025: a practical guide",
                ],
            },
        ],
    }
    logger.info("Trend search: query=%s platform=%s", query, platform)
    return result


async def _save_post(tool_input: dict, db: Database) -> dict:
    post_id = await db.save_post(
        platform=tool_input["platform"],
        content=tool_input["content"],
        hashtags=tool_input.get("hashtags", []),
        media_desc=tool_input.get("media_desc", ""),
        scheduled_for=tool_input.get("scheduled_for"),
        content_type=tool_input.get("content_type", "post"),
        topic_category=tool_input.get("topic_category", "general"),
    )
    preview = tool_input["content"]
    if len(preview) > 120:
        preview = preview[:120] + "…"
    logger.info("Saved post id=%d platform=%s", post_id, tool_input["platform"])
    return {
        "success": True,
        "post_id": post_id,
        "platform": tool_input["platform"],
        "content_type": tool_input.get("content_type", "post"),
        "preview": preview,
    }


async def _get_pending_posts(tool_input: dict, db: Database) -> dict:
    platform = tool_input.get("platform", "all")
    limit = int(tool_input.get("limit") or 10)
    status = tool_input.get("status", "pending")

    posts = await db.get_posts(
        platform=None if platform == "all" else platform,
        status=None if status == "all" else status,
        limit=limit,
    )
    return {"count": len(posts), "posts": posts}


async def _save_trend(tool_input: dict, db: Database) -> dict:
    trend_id = await db.save_trend(
        topic=tool_input["topic"],
        platforms=tool_input["platforms"],
        hashtags=tool_input.get("hashtags", []),
        description=tool_input.get("description", ""),
        relevance_score=float(tool_input.get("relevance_score", 5.0)),
    )
    logger.info("Saved trend id=%d topic=%s", trend_id, tool_input["topic"])
    return {
        "success": True,
        "trend_id": trend_id,
        "topic": tool_input["topic"],
    }


async def _get_recent_trends(tool_input: dict, db: Database) -> dict:
    platform = tool_input.get("platform")
    limit = int(tool_input.get("limit") or 5)
    trends = await db.get_trends(platform=platform, limit=limit)
    return {"count": len(trends), "trends": trends}


async def _get_content_stats(_tool_input: dict, db: Database) -> dict:
    return await db.get_stats()
