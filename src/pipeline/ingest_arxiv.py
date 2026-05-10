"""
抓取 arXiv 8 个分类下与 OB/营销 相关的论文，写入 raw_records，再 normalize 入 papers。

复用 P1 的 normalizer 逻辑会复杂（字段不一），所以这里直接 normalize：
arxiv_id 作为去重键，DOI 也存（少数论文有 DOI）。
"""

import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.db.schema import get_session, SourceRun, RawRecord, Paper, PaperSource
from src.connectors.arxiv import fetch_category

load_dotenv()
DB_PATH = os.getenv("DB_PATH", "./data/papers.db")

CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.HC", "cs.CY", "cs.SI", "stat.ML", "econ.GN"]
FROM_DATE = "2023-01-01"


def ingest():
    session = get_session(DB_PATH)
    try:
        for cat in CATEGORIES:
            print(f"\n=== arXiv {cat} ===")
            run = SourceRun(
                source="arxiv",
                journal_abbr=None,
                params={"category": cat, "from_date": FROM_DATE},
            )
            session.add(run)
            session.flush()

            count = 0
            try:
                for rec in fetch_category(cat, from_date=FROM_DATE):
                    raw = RawRecord(
                        run_id=run.id,
                        source="arxiv",
                        source_record_id=rec["arxiv_id"],
                        payload=rec,
                    )
                    session.add(raw)
                    try:
                        session.flush()
                    except IntegrityError:
                        # 同一 arxiv_id 在多个分类里出现 = 重复，跳过
                        session.rollback()
                        continue
                    count += 1
                    if count % 50 == 0:
                        session.commit()
                        print(f"    已入库 {count} 条")
                session.commit()
                run.status = "success"
            except Exception as e:
                session.rollback()
                run.status = "failed"
                run.error_message = str(e)[:500]
                print(f"  ! {e}")
            finally:
                run.records_fetched = count
                run.finished_at = datetime.utcnow()
                session.merge(run)
                session.commit()

            print(f"  -> 入库 {count} 条")
    finally:
        session.close()


def normalize_arxiv():
    """把 arXiv raw_records 提升为 papers + paper_sources。"""
    session = get_session(DB_PATH)
    try:
        existing_raw_ids = set(
            session.execute(select(PaperSource.raw_record_id)).scalars().all()
        )
        rows = session.execute(
            select(RawRecord).where(RawRecord.source == "arxiv")
        ).scalars().all()
        new_rows = [r for r in rows if r.id not in existing_raw_ids]
        print(f"待 normalize 的 arXiv raw: {len(new_rows)}")

        n_new = 0
        n_merged = 0
        for r in new_rows:
            payload = r.payload
            arxiv_id = payload.get("arxiv_id")
            doi = (payload.get("doi") or "").lower() or None

            # 同一 arxiv_id 视为同一论文
            paper = session.execute(
                select(Paper).where(Paper.arxiv_id == arxiv_id)
            ).scalar_one_or_none()
            # 也可能 DOI 已存在（被期刊源收录）
            if not paper and doi:
                paper = session.execute(
                    select(Paper).where(Paper.doi == doi)
                ).scalar_one_or_none()

            if paper:
                # 合并: 补 arxiv_id, abstract, pdf_url
                if not paper.arxiv_id:
                    paper.arxiv_id = arxiv_id
                if not paper.arxiv_categories:
                    paper.arxiv_categories = payload.get("categories")
                if not paper.abstract and payload.get("abstract"):
                    paper.abstract = payload.get("abstract")
                if not paper.pdf_url and payload.get("pdf_url"):
                    paper.pdf_url = payload.get("pdf_url")
                paper.is_arxiv = True
                n_merged += 1
                is_primary = False
            else:
                paper = Paper(
                    doi=doi,
                    arxiv_id=arxiv_id,
                    arxiv_categories=payload.get("categories"),
                    is_arxiv=True,
                    title=payload.get("title") or "(无标题)",
                    abstract=payload.get("abstract"),
                    authors=payload.get("authors"),
                    journal_abbr=None,
                    journal_name=f"arXiv:{payload.get('primary_category', '')}",
                    pub_year=payload.get("publication_year"),
                    pub_date=payload.get("publication_date"),
                    pdf_url=payload.get("pdf_url"),
                    landing_page_url=payload.get("landing_page_url"),
                    lang="en",
                )
                session.add(paper)
                session.flush()
                n_new += 1
                is_primary = True

            session.add(PaperSource(
                paper_id=paper.id,
                raw_record_id=r.id,
                source="arxiv",
                is_primary=is_primary,
            ))

            if (n_new + n_merged) % 100 == 0:
                session.commit()
        session.commit()
        print(f"完成: 新增 {n_new} 篇 arXiv 论文 / 合并 {n_merged} 条到已有论文")
    finally:
        session.close()


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["fetch", "normalize", "all"])
    args = p.parse_args()
    if args.cmd in ("fetch", "all"):
        ingest()
    if args.cmd in ("normalize", "all"):
        normalize_arxiv()
