#!/usr/bin/env python3
"""Backfill calls.subject and calls.summary from existing transcripts.

Usage (from portal/backend):
  ../../.venv/bin/python ../../scripts/backfill-call-subjects.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "portal" / "backend"
sys.path.insert(0, str(BACKEND))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.models import Call, CallStatus, Transcript  # noqa: E402
from app.services.call_subject import derive_subject_summary  # noqa: E402


async def run(*, dry_run: bool, limit: int | None) -> int:
    updated = 0
    async with async_session() as db:
        stmt = (
            select(Call)
            .where(Call.status == CallStatus.COMPLETED)
            .options(selectinload(Call.transcripts))
            .order_by(Call.id)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        calls = (await db.execute(stmt)).scalars().all()
        for call in calls:
            if not call.transcripts:
                continue
            if call.subject and call.summary:
                continue
            subject, summary = derive_subject_summary(list(call.transcripts))
            if subject is None and summary is None:
                continue
            if dry_run:
                print(f"call {call.id}: subject={subject!r} summary={(summary or '')[:60]!r}…")
            else:
                call.subject = subject
                call.summary = summary
            updated += 1
        if not dry_run:
            await db.commit()
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill extractive call subjects/summaries")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing")
    parser.add_argument("--limit", type=int, default=None, help="Max calls to process")
    args = parser.parse_args()
    count = asyncio.run(run(dry_run=args.dry_run, limit=args.limit))
    mode = "would update" if args.dry_run else "updated"
    print(f"{mode} {count} call(s)")


if __name__ == "__main__":
    main()
