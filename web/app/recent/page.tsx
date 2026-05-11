"use client";

import { useEffect, useState } from "react";
import PaperList, { type Paper } from "@/components/PaperList";

const DAYS = 7;

export default function RecentPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/data/papers.json").then((r) => r.json()),
      fetch("/data/meta.json").then((r) => r.json()),
    ]).then(([all, m]: [Paper[], any]) => {
      // 取近 N 天（按论文 pub_date 实际发表日期）
      const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
      const sinceStr = since.toISOString().slice(0, 10);
      const recent = all.filter((p) => p.date && p.date >= sinceStr);
      setPapers(recent);
      setMeta(m);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-stone-500 text-sm py-20 text-center">加载中…</div>;

  return (
    <PaperList
      papers={papers}
      meta={meta}
      title={`近 ${DAYS} 天新增`}
      subtitle="按论文实际发表日期"
    />
  );
}
