"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCcw } from "lucide-react";

import { GlassCard } from "@/components/ui/GlassCard";
import type { VisualizationOverlayMode, VisualizationScenario, VisualizationSceneResponse } from "@/lib/visualization";

const MapboxThreeScene = dynamic(() => import("@/components/visualization/MapboxThreeScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[var(--text-secondary)]">
      <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Loading 3D scene
    </div>
  ),
});

type RoofCalibration = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
};

const STORAGE_AUDIT_ID = "auditai.last-visualization-audit-id";
const STORAGE_CALIBRATION = "auditai.dev.roof-calibration";
const DEFAULT_CALIBRATION: RoofCalibration = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
};

export default function VisualizationDevPage() {
  const searchParams = useSearchParams();
  const [auditId, setAuditId] = useState("");
  const [draftAuditId, setDraftAuditId] = useState("");
  const [data, setData] = useState<VisualizationSceneResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<VisualizationOverlayMode>("both");
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [roofCalibration, setRoofCalibration] = useState<RoofCalibration>(DEFAULT_CALIBRATION);

  const scenario: VisualizationScenario = "current";
  const month = 0;

  useEffect(() => {
    const searchAuditId = searchParams.get("auditId");
    const storedAuditId = window.localStorage.getItem(STORAGE_AUDIT_ID) ?? "";
    const nextAuditId = searchAuditId || storedAuditId;
    setAuditId(nextAuditId);
    setDraftAuditId(nextAuditId);

    try {
      const storedCalibration = window.localStorage.getItem(STORAGE_CALIBRATION);
      if (!storedCalibration) {
        return;
      }
      const parsed = JSON.parse(storedCalibration) as Partial<RoofCalibration>;
      setRoofCalibration({
        offsetX: typeof parsed.offsetX === "number" ? parsed.offsetX : DEFAULT_CALIBRATION.offsetX,
        offsetY: typeof parsed.offsetY === "number" ? parsed.offsetY : DEFAULT_CALIBRATION.offsetY,
        scaleX: typeof parsed.scaleX === "number" ? parsed.scaleX : DEFAULT_CALIBRATION.scaleX,
        scaleY: typeof parsed.scaleY === "number" ? parsed.scaleY : DEFAULT_CALIBRATION.scaleY,
        flipX: typeof parsed.flipX === "boolean" ? parsed.flipX : DEFAULT_CALIBRATION.flipX,
        flipY: typeof parsed.flipY === "boolean" ? parsed.flipY : DEFAULT_CALIBRATION.flipY,
      });
    } catch {
      window.localStorage.removeItem(STORAGE_CALIBRATION);
    }
  }, [searchParams]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_CALIBRATION, JSON.stringify(roofCalibration));
  }, [roofCalibration]);

  useEffect(() => {
    if (!auditId) {
      return;
    }

    let active = true;
    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/audits/${auditId}/visualization`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error((await response.text()) || "Visualization request failed");
        }
        const payload = (await response.json()) as VisualizationSceneResponse;
        if (!active) {
          return;
        }
        setData(payload);
        window.localStorage.setItem(STORAGE_AUDIT_ID, auditId);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setData(null);
        setError(loadError instanceof Error ? loadError.message : "Visualization request failed");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [auditId]);

  const sourceSummary = useMemo(() => {
    if (!data) {
      return "No payload loaded";
    }
    return `${data.solar.sourceBuildings.length} solar source${data.solar.sourceBuildings.length === 1 ? "" : "s"}`;
  }, [data]);

  return (
    <div className="min-h-screen px-6 pb-16 pt-24">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link
              href="/results/3d"
              className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" /> Back to 3D Results
            </Link>
            <h1 className="section-title text-navy">3D Visualization Dev</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--text-secondary)]">
              Load a saved audit directly and iterate on the roof overlay without rerunning the full survey.
            </p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4">
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Load Audit</h2>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Uses the last visualization audit id by default.</p>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-navy">Audit ID</span>
                <input
                  value={draftAuditId}
                  onChange={(event) => setDraftAuditId(event.target.value)}
                  className="w-full rounded-[1.1rem] border border-white/60 bg-white/40 px-4 py-3 text-sm text-navy outline-none transition focus:border-[rgba(20,104,183,0.4)]"
                  placeholder="Paste audit id"
                />
              </label>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAuditId(draftAuditId.trim())}
                  className="rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => setAuditId((current) => current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/65 bg-white/45 px-4 py-2 text-sm font-semibold text-navy transition hover:bg-white/65"
                >
                  <RefreshCcw className="h-4 w-4" /> Reload
                </button>
              </div>
              <div className="mt-4 rounded-[1.2rem] border border-white/55 bg-white/30 px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                {auditId ? `Loaded audit: ${auditId}` : "No audit selected."}
                <br />
                {sourceSummary}
              </div>
              {error ? <p className="mt-3 text-sm text-[var(--accent-red)]">{error}</p> : null}
            </GlassCard>

            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4">
                <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Display</h2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["both", "solar", "thermal"] as VisualizationOverlayMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setOverlay(mode)}
                    className={`rounded-full px-3 py-2 text-sm transition ${
                      overlay === mode
                        ? "bg-[rgba(20,104,183,0.16)] text-mid-navy ring-1 ring-[rgba(20,104,183,0.35)]"
                        : "bg-white/35 text-[var(--text-secondary)] ring-1 ring-white/45"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setParticlesEnabled((current) => !current)}
                className="mt-3 w-full rounded-[1.1rem] border border-white/58 bg-white/34 px-4 py-3 text-left text-sm text-navy transition hover:bg-white/52"
              >
                Particle flow: {particlesEnabled ? "On" : "Off"}
              </button>
            </GlassCard>

            <GlassCard className="rounded-[2rem] p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold tracking-[-0.03em] text-navy">Roof Alignment</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Tune locally and tell me the final numbers.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoofCalibration(DEFAULT_CALIBRATION)}
                  className="rounded-full border border-white/65 bg-white/45 px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)] transition hover:bg-white/65"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <CalibrationField label="Offset X" value={roofCalibration.offsetX} min={-0.25} max={0.25} step={0.002} onChange={(value) => setRoofCalibration((current) => ({ ...current, offsetX: value }))} />
                <CalibrationField label="Offset Y" value={roofCalibration.offsetY} min={-0.25} max={0.25} step={0.002} onChange={(value) => setRoofCalibration((current) => ({ ...current, offsetY: value }))} />
                <CalibrationField label="Scale X" value={roofCalibration.scaleX} min={0.4} max={1.4} step={0.01} onChange={(value) => setRoofCalibration((current) => ({ ...current, scaleX: value }))} />
                <CalibrationField label="Scale Y" value={roofCalibration.scaleY} min={0.4} max={1.4} step={0.01} onChange={(value) => setRoofCalibration((current) => ({ ...current, scaleY: value }))} />
              </div>
            </GlassCard>
          </div>

          <GlassCard className="overflow-hidden rounded-[2rem] p-0">
            {isLoading || !data ? (
              <div className="flex h-[820px] items-center justify-center px-6 text-center text-[var(--text-secondary)]">
                {error ? (
                  <span>{error}</span>
                ) : (
                  <>
                    <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Loading visualization payload
                  </>
                )}
              </div>
            ) : (
              <div className="h-[820px] overflow-hidden">
                <MapboxThreeScene
                  data={data}
                  scenario={scenario}
                  overlay={overlay}
                  month={month}
                  particlesEnabled={particlesEnabled}
                  roofCalibration={roofCalibration}
                  onHoverChange={() => {}}
                />
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function CalibrationField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-[1.2rem] border border-white/58 bg-white/34 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-navy">{label}</span>
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">{value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-[rgba(18,52,88,0.12)] accent-[var(--accent-blue)]"
      />
    </label>
  );
}
