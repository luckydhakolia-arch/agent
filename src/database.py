"""Async SQLite database for content and trend storage."""
import json
import logging
from datetime import datetime
from typing import Any

import aiosqlite

logger = logging.getLogger(__name__)


class Database:
    """Async SQLite database for the Social Media Agent."""

    def __init__(self, db_path: str = "social_media_agent.db"):
        self.db_path = db_path

    async def initialize(self):
        """Create all tables and indexes on first run."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS posts (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform        TEXT    NOT NULL,
                    content         TEXT    NOT NULL,
                    hashtags        TEXT    DEFAULT '[]',
                    media_desc      TEXT    DEFAULT '',
                    scheduled_for   TEXT,
                    content_type    TEXT    DEFAULT 'post',
                    topic_category  TEXT    DEFAULT 'general',
                    status          TEXT    DEFAULT 'pending',
                    created_at      TEXT    NOT NULL,
                    published_at    TEXT
                );

                CREATE TABLE IF NOT EXISTS trends (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic           TEXT    NOT NULL,
                    platforms       TEXT    NOT NULL,
                    hashtags        TEXT    DEFAULT '[]',
                    description     TEXT    DEFAULT '',
                    relevance_score REAL    DEFAULT 5.0,
                    discovered_at   TEXT    NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_posts_platform
                    ON posts(platform);
                CREATE INDEX IF NOT EXISTS idx_posts_status
                    ON posts(status);
                CREATE INDEX IF NOT EXISTS idx_posts_scheduled
                    ON posts(scheduled_for);
                CREATE INDEX IF NOT EXISTS idx_trends_discovered
                    ON trends(discovered_at DESC);
            """)
            await db.commit()
        logger.info("Database initialised at %s", self.db_path)

    # ------------------------------------------------------------------ posts

    async def save_post(
        self,
        platform: str,
        content: str,
        hashtags: list[str] | None = None,
        media_desc: str = "",
        scheduled_for: str | None = None,
        content_type: str = "post",
        topic_category: str = "general",
    ) -> int:
        """Insert a new post and return its row ID."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                INSERT INTO posts
                    (platform, content, hashtags, media_desc, scheduled_for,
                     content_type, topic_category, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """,
                (
                    platform,
                    content,
                    json.dumps(hashtags or []),
                    media_desc,
                    scheduled_for,
                    content_type,
                    topic_category,
                    datetime.utcnow().isoformat(),
                ),
            )
            await db.commit()
            return cursor.lastrowid  # type: ignore[return-value]

    async def get_posts(
        self,
        platform: str | None = None,
        status: str | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Retrieve posts, optionally filtered by platform and status."""
        query = "SELECT * FROM posts WHERE 1=1"
        params: list[Any] = []

        if platform:
            query += " AND platform = ?"
            params.append(platform)
        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()
            return [
                {**dict(row), "hashtags": json.loads(row["hashtags"] or "[]")}
                for row in rows
            ]

    async def update_post_status(
        self, post_id: int, status: str, published_at: str | None = None
    ):
        """Update a post's status (e.g., pending → published)."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE posts SET status = ?, published_at = ? WHERE id = ?",
                (status, published_at or datetime.utcnow().isoformat(), post_id),
            )
            await db.commit()

    # ----------------------------------------------------------------- trends

    async def save_trend(
        self,
        topic: str,
        platforms: list[str],
        hashtags: list[str] | None = None,
        description: str = "",
        relevance_score: float = 5.0,
    ) -> int:
        """Insert a discovered trend and return its row ID."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                INSERT INTO trends
                    (topic, platforms, hashtags, description, relevance_score, discovered_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    topic,
                    json.dumps(platforms),
                    json.dumps(hashtags or []),
                    description,
                    relevance_score,
                    datetime.utcnow().isoformat(),
                ),
            )
            await db.commit()
            return cursor.lastrowid  # type: ignore[return-value]

    async def get_trends(
        self,
        platform: str | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Retrieve recent trends, optionally filtered by platform."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM trends ORDER BY discovered_at DESC LIMIT ?",
                (limit * 3,),  # over-fetch so we can filter by platform
            )
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            item = dict(row)
            item["platforms"] = json.loads(item["platforms"] or "[]")
            item["hashtags"] = json.loads(item["hashtags"] or "[]")
            if platform is None or platform in item["platforms"]:
                results.append(item)
            if len(results) >= limit:
                break

        return results

    # ------------------------------------------------------------------ stats

    async def get_stats(self) -> dict[str, Any]:
        """Aggregate statistics about stored content."""
        async with aiosqlite.connect(self.db_path) as db:
            total_row = await (await db.execute("SELECT COUNT(*) FROM posts")).fetchone()
            total_posts = total_row[0] if total_row else 0

            platform_rows = await (
                await db.execute(
                    "SELECT platform, COUNT(*) FROM posts GROUP BY platform"
                )
            ).fetchall()

            status_rows = await (
                await db.execute(
                    "SELECT status, COUNT(*) FROM posts GROUP BY status"
                )
            ).fetchall()

            trends_row = await (await db.execute("SELECT COUNT(*) FROM trends")).fetchone()
            total_trends = trends_row[0] if trends_row else 0

        return {
            "total_posts": total_posts,
            "posts_by_platform": {r[0]: r[1] for r in platform_rows},
            "posts_by_status": {r[0]: r[1] for r in status_rows},
            "total_trends": total_trends,
            "generated_at": datetime.utcnow().isoformat(),
        }
