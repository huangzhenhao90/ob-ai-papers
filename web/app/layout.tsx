import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "OB × AI Papers — 组织行为学 / 营销学 AI 论文索引",
  description: "聚合 2023 至今 OB / 营销 / 管理顶刊中与 AI 相关的论文，含中文 TL;DR、主题标签与覆盖率审计。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-mono font-semibold tracking-tight">
              OB × AI <span className="text-accent">Papers</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-accent">全部论文</Link>
              <Link href="/recent" className="hover:text-accent">本周新增</Link>
              <Link href="/about" className="hover:text-accent">关于</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        <footer className="max-w-6xl mx-auto px-4 py-8 text-xs text-stone-500 border-t border-stone-200 mt-10">
          数据来源：OpenAlex + Crossref · LLM：MiniMax-M2.5-lightning ·
          构建：<span className="font-mono">ob-ai-papers</span>
        </footer>
      </body>
    </html>
  );
}
