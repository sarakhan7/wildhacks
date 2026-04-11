"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAudit } from "@/context/AuditContext";
import { ArrowLeft, Download, FileCheck, CheckCircle2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";

export default function ReportViewer() {
  const router = useRouter();
  const { reportMarkdown, buildingInfo } = useAudit();

  useEffect(() => {
    if (!reportMarkdown && typeof window !== "undefined") {
      router.push("/audit");
    }
  }, [reportMarkdown, router]);

  if (!reportMarkdown) return null;

  // Simple markdown parser for MVP (in a real app, use react-markdown)
  const renderMarkdown = (md: string) => {
    // Basic replacements for HTML rendering
    let html = md
      .replace(/^### (.*$)/gim, '<h3 class="text-2xl font-semibold mt-8 mb-4 font-heading text-white">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-3xl font-bold mt-12 mb-6 font-heading text-[var(--accent-cyan)]">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-4xl font-black mt-8 mb-6 font-heading text-[var(--accent-green)]">$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold text-white">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em class="italic text-[var(--text-primary)]">$1</em>')
      .replace(/^\- (.*$)/gim, '<li class="ml-6 list-disc mb-2 leading-relaxed text-[#cbd5e1]">$1</li>')
      .replace(/<li.*?>[\s\S]*?<\/li>/gi, match => `<ul>${match}</ul>`) // Group lists (hacky but works for MVP)
      .replace(/\n\n/g, '<p class="mb-4 leading-relaxed text-[#cbd5e1]"></p>')
      .replace(/\n/g, '<br />');

    // Clean up grouped lists from the regex hack
    html = html.replace(/<\/ul><br \/><ul>/g, '');

    return { __html: html };
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 bg-[var(--bg-primary)] py-8 px-6 print:py-0 print:px-0">
      <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center print:hidden">
        <Link href="/results" className="btn-secondary py-2 flex items-center gap-2 border-none">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <button onClick={handlePrint} className="btn-primary py-2 flex items-center gap-2">
          <Download className="w-4 h-4" /> Save as PDF
        </button>
      </div>

      <GlassCard className="max-w-4xl mx-auto p-12 print:bg-white print:text-black print:p-8 print:shadow-none print:border-none print:rounded-none bg-[#0f172a] border-[var(--border-subtle)] relative overflow-hidden">
        
        {/* Report Header */}
        <div className="border-b border-[var(--border-subtle)] print:border-gray-300 pb-8 mb-8 text-center relative z-10">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-[var(--accent-green-dim)] text-[var(--accent-green)] print:text-green-700 print:bg-green-50 mb-4">
            <FileCheck className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-heading font-black mb-2 text-white print:text-black">
            ASHRAE Level II Diagnostic Report
          </h1>
          <p className="text-lg text-[var(--text-secondary)] print:text-gray-600">
            Prepared for: <span className="font-medium text-white print:text-black">{buildingInfo.address || "Subject Property"}</span>
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-xs font-medium text-[var(--text-muted)] print:text-gray-500">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-[var(--accent-green)] print:text-green-600"/> Deterministic Statistics</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-[var(--accent-green)] print:text-green-600"/> Structured Reasoning</span>
            <span>Date: {new Date().toLocaleDateString()}</span>
          </div>
        </div>

        {/* Report Body */}
        <div 
          className="prose prose-invert prose-green max-w-none print:prose-neutral"
          dangerouslySetInnerHTML={renderMarkdown(reportMarkdown)}
        />
        
        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-[var(--border-subtle)] print:border-gray-300 text-center text-xs text-[var(--text-muted)] print:text-gray-500">
          <p>Generated automatically by AuditAI.</p>
          <p className="mt-1">This is a preliminary analysis based on provided utility data and statistical norms. A physical inspection by a licensed Professional Engineer is required for investment-grade certification.</p>
        </div>

      </GlassCard>

      {/* Print-specific styles appended directly */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body { background: white !important; color: black !important; }
          .navbar, .gradient-mesh, header { display: none !important; }
          .prose { color: black !important; }
          h1, h2, h3 { color: black !important; }
          .glass-strong, .glass { border: none !important; box-shadow: none !important; backdrop-filter: none !important; background: transparent !important; }
          .text-white { color: black !important; }
          .text-\\[\\#cbd5e1\\] { color: #333 !important; }
          ul, li { color: #333 !important; }
          padding-top: 0 !important;
        }
      `}} />
    </div>
  );
}
