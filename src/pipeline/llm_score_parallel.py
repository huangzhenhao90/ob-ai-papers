"""
并发版 LLM 打分。
- batch=25 摊薄推理开销
- 4 个 worker 并发请求 minimax
- 主线程负责调度 + 写库（避免 SQLite 写锁）
"""

import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv
from sqlalchemy import select

from src.db.schema import get_session, Paper, PaperScore
from src.llm.client import MiniMaxClient, extract_json

load_dotenv()
DB_PATH = os.getenv("DB_PATH", "./data/papers.db")

BATCH_SIZE = 25
N_WORKERS = 4
ABS_TRUNC = 800

SYSTEM_PROMPT = """你是一名学术论文相关性评判专家。任务：对一批组织行为学/营销学/管理学顶刊论文，
判断每篇与 (1) AI 议题、(2) OB/营销/管理领域 的相关性。

打分标准（0-5）：
- ai_relevance:
  5 = 论文核心议题就是 AI / GenAI / LLM / 算法决策（如 ChatGPT、AI 招聘、算法管理）
  4 = AI 是主要变量之一
  3 = 论文实质涉及 AI，但 AI 不是中心
  2 = 仅在引言/讨论中提及 AI 作为背景
  1 = 字面提到 algorithm/automation 但与 AI 无关
  0 = 完全无关

- domain_relevance:
  5 = 核心 OB/管理/营销研究
  4 = 强相关（消费者行为、领导力、HR 等）
  3 = 边缘相关
  0-2 = 无关

【关键】必须为输入的每一篇论文返回一个 JSON 对象，id 严格对应 [p1] [p2] ... 编号。
即使无法判断，也要给 0 分而不是省略。

输出格式（严格 JSON 数组，无任何额外文字、无 markdown 包裹）：
[{"id": "p1", "ai": 5, "domain": 5, "reason": "..."}, {"id": "p2", "ai": 0, "domain": 5, "reason": "..."}, ...]
"""

USER_TEMPLATE = """请评分以下 {n} 篇论文（务必每篇都返回 JSON）：

{papers}

只输出长度为 {n} 的 JSON 数组，每篇一条 {{"id":"pN","ai":0-5,"domain":0-5,"reason":"≤30字"}}"""


def fmt_paper_dict(idx: int, p: dict) -> str:
    abs_text = (p.get("abstract") or "")[:ABS_TRUNC]
    abs_part = f"\n摘要: {abs_text}" if abs_text else "\n（无摘要）"
    return f"[p{idx}] 期刊={p.get('journal_abbr')} 标题: {p.get('title')}{abs_part}"


def score_one_batch(client: MiniMaxClient, papers: list[dict]) -> tuple[list[dict], dict, str]:
    """返回 (scores, usage, raw_text)。papers 是 dict 列表（避免 ORM 跨线程懒加载）。失败抛异常。"""
    body = "\n\n".join(fmt_paper_dict(i + 1, p) for i, p in enumerate(papers))
    user = USER_TEMPLATE.format(n=len(papers), papers=body)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
    # M2.7 推理 ~1500 + 每篇输出 ~80 字符 ≈ 100 token，留 1.5 倍冗余
    max_tok = 2500 + 200 * len(papers)
    data = client.chat(messages, max_tokens=max_tok, temperature=0.0)
    usage = client.usage(data)
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = extract_json(text) or []
    return parsed, usage, text


# 全局统计（受锁保护）
stats_lock = threading.Lock()
total_in = total_out = total_reason = 0
n_done_papers = 0
n_ok = n_fail = 0


def process_batch(client: MiniMaxClient, batch_idx: int, batch: list[dict]) -> list[tuple]:
    """worker：跑一个 batch（输入纯 dict 避免 ORM 跨线程问题）。
    返回需写库的 (paper_id, score_data 或 None/error) 列表。"""
    global total_in, total_out, total_reason, n_done_papers, n_ok, n_fail
    try:
        scores, usage, raw_text = score_one_batch(client, batch)
    except Exception as e:
        return [(p["id"], {"error": str(e)[:200]}) for p in batch]

    with stats_lock:
        total_in += usage.get("prompt_tokens", 0)
        total_out += usage.get("completion_tokens", 0)
        total_reason += (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)

    score_by_idx = {}
    for s in scores:
        sid = str(s.get("id", "")).lower().lstrip("p")
        try:
            idx = int(sid) - 1
            score_by_idx[idx] = s
        except (ValueError, TypeError):
            continue

    if len(score_by_idx) < len(batch) // 2:
        print(f"  ! batch_idx={batch_idx} 仅解析 {len(score_by_idx)}/{len(batch)} raw[:300]: {raw_text[:300]!r}")

    out = []
    for i, p in enumerate(batch):
        s = score_by_idx.get(i)
        if s is None:
            out.append((p["id"], None))
        else:
            out.append((p["id"], {
                "ai": float(s.get("ai", 0) or 0),
                "domain": float(s.get("domain", 0) or 0),
                "reason": (s.get("reason") or "")[:200],
            }))
    return out


def run(limit: int = None, batch_size: int = BATCH_SIZE, n_workers: int = N_WORKERS):
    global total_in, total_out, total_reason, n_done_papers, n_ok, n_fail
    session = get_session(DB_PATH)
    client = MiniMaxClient()
    try:
        scored_ids = set(session.execute(select(PaperScore.paper_id)).scalars().all())
        # 用 SQL 直接查需要字段，转成纯 dict 列表（避免跨线程 ORM 问题）
        from sqlalchemy import text
        rows = session.execute(text(
            "SELECT id, title, abstract, journal_abbr FROM papers"
        )).all()
        todo = [
            {"id": r[0], "title": r[1], "abstract": r[2], "journal_abbr": r[3]}
            for r in rows if r[0] not in scored_ids
        ]
        if limit:
            todo = todo[:limit]
        print(f"待打分: {len(todo)} 篇 (batch={batch_size}, workers={n_workers})")

        # 切分 batches（每个元素是 dict）
        batches = [todo[i : i + batch_size] for i in range(0, len(todo), batch_size)]
        print(f"共 {len(batches)} 个 batch")

        t0 = time.time()
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            future_to_idx = {pool.submit(process_batch, client, i, b): i for i, b in enumerate(batches)}
            for fut in as_completed(future_to_idx):
                results = fut.result()
                # 主线程写库
                for paper_id, score_data in results:
                    if score_data is None:
                        # 漏返回 - 标记失败
                        if not session.get(PaperScore, paper_id):
                            session.add(PaperScore(
                                paper_id=paper_id, scored_at=datetime.utcnow(),
                                model_used=client.model, rationale="LLM 漏返回该条",
                            ))
                        with stats_lock:
                            n_fail += 1
                            n_done_papers += 1
                    elif "error" in score_data:
                        if not session.get(PaperScore, paper_id):
                            session.add(PaperScore(
                                paper_id=paper_id, scored_at=datetime.utcnow(),
                                model_used=client.model, rationale=f"ERROR: {score_data['error']}",
                            ))
                    else:
                        ps = session.get(PaperScore, paper_id)
                        if ps:
                            ps.ai_relevance = score_data["ai"]
                            ps.domain_relevance = score_data["domain"]
                            ps.rationale = score_data["reason"]
                            ps.model_used = client.model
                            ps.scored_at = datetime.utcnow()
                        else:
                            session.add(PaperScore(
                                paper_id=paper_id,
                                ai_relevance=score_data["ai"],
                                domain_relevance=score_data["domain"],
                                rationale=score_data["reason"],
                                model_used=client.model,
                                scored_at=datetime.utcnow(),
                            ))
                        with stats_lock:
                            n_ok += 1
                            n_done_papers += 1
                session.commit()

                elapsed = time.time() - t0
                pct = n_done_papers * 100 // max(len(todo), 1)
                rate = n_done_papers / max(elapsed, 1)
                eta = (len(todo) - n_done_papers) / max(rate, 0.01)
                print(f"  [{n_done_papers}/{len(todo)} {pct}%] ok={n_ok} fail={n_fail} "
                      f"in={total_in} out={total_out} reason={total_reason} "
                      f"elapsed={elapsed:.0f}s ETA={eta:.0f}s")

        print(f"\n完成: 成功 {n_ok} / 失败 {n_fail} / 用时 {(time.time()-t0)/60:.1f} 分钟")
        cost_cny = total_in / 1e6 * 1.2 + total_out / 1e6 * 8
        print(f"Token: in={total_in} out={total_out} (reasoning={total_reason})")
        print(f"估算成本: ¥{cost_cny:.2f}")
    finally:
        session.close()
        client.close()


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--batch", type=int, default=BATCH_SIZE)
    p.add_argument("--workers", type=int, default=N_WORKERS)
    args = p.parse_args()
    run(limit=args.limit, batch_size=args.batch, n_workers=args.workers)
