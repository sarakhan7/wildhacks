"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAudit } from "@/context/AuditContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import Map, { Marker, Layer } from "react-map-gl/mapbox";
import 'mapbox-gl/dist/mapbox-gl.css';
import { getBenchmarkForType } from "@/lib/benchmarks";
import { GlassCard } from "@/components/ui/GlassCard";
import { GaugeChart } from "@/components/ui/GaugeChart";
import { BatteryWarning, Leaf, Zap, FileText, ArrowUpRight, TrendingDown, ThermometerSnowflake, DollarSign, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export default function ResultsDashboard() {
  const router = useRouter();
  const {
    buildingInfo,
    analysisResults,
    reportMarkdown,
    peerInsights,
    anomalies,
    diagnosticHypotheses,
    recommendations,
    auditWarnings,
  } = useAudit();

  // Redirect if no analysis data exists (page reload)
  useEffect(() => {
    if (!analysisResults && typeof window !== "undefined") {
      router.push("/audit");
    }
  }, [analysisResults, router]);

  if (!analysisResults) return null;

  const benchmark = getBenchmarkForType(buildingInfo.buildingType);
  const percentile = peerInsights?.percentile ?? analysisResults.peerPercentile ?? 50;
  const peerLabel = peerInsights?.archetype_label ?? analysisResults.clusterLabel ?? benchmark.label;
  const climateZone = peerInsights?.climate_zone ?? analysisResults.climateZone ?? "Unassigned";
  const topRecommendations = recommendations.slice(0, 3);
  const flaggedAnomalies = anomalies.filter((signal) => signal.flagged);
  // Prepare chart data
  const chartData = analysisResults.monthlyBreakdown.map((m) => ({
    name: m.month.split("-")[1], // Just the month number or short name
    electric: Math.round(m.electricKbtu),
    gas: Math.round(m.gasKbtu),
    total: Math.round(m.totalKbtu),
    isAnomaly: m.isAnomaly
  }));

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-[var(--bg-primary)] to-[var(--bg-secondary)]">
      {/* Header Banner */}
      <div className="w-full bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] py-6 px-6 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-1/3 h-full bg-gradient-to-l from-[var(--accent-green-dim)] to-transparent opacity-50" />
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center relative z-10">
          <div>
            <h1 className="text-3xl font-heading font-bold">{buildingInfo.address}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-[var(--text-muted)]">
              <span className="px-2 py-1 glass rounded text-[var(--text-primary)] font-medium">
                {peerLabel}
              </span>
              <span>{buildingInfo.squareFeet.toLocaleString()} sq ft</span>
              <span>Built {buildingInfo.yearBuilt}</span>
            </div>
          </div>
          <div className="mt-4 md:mt-0 flex gap-4">
            <Link href="/audit" className="btn-secondary py-2">Edit Data</Link>
            <Link href="/report" className="btn-primary flex items-center gap-2 py-2">
              <FileText className="w-4 h-4" /> View Full Report
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Top metric strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <GlassCard className="flex flex-col p-5">
              <span className="text-[var(--text-muted)] text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" /> Annual Cost
              </span>
              <span className="text-3xl font-bold font-heading mt-2">
                ${analysisResults.totalCost.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--text-secondary)] mt-1">
                ${analysisResults.costPerSqFt.toFixed(2)} / sq ft
              </span>
            </GlassCard>

            <GlassCard className="flex flex-col p-5">
              <span className="text-[var(--text-muted)] text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Total Energy
              </span>
              <span className="text-3xl font-bold font-heading mt-2">
                {(analysisResults.totalEnergy / 1000).toFixed(1)}k <span className="text-lg font-normal">kBtu</span>
              </span>
            </GlassCard>

            <GlassCard className="flex flex-col p-5 bg-gradient-to-br from-[var(--bg-glass)] to-[rgba(0,229,134,0.05)] border-[var(--border-accent)]">
              <span className="text-[var(--accent-green)] text-sm font-medium flex items-center gap-2">
                <TrendingDown className="w-4 h-4" /> Potential Savings
              </span>
              <span className="text-3xl font-bold font-heading mt-2 text-[#00e586]">
                ${analysisResults.annualSavingsOpportunity.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--text-secondary)] mt-1">Estimated vs Median</span>
            </GlassCard>
          </div>

          {/* Consumption Chart */}
          <GlassCard className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-heading font-medium">Monthly Consumption Signature (kBtu)</h3>
              <div className="flex items-center gap-2 text-xs font-medium px-2 py-1 glass rounded-md">
                <span className="w-3 h-3 rounded-full bg-[#06b6d4]"></span> Electricity
                <span className="w-3 h-3 rounded-full bg-[#f59e0b] ml-2"></span> Gas
              </div>
            </div>
            
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                    tickFormatter={(val) => `${val / 1000}k`}
                  />
                  <Tooltip 
                    cursor={{ fill: 'var(--bg-tertiary)' }}
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}
                  />
                  <Bar dataKey="electric" stackId="a" fill="#06b6d4" radius={[0, 0, 4, 4]} name="Electricity (kBtu)" />
                  <Bar dataKey="gas" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Natural Gas (kBtu)" />
                  <ReferenceLine y={analysisResults.estimatedBaseload} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-xs text-[var(--text-muted)] mt-2">
              Dashed line represents theoretical baseload (always-on equipment: {analysisResults.baseloadPercent}% of total)
            </div>
          </GlassCard>

          {/* Diagnostics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <GlassCard className="p-6">
              <h3 className="text-lg font-heading font-medium mb-4 flex items-center gap-2">
                <ThermometerSnowflake className="text-cyan-400" /> Heating & Cooling
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-secondary)]">Heating Load</span>
                    <span className="font-medium">{analysisResults.heatingPercent}%</span>
                  </div>
                  <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2">
                    <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${Math.min(100, analysisResults.heatingPercent)}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-secondary)]">Cooling Load</span>
                    <span className="font-medium">{analysisResults.coolingPercent}%</span>
                  </div>
                  <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2">
                    <div className="bg-cyan-400 h-2 rounded-full" style={{ width: `${Math.min(100, analysisResults.coolingPercent)}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-secondary)]">Baseload (Always On)</span>
                    <span className="font-medium">{analysisResults.baseloadPercent}%</span>
                  </div>
                  <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-2">
                    <div className="bg-gray-400 h-2 rounded-full" style={{ width: `${Math.min(100, analysisResults.baseloadPercent)}%` }}></div>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-lg font-heading font-medium mb-4 flex items-center gap-2">
                <BatteryWarning className="text-red-400" /> Demand & Anomalies
              </h3>
              <ul className="space-y-3">
                <li className="flex gap-3 items-start">
                  <div className="bg-[var(--bg-tertiary)] p-1.5 rounded text-[var(--text-muted)]">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-sm font-medium">Load Factor</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {analysisResults.loadFactor 
                        ? `${(analysisResults.loadFactor * 100).toFixed(0)}% (Goal: >65%)`
                        : "Peak demand data not available"}
                    </span>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <div className="bg-[var(--bg-tertiary)] p-1.5 rounded text-[var(--text-muted)]">
                    <ThermometerSnowflake className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-sm font-medium">Seasonal Ratio</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      Peak month uses {analysisResults.seasonalVariation}x more energy than lowest
                    </span>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <div className="bg-[var(--bg-tertiary)] p-1.5 rounded text-[var(--text-muted)]">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-sm font-medium">Flagged Months</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {flaggedAnomalies.length > 0
                        ? flaggedAnomalies.map((signal) => signal.month).join(", ")
                        : "No anomalous utility months detected"}
                    </span>
                  </div>
                </li>
              </ul>
            </GlassCard>
          </div>

          <GlassCard className="p-6">
            <div className="flex justify-between items-center mb-4 gap-4">
              <h3 className="text-lg font-heading font-medium">Diagnostic Findings</h3>
              <span className="text-xs text-[var(--text-muted)]">
                {diagnosticHypotheses.length} hypotheses, {recommendations.length} ECMs
              </span>
            </div>
            <div className="space-y-4">
              {diagnosticHypotheses.length > 0 ? (
                diagnosticHypotheses.slice(0, 4).map((hypothesis) => (
                  <div key={hypothesis.hypothesis_id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                    <div className="flex justify-between gap-4 mb-2">
                      <h4 className="font-medium text-sm">{hypothesis.title}</h4>
                      <span className="text-xs text-[var(--text-muted)]">Confidence {hypothesis.confidence}/5</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{hypothesis.description}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Evidence: {hypothesis.evidence_months.join(", ") || "None"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">No diagnostic findings were generated for this run.</p>
              )}
            </div>
          </GlassCard>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* EUI Benchmark Card */}
          <GlassCard strong glow className="border-[var(--border-accent)] relative overflow-hidden p-6 flex flex-col items-center">
            <h3 className="text-lg font-medium self-start mb-2">ENERGY STAR Benchmark</h3>
            <p className="text-xs text-[var(--text-muted)] self-start mb-6">Peer comparison based on CBECS microdata.</p>
            
            <GaugeChart 
              value={analysisResults.siteEUI} 
              percentile={percentile} 
              max={Math.max(benchmark.medianSiteEUI * 2, analysisResults.siteEUI * 1.2)}
            />
            
            <div className="w-full mt-8 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[var(--text-secondary)]">Your EUI</span>
                <span className="font-bold">{analysisResults.siteEUI.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-[var(--border-subtle)] pt-2 relative">
                <span className="text-[var(--text-muted)]">Median {peerLabel}</span>
                <span className="font-medium text-[var(--text-muted)]">
                  {(peerInsights?.median_eui ?? benchmark.medianSiteEUI).toFixed(1)}
                </span>
              </div>
            </div>
            
            <div className="mt-4 text-center">
              <span className="text-xs font-semibold px-3 py-1 glass rounded-full opacity-80 border-none">
                {percentile < 50 ? "Below Average" : "Above Average"} — {Math.floor(percentile)}th Percentile
              </span>
            </div>
          </GlassCard>

          {/* Map context */}
          <GlassCard className="p-0 overflow-hidden h-[250px] relative">
             <Map
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={{
                  longitude: buildingInfo.lng,
                  latitude: buildingInfo.lat,
                  zoom: 16,
                  pitch: 60,
                  bearing: 20
                }}
                mapStyle="mapbox://styles/mapbox/satellite-v9"
                attributionControl={false}
                interactive={false}
              >
                <Marker longitude={buildingInfo.lng} latitude={buildingInfo.lat} color="#00e586" />
                
                {/* 3D Buildings Layer context if possible */}
                <Layer 
                  id="3d-buildings"
                  source="composite"
                  source-layer="building"
                  filter={['==', 'extrude', 'true']}
                  type="fill-extrusion"
                  paint={{
                    'fill-extrusion-color': '#06b6d4',
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-opacity': 0.6
                  }}
                />
              </Map>
              <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none rounded-2xl" />
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4 pt-12">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Leaf className="w-4 h-4 text-green-400" /> Climate Zone: {climateZone}
                </div>
              </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex justify-between items-center mb-4 gap-4">
              <h3 className="text-lg font-heading font-medium">Top ECMs</h3>
              <span className="text-xs text-[var(--text-muted)]">Tool-backed payback and NPV</span>
            </div>
            <div className="space-y-4">
              {topRecommendations.length > 0 ? (
                topRecommendations.map((recommendation) => (
                  <div key={recommendation.recommendation_id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                    <div className="flex justify-between gap-4">
                      <h4 className="font-medium text-sm">{recommendation.title}</h4>
                      <span className="text-xs text-[var(--text-muted)]">{recommendation.implementation_complexity}</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{recommendation.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                      <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-1">
                        Savings ${recommendation.estimated_savings_usd.toLocaleString()}
                      </span>
                      <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-1">
                        Payback {recommendation.simple_payback_years?.toFixed(1) ?? "n/a"} yrs
                      </span>
                      <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-1">
                        NPV ${recommendation.npv_10y.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">Recommendations will appear after the reasoning stage completes.</p>
              )}
            </div>
          </GlassCard>

          {auditWarnings.length > 0 && (
            <GlassCard className="p-6 border-amber-500/40">
              <div className="flex items-center gap-2 mb-3 text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                <h3 className="text-lg font-heading font-medium">Audit Warnings</h3>
              </div>
              <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                {auditWarnings.map((warning) => (
                  <li key={warning} className="leading-relaxed">
                    {warning}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          {/* CTA Link */}
          {reportMarkdown && (
             <motion.div 
               whileHover={{ scale: 1.02 }}
               whileTap={{ scale: 0.98 }}
             >
                <Link href="/report" className="w-full glass p-6 flex items-center justify-between group cursor-pointer hover:border-[var(--accent-green)] transition-colors">
                  <div>
                    <h3 className="font-heading font-semibold text-lg text-[var(--accent-green)] group-hover:drop-shadow-[0_0_8px_rgba(0,229,134,0.5)] transition-all">
                      Read Structured Audit Report
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">Generated by the AuditAI reasoning pipeline</p>
                  </div>
                  <div className="bg-[var(--accent-green-dim)] p-3 rounded-full text-[var(--accent-green)] group-hover:bg-[var(--accent-green)] group-hover:text-black transition-colors">
                    <FileText className="w-5 h-5" />
                  </div>
                </Link>
             </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
