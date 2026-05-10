"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Paper = {
  id: number;
  doi: string | null;
  title: string;
  journal: string | null;
  year: number | null;
  date: string | null;
  authors: string[];
  url: string | null;
  pdf_url: string | null;
  cited_by: number;
  ai_score: number;
  domain_score: number;
  ai_reason: string;
  tldr: string | null;
  topic_tags: string[];
  ai_type_tags: string[];
};

type Meta = {
  totals: { papers_indexed: number; papers_scored: number; papers_ai_relevant: number };
  facets: {
    years: Record<string, number>;
    journals: Record<string, number>;
    topic_tags: Record<string, number>;
    ai_type_tags: Record<string, number>;
  };
  generated_at: string;
};

export default function HomePage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  // 筛选状态
  const [q, setQ] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [journal, setJournal] = useState<string | null>(null);
  const [topicTag, setTopicTag] = useState<string | null>(null);
  const [aiType, setAiType] = useState<string | null>(null);
  const [minAi, setMinAi] = useState(3);
  const [sort, setSort] = useState<"recent" | "ai_score" | "cited">("recent");

  useEffect(() => {
    Promise.all([
      fetch("/data/papers.json").then((r) => r.json()),
      fetch("/data/meta.json").then((r) => r.json()),
    ]).then(([p, m]) => {
      setPapers(p);
      setMeta(m);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let res = papers;
    if (year) res = res.filter((p) => p.year === year);
    if (journal) res = res.filter((p) => p.journal === journal);
    if (topicTag) res = res.filter((p) => p.topic_tags?.includes(topicTag));
    if (aiType) res = res.filter((p) => p.ai_type_tags?.includes(aiType));
    if (minAi > 3) res = res.filter((p) => p.ai_score >= minAi);
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      res = res.filter(
        (p) =>
          p.title?.toLowerCase().includes(qq) ||
          p.tldr?.toLowerCase().includes(qq) ||
          p.authors?.some((a) => a?.toLowerCase().includes(qq)) ||
          p.topic_tags?.some((t) => t.includes(qq)) ||
          p.ai_type_tags?.some((t) => t.includes(qq))
      );
    }
    if (sort === "ai_score") res = [...res].sort((a, b) => b.ai_score - a.ai_score);
    else if (sort === "cited") res = [...res].sort((a, b) => b.cited_by - a.cited_by);
    return res;
  }, [papers, q, year, journal, topicTag, aiType, minAi, sort]);

  if (loading) return <div className="text-stone-500 text-sm py-20 text-center">加载中…</div>;

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-6">
      {/* 侧边栏 */}
      <aside className="space-y-4 text-sm">
        <Stats meta={meta!} filteredCount={filtered.length} />

        <FilterGroup label="年份">
          <FilterChips
            items={Object.entries(meta!.facets.years).reverse()}
            active={year ? String(year) : null}
            onPick={(v) => setYear(v ? Number(v) : null)}
          />
        </FilterGroup>

        <FilterGroup label="期刊 (前 12)">
          <FilterChips
            items={Object.entries(meta!.facets.journals).slice(0, 12)}
            active={journal}
            onPick={(v) => setJournal(v)}
          />
        </FilterGroup>

        <FilterGroup label="主题">
          <FilterChips
            items={Object.entries(meta!.facets.topic_tags).slice(0, 20)}
            active={topicTag}
            onPick={setTopicTag}
          />
        </FilterGroup>

        <FilterGroup label="AI 类型">
          <FilterChips
            items={Object.entries(meta!.facets.ai_type_tags).slice(0, 14)}
            active={aiType}
            onPick={setAiType}
          />
        </FilterGroup>

        <FilterGroup label="AI 相关性 ≥">
          <div className="flex gap-2">
            {[3, 4, 5].map((v) => (
              <button
                key={v}
                onClick={() => setMinAi(v)}
                className={`chip ${minAi === v ? "chip-on" : ""}`}
              >
                {v}
              </button>
            ))}
          </div>
        </FilterGroup>
      </aside>

      {/* 主区 */}
      <section>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、摘要、作者、标签…"
            className="w-full md:w-80 px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-stone-500">排序</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="px-2 py-1 border border-stone-300 rounded bg-white"
            >
              <option value="recent">最新</option>
              <option value="ai_score">AI 分数</option>
              <option value="cited">引用数</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-stone-500 mb-3">
          {filtered.length} 篇 · 已默认过滤 AI≥3 且 OB/营销/管理 ≥3
        </div>

        <ul className="space-y-3">
          {filtered.slice(0, 200).map((p) => (
            <PaperCard key={p.id} p={p} />
          ))}
        </ul>
        {filtered.length > 200 && (
          <div className="text-center text-stone-400 text-xs py-4">
            仅展示前 200 条 · 通过筛选缩小范围
          </div>
        )}
      </section>
    </div>
  );
}

function Stats({ meta, filteredCount }: { meta: Meta; filteredCount: number }) {
  return (
    <div className="border border-stone-200 rounded p-3 bg-white">
      <div className="text-xs text-stone-500 mb-1">数据范围</div>
      <div className="text-2xl font-mono font-semibold">{filteredCount}</div>
      <div className="text-xs text-stone-500 mt-1">
        当前筛选 / 共 {meta.totals.papers_ai_relevant} 篇 AI 相关 / 数据库 {meta.totals.papers_indexed} 篇
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-stone-500 mb-1.5 font-medium">{label}</div>
      {children}
    </div>
  );
}

function FilterChips({
  items, active, onPick,
}: {
  items: [string, number][];
  active: string | null;
  onPick: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([name, n]) => {
        const on = active === name;
        return (
          <button
            key={name}
            onClick={() => onPick(on ? null : name)}
            className={`chip ${on ? "chip-on" : ""}`}
          >
            {name}
            <span className="ml-1 text-[10px] opacity-60">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function PaperCard({ p }: { p: Paper }) {
  return (
    <li className="border border-stone-200 rounded p-3 bg-white hover:border-accent transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 flex flex-col items-center text-center w-12">
          <div className="text-xs text-stone-400">AI</div>
          <div className="font-mono font-semibold text-accent">{p.ai_score?.toFixed(0)}</div>
          <div className="text-[10px] text-stone-400 mt-1">引用</div>
          <div className="font-mono text-xs">{p.cited_by}</div>
        </div>
        <div className="flex-1 min-w-0">
          <Link href={`/papers/${p.id}`} className="block">
            <h3 className="font-medium leading-snug hover:text-accent">{p.title}</h3>
          </Link>
          <div className="text-xs text-stone-500 mt-0.5">
            <span className="font-mono">{p.journal}</span>
            {p.year ? <> · {p.year}</> : null}
            {p.authors?.length ? <> · {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " 等" : ""}</> : null}
          </div>
          {p.tldr && (
            <p className="text-sm text-stone-700 mt-2 leading-relaxed">{p.tldr}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {p.topic_tags?.slice(0, 5).map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
            {p.ai_type_tags?.slice(0, 3).map((t) => (
              <span key={"ai-" + t} className="chip border-accent/40 text-accent">{t}</span>
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-xs">
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener" className="text-accent hover:underline">
                原文 ↗
              </a>
            )}
            {p.pdf_url && (
              <a href={p.pdf_url} target="_blank" rel="noopener" className="text-accent hover:underline">
                PDF ↗
              </a>
            )}
            {p.doi && (
              <span className="text-stone-400 font-mono">{p.doi}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
