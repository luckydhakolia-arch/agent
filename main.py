"""
Entry point for the 24x7 Social Media Content Agent.

Usage:
    python main.py              # run with settings from .env
    python main.py --once       # run a single startup cycle and exit
"""
import asyncio
import logging
import signal
import sys
from argparse import ArgumentParser

from dotenv import load_dotenv

from src.agent import SocialMediaAgent
from src.config import Config
from src.database import Database
from src.scheduler import ContentScheduler


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Quiet noisy third-party loggers
    for noisy in ("apscheduler", "aiosqlite", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


async def main(once: bool = False) -> None:
    load_dotenv()
    config = Config.from_env()
    _setup_logging(config.log_level)

    logger = logging.getLogger(__name__)
    logger.info("Starting Social Media Content Agent")

    db = Database(config.database_path)
    await db.initialize()

    agent = SocialMediaAgent(config, db)
    scheduler = ContentScheduler(agent, config, db)

    if once:
        # Run a single cycle and exit — useful for testing
        await scheduler._startup_cycle()
        return

    loop = asyncio.get_running_loop()

    def _request_stop():
        logger.info("Shutdown signal received")
        asyncio.ensure_future(scheduler.stop())

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _request_stop)

    await scheduler.start()


if __name__ == "__main__":
    parser = ArgumentParser(description="24x7 Social Media Content Agent")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single startup cycle and exit instead of looping 24x7",
    )
    args = parser.parse_args()

    try:
        asyncio.run(main(once=args.once))
    except KeyboardInterrupt:
        sys.exit(0)
