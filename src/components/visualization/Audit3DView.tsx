"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, LoaderCircle, SunMedium, Thermometer, Waves } from "lucide-react";

import { GlassCard } from "@/components/ui/GlassCard";
import { useAudit } from "@/context/AuditContext";
import type { VisualizationSceneResponse, VisualizationOverlayMode, VisualizationScenario } from "@/lib/visualization";
import { applyScenarioToThermal } from "@/lib/visualization";

const MapboxThreeScene = dynamic(() => import("@/components/visualization/MapboxThreeScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[var(--text-secondary)]">
      <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Loading 3D scene
    </div>
  ),
});

const SCENARIOS: Array<{ id: VisualizationScenario; label: string }> = [
  { id: "current", label: "Current" },
  { id: "improved_insulation", label: "Improved Insulation" },
  { id: "rooftop_solar", label: "Rooftop Solar" },
];

type HoverCard = {
  title: string;
  detail: string;
};

function formatDate(date: VisualizationSceneResponse["solar"]["imageryDate"]) {
  if (!date) {
    return "Modeled fallback";
  }
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function scenarioDisplayLabel(scenario: VisualizationScenario) {
  return SCENARIOS.find((item) => item.id === scenario)?.label ?? "Current";
}

const DEFAULT_ROOF_CALIBRATION = {
  offsetX: 0,
  offsetY: -0.088,
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
};

export default function Audit3DView() {
  const router = useRouter();
  const { analysisResults, auditId, buildingInfo } = useAudit();
  const [data, setData] = useState<VisualizationSceneResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hovered, setHovered] = useState<HoverCard | null>(null);
  const scenario: VisualizationScenario = "current";
  const overlay = "solar" as VisualizationOverlayMode;
  const month = 0;
  const particlesEnabled = true;

  useEffect(() => {
    if (!analysisResults || !auditId) {
      router.push("/audit");
    }
  }, [analysisResults, auditId, router]);

  useEffect(() => {
    if (!auditId) {
      return;
    }

    window.localStorage.setItem("architec.last-visualization-audit-id", auditId);

    let active = true;
    async function loadVisualization() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/audits/${auditId}/visualization`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error((await response.json()).error || "Visualization data request failed");
        }
        const payload = (await response.json()) as VisualizationSceneResponse;
        if (active) {
          setData(payload);
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Visualization data request failed");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadVisualization();

    return () => {
      active = false;
    };
  }, [auditId]);

  const thermalSurfaces = useMemo(() => {
    if (!data) {
      return [];
    }
    return applyScenarioToThermal(data.thermal, scenario, month || 7);
  }, [data, scenario, month]);

  const thermalPeak = useMemo(() => {
    let peak = 0;
    for (const surface of thermalSurfaces) {
      for (let i = 0; i < surface.patchValues.length; i++) {
        if (surface.patchValues[i] > peak) peak = surface.patchValues[i];
      }
    }
    return peak;
  }, [thermalSurfaces]);

  const roofSummary = data?.solar.roofStats;

  if (!analysisResults || !auditId) {
    return null;
  }

  return (
    <div className="min-h-screen px-6 pb-20 pt-32">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/results"
              className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Results
            </Link>
            <span className="eyebrow">Step 03 · Visualization</span>
            <h1 className="section-title mt-4 text-navy">
              3D energy map.
              <span className="block text-mid-navy">Rendered for the real site.</span>
            </h1>
            <p className="mt-5 max-w-3xl text-[1rem] leading-8 text-[var(--text-secondary)]">
              Solar production, thermal loss, and retrofit scenarios are layered onto the building shell so the audit reads like a physical object instead of a spreadsheet.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:max-w-[28rem] lg:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-amber-dim)] px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-[var(--accent-amber)]">
              <SunMedium className="h-3.5 w-3.5" /> Google Solar imagery {formatDate(data?.solar.imageryDate ?? null)}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-blue-dim)] px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-mid-navy">
              <Thermometer className="h-3.5 w-3.5" /> Model-driven thermal flow
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Address" value={buildingInfo.address.split(",")[0] || buildingInfo.address} detail="Mapped building shell" />
          <MetricCard
            label="Scenario"
            value={scenarioDisplayLabel(scenario)}
            detail={overlay === "both" ? "Solar + thermal" : overlay === "solar" ? "Solar only" : "Thermal only"}
          />
          <MetricCard label="Peak envelope flux" value={`${thermalPeak.toFixed(1)} W/m²`} detail="Modeled heat-loss intensity" />
          <MetricCard
            label="Solar opportunity"
            value={`$${Math.round(roofSummary?.estimatedAnnualSavingsUsd ?? 0).toLocaleString()}/yr`}
            detail={`${roofSummary?.maxArrayPanelsCount ?? 0} roof panels`}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <GlassCard className="overflow-hidden rounded-[2rem] p-0">
            <div className="flex items-center justify-between border-b border-white/55 px-5 py-4">
              <div>
                <div className="font-heading text-[1.2rem] font-bold tracking-[-0.04em] text-navy">Interactive scene</div>
                <div className="mt-1 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Orbit, zoom, and inspect roof and facade surfaces
                </div>
              </div>
              <div className="hidden rounded-full bg-white/42 px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:block">
                Live 3D canvas
              </div>
            </div>

            {isLoading || !data ? (
              <div className="flex h-[720px] items-center justify-center px-6 text-center text-[var(--text-secondary)]">
                {error ? (
                  <span>{error}</span>
                ) : (
                  <>
                    <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Preparing visualization payload
                  </>
                )}
              </div>
            ) : (
              <div className="h-[720px] overflow-hidden">
                <MapboxThreeScene
                  data={data}
                  scenario={scenario}
                  overlay={overlay}
                  month={month}
                  particlesEnabled={particlesEnabled}
                  roofCalibration={DEFAULT_ROOF_CALIBRATION}
                  onHoverChange={setHovered}
                />
              </div>
            )}
          </GlassCard>

          <div className="flex flex-col gap-6">
            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-3">
                <SunMedium className="h-5 w-5 text-[var(--accent-amber)]" />
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Solar Insight</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Roof Area" value={`${roofSummary?.areaMeters2.toFixed(0) ?? "0"} m²`} />
                <StatCard label="Panels" value={`${roofSummary?.maxArrayPanelsCount ?? 0}`} />
                <StatCard label="Annual Output" value={`${(roofSummary?.estimatedAnnualKwh ?? 0).toLocaleString()} kWh`} />
                <StatCard label="Annual Savings" value={`$${(roofSummary?.estimatedAnnualSavingsUsd ?? 0).toLocaleString()}`} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">
                Source: {data?.solar.source === "google_solar" ? "Google Solar roof flux rasters" : "Modeled fallback roof suitability"}.
              </p>
            </GlassCard>

            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Thermometer className="h-5 w-5 text-[var(--accent-red)]" />
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Thermal Envelope</h2>
              </div>
              <div className="space-y-3">
                <StatRow label="Scenario" value={scenarioDisplayLabel(scenario)} />
                <StatRow label="Peak Flux" value={`${thermalPeak.toFixed(1)} W/m²`} />
                <StatRow label="Envelope Band" value={data?.thermal.assumptions.envelopeVintageBand.replaceAll("_", " ") ?? "n/a"} />
                <StatRow label="Heating / Cooling" value={`${analysisResults.heatingPercent}% / ${analysisResults.coolingPercent}%`} />
              </div>
              <div className="mt-4 rounded-[1.4rem] border border-[rgba(160,40,40,0.18)] bg-[rgba(160,40,40,0.07)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                This thermal layer blends modeled envelope loss with facade streamlines and entrance hotspots sourced from OpenStreetMap when available. It remains a stylized engineering view, not CFD.
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Waves className="h-5 w-5 text-mid-navy" />
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Hover Readout</h2>
              </div>
              {hovered ? (
                <div className="rounded-[1.4rem] border border-white/58 bg-white/36 p-4">
                  <p className="text-sm font-semibold text-navy">{hovered.title}</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{hovered.detail}</p>
                </div>
              ) : (
                <p className="text-sm leading-7 text-[var(--text-secondary)]">
                  Hover the roof or facade surfaces to inspect Google Solar roof tiles or modeled heat-loss patches.
                </p>
              )}
            </GlassCard>

            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Building2 className="h-5 w-5 text-success" />
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Why This Matters</h2>
              </div>
              <p className="text-sm leading-7 text-[var(--text-secondary)]">
                The 3D view turns abstract audit signals into a decision surface: roof production potential from Google Solar data, facade loss patterns from the modeled envelope, and motion that makes retrofit impact legible for clients.
              </p>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/58 bg-white/34 p-4">
      <p className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 font-heading text-[1.05rem] font-bold tracking-[-0.03em] text-navy">{value}</p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/46 pb-2 text-sm last:border-b-0">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-navy">{value}</span>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <GlassCard className="rounded-[1.6rem] px-5 py-5">
      <div className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-3 font-heading text-[1.45rem] font-bold tracking-[-0.05em] text-navy">{value}</div>
      <div className="mt-2 text-sm text-[var(--text-secondary)]">{detail}</div>
    </GlassCard>
  );
}
