export default function AboutPage() {
  return (
    <div className="prose prose-stone max-w-3xl">
      <h1 className="text-xl font-semibold mb-4">关于这个项目</h1>

      <h2 className="text-base font-semibold mt-6 mb-2">这是什么</h2>
      <p className="text-sm leading-relaxed text-stone-700">
        聚合 2023-01 至今 32 本组织行为学 / 营销学 / 管理学 / 心理学顶刊中
        <strong className="text-accent"> 与 AI（尤其 GenAI / LLM）相关</strong>
        的论文，并用 LLM 自动生成中文 TL;DR、主题标签和 AI 类型标签。
      </p>

      <h2 className="text-base font-semibold mt-6 mb-2">数据流水线</h2>
      <ol className="text-sm space-y-1 list-decimal pl-5 text-stone-700">
        <li><strong>抓取</strong>：每本期刊从 OpenAlex 和 Crossref 双源全量抓取（不用关键词作召回闸门）</li>
        <li><strong>规范化 + 去重</strong>：DOI 优先；无 DOI 用 标题+作者+年份+卷期 指纹</li>
        <li><strong>覆盖率审计</strong>：每期对账双源数字，可疑期标记到 <a href="/coverage" className="text-accent">覆盖率页</a></li>
        <li><strong>LLM 双打分</strong>：MiniMax-M2.5-lightning，对每篇论文给 AI 相关性 (0-5) 和领域相关性 (0-5)</li>
        <li><strong>TL;DR 生成</strong>：仅对双 ≥ 3 的论文生成 200 字中文摘要 + 标签</li>
      </ol>

      <h2 className="text-base font-semibold mt-6 mb-2">为什么不用关键词过滤</h2>
      <p className="text-sm leading-relaxed text-stone-700">
        AI 议题的措辞每年都在变（2023「ChatGPT」→ 2024「GenAI」→ 2025「Agent」）。
        如果用关键词作召回闸门，会漏掉那些措辞不直白但实质相关的论文。
        所以本项目采用「<strong>期刊全量入库 → LLM 后置判定</strong>」策略，宁宽勿漏。
      </p>

      <h2 className="text-base font-semibold mt-6 mb-2">已知局限</h2>
      <ul className="text-sm space-y-1 list-disc pl-5 text-stone-700">
        <li>约 18% 论文摘要缺失（出版商未向 OpenAlex/Crossref 开放 abstract feed），LLM 仅能根据标题打分</li>
        <li>OpenAlex 对 AOM 系列期刊收录不全，但 Crossref 兜住了</li>
        <li>中文期刊（管理世界、心理学报等）暂未接入</li>
        <li>arXiv 暂未接入</li>
      </ul>

      <h2 className="text-base font-semibold mt-6 mb-2">期刊清单</h2>
      <p className="text-sm text-stone-700">
        英文 26 本（OB / 管理 15 + 营销 6 + 强相关 5）+ 中文 6 本（管理世界、管理科学学报、南开管理评论、营销科学学报、心理学报、心理科学进展）。
        详见 <a href="/coverage" className="text-accent">覆盖率页</a> 顶部期刊网格。
      </p>
    </div>
  );
}
