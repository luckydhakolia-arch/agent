"""Configuration management for the Social Media Agent."""
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass
class SchedulerConfig:
    """Scheduler timing configuration."""
    trend_research_interval_hours: int = field(
        default_factory=lambda: int(os.environ.get("TREND_RESEARCH_INTERVAL_HOURS", "6"))
    )
    content_gen_interval_hours: int = field(
        default_factory=lambda: int(os.environ.get("CONTENT_GEN_INTERVAL_HOURS", "4"))
    )
    posts_per_platform_per_day: int = field(
        default_factory=lambda: int(os.environ.get("POSTS_PER_PLATFORM_PER_DAY", "3"))
    )


@dataclass
class Config:
    """Main agent configuration."""
    anthropic_api_key: str = field(
        default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", "")
    )
    database_path: str = field(
        default_factory=lambda: os.environ.get("DATABASE_PATH", "social_media_agent.db")
    )
    log_level: str = field(
        default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO")
    )
    enabled_platforms: list[str] = field(
        default_factory=lambda: [
            p.strip()
            for p in os.environ.get(
                "ENABLED_PLATFORMS", "twitter,linkedin,instagram,facebook"
            ).split(",")
        ]
    )
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)

    def __post_init__(self):
        if not self.anthropic_api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY environment variable is required. "
                "Copy .env.example to .env and set your key."
            )
