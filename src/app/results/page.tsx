"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  FileText,
  Orbit,
  Sparkles,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AuditTerminal } from "@/components/site/AuditTerminal";
import { GlassCard } from "@/components/ui/GlassCard";
import { useAudit } from "@/context/AuditContext";

export default function ResultsDashboard() {
  const router = useRouter();
  const { analysisResults, buildingInfo, peerInsights, anomalies, diagnosticHypotheses, recommendations, auditWarnings } = useAudit();

  useEffect(() => {
    if (!analysisResults && typeof window !== "undefined") {
      router.push("/audit");
    }
  }, [analysisResults, router]);

  const chartData = useMemo(() => {
    if (!analysisResults) {
      return [];
    }

    return analysisResults.monthlyBreakdown.map((month) => {
      const baseline = Math.min(month.totalKbtu, analysisResults.estimatedBaseload);
      const anomaly = month.isAnomaly ? Math.max(month.totalKbtu - baseline, 0) : 0;
      const variable = Math.max(month.totalKbtu - baseline - anomaly, 0);

      return {
        month: month.label.split(" ")[0],
        baseline: Math.round(baseline / 1000),
        variable: Math.round(variable / 1000),
        anomaly: Math.round(anomaly / 1000),
      };
    });
  }, [analysisResults]);

  if (!analysisResults) {
    return null;
  }

  const percentile = Math.round(peerInsights?.percentile ?? analysisResults.peerPercentile ?? 50);
  const flaggedAnomalies = anomalies.filter((item) => item.flagged);
  const topRecommendations = recommendations.slice(0, 4);
  const totalSavings = topRecommendations.reduce((sum, item) => sum + item.estimated_savings_usd, 0);
  const buildingTypeLabel = buildingInfo.buildingType.replaceAll("_", " ");
  const shortAddress = buildingInfo.address.split(",")[0] || buildingInfo.address;

  const terminalLines = [
    { label: "Building", value: shortAddress, valueClassName: "text-emerald-400" },
    { label: "Type", value: buildingTypeLabel, valueClassName: "text-emerald-400" },
    { label: "EUI", value: `${analysisResults.siteEUI.toFixed(1)} kBtu/ft²`, valueClassName: "text-emerald-400" },
    { label: "Rank", value: `${percentile}th percentile`, valueClassName: "text-emerald-400" },
    { label: "", value: "" },
    {
      label: "⚠ Anomaly",
      value: flaggedAnomalies[0] ? `${flaggedAnomalies[0].month} flagged` : "No major anomaly",
      valueClassName: flaggedAnomalies[0] ? "text-red-400" : "text-white/76",
    },
    {
      label: "✓ Upgrades",
      value: `${recommendations.length} recommendations`,
      valueClassName: "text-emerald-400",
    },
    { label: "", value: "" },
    ...topRecommendations.slice(0, 3).map((recommendation, index) => ({
      label: `0${index + 1}`,
      value: `${recommendation.title} · saves $${Math.round(recommendation.estimated_savings_usd).toLocaleString()}/yr`,
    })),
    { label: "", value: "" },
    {
      label: "Savings",
      value: `$${Math.round(totalSavings).toLocaleString()}/yr`,
      valueClassName: "text-sky-300",
    },
  ];

  return (
    <div className="min-h-screen px-6 pb-20 pt-32">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <span className="eyebrow">Step 02 · Results</span>
          <h1 className="section-title mt-4 text-navy">
            Your building.
            <span className="block text-mid-navy">Exposed.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[1rem] leading-8 text-[var(--text-secondary)]">
            AuditAI normalized the year, benchmarked the building, and ranked the best paths to savings.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Energy intensity"
            value={analysisResults.siteEUI.toFixed(1)}
            suffix="kBtu/ft²"
            detail={`${percentile}th percentile`}
            detailClassName="text-[var(--accent-red)]"
          />
          <MetricCard
            label="Annual energy cost"
            value={`$${analysisResults.totalCost.toLocaleString()}`}
            detail={`$${analysisResults.annualSavingsOpportunity.toLocaleString()} avoidable`}
            detailClassName="text-[var(--accent-red)]"
          />
          <MetricCard
            label="Savings opportunity"
            value={`$${analysisResults.annualSavingsOpportunity.toLocaleString()}/yr`}
            detail={`${recommendations.length} ECMs identified`}
            detailClassName="text-success"
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="space-y-6">
            <GlassCard className="rounded-[2rem]">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-heading text-[1.45rem] font-bold tracking-[-0.05em] text-navy">
                    Monthly consumption
                  </div>
                  <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Baseload, variable load, and anomalies
                  </div>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-blue-dim)] px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-mid-navy">
                  <BarChart3 className="h-3.5 w-3.5" /> Weather-aware
                </span>
              </div>

              <div className="h-[18rem] w-full min-h-0 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={chartData}>
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "rgba(14,28,42,0.58)" }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "rgba(14,28,42,0.58)" }}
                      tickFormatter={(value) => `${value}k`}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.28)" }}
                      contentStyle={{
                        backgroundColor: "rgba(255,255,255,0.84)",
                        borderRadius: 18,
                        border: "1px solid rgba(255,255,255,0.85)",
                        color: "#0e1c2a",
                      }}
                    />
                    <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                    <Bar dataKey="baseline" stackId="load" fill="#3a6e92" radius={[4, 4, 0, 0]} name="Baseload" />
                    <Bar dataKey="variable" stackId="load" fill="#c87830" radius={[4, 4, 0, 0]} name="Variable" />
                    <Bar dataKey="anomaly" stackId="load" fill="#a02828" radius={[4, 4, 0, 0]} name="Anomaly" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-heading text-[1.45rem] font-bold tracking-[-0.05em] text-navy">
                    Diagnostic findings
                  </div>
                  <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Ranked engineering hypotheses
                  </div>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-green-dim)] px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-success">
                  <Sparkles className="h-3.5 w-3.5" /> {diagnosticHypotheses.length} findings
                </span>
              </div>

              <div className="space-y-4">
                {diagnosticHypotheses.length > 0 ? (
                  diagnosticHypotheses.slice(0, 3).map((hypothesis) => (
                    <div key={hypothesis.hypothesis_id} className="rounded-[1.4rem] border border-white/60 bg-white/34 px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="font-heading text-[1.05rem] font-bold tracking-[-0.04em] text-navy">
                          {hypothesis.title}
                        </div>
                        <span className="rounded-full bg-[var(--accent-blue-dim)] px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-mid-navy">
                          Confidence {hypothesis.confidence}/5
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{hypothesis.description}</p>
                      <div className="mt-3 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Evidence months: {hypothesis.evidence_months.join(", ") || "None"}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-[var(--text-secondary)]">No diagnostic findings were generated for this run.</p>
                )}
              </div>
            </GlassCard>

            {auditWarnings.length > 0 && (
              <GlassCard className="rounded-[2rem] border-[rgba(160,40,40,0.2)]">
                <div className="flex items-center gap-3 text-[var(--accent-red)]">
                  <AlertTriangle className="h-4 w-4" />
                  <div className="font-heading text-[1.1rem] font-bold tracking-[-0.04em]">Audit warnings</div>
                </div>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--text-secondary)]">
                  {auditWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </GlassCard>
            )}
          </div>

          <div className="space-y-6">
            <GlassCard className="rounded-[2rem]">
              <div className="flex items-center gap-6">
                <PercentileRing percentile={percentile} />
                <div>
                  <div className="font-heading text-[1.3rem] font-bold tracking-[-0.05em] text-navy">
                    Peer benchmark
                  </div>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
                    {buildingInfo.address} uses more energy than {percentile}% of similar {buildingTypeLabel} buildings
                    in comparable conditions.
                  </p>
                  <div className="mt-3 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {peerInsights?.archetype_label || "Benchmark"} · {peerInsights?.climate_zone || analysisResults.climateZone || "Climate zone pending"}
                  </div>
                </div>
              </div>
            </GlassCard>

            <AuditTerminal lines={terminalLines} compact />

            <GlassCard className="rounded-[2rem]">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="font-heading text-[1.3rem] font-bold tracking-[-0.05em] text-navy">Top upgrades</div>
                <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Highest annual savings
                </span>
              </div>

              <div className="space-y-3">
                {topRecommendations.length > 0 ? (
                  topRecommendations.map((recommendation, index) => (
                    <div key={recommendation.recommendation_id} className="rounded-[1.3rem] border border-white/56 bg-white/34 px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-blue-dim)] font-mono text-[0.68rem] uppercase tracking-[0.12em] text-mid-navy">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-navy">{recommendation.title}</div>
                          <div className="mt-1 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            {recommendation.implementation_complexity} complexity
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[0.78rem] uppercase tracking-[0.12em] text-success">
                            ${Math.round(recommendation.estimated_savings_usd).toLocaleString()}/yr
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            Payback {recommendation.simple_payback_years?.toFixed(1) ?? "n/a"} yr
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-[var(--text-secondary)]">Recommendations will appear once the reasoning stage completes.</p>
                )}
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-heading text-[1.3rem] font-bold tracking-[-0.05em] text-navy">Next actions</div>
              <div className="mt-4 space-y-3">
                <Link href="/report" className="flex items-center justify-between rounded-[1.3rem] border border-white/58 bg-white/36 px-4 py-4 transition-colors hover:bg-white/46">
                  <div>
                    <div className="font-medium text-navy">Open the full audit report</div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">Executive summary, ECM table, and implementation guidance</div>
                  </div>
                  <FileText className="h-5 w-5 text-mid-navy" />
                </Link>

                <Link href="/results/3d" className="flex items-center justify-between rounded-[1.3rem] border border-white/58 bg-white/36 px-4 py-4 transition-colors hover:bg-white/46">
                  <div>
                    <div className="font-medium text-navy">Inspect the 3D audit view</div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">Explore roof solar flux and modeled heat-loss overlays</div>
                  </div>
                  <Orbit className="h-5 w-5 text-mid-navy" />
                </Link>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  detail,
  detailClassName,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  detailClassName?: string;
}) {
  return (
    <GlassCard className="rounded-[1.7rem] text-center">
      <div className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-3 font-heading text-[2rem] font-extrabold tracking-[-0.05em] text-navy">
        {value}
        {suffix && <span className="ml-1 text-[0.95rem] font-medium">{suffix}</span>}
      </div>
      <div className={`mt-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] ${detailClassName ?? "text-[var(--text-secondary)]"}`}>
        {detail}
      </div>
    </GlassCard>
  );
}

function PercentileRing({ percentile }: { percentile: number }) {
  const circumference = 2 * Math.PI * 50;
  const dash = (Math.min(Math.max(percentile, 0), 100) / 100) * circumference;

  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 flex-shrink-0">
      <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(14,28,42,0.08)" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r="50"
        fill="none"
        stroke="#a02828"
        strokeWidth="10"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="56" textAnchor="middle" className="font-heading" fontSize="26" fontWeight="800" fill="#0e1c2a">
        {percentile}th
      </text>
      <text x="60" y="72" textAnchor="middle" style={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "rgba(14,28,42,0.42)" }}>
        percentile
      </text>
    </svg>
  );
}
