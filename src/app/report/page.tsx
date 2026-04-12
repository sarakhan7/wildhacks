"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileCheck,
  TrendingDown,
} from "lucide-react";
import {
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { GlassCard } from "@/components/ui/GlassCard";
import { useAudit } from "@/context/AuditContext";

const reportSections = [
  { num: "01", label: "Executive summary" },
  { num: "02", label: "Audit narrative" },
  { num: "03", label: "Upgrade list" },
  { num: "04", label: "Financial model" },
  { num: "05", label: "Next steps" },
];

const demoReportMarkdown = `# Audit Report

## Executive Summary

350 Fifth Avenue consumes 89.4 kBtu/ft² annually, placing it in the 73rd percentile among comparable office buildings. Annual spend is approximately **$214,000**, and an estimated **$62,000 per year** is avoidable through four prioritized upgrades.

## Primary Findings

- Weather-normalized consumption suggests a persistent baseload opportunity.
- March 2022 was materially above the expected baseline and should be reviewed.
- The highest-value upgrades are HVAC optimization, roof insulation, and LED lighting.

## Recommended Actions

- Commission pricing for the top three ECMs.
- Investigate the March anomaly before the next renewal cycle.
- Use this report as the basis for a deeper field audit if capital is available.
`;

const demoPayload = {
  address: "350 Fifth Avenue, New York, NY",
  totalCost: 214000,
  siteEUI: 89.4,
  percentile: 73,
  anomaly: "March 2022 exceeded the weather-adjusted baseline by 18%.",
  markdown: demoReportMarkdown,
  upgrades: [
    {
      id: "1",
      title: "VFD on AHU-3",
      description: "Install variable frequency control and retune supply fan schedules.",
      estimated_cost_range: "$58,000 – $64,000",
      estimated_savings_usd: 28000,
      simple_payback_years: 2.1,
      npv_10y: 184000,
      implementation_complexity: "Medium" as const,
    },
    {
      id: "2",
      title: "Roof insulation",
      description: "Improve roof insulation to reduce conductive heat loss and summer gains.",
      estimated_cost_range: "$62,000 – $72,000",
      estimated_savings_usd: 18000,
      simple_payback_years: 3.4,
      npv_10y: 108000,
      implementation_complexity: "High" as const,
    },
    {
      id: "3",
      title: "LED retrofit",
      description: "Replace remaining fluorescent fixtures and add occupancy sensors.",
      estimated_cost_range: "$22,000 – $28,000",
      estimated_savings_usd: 12000,
      simple_payback_years: 1.8,
      npv_10y: 86000,
      implementation_complexity: "Low" as const,
    },
    {
      id: "4",
      title: "BMS optimization",
      description: "Tune schedules, setpoints, and sequences in the controls stack.",
      estimated_cost_range: "$8,000 – $12,000",
      estimated_savings_usd: 4000,
      simple_payback_years: 0.8,
      npv_10y: 28000,
      implementation_complexity: "Low" as const,
    },
  ],
};

export default function ReportViewer() {
  return (
    <Suspense fallback={<ReportFallback />}>
      <ReportContent />
    </Suspense>
  );
}

function ReportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";

  const { buildingInfo, reportMarkdown, analysisResults, anomalies, recommendations, auditWarnings } = useAudit();

  useEffect(() => {
    if (!isDemo && !reportMarkdown && !analysisResults && typeof window !== "undefined") {
      router.push("/audit");
    }
  }, [analysisResults, isDemo, reportMarkdown, router]);

  const activeRecommendations = isDemo
    ? demoPayload.upgrades.map((upgrade) => ({
        recommendation_id: upgrade.id,
        title: upgrade.title,
        description: upgrade.description,
        rationale: "",
        estimated_cost_range: upgrade.estimated_cost_range,
        estimated_savings_kwh: 0,
        estimated_savings_therms: 0,
        estimated_savings_usd: upgrade.estimated_savings_usd,
        simple_payback_years: upgrade.simple_payback_years,
        npv_10y: upgrade.npv_10y,
        implementation_complexity: upgrade.implementation_complexity,
        priority: 0,
        dependencies: [],
        hypothesis_ids: [],
      }))
    : recommendations;

  const address = isDemo ? demoPayload.address : buildingInfo.address;
  const percentile = isDemo ? demoPayload.percentile : Math.round(analysisResults?.peerPercentile ?? 50);
  const annualCost = isDemo ? demoPayload.totalCost : analysisResults?.totalCost ?? 0;
  const siteEUI = isDemo ? demoPayload.siteEUI : analysisResults?.siteEUI ?? 0;
  const anomalyText = isDemo
    ? demoPayload.anomaly
    : anomalies.find((item) => item.flagged)
      ? `${anomalies.find((item) => item.flagged)?.month} was flagged for unexplained usage.`
      : "";
  const markdown = isDemo ? demoPayload.markdown : reportMarkdown ?? "";

  const upfrontCost = activeRecommendations.reduce((sum, recommendation) => {
    const parsed = estimateCost(recommendation.estimated_cost_range);
    if (parsed > 0) {
      return sum + parsed;
    }
    if (recommendation.simple_payback_years) {
      return sum + recommendation.simple_payback_years * recommendation.estimated_savings_usd;
    }
    return sum;
  }, 0);

  const annualSavings = activeRecommendations.reduce((sum, recommendation) => sum + recommendation.estimated_savings_usd, 0);

  const financialData = Array.from({ length: 11 }, (_, year) => ({
    year: `Y${year}`,
    upgrade: year === 0 ? 0 : -upfrontCost + annualSavings * year,
    nothing: annualSavings * year,
  }));

  const nextSteps = activeRecommendations.slice(0, 3).map((recommendation, index) => ({
    num: String(index + 1),
    title: recommendation.title,
    desc:
      recommendation.simple_payback_years && recommendation.simple_payback_years < 2
        ? "Start pricing immediately. This is a fast-payback opportunity."
        : "Use this report to gather contractor pricing and rebate options.",
  }));

  if (!isDemo && !reportMarkdown && !analysisResults) {
    return null;
  }

  return (
    <div className="min-h-screen px-6 pb-20 pt-32 print:px-0 print:pt-0">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
          <Link href={isDemo ? "/" : "/results"} className="btn-secondary">
            <ArrowLeft className="h-4 w-4" /> {isDemo ? "Back home" : "Back to results"}
          </Link>
          <button type="button" onClick={() => window.print()} className="btn-primary">
            <Download className="h-4 w-4" /> Save as PDF
          </button>
        </div>

        <div className="flex gap-6">
          <div className="hidden w-60 shrink-0 lg:block print:hidden">
            <GlassCard className="sticky top-28 rounded-[2rem]">
              <div className="space-y-1">
                {reportSections.map((section, index) => (
                  <div
                    key={section.num}
                    className={[
                      "rounded-[1rem] px-4 py-3 text-sm transition-colors",
                      index === 0 ? "bg-[var(--accent-blue-dim)] text-mid-navy" : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <div className="font-mono text-[0.64rem] uppercase tracking-[0.16em]">{section.num}</div>
                    <div className="mt-1 font-medium">{section.label}</div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => window.print()} className="btn-primary mt-5 w-full">
                Download PDF
              </button>
            </GlassCard>
          </div>

          <div className="flex-1 space-y-6">
            <GlassCard strong className="rounded-[2rem]">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-green-dim)] text-success">
                  <FileCheck className="h-7 w-7" />
                </div>
                <div className="eyebrow">Step 03 · Report</div>
                <h1 className="mt-4 font-heading text-[2.5rem] font-extrabold tracking-[-0.06em] text-navy">
                  The full audit.
                </h1>
                <p className="mt-4 text-[1rem] leading-8 text-[var(--text-secondary)]">
                  Prepared for {address || "the subject property"} · {siteEUI.toFixed(1)} kBtu/ft² · {percentile}th percentile
                </p>
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-heading text-[1.35rem] font-bold tracking-[-0.05em] text-navy">01 · Executive summary</div>
              <p className="mt-4 text-[0.98rem] leading-8 text-[var(--text-secondary)]">
                {address || "This property"} uses approximately {siteEUI.toFixed(1)} kBtu/ft² annually and spends about
                ${annualCost.toLocaleString()} on energy each year. AuditAI identified {activeRecommendations.length} prioritized
                upgrades with roughly ${annualSavings.toLocaleString()} in potential annual savings.
              </p>

              {anomalyText && (
                <div className="mt-5 rounded-[1.4rem] border border-[rgba(160,40,40,0.18)] bg-[rgba(160,40,40,0.07)] px-5 py-4">
                  <div className="font-heading text-[1.02rem] font-bold tracking-[-0.04em] text-[var(--accent-red)]">
                    Anomaly detected
                  </div>
                  <p className="mt-2 text-sm leading-7 text-[var(--accent-red)]">{anomalyText}</p>
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <SummaryBox label="Top finding" value={activeRecommendations[0]?.title || "Pending"} />
                <SummaryBox label="Total savings" value={`$${annualSavings.toLocaleString()}/yr`} />
                <SummaryBox
                  label="Average payback"
                  value={`${averagePayback(activeRecommendations).toFixed(1)} yr`}
                />
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-heading text-[1.35rem] font-bold tracking-[-0.05em] text-navy">02 · Audit narrative</div>
              <div className="markdown-report mt-4" dangerouslySetInnerHTML={renderMarkdown(markdown)} />
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-heading text-[1.35rem] font-bold tracking-[-0.05em] text-navy">03 · Upgrade list</div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[680px] text-left">
                  <thead>
                    <tr className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      <th className="pb-3">Upgrade</th>
                      <th className="pb-3">Est. cost</th>
                      <th className="pb-3">Annual savings</th>
                      <th className="pb-3">Payback</th>
                      <th className="pb-3">10-year NPV</th>
                      <th className="pb-3">Complexity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRecommendations.map((recommendation) => (
                      <tr key={recommendation.recommendation_id} className="border-t border-white/50">
                        <td className="py-4 pr-4 text-sm font-medium text-navy">{recommendation.title}</td>
                        <td className="py-4 pr-4 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                          {recommendation.estimated_cost_range}
                        </td>
                        <td className="py-4 pr-4 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-success">
                          ${Math.round(recommendation.estimated_savings_usd).toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                          {recommendation.simple_payback_years?.toFixed(1) ?? "n/a"} yr
                        </td>
                        <td className="py-4 pr-4 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                          ${Math.round(recommendation.npv_10y).toLocaleString()}
                        </td>
                        <td className="py-4">
                          <span className="rounded-full bg-[var(--accent-blue-dim)] px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-mid-navy">
                            {recommendation.implementation_complexity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="mb-4 flex items-center gap-3">
                <TrendingDown className="h-5 w-5 text-success" />
                <div className="font-heading text-[1.35rem] font-bold tracking-[-0.05em] text-navy">04 · Financial model</div>
              </div>
              <div className="h-[18rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={financialData}>
                    <XAxis
                      dataKey="year"
                      tick={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "rgba(14,28,42,0.58)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "rgba(14,28,42,0.58)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                    />
                    <Tooltip
                      cursor={{ stroke: "rgba(14,28,42,0.15)" }}
                      contentStyle={{
                        backgroundColor: "rgba(255,255,255,0.86)",
                        borderRadius: 18,
                        border: "1px solid rgba(255,255,255,0.85)",
                        color: "#0e1c2a",
                      }}
                    />
                    <Line type="monotone" dataKey="upgrade" stroke="#1a6040" strokeWidth={2.5} dot={false} name="Act on upgrades" />
                    <Line type="monotone" dataKey="nothing" stroke="#a02828" strokeWidth={2.5} strokeDasharray="6 4" dot={false} name="Do nothing" />
                    <ReferenceDot x="Y2" y={financialData[2]?.upgrade ?? 0} r={5} fill="#1a6040" stroke="none" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-heading text-[1.35rem] font-bold tracking-[-0.05em] text-navy">05 · Next steps</div>
              <div className="mt-5 space-y-3">
                {nextSteps.map((step) => (
                  <div key={step.num} className="rounded-[1.3rem] border border-white/56 bg-white/34 px-5 py-4">
                    <div className="flex items-start gap-4">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-blue-dim)] font-mono text-[0.68rem] uppercase tracking-[0.12em] text-mid-navy">
                        {step.num}
                      </span>
                      <div>
                        <div className="font-medium text-navy">{step.title}</div>
                        <div className="mt-1 text-sm leading-7 text-[var(--text-secondary)]">{step.desc}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {auditWarnings.length > 0 && (
                  <div className="rounded-[1.3rem] border border-[rgba(160,40,40,0.18)] bg-[rgba(160,40,40,0.07)] px-5 py-4 text-sm leading-7 text-[var(--accent-red)]">
                    {auditWarnings[0]}
                  </div>
                )}
              </div>
            </GlassCard>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              header { display: none !important; }
              body {
                background: white !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}

function ReportFallback() {
  return (
    <div className="min-h-screen px-6 pb-20 pt-32">
      <div className="mx-auto max-w-4xl">
        <GlassCard strong className="rounded-[2rem] text-center">
          <div className="eyebrow">Loading report</div>
          <div className="mt-4 font-heading text-[2rem] font-extrabold tracking-[-0.05em] text-navy">
            Preparing the audit report.
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-white/56 bg-white/34 px-4 py-4 text-center">
      <div className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 font-heading text-[1.2rem] font-bold tracking-[-0.04em] text-navy">{value}</div>
    </div>
  );
}

function averagePayback(
  recommendations: Array<{ simple_payback_years: number | null }>,
) {
  const valid = recommendations.map((item) => item.simple_payback_years).filter((item): item is number => item !== null);
  if (valid.length === 0) {
    return 0;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function estimateCost(range: string) {
  const numbers = Array.from(range.matchAll(/\d[\d,]*/g)).map((match) => Number(match[0].replaceAll(",", "")));
  if (numbers.length === 0) {
    return 0;
  }
  if (numbers.length === 1) {
    return numbers[0];
  }
  return Math.round((numbers[0] + numbers[1]) / 2);
}

function renderMarkdown(markdown: string) {
  let html = markdown
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    .replace(/^\- (.*$)/gim, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");

  html = `<p>${html}</p>`
    .replace(/<p><h/g, "<h")
    .replace(/<\/h([1-3])><br \/><p>/g, "</h$1>")
    .replace(/<p><li>/g, "<ul><li>")
    .replace(/<\/li><br \/><li>/g, "</li><li>")
    .replace(/<\/li><\/p>/g, "</li></ul>")
    .replace(/<p><\/p>/g, "");

  return { __html: html };
}
