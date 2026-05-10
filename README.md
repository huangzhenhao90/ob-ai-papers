# OB-AI-Papers

聚合 2023-01 至今组织行为学 / 营销学 / 中文管理与心理学顶刊中**与 AI（尤其 GenAI/LLM）相关**的论文。

## 范围

- **32 本白名单期刊**（英文 OB/管理 15 + 营销 6 + 强相关 5 + 中文 6）
- **arXiv** 8 个分类（cs.AI, cs.CL, cs.LG, cs.HC, cs.CY, cs.SI, stat.ML, econ.GN）
- 时间窗：2023-01-01 至今
- 召回原则：**期刊全量入库 → 后置 AI 相关性判定**（关键词不作召回闸门）

## 架构

```
GitHub Actions cron
  ↓ Source Registry (config/journals.yaml)
  ↓ Connectors (crossref / openalex / arxiv-oai / cnki-import / wanfang / nssd / publisher-toc)
  ↓ raw_records (永不删)
  ↓ normalizer → deduper → coverage_auditor
  ↓ enrichment_queue (摘要/引用/OA/PDF 补全)
  ↓ llm_queue (Claude Haiku 4.5: 双打分 + TL;DR + 标签)
  ↓ publish_index → Next.js 前端
```

## 目录结构

```
ob-ai-papers/
├── config/              # journals.yaml, keywords.yaml
├── src/
│   ├── connectors/      # crossref, openalex, arxiv, wanfang, nssd, publisher_toc, cnki_ris
│   ├── pipeline/        # normalize, dedupe, coverage_audit, enrich, llm_score
│   ├── db/              # schema, migrations
│   ├── llm/             # Claude client, prompts
│   └── utils/           # 通用工具
├── data/
│   ├── raw/             # 原始 API 响应（JSON）
│   ├── cnki_imports/    # 用户手动导出的 RIS/Endnote 文件
│   └── exports/         # 数据库导出（不入 git）
├── scripts/             # 一次性脚本
├── web/                 # Next.js 前端
├── docs/
└── logs/
```

## 状态

P0 基建中。
