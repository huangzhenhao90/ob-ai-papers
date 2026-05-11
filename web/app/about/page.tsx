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

type Meta = {
  totals: { papers_indexed: number; papers_scored: number; papers_ai_relevant: number };
  generated_at: string;
  journals: { abbr: string; name_en: string; name_zh: string; publisher: string; tier: string; lang: string; papers_indexed: number; papers_ai_relevant: number; publisher_toc: string }[];
};

export default function AboutPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [showSuspicious, setShowSuspicious] = useState(false);
  const [showJournalRows, setShowJournalRows] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/meta.json").then((r) => r.json()),
      fetch("/data/coverage.json").then((r) => r.json()),
    ]).then(([m, g]) => { setMeta(m); setGaps(g); });
  }, []);

  const filteredGaps = useMemo(() => {
    let v = gaps;
    if (showSuspicious) v = v.filter((g) => g.notes);
    if (showJournalRows) v = v.filter((g) => g.journal === showJournalRows);
    return v;
  }, [gaps, showSuspicious, showJournalRows]);

  if (!meta) return <div className="text-stone-500 text-sm py-20 text-center">加载中…</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* 项目说明 */}
      <section>
        <h1 className="text-2xl font-semibold mb-4">关于这个项目</h1>
        <p className="text-sm leading-relaxed text-stone-700">
          聚合 2023-01 至今 32 本组织行为学 / 营销学 / 管理学 / 心理学顶刊
          及 arXiv 8 个分类中
          <strong className="text-accent"> 与 AI（尤其 GenAI / LLM）相关 </strong>
          的论文，用 LLM 自动生成中文 TL;DR、主题标签和 AI 类型标签。
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Stat n={meta.totals.papers_indexed} label="数据库总论文" />
          <Stat n={meta.totals.papers_ai_relevant} label="AI 相关（双≥3）" />
          <Stat n={meta.journals.length} label="覆盖刊物 / 来源" />
        </div>
        <p className="text-xs text-stone-400 mt-2">
          数据更新时间：{new Date(meta.generated_at).toLocaleString("zh-CN")} · 每天 UTC 02:00 自动增量
        </p>
      </section>

      {/* 数据流水线 */}
      <section>
        <h2 className="text-base font-semibold mb-3">数据流水线</h2>
        <ol className="text-sm space-y-1 list-decimal pl-5 text-stone-700">
          <li><strong>抓取</strong>：每本期刊从 OpenAlex 和 Crossref 双源全量抓取（不用关键词作召回闸门）；arXiv 用 OB 强信号词预过滤</li>
          <li><strong>规范化 + 去重</strong>：DOI 优先；无 DOI 用 标题+作者+年份+卷期 指纹</li>
          <li><strong>覆盖率审计</strong>：每期对账双源数字（见下方表）</li>
          <li><strong>LLM 双打分</strong>：MiniMax-M2.5-lightning，对每篇论文给 AI 相关性 (0-5) 和领域相关性 (0-5)</li>
          <li><strong>TL;DR + 标签</strong>：仅对双 ≥ 3 的论文生成 200 字中文摘要 + 标签</li>
          <li><strong>标题翻译</strong>：双≥3 的论文标题全部预翻译为中文</li>
        </ol>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-2">为什么不用关键词作召回闸门</h2>
        <p className="text-sm leading-relaxed text-stone-700">
          AI 议题的措辞每年都在变（2023「ChatGPT」→ 2024「GenAI」→ 2025「Agent」）。
          如果用关键词作召回闸门，会漏掉那些措辞不直白但实质相关的论文。
          所以本项目对期刊采用「<strong>全量入库 → LLM 后置判定</strong>」策略。
          arXiv 是例外——总量太大，只能用 OB/营销 强信号词预过滤后再 LLM 复判。
        </p>
      </section>

      {/* 覆盖率审计 */}
      <section>
        <h2 className="text-base font-semibold mb-2">期刊覆盖率审计</h2>
        <p className="text-sm text-stone-600 mb-4">
          每本期刊×年×卷×期对账双源抓取结果。<span className="text-amber-700">有 notes 的</span>是可疑期，需人工核查。
          点击期刊卡片可查看具体某期的对账数字。
        </p>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-6">
          {meta.journals.map((j) => (
            <button
              key={j.abbr}
              onClick={() => setShowJournalRows(showJournalRows === j.abbr ? null : j.abbr)}
              className={`text-left p-2 border rounded text-xs ${
                showJournalRows === j.abbr ? "border-accent bg-accent/5" : "border-stone-200 bg-white hover:border-accent/50"
              }`}
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
            onClick={() => setShowSuspicious(!showSuspicious)}
            className={`chip ${showSuspicious ? "chip-on" : ""}`}
          >
            仅显示可疑期
          </button>
          {showJournalRows && (
            <button onClick={() => setShowJournalRows(null)} className="text-stone-500 underline text-xs">
              清除期刊筛选
            </button>
          )}
          <span className="text-xs text-stone-500">{filteredGaps.length} 行</span>
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
              {filteredGaps.slice(0, 500).map((g, i) => (
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
        {filteredGaps.length > 500 && (
          <div className="text-center text-stone-400 text-xs py-3">仅显示前 500 行</div>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-2">已知局限</h2>
        <ul className="text-sm space-y-1 list-disc pl-5 text-stone-700">
          <li>约 18% 论文摘要缺失（出版商未向 OpenAlex/Crossref 开放 abstract feed），LLM 仅能根据标题打分</li>
          <li>OpenAlex 对 AOM 系列期刊收录不全，但 Crossref 兜住了</li>
          <li>中文期刊（管理世界、心理学报等）暂未接入</li>
          <li>每天 UTC 02:00 自动跑增量，但 LLM 安全阀（默认 500 篇）防止 cache miss 时烧钱</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="border border-stone-200 rounded p-3 bg-white">
      <div className="text-2xl font-mono font-semibold">{n.toLocaleString()}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
    </div>
  );
}
