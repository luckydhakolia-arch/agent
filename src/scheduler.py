"""
24x7 async scheduler for the Social Media Content Agent.

Uses APScheduler's AsyncIOScheduler to trigger content-generation jobs
on a recurring basis without blocking the event loop.
"""
import asyncio
import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from rich.console import Console
from rich.table import Table

from .agent import SocialMediaAgent
from .config import Config
from .database import Database

logger = logging.getLogger(__name__)
console = Console()


class ContentScheduler:
    """Orchestrates 24x7 content generation via scheduled async jobs."""

    def __init__(self, agent: SocialMediaAgent, config: Config, db: Database):
        self.agent = agent
        self.config = config
        self.db = db
        self._scheduler = AsyncIOScheduler()
        self._running = False

    # -------------------------------------------------------------- lifecycle

    def _register_jobs(self):
        """Register all recurring jobs with the APScheduler instance."""
        sc = self.config.scheduler

        # Trend research — runs every N hours
        self._scheduler.add_job(
            self._job_research_trends,
            trigger=IntervalTrigger(hours=sc.trend_research_interval_hours),
            id="trend_research",
            name="Trend Research",
            replace_existing=True,
            misfire_grace_time=600,
        )

        # Content generation — one job per enabled platform, staggered by 15 min
        for idx, platform in enumerate(self.config.enabled_platforms):
            self._scheduler.add_job(
                self._job_generate_content,
                trigger=IntervalTrigger(hours=sc.content_gen_interval_hours),
                id=f"content_{platform}",
                name=f"Content — {platform}",
                kwargs={"platform": platform},
                replace_existing=True,
                misfire_grace_time=600,
            )

        # Daily content calendar planning at 06:00 UTC
        self._scheduler.add_job(
            self._job_plan_calendar,
            trigger=CronTrigger(hour=6, minute=0),
            id="calendar_planning",
            name="Daily Calendar Planning",
            replace_existing=True,
            misfire_grace_time=3600,
        )

        # Hourly stats summary
        self._scheduler.add_job(
            self._job_report_stats,
            trigger=IntervalTrigger(hours=1),
            id="stats_report",
            name="Hourly Stats",
            replace_existing=True,
            misfire_grace_time=300,
        )

        logger.info("Registered %d jobs", len(self._scheduler.get_jobs()))

    async def start(self):
        """Start the scheduler and block until stopped."""
        self._running = True
        self._register_jobs()
        self._scheduler.start()

        console.print(
            "\n[bold green]🚀  Social Media Agent — Running 24x7[/bold green]"
        )
        console.print(
            f"[cyan]Platforms : {', '.join(self.config.enabled_platforms)}[/cyan]"
        )
        console.print(f"[cyan]Database  : {self.config.database_path}[/cyan]")
        console.print(
            f"[cyan]Trend research every {self.config.scheduler.trend_research_interval_hours}h  "
            f"| Content generation every {self.config.scheduler.content_gen_interval_hours}h[/cyan]\n"
        )

        # Run an immediate startup cycle so we produce content right away
        await self._startup_cycle()

        try:
            while self._running:
                await asyncio.sleep(30)
        except asyncio.CancelledError:
            await self.stop()

    async def stop(self):
        """Shut down the scheduler gracefully."""
        self._running = False
        self._scheduler.shutdown(wait=False)
        console.print("\n[yellow]⏹  Agent stopped.[/yellow]")

    # -------------------------------------------------------- startup

    async def _startup_cycle(self):
        """Run an abbreviated first cycle immediately on startup."""
        console.print("[bold]Running startup cycle…[/bold]")
        await self._job_research_trends()
        if self.config.enabled_platforms:
            await self._job_generate_content(self.config.enabled_platforms[0])

    # -------------------------------------------------------- scheduled jobs

    async def _job_research_trends(self):
        ts = datetime.utcnow().strftime("%H:%M UTC")
        console.print(f"\n[bold blue]🔍  Researching trends [{ts}][/bold blue]")
        try:
            result = await self.agent.research_trends(self.config.enabled_platforms)
            console.print(
                f"[green]✓  Trend research complete "
                f"({result['tool_calls']} tool calls)[/green]"
            )
        except Exception as exc:
            logger.error("Trend research failed: %s", exc, exc_info=True)
            console.print(f"[red]✗  Trend research failed: {exc}[/red]")

    async def _job_generate_content(self, platform: str):
        ts = datetime.utcnow().strftime("%H:%M UTC")
        console.print(
            f"\n[bold blue]✍  Generating {platform} content [{ts}][/bold blue]"
        )

        # Each platform gets its natural content types
        content_types = {
            "twitter": ["post", "thread"],
            "linkedin": ["post", "article"],
            "instagram": ["post", "reel"],
            "facebook": ["post"],
        }.get(platform, ["post"])

        for ct in content_types:
            try:
                result = await self.agent.generate_content(
                    platform=platform, content_type=ct
                )
                console.print(
                    f"[green]✓  {platform} {ct} saved "
                    f"({result['tool_calls']} tool calls)[/green]"
                )
                await asyncio.sleep(2)  # brief pause between types
            except Exception as exc:
                logger.error(
                    "Content generation failed (%s/%s): %s", platform, ct, exc,
                    exc_info=True,
                )
                console.print(
                    f"[red]✗  {platform} {ct} failed: {exc}[/red]"
                )

    async def _job_plan_calendar(self):
        ts = datetime.utcnow().strftime("%H:%M UTC")
        console.print(f"\n[bold blue]📅  Planning 7-day calendar [{ts}][/bold blue]")
        try:
            result = await self.agent.plan_content_calendar(days=7)
            console.print(
                f"[green]✓  Calendar planned "
                f"({result['tool_calls']} tool calls)[/green]"
            )
        except Exception as exc:
            logger.error("Calendar planning failed: %s", exc, exc_info=True)
            console.print(f"[red]✗  Calendar planning failed: {exc}[/red]")

    async def _job_report_stats(self):
        stats = await self.db.get_stats()
        ts = datetime.utcnow().strftime("%H:%M UTC")

        table = Table(title=f"📊  Content Stats [{ts}]", show_lines=True)
        table.add_column("Metric", style="cyan", no_wrap=True)
        table.add_column("Value", style="green", justify="right")

        table.add_row("Total posts generated", str(stats["total_posts"]))
        table.add_row("Trends discovered", str(stats["total_trends"]))

        for platform, count in sorted(stats.get("posts_by_platform", {}).items()):
            table.add_row(f"  ↳ {platform}", str(count))

        for status, count in sorted(stats.get("posts_by_status", {}).items()):
            table.add_row(f"  {status}", str(count))

        console.print(table)
