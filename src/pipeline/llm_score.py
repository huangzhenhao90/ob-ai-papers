"""
LLM 双打分：AI 相关性 + 领域相关性 (0-5)，批量 10 篇/次。

策略：
- 输入：title + (abstract 截前 800 字) + journal_abbr
- 输出：[{id, ai, domain, reason}, ...]
- 写入 paper_scores 表
- 失败重试 3 次，仍失败则把该批拆成单篇兜底

成本控制：
- M2.7 单次推理约 1500 tokens 固定开销
- 批量 10 篇分摊后，单篇成本降到 1/10 左右
"""

import os
import sys
import json
import time
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv
from sqlalchemy import select, func

from src.db.schema import get_session, Paper, PaperScore
from src.llm.client import MiniMaxClient, extract_json

load_dotenv()
DB_PATH = os.getenv("DB_PATH", "./data/papers.db")

BATCH_SIZE = 10
ABS_TRUNC = 800

SYSTEM_PROMPT = """你是一名学术论文相关性评判专家。任务：对一批组织行为学/营销学/管理学顶刊论文，
判断每篇与 (1) AI 议题、(2) OB/营销/管理领域 的相关性。

打分标准（0-5）：
- ai_relevance:
  5 = 论文核心议题就是 AI / GenAI / LLM / 算法决策（如 ChatGPT、AI 招聘、算法管理）
  4 = AI 是主要变量之一（如「AI 辅助下的团队决策」）
  3 = 论文实质涉及 AI，但 AI 不是中心（如「在 AI 时代重思…」）
  2 = 仅在引言/讨论中提及 AI 作为背景
  1 = 字面提到 algorithm/automation 但与 AI 无关
  0 = 完全无关

- domain_relevance:
  5 = 核心 OB/管理/营销研究
  4 = 强相关（消费者行为、领导力、HR 等）
  3 = 边缘相关（如组织经济学、信息系统中的人因）
  2 = 弱相关
  0-1 = 无关

输出格式（严格 JSON 数组，无任何额外文字）：
[{"id": "p1", "ai": 5, "domain": 5, "reason": "ChatGPT 对团队决策的影响"}, ...]
"""

USER_TEMPLATE = """请评分以下 {n} 篇论文：

{papers}

只输出 JSON 数组，每篇一个对象：[{{"id": "...", "ai": 0-5, "domain": 0-5, "reason": "≤30字"}}]"""


def fmt_paper(idx: int, p: Paper) -> str:
    abs_text = (p.abstract or "")[:ABS_TRUNC]
    abs_part = f"\n摘要: {abs_text}" if abs_text else "\n（无摘要）"
    return f"[p{idx}] 期刊={p.journal_abbr} 标题: {p.title}{abs_part}"


def score_batch(client: MiniMaxClient, papers: list[Paper]) -> list[dict]:
    """返回 [{id_idx, ai, domain, reason}, ...]，索引对应 papers 列表位置。"""
    body = "\n\n".join(fmt_paper(i + 1, p) for i, p in enumerate(papers))
    user = USER_TEMPLATE.format(n=len(papers), papers=body)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
    # M2.7 推理可能很长，给足空间：基础 1200 + 每篇 100
    max_tok = 1500 + 120 * len(papers)
    data = client.chat(messages, max_tokens=max_tok, temperature=0.0)
    usage = client.usage(data)
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    parsed = extract_json(text)
    return parsed or [], usage


def run(limit: int = None, batch_size: int = BATCH_SIZE):
    session = get_session(DB_PATH)
    client = MiniMaxClient()
    try:
        # 选未打分的论文
        scored_ids = set(session.execute(select(PaperScore.paper_id)).scalars().all())
        all_papers = session.execute(select(Paper)).scalars().all()
        todo = [p for p in all_papers if p.id not in scored_ids]
        if limit:
            todo = todo[:limit]
        print(f"待打分: {len(todo)} 篇 (batch={batch_size})")

        total_in = total_out = total_reason = 0
        n_ok = n_fail = 0
        t0 = time.time()

        for batch_start in range(0, len(todo), batch_size):
            batch = todo[batch_start : batch_start + batch_size]
            try:
                scores, usage = score_batch(client, batch)
            except Exception as e:
                print(f"  ! batch {batch_start}: {e}")
                # 标记失败，跳过；后续可单篇重跑
                for p in batch:
                    if not session.get(PaperScore, p.id):
                        session.add(PaperScore(
                            paper_id=p.id,
                            ai_relevance=None, domain_relevance=None,
                            scored_at=datetime.utcnow(),
                            model_used=client.model,
                            rationale=f"ERROR: {str(e)[:200]}",
                        ))
                n_fail += len(batch)
                session.commit()
                continue

            total_in += usage.get("prompt_tokens", 0)
            total_out += usage.get("completion_tokens", 0)
            total_reason += (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)

            # scores 是 list of dict; 按位置对齐 papers (兼容 LLM 漏掉某条)
            score_by_idx = {}
            for s in scores:
                # id 形如 "p3"
                sid = str(s.get("id", "")).lower().lstrip("p")
                try:
                    idx = int(sid) - 1
                    score_by_idx[idx] = s
                except ValueError:
                    continue

            for i, p in enumerate(batch):
                s = score_by_idx.get(i)
                if s is None:
                    n_fail += 1
                    if not session.get(PaperScore, p.id):
                        session.add(PaperScore(
                            paper_id=p.id, ai_relevance=None, domain_relevance=None,
                            scored_at=datetime.utcnow(), model_used=client.model,
                            rationale="LLM 漏返回该条",
                        ))
                    continue
                ai = float(s.get("ai", 0))
                dom = float(s.get("domain", 0))
                reason = (s.get("reason") or "")[:200]

                ps = session.get(PaperScore, p.id)
                if ps:
                    ps.ai_relevance = ai
                    ps.domain_relevance = dom
                    ps.rationale = reason
                    ps.model_used = client.model
                    ps.scored_at = datetime.utcnow()
                else:
                    session.add(PaperScore(
                        paper_id=p.id,
                        ai_relevance=ai,
                        domain_relevance=dom,
                        rationale=reason,
                        model_used=client.model,
                        scored_at=datetime.utcnow(),
                    ))
                n_ok += 1
            session.commit()

            # 进度
            elapsed = time.time() - t0
            done = batch_start + batch_size
            print(f"  [{min(done, len(todo))}/{len(todo)}] in={total_in} out={total_out} (reason={total_reason}) elapsed={elapsed:.0f}s")

        print(f"\n完成: 成功 {n_ok} / 失败 {n_fail}")
        print(f"Token: prompt={total_in} completion={total_out} (reasoning={total_reason})")
        # 粗估成本（按 ¥1.2/M in + ¥8/M out）
        cost_cny = total_in / 1e6 * 1.2 + total_out / 1e6 * 8
        print(f"估算成本: ¥{cost_cny:.2f}")
    finally:
        session.close()
        client.close()


def report():
    session = get_session(DB_PATH)
    try:
        from collections import Counter
        scores = session.execute(select(PaperScore)).scalars().all()
        total = len(scores)
        ok = [s for s in scores if s.ai_relevance is not None]
        print(f"\n=== 打分汇总 ===")
        print(f"已打分: {total} (成功 {len(ok)}, 失败 {total - len(ok)})")
        if not ok:
            return
        ai_dist = Counter(int(s.ai_relevance) for s in ok)
        dom_dist = Counter(int(s.domain_relevance) for s in ok)
        print(f"\nAI 相关性分布:")
        for k in sorted(ai_dist):
            print(f"  {k}: {ai_dist[k]:>5}")
        print(f"\n领域相关性分布:")
        for k in sorted(dom_dist):
            print(f"  {k}: {dom_dist[k]:>5}")
        # 双 ≥3 的总数（默认展示阈值）
        both = sum(1 for s in ok if (s.ai_relevance or 0) >= 3 and (s.domain_relevance or 0) >= 3)
        print(f"\n双 ≥3 (AI 相关 + 领域相关): {both} 篇")
    finally:
        session.close()


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["run", "report"])
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--batch", type=int, default=BATCH_SIZE)
    args = p.parse_args()
    if args.cmd == "run":
        run(limit=args.limit, batch_size=args.batch)
    else:
        report()
