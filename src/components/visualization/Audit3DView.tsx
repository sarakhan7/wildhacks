"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, LoaderCircle, Orbit, SunMedium, Thermometer, Waves } from "lucide-react";

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

const OVERLAYS: Array<{ id: VisualizationOverlayMode; label: string }> = [
  { id: "both", label: "Both" },
  { id: "solar", label: "Solar" },
  { id: "thermal", label: "Thermal" },
];

const MONTHS = [
  { value: 0, label: "Annual" },
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
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

export default function Audit3DView() {
  const router = useRouter();
  const { analysisResults, auditId, buildingInfo } = useAudit();
  const [data, setData] = useState<VisualizationSceneResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [scenario, setScenario] = useState<VisualizationScenario>("current");
  const [overlay, setOverlay] = useState<VisualizationOverlayMode>("both");
  const [month, setMonth] = useState(0);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [hovered, setHovered] = useState<HoverCard | null>(null);

  useEffect(() => {
    if (!analysisResults || !auditId) {
      router.push("/audit");
    }
  }, [analysisResults, auditId, router]);

  useEffect(() => {
    if (!auditId) {
      return;
    }

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

  const thermalPeak = useMemo(
    () => Math.max(...thermalSurfaces.map((surface) => Math.max(...surface.patchValues, 0)), 0),
    [thermalSurfaces],
  );

  const roofSummary = data?.solar.roofStats;

  if (!analysisResults || !auditId) {
    return null;
  }

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(6,182,212,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(0,229,134,0.16),_transparent_24%),linear-gradient(180deg,#07101d_0%,#091321_100%)] px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/results" className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
              <ArrowLeft className="h-4 w-4" /> Back to Results
            </Link>
            <h1 className="text-3xl font-heading font-bold text-white md:text-5xl">
              3D Energy Envelope for {buildingInfo.address}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
              Real roof solar potential from Google Solar, paired with a model-driven thermal envelope and particle flow built from the audit&apos;s weather and PRISM signals.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="rounded-full border border-[rgba(255,196,77,0.35)] bg-[rgba(255,196,77,0.12)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-amber)]">
              Google Solar imagery {formatDate(data?.solar.imageryDate ?? null)}
            </div>
            <div className="rounded-full border border-[rgba(6,182,212,0.35)] bg-[rgba(6,182,212,0.12)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-cyan)]">
              Model-driven thermal flow
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <GlassCard className="min-h-[720px] overflow-hidden border-[rgba(148,163,184,0.12)] bg-[rgba(6,12,22,0.72)] p-0">
            {isLoading || !data ? (
              <div className="flex h-[720px] items-center justify-center text-[var(--text-secondary)]">
                {error ? (
                  <span>{error}</span>
                ) : (
                  <>
                    <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Preparing visualization payload
                  </>
                )}
              </div>
            ) : (
              <MapboxThreeScene
                data={data}
                scenario={scenario}
                overlay={overlay}
                month={month}
                particlesEnabled={particlesEnabled}
                onHoverChange={setHovered}
              />
            )}
          </GlassCard>

          <div className="flex flex-col gap-6">
            <GlassCard className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Orbit className="h-5 w-5 text-[var(--accent-cyan)]" />
                <h2 className="font-heading text-lg font-semibold">Scene Controls</h2>
              </div>

              <ControlGroup label="Scenario">
                {SCENARIOS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setScenario(item.id)}
                    className={pillClassName(scenario === item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </ControlGroup>

              <ControlGroup label="Overlay">
                {OVERLAYS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOverlay(item.id)}
                    className={pillClassName(overlay === item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </ControlGroup>

              <ControlGroup label="Season / Month">
                <div className="grid grid-cols-4 gap-2">
                  {MONTHS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setMonth(item.value)}
                      className={tinyPillClassName(month === item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </ControlGroup>

              <div className="mt-5 flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[rgba(8,15,29,0.78)] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">Particle Flow</p>
                  <p className="text-xs text-[var(--text-muted)]">Show GPU heat-loss streamlines</p>
                </div>
                <button
                  type="button"
                  onClick={() => setParticlesEnabled((current) => !current)}
                  className={tinyPillClassName(particlesEnabled)}
                >
                  {particlesEnabled ? "On" : "Off"}
                </button>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <SunMedium className="h-5 w-5 text-[var(--accent-amber)]" />
                <h2 className="font-heading text-lg font-semibold">Solar Insight</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Roof Area" value={`${roofSummary?.areaMeters2.toFixed(0) ?? "0"} m²`} />
                <StatCard label="Panels" value={`${roofSummary?.maxArrayPanelsCount ?? 0}`} />
                <StatCard label="Annual Output" value={`${roofSummary?.estimatedAnnualKwh.toLocaleString() ?? "0"} kWh`} />
                <StatCard label="Annual Savings" value={`$${roofSummary?.estimatedAnnualSavingsUsd.toLocaleString() ?? "0"}`} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">
                Source: {data?.solar.source === "google_solar" ? "Google Solar roof flux rasters" : "Modeled fallback roof suitability"}.
              </p>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Thermometer className="h-5 w-5 text-[var(--accent-red)]" />
                <h2 className="font-heading text-lg font-semibold">Thermal Envelope</h2>
              </div>
              <div className="space-y-3">
                <StatRow label="Scenario" value={scenarioDisplayLabel(scenario)} />
                <StatRow label="Peak Flux" value={`${thermalPeak.toFixed(1)} W/m²`} />
                <StatRow label="Envelope Band" value={data?.thermal.assumptions.envelopeVintageBand.replaceAll("_", " ") ?? "n/a"} />
                <StatRow label="Heating / Cooling" value={`${analysisResults.heatingPercent}% / ${analysisResults.coolingPercent}%`} />
              </div>
              <div className="mt-4 rounded-2xl border border-[rgba(239,68,68,0.18)] bg-[rgba(239,68,68,0.07)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                This layer is a stylized interpretation of modeled envelope loss using PRISM, weather normalization, and building metadata. It is not CFD.
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Waves className="h-5 w-5 text-[var(--accent-cyan)]" />
                <h2 className="font-heading text-lg font-semibold">Hover Readout</h2>
              </div>
              {hovered ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[rgba(8,15,29,0.78)] p-4">
                  <p className="text-sm font-semibold text-white">{hovered.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{hovered.detail}</p>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  Hover the roof or facades to inspect the Google Solar roof grid or modeled heat-loss patches.
                </p>
              )}
            </GlassCard>

            <GlassCard className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <Building2 className="h-5 w-5 text-[var(--accent-green)]" />
                <h2 className="font-heading text-lg font-semibold">Why This Matters</h2>
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                The 3D view turns abstract audit signals into a decision surface: roof production potential from real Google Solar flux data, facade loss patterns from the modeled envelope, and particle motion that makes retrofit impact legible.
              </p>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[rgba(8,15,29,0.78)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.08)] pb-2 text-sm last:border-b-0">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function pillClassName(active: boolean) {
  return [
    "rounded-full border px-4 py-2 text-sm font-medium transition-all",
    active
      ? "border-[var(--accent-green)] bg-[rgba(0,229,134,0.12)] text-[var(--accent-green)]"
      : "border-[var(--border-subtle)] bg-[rgba(8,15,29,0.78)] text-[var(--text-secondary)] hover:border-[rgba(6,182,212,0.28)] hover:text-white",
  ].join(" ");
}

function tinyPillClassName(active: boolean) {
  return [
    "rounded-full border px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] transition-all",
    active
      ? "border-[var(--accent-cyan)] bg-[rgba(6,182,212,0.12)] text-[var(--accent-cyan)]"
      : "border-[var(--border-subtle)] bg-[rgba(8,15,29,0.78)] text-[var(--text-muted)] hover:border-[rgba(0,229,134,0.28)] hover:text-white",
  ].join(" ");
}
