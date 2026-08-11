import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select

from scripts import incremental_update
from src.db.schema import RawRecord, SourceRun, get_session, init_db
from src.pipeline.raw_ingest import insert_raw_record


class IncrementalIngestTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp_dir.name) / "papers.db")
        init_db(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def seed_duplicate(self, source: str, source_record_id: str):
        session = get_session(self.db_path)
        run = SourceRun(source=source, params={"seed": True})
        session.add(run)
        session.flush()
        insert_raw_record(
            session,
            run_id=run.id,
            source=source,
            source_record_id=source_record_id,
            payload={"seed": True},
        )
        session.commit()
        session.close()

    def latest_run(self, source: str) -> SourceRun:
        session = get_session(self.db_path)
        try:
            return session.execute(
                select(SourceRun)
                .where(SourceRun.source == source)
                .order_by(SourceRun.id.desc())
            ).scalars().first()
        finally:
            session.close()

    def persisted_ids(self, run_id: int) -> list[str]:
        session = get_session(self.db_path)
        try:
            return list(session.execute(
                select(RawRecord.source_record_id)
                .where(RawRecord.run_id == run_id)
                .order_by(RawRecord.source_record_id)
            ).scalars().all())
        finally:
            session.close()

    def test_arxiv_increment_keeps_new_records_around_a_duplicate(self):
        self.seed_duplicate("arxiv", "duplicate")
        records = [
            {"arxiv_id": "new-before-duplicate"},
            {"arxiv_id": "duplicate"},
            {"arxiv_id": "new-after-duplicate"},
        ]

        with (
            patch.object(incremental_update, "DB_PATH", self.db_path),
            patch.object(incremental_update, "ARXIV_CATEGORIES", ["cs.AI"]),
            patch.object(incremental_update, "fetch_category", return_value=records),
        ):
            incremental_update.step_fetch_arxiv_incremental()

        run = self.latest_run("arxiv")
        self.assertEqual(run.status, "success")
        self.assertEqual(run.records_fetched, 2)
        self.assertEqual(
            self.persisted_ids(run.id),
            ["new-after-duplicate", "new-before-duplicate"],
        )

    def test_crossref_increment_keeps_new_records_around_a_duplicate(self):
        self.seed_duplicate("crossref", "duplicate")
        works = [
            {"doi": "new-before-duplicate"},
            {"doi": "duplicate"},
            {"doi": "new-after-duplicate"},
        ]
        journal = {"abbr": "TEST", "issn": "0000-0000", "openalex_source_id": None}

        with (
            patch.object(incremental_update, "DB_PATH", self.db_path),
            patch.object(incremental_update, "english_journals", return_value=[journal]),
            patch.object(incremental_update.cr, "fetch_works_by_issn", return_value=works),
            patch.object(incremental_update.cr, "slim_record", side_effect=lambda work: work),
        ):
            incremental_update.step_fetch_english_incremental()

        run = self.latest_run("crossref")
        self.assertEqual(run.status, "success")
        self.assertEqual(run.records_fetched, 2)
        self.assertEqual(
            self.persisted_ids(run.id),
            ["new-after-duplicate", "new-before-duplicate"],
        )


if __name__ == "__main__":
    unittest.main()
