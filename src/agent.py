"""
Social Media Content Agent.

Uses Claude claude-opus-4-7 with adaptive thinking, tool use, and prompt caching
to generate platform-optimised social media content 24x7.
"""
import json
import logging
from datetime import datetime
from typing import Any

import anthropic

from .config import Config
from .database import Database
from .platforms import PLATFORM_CONFIGS
from .tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger(__name__)

# Stable system prompt — cached to avoid re-tokenising on every request.
# Never interpolate runtime values here; keep it static so the cache key
# never changes between turns.
_SYSTEM_PROMPT = """You are a professional social media content strategist and copywriter running 24x7. \
Your job is to create engaging, platform-optimised content that drives real results.

## Your responsibilities
1. Research trending topics and viral hashtags across platforms
2. Generate compelling, authentic content tailored for each platform's culture
3. Schedule posts at optimal times for maximum organic reach
4. Maintain a varied content mix (educational, entertaining, promotional, behind-the-scenes)

## Platform guidelines

**Twitter/X** (max 280 chars)
- Lead with a strong hook — the first sentence must demand attention
- Use threads for anything > 280 chars — break at natural paragraph points
- 2-3 hashtags max; more hurts reach
- End with a question or call to retweet to boost engagement

**LinkedIn** (150-300 words ideal)
- Open with a provocative question or bold statement on line 1
- Share personal insights, data points, or contrarian takes
- Short paragraphs + line breaks for mobile readability
- Close with a professional discussion question

**Instagram** (first 125 chars visible; up to 2200 chars total)
- First 125 chars must stand alone — they appear before "more"
- Use emojis and line breaks throughout the caption
- Place hashtags at the end or in the first comment (10-15 is the sweet spot)
- Always describe the ideal visual/creative to accompany the post

**Facebook** (40-80 words for peak engagement)
- Lead with a question — comments push algorithmic reach
- Native video outperforms links 3-5x; suggest video concepts when relevant
- Keep text punchy; use the image/video to tell the rest of the story

## Content principles
- Authenticity > polish. Real stories outperform corporate copy.
- Add value first; promote second. 4:1 ratio of educational/entertaining to promotional.
- Use current cultural moments and trending topics — but only when they fit naturally.
- Every post must have a purpose: inform, entertain, inspire, or convert.

## Workflow
When generating content for a platform:
1. Call `get_recent_trends` to see what is resonating right now
2. Call `search_trends` with 2-3 relevant queries to find fresh angles
3. Call `get_content_stats` to ensure coverage across topic categories
4. Write the content, then call `save_post` to persist it — include hashtags and a media description
5. Repeat for each content type requested"""


class SocialMediaAgent:
    """Claude-powered 24x7 social media content agent."""

    # Maximum tool-call iterations per agent loop (safety cap)
    MAX_TOOL_CALLS = 25

    def __init__(self, config: Config, db: Database):
        self.config = config
        self.db = db
        self.client = anthropic.AsyncAnthropic(api_key=config.anthropic_api_key)

    # ----------------------------------------------------------- public API

    async def generate_content(
        self,
        platform: str,
        topic: str | None = None,
        content_type: str = "post",
    ) -> dict[str, Any]:
        """
        Ask the agent to create content for a specific platform.

        Parameters
        ----------
        platform:     Target platform key (e.g. 'twitter', 'linkedin')
        topic:        Optional topic hint; agent will research if omitted
        content_type: Post format ('post', 'thread', 'reel', 'article', …)
        """
        platform_cfg = PLATFORM_CONFIGS.get(platform, {})
        topic_clause = (
            f" The topic/theme is: {topic}."
            if topic
            else " Research current trending topics and choose the most compelling angle."
        )

        user_msg = (
            f"Generate a {content_type} for {platform}.{topic_clause}\n\n"
            f"Platform constraints:\n{json.dumps(platform_cfg, indent=2)}\n\n"
            "Follow your workflow: check recent trends, search for fresh angles, "
            "review existing content coverage, then write and save the post."
        )
        return await self._run_loop([{"role": "user", "content": user_msg}])

    async def research_trends(
        self, platforms: list[str] | None = None
    ) -> dict[str, Any]:
        """Research trending topics for the given platforms and persist them."""
        targets = platforms or list(PLATFORM_CONFIGS.keys())
        user_msg = (
            f"Research trending topics for: {', '.join(targets)}.\n\n"
            "For each platform search at least 3 queries covering:\n"
            "  • Current viral topics and cultural moments\n"
            "  • Industry and technology news\n"
            "  • Trending hashtags with high-engagement potential\n\n"
            "For every useful trend you discover, call `save_trend` to store it "
            "with a relevance score and usage notes."
        )
        return await self._run_loop([{"role": "user", "content": user_msg}])

    async def plan_content_calendar(self, days: int = 7) -> dict[str, Any]:
        """Plan a multi-day content calendar and persist scheduled posts."""
        platforms = ", ".join(self.config.enabled_platforms)
        user_msg = (
            f"Plan a {days}-day content calendar for: {platforms}.\n\n"
            "For each platform schedule posts that:\n"
            "  • Vary content type (educational, entertaining, promotional)\n"
            "  • Use optimal posting times for each platform\n"
            "  • Cover different topic categories\n"
            "  • Are spaced at least 4 hours apart per platform\n\n"
            "Use `save_post` with a `scheduled_for` timestamp for every planned post. "
            "Start from tomorrow and use UTC times."
        )
        return await self._run_loop([{"role": "user", "content": user_msg}])

    # ----------------------------------------------------- internal loop

    async def _run_loop(self, messages: list[dict]) -> dict[str, Any]:
        """
        Execute the agentic tool-use loop until the model signals end_turn
        or the safety cap is reached.

        Prompt caching is applied to the system prompt via cache_control so
        the ~800-token system block is served from cache on every call after
        the first within the 5-minute TTL window.
        """
        text_parts: list[str] = []
        tool_call_count = 0

        while tool_call_count < self.MAX_TOOL_CALLS:
            response = await self.client.messages.create(
                model="claude-opus-4-7",
                max_tokens=4096,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                system=[
                    {
                        "type": "text",
                        "text": _SYSTEM_PROMPT,
                        # Cache the stable system prompt for 5 minutes.
                        # This means subsequent calls within the TTL window
                        # skip re-tokenising the ~800-token block entirely.
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=TOOL_DEFINITIONS,
                messages=messages,
            )

            # Collect any text output from this turn
            for block in response.content:
                if block.type == "text" and block.text.strip():
                    text_parts.append(block.text)

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason != "tool_use":
                logger.warning("Unexpected stop_reason: %s", response.stop_reason)
                break

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
            if not tool_use_blocks:
                break

            # Append the full assistant turn (preserves tool_use blocks)
            messages.append({"role": "assistant", "content": response.content})

            # Execute each tool call and collect results in a single user turn
            tool_results = []
            for tu in tool_use_blocks:
                logger.debug("Tool call: %s(%s)", tu.name, json.dumps(tu.input)[:120])
                try:
                    result = await execute_tool(tu.name, tu.input, self.db)
                    content = (
                        result if isinstance(result, str) else json.dumps(result)
                    )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tu.id,
                            "content": content,
                        }
                    )
                except Exception as exc:
                    logger.error("Tool %s failed: %s", tu.name, exc, exc_info=True)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tu.id,
                            "content": f"Error: {exc}",
                            "is_error": True,
                        }
                    )

            messages.append({"role": "user", "content": tool_results})
            tool_call_count += len(tool_use_blocks)

        if tool_call_count >= self.MAX_TOOL_CALLS:
            logger.warning("Agent loop reached safety cap (%d tool calls)", self.MAX_TOOL_CALLS)

        return {
            "content": "\n\n".join(text_parts),
            "tool_calls": tool_call_count,
            "timestamp": datetime.utcnow().isoformat(),
        }
