"use client";

import { useEffect, useMemo, useState } from "react";

type Gap = {
  journal: string;
  year: number;
  volume: string | null;
  issue: string | null;
  crossref: number;
  openalex: number;
  notes: string | null;
};

type Meta = { journals: { abbr: string; name_en: string; papers_indexed: number; papers_ai_relevant: number; publisher_toc: string }[] };

export default function CoveragePage() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<"all" | "suspicious">("all");
  const [journal, setJournal] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/coverage.json").then((r) => r.json()),
      fetch("/data/meta.json").then((r) => r.json()),
    ]).then(([g, m]) => {
      setGaps(g);
      setMeta(m);
    });
  }, []);

  const view = useMemo(() => {
    let v = gaps;
    if (filter === "suspicious") v = v.filter((g) => g.notes);
    if (journal) v = v.filter((g) => g.journal === journal);
    return v;
  }, [gaps, filter, journal]);

  if (!meta) return <div className="text-stone-500 text-sm py-20 text-center">加载中…</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">覆盖率审计</h1>
      <p className="text-sm text-stone-600 mb-4">
        每本期刊 × 年 × 卷 × 期对账双源抓取结果。<span className="text-amber-700">notes 列</span>标记可疑期。
      </p>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-6">
        {meta.journals.map((j) => (
          <button
            key={j.abbr}
            onClick={() => setJournal(journal === j.abbr ? null : j.abbr)}
            className={`text-left p-2 border rounded text-xs ${journal === j.abbr ? "border-accent bg-accent/5" : "border-stone-200 bg-white hover:border-accent/50"}`}
          >
            <div className="font-mono font-semibold">{j.abbr}</div>
            <div className="text-stone-500 truncate">{j.name_en}</div>
            <div className="mt-1 flex justify-between">
              <span>共 {j.papers_indexed}</span>
              <span className="text-accent">AI {j.papers_ai_relevant}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3 text-sm">
        <button
          onClick={() => setFilter(filter === "all" ? "suspicious" : "all")}
          className={`chip ${filter === "suspicious" ? "chip-on" : ""}`}
        >
          仅显示可疑
        </button>
        {journal && (
          <button onClick={() => setJournal(null)} className="text-stone-500 underline text-xs">
            清除期刊筛选
          </button>
        )}
        <span className="text-xs text-stone-500">{view.length} 行</span>
      </div>

      <div className="overflow-x-auto thin-scroll border border-stone-200 rounded bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2">期刊</th>
              <th className="text-left px-3 py-2">年</th>
              <th className="text-left px-3 py-2">Vol</th>
              <th className="text-left px-3 py-2">Issue</th>
              <th className="text-right px-3 py-2">Crossref</th>
              <th className="text-right px-3 py-2">OpenAlex</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {view.slice(0, 500).map((g, i) => (
              <tr key={i} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-3 py-1.5 font-mono text-xs">{g.journal}</td>
                <td className="px-3 py-1.5">{g.year || "-"}</td>
                <td className="px-3 py-1.5">{g.volume || "-"}</td>
                <td className="px-3 py-1.5">{g.issue || "-"}</td>
                <td className="px-3 py-1.5 text-right font-mono">{g.crossref}</td>
                <td className="px-3 py-1.5 text-right font-mono">{g.openalex}</td>
                <td className="px-3 py-1.5 text-xs text-amber-700">{g.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length > 500 && (
        <div className="text-center text-stone-400 text-xs py-3">仅展示前 500 行 · 用筛选缩小范围</div>
      )}
    </div>
  );
}
