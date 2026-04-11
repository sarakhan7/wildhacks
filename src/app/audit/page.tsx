"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Map, { Marker } from "react-map-gl/mapbox";
import 'mapbox-gl/dist/mapbox-gl.css';
import { Search, MapPin, Building, Settings, FileBox, Zap } from "lucide-react";
import { useAudit } from "@/context/AuditContext";
import { StepWizard } from "@/components/ui/StepWizard";
import { GlassCard } from "@/components/ui/GlassCard";
import { FileUpload } from "@/components/ui/FileUpload";
import { LoadingPipeline } from "@/components/ui/LoadingPipeline";
import type { AuditResultsBundle, AuditStatus } from "@/lib/audit-api";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export default function AuditWizard() {
  const router = useRouter();
  const { buildingInfo, setBuildingInfo, setAuditResults, setAuditId } = useAudit();
  
  const [activeStep, setActiveStep] = useState(0);
  const [addressSearch, setAddressSearch] = useState("");
  const [locationError, setLocationError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [analysisError, setAnalysisError] = useState("");

  const steps = ["Location", "Details", "Systems", "Data"];

  const stageToIndex: Record<AuditStatus["stage"], number> = {
    created: 0,
    queued: 0,
    ocr: 1,
    normalize: 1,
    weather: 2,
    analytics: 2,
    diagnostics: 3,
    recommendations: 3,
    report: 3,
    completed: 4,
    needs_review: 4,
    failed: 4,
  };

  // Step 1: Location geocoding handler
  const handleGeocode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressSearch) return;
    
    try {
      setLocationError("");

      const res = await fetch(`/api/geocode?query=${encodeURIComponent(addressSearch)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Location search failed");
      }

      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        setBuildingInfo({
          address: feature.place_name,
          lng: feature.center[0],
          lat: feature.center[1],
        });
        return;
      }

      setLocationError("No matching addresses found. Try a more specific search.");
    } catch (error) {
      console.error("Geocoding failed:", error);
      setLocationError(error instanceof Error ? error.message : "Location search failed");
    }
  };

  // Final submission and analysis trigger
  const runFullAnalysis = async () => {
    if (files.length === 0 && buildingInfo.squareFeet === 0) {
      alert("Please upload at least one utility bill and enter building details.");
      return;
    }

    setIsSubmitting(true);
    setAnalysisStage(0);
    setAnalysisError("");

    try {
      const createRes = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building: buildingInfo }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || createData.detail || "Failed to create audit");
      }

      const auditId = createData.audit_id as string;
      setAuditId(auditId);

      if (files.length > 0) {
        const uploadFormData = new FormData();
        files.forEach((file) => uploadFormData.append("files", file));
        setAnalysisStage(1);
        const uploadRes = await fetch(`/api/audits/${auditId}/files`, {
          method: "POST",
          body: uploadFormData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || uploadData.detail || "Failed to upload utility files");
        }
      }

      const runRes = await fetch(`/api/audits/${auditId}/run`, { method: "POST" });
      const runData = await runRes.json();
      if (!runRes.ok) {
        throw new Error(runData.error || runData.detail || "Failed to queue audit");
      }

      let status: AuditStatus | null = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusRes = await fetch(`/api/audits/${auditId}/status`, { cache: "no-store" });
        const statusData = (await statusRes.json()) as AuditStatus & { detail?: string };
        if (!statusRes.ok) {
          throw new Error(statusData.detail || "Failed to fetch audit status");
        }
        status = statusData;
        setAnalysisStage(stageToIndex[status.stage]);

        if (status.status === "failed") {
          throw new Error(status.error || "Audit analysis failed");
        }

        if (status.status === "completed" || status.status === "needs_review") {
          break;
        }
      }

      const resultsRes = await fetch(`/api/audits/${auditId}/results`, { cache: "no-store" });
      const resultsData = await resultsRes.json();
      if (!resultsRes.ok) {
        throw new Error(resultsData.error || resultsData.detail || "Failed to fetch audit results");
      }

      setAuditResults(resultsData as AuditResultsBundle);
      setAnalysisStage(4);
      setTimeout(() => {
        router.push("/results");
      }, 1000);

    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Analysis failed";
      setAnalysisError(message);
      alert(`${message}. Make sure the Python backend is running and try again.`);
      setIsSubmitting(false);
    }
  };

  if (isSubmitting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <GlassCard className="max-w-2xl w-full p-12 text-center" glow>
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-8"
          >
            <div className="w-24 h-24 bg-gradient-to-br from-[var(--accent-green)] to-[var(--accent-cyan)] rounded-2xl mx-auto flex items-center justify-center shadow-glow-green mb-6 animate-pulse">
              <Settings className="w-12 h-12 text-[#0a0e17] animate-[spin_4s_linear_infinite]" />
            </div>
            <h2 className="text-3xl font-heading font-bold mb-2">Analyzing Facility</h2>
            <p className="text-[var(--text-muted)]">Our multi-agent pipeline is processing your data.</p>
          </motion.div>

          {analysisError && (
            <p className="mb-6 text-sm text-red-300">{analysisError}</p>
          )}
          
          <div className="mt-12 text-left">
            <LoadingPipeline 
              activeStageIdx={analysisStage}
              stages={[
                "Initiating analysis sequence...",
                "Running Gemini OCR on utility bills",
                "Calculating consumption footprint & weather signature",
                "Drafting engineering diagnostic report",
                "Finalizing results dashboard"
              ]}
            />
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center py-12 px-6">
      <div className="max-w-4xl w-full mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-heading font-bold mb-4">Initial Assessment</h1>
        <p className="text-[var(--text-secondary)]">Provide basic details to establish your building&apos;s baseline profile.</p>
      </div>

      <GlassCard className="w-full max-w-4xl p-8 shadow-card border-[var(--border-subtle)]">
        <StepWizard 
          steps={steps} 
          currentStepIndex={activeStep}
          onStepChange={setActiveStep}
        >
          {/* STEP 1: LOCATION */}
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold flex items-center gap-2"><MapPin className="text-[var(--accent-cyan)]" /> Locate Property</h2>
            
            <form onSubmit={handleGeocode} className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                <input 
                  type="text" 
                  value={addressSearch}
                  onChange={(e) => {
                    setAddressSearch(e.target.value);
                    if (locationError) {
                      setLocationError("");
                    }
                  }}
                  placeholder="Enter building address (e.g., 100 Main St, Chicago, IL)"
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)] transition-colors"
                />
              </div>
              <button type="submit" className="btn-secondary whitespace-nowrap">Search</button>
            </form>

            {locationError && (
              <p className="text-sm text-red-300">{locationError}</p>
            )}

            {buildingInfo.lat !== 0 && (
              <div className="h-[300px] w-full rounded-xl overflow-hidden border border-[var(--border-subtle)] relative">
                <Map
                  mapboxAccessToken={MAPBOX_TOKEN}
                  initialViewState={{
                    longitude: buildingInfo.lng,
                    latitude: buildingInfo.lat,
                    zoom: 15,
                    pitch: 45
                  }}
                  mapStyle="mapbox://styles/mapbox/dark-v11"
                  attributionControl={false}
                >
                  <Marker longitude={buildingInfo.lng} latitude={buildingInfo.lat} color="#00e586" />
                </Map>
                <div className="absolute bottom-4 left-4 glass px-4 py-2 text-sm font-medium">
                  {buildingInfo.address}
                </div>
              </div>
            )}
            
            <div className="flex justify-end mt-6">
              <button 
                onClick={() => setActiveStep(1)} 
                disabled={buildingInfo.lat === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next Step
              </button>
            </div>
          </div>

          {/* STEP 2: DETAILS */}
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold flex items-center gap-2"><Building className="text-[var(--accent-blue)]" /> Building Profile</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Primary Use Type</label>
                <select 
                  value={buildingInfo.buildingType}
                  onChange={(e) => setBuildingInfo({ buildingType: e.target.value })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-blue)]"
                >
                  <option value="office">Office</option>
                  <option value="retail">Retail Store</option>
                  <option value="multifamily">Multifamily Housing</option>
                  <option value="hospital">Hospital / Healthcare</option>
                  <option value="k12_school">K-12 School</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="other">Other</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Gross Floor Area (sq ft)</label>
                <input 
                  type="number" 
                  value={buildingInfo.squareFeet || ""}
                  onChange={(e) => setBuildingInfo({ squareFeet: parseInt(e.target.value) || 0 })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-blue)]"
                  placeholder="e.g. 50000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Year Built</label>
                <input 
                  type="number" 
                  value={buildingInfo.yearBuilt || ""}
                  onChange={(e) => setBuildingInfo({ yearBuilt: parseInt(e.target.value) || 0 })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-blue)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Operating Hours (per week)</label>
                <input 
                  type="number" 
                  value={buildingInfo.operatingHours || ""}
                  onChange={(e) => setBuildingInfo({ operatingHours: parseInt(e.target.value) || 0 })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-blue)]"
                  placeholder="e.g. 60"
                />
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={() => setActiveStep(0)} className="btn-secondary">Back</button>
              <button 
                onClick={() => setActiveStep(2)} 
                disabled={!buildingInfo.squareFeet}
                className="btn-primary disabled:opacity-50"
              >
                Next Step
              </button>
            </div>
          </div>

          {/* STEP 3: SYSTEMS */}
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold flex items-center gap-2"><Settings className="text-[var(--accent-purple)]" /> Core Systems</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Primary HVAC Type</label>
                <select 
                  value={buildingInfo.hvacType}
                  onChange={(e) => setBuildingInfo({ hvacType: e.target.value })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-purple)]"
                >
                  <option value="packaged_rtu">Packaged Rooftop Units (RTU)</option>
                  <option value="chiller_boiler">Central Chiller / Boiler Plant</option>
                  <option value="vav">VAV System</option>
                  <option value="vtf">Variable Refrigerant Flow (VRF)</option>
                  <option value="split">Split Systems / Heat Pumps</option>
                  <option value="unknown">Not Sure</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Lighting</label>
                <select 
                  value={buildingInfo.lightingType}
                  onChange={(e) => setBuildingInfo({ lightingType: e.target.value })}
                  className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-3 text-white focus:outline-none focus:border-[var(--accent-purple)]"
                >
                  <option value="led">Mostly LED</option>
                  <option value="fluorescent">Mostly Fluorescent (T8/T12)</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>

            <div className="flex bg-[var(--bg-tertiary)] p-4 rounded-xl border border-[var(--border-subtle)] mt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={buildingInfo.hasRenovations}
                  onChange={(e) => setBuildingInfo({ hasRenovations: e.target.checked })}
                  className="w-5 h-5 rounded border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--accent-green)] focus:ring-[var(--accent-green)]"
                />
                <div>
                  <span className="block font-medium">Major renovations in last 5 years?</span>
                  <span className="text-xs text-[var(--text-muted)]">Envelope, HVAC overhaul, etc.</span>
                </div>
              </label>
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={() => setActiveStep(1)} className="btn-secondary">Back</button>
              <button onClick={() => setActiveStep(3)} className="btn-primary">Next Step</button>
            </div>
          </div>

          {/* STEP 4: DATA UPLOAD */}
          <div className="flex flex-col gap-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-semibold flex items-center gap-2"><FileBox className="text-[var(--accent-amber)]" /> Utility Documents</h2>
                <p className="text-[var(--text-muted)] text-sm mt-1">Upload 12 months of consecutive bills for the most accurate baseline.</p>
              </div>
              <div className="bg-[var(--accent-amber)]/20 text-[var(--accent-amber)] text-xs px-3 py-1 rounded-full font-medium border border-[var(--accent-amber)]/30">
                OCR Enabled
              </div>
            </div>

            <FileUpload 
              onFilesSelected={(f) => setFiles(f)} 
              maxFiles={24}
              className="my-4"
            />
            
            <div className="bg-[var(--bg-tertiary)] border-l-4 border-[var(--accent-green)] p-4 rounded-r-xl">
              <p className="text-sm font-medium">Privacy Notice</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Your data is parsed in-memory using stateless AI models. We do not permanently store your utility bills or use them to train public models.
              </p>
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={() => setActiveStep(2)} className="btn-secondary">Back</button>
              <button onClick={runFullAnalysis} className="btn-primary flex items-center gap-2">
                <Zap className="w-4 h-4" /> Run Audit Pipeline
              </button>
            </div>
          </div>

        </StepWizard>
      </GlassCard>
    </div>
  );
}
