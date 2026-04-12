"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Map, { Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Building2,
  CheckCircle2,
  FileBox,
  MapPin,
  Search,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";

import { useAudit } from "@/context/AuditContext";
import { FileUpload } from "@/components/ui/FileUpload";
import { GlassCard } from "@/components/ui/GlassCard";
import { LoadingPipeline } from "@/components/ui/LoadingPipeline";
import type { BuildingInfo } from "@/lib/analysis";
import type { AuditResultsBundle, AuditStatus } from "@/lib/audit-api";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const steps = [
  { id: "location", label: "Location", icon: MapPin },
  { id: "details", label: "Profile", icon: Building2 },
  { id: "systems", label: "Systems", icon: Settings2 },
  { id: "files", label: "Bills", icon: FileBox },
];

const buildingTypes = [
  { value: "office", label: "Office" },
  { value: "university", label: "College / University" },
  { value: "lab", label: "Laboratory" },
  { value: "retail", label: "Retail Store" },
  { value: "multifamily", label: "Multifamily Housing" },
  { value: "hospital", label: "Hospital / Healthcare" },
  { value: "k12_school", label: "K-12 School" },
  { value: "warehouse", label: "Warehouse" },
  { value: "other", label: "Other" },
];

const hvacTypes = [
  { value: "packaged_rtu", label: "Packaged rooftop units" },
  { value: "chiller_boiler", label: "Central chiller / boiler plant" },
  { value: "vav", label: "VAV system" },
  { value: "vrf", label: "VRF / heat pump" },
  { value: "split", label: "Split systems" },
  { value: "unknown", label: "Not sure" },
];

const lightingTypes = [
  { value: "led", label: "Mostly LED" },
  { value: "fluorescent", label: "Mostly fluorescent" },
  { value: "mixed", label: "Mixed lighting" },
];

type LocationSuggestion = {
  id: string;
  name: string;
  full_address: string;
  place_formatted: string;
  feature_type: string;
  center: [number, number];
};

const TECH_INSTITUTE_PROFILE_PRESET: Partial<BuildingInfo> = {
  buildingType: "university",
  squareFeet: 800000,
  floors: 5,
  operatingHours: 82,
};

function getLocationProfilePreset(feature: LocationSuggestion): Partial<BuildingInfo> {
  const normalized = `${feature.name} ${feature.full_address}`.toLowerCase();
  if (
    normalized.includes("technological institute") ||
    normalized.includes("2145 sheridan") ||
    (normalized.includes("northwestern") && normalized.includes("evanston"))
  ) {
    return TECH_INSTITUTE_PROFILE_PRESET;
  }
  return {};
}

function getMissingProfileFields(buildingInfo: BuildingInfo): string[] {
  const missing: string[] = [];
  if (!buildingInfo.address.trim()) {
    missing.push("location");
  }
  if (buildingInfo.squareFeet <= 0) {
    missing.push("gross floor area");
  }
  if (buildingInfo.yearBuilt < 1800) {
    missing.push("year built");
  }
  if (buildingInfo.floors <= 0) {
    missing.push("floor count");
  }
  if (buildingInfo.operatingHours <= 0) {
    missing.push("weekly operating hours");
  }
  return missing;
}

export default function AuditWizard() {
  const router = useRouter();
  const { buildingInfo, setBuildingInfo, setAuditId, setAuditResults } = useAudit();

  const [activeStep, setActiveStep] = useState(0);
  const [addressSearch, setAddressSearch] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const skipNextAutocompleteRef = useRef(false);

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

  const searchLocations = async (query: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`, {
      signal,
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Location search failed");
    }

    return (data.features ?? []) as LocationSuggestion[];
  };

  const selectLocation = (feature: LocationSuggestion) => {
    const preset = getLocationProfilePreset(feature);
    skipNextAutocompleteRef.current = true;
    setAddressSearch(feature.full_address);
    setLocationSuggestions([]);
    setLocationError("");
    setBuildingInfo({
      address: feature.full_address,
      lng: feature.center[0],
      lat: feature.center[1],
      ...preset,
    });
  };

  useEffect(() => {
    const query = addressSearch.trim();

    if (skipNextAutocompleteRef.current) {
      skipNextAutocompleteRef.current = false;
      setIsSearchingLocation(false);
      return;
    }

    if (query.length < 3) {
      setLocationSuggestions([]);
      setIsSearchingLocation(false);
      setLocationError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearchingLocation(true);
        const features = await searchLocations(query, controller.signal);
        setLocationSuggestions(features);
        setLocationError(features.length === 0 ? "No matching addresses found yet. Try a full street address." : "");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setLocationSuggestions([]);
        setLocationError(error instanceof Error ? error.message : "Location search failed");
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingLocation(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [addressSearch]);

  const handleGeocode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addressSearch.trim()) {
      return;
    }

    try {
      setLocationError("");
      setIsSearchingLocation(true);
      const features = await searchLocations(addressSearch.trim());

      if (features.length === 1) {
        selectLocation(features[0]);
        return;
      }

      setLocationSuggestions(features);
      setLocationError(
        features.length > 1
          ? "Select the exact property from the list below."
          : "No matching addresses found. Try a street number, city, and state.",
      );
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Location search failed");
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const runFullAnalysis = async () => {
    const missingProfileFields = getMissingProfileFields(buildingInfo);
    if (missingProfileFields.length > 0) {
      setAnalysisError(`Confirm the ${missingProfileFields.join(", ")} before running the audit.`);
      return;
    }

    setIsSubmitting(true);
    setAnalysisStage(0);
    setAnalysisError("");

    try {
      const createResponse = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building: buildingInfo }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || createData.detail || "Failed to create audit");
      }

      const auditId = createData.audit_id as string;
      setAuditId(auditId);

      if (files.length > 0) {
        const uploadFormData = new FormData();
        files.forEach((file) => uploadFormData.append("files", file));
        setAnalysisStage(1);
        const uploadResponse = await fetch(`/api/audits/${auditId}/files`, {
          method: "POST",
          body: uploadFormData,
        });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          throw new Error(uploadData.error || uploadData.detail || "Failed to upload utility files");
        }
      }

      const runResponse = await fetch(`/api/audits/${auditId}/run`, { method: "POST" });
      const runData = await runResponse.json();
      if (!runResponse.ok) {
        throw new Error(runData.error || runData.detail || "Failed to queue audit");
      }

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResponse = await fetch(`/api/audits/${auditId}/status`, { cache: "no-store" });
        const statusData = (await statusResponse.json()) as AuditStatus & { detail?: string };
        if (!statusResponse.ok) {
          throw new Error(statusData.detail || "Failed to fetch audit status");
        }

        setAnalysisStage(stageToIndex[statusData.stage]);

        if (statusData.status === "failed") {
          throw new Error(statusData.error || "Audit analysis failed");
        }

        if (statusData.status === "completed" || statusData.status === "needs_review") {
          break;
        }
      }

      const resultsResponse = await fetch(`/api/audits/${auditId}/results`, { cache: "no-store" });
      const resultsData = await resultsResponse.json();
      if (!resultsResponse.ok) {
        throw new Error(resultsData.error || resultsData.detail || "Failed to fetch audit results");
      }

      setAuditResults(resultsData as AuditResultsBundle);
      setAnalysisStage(4);

      setTimeout(() => {
        router.push("/results");
      }, 900);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      setAnalysisError(message);
      setIsSubmitting(false);
    }
  };

  if (isSubmitting) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 pb-16 pt-32">
        <GlassCard strong className="w-full max-w-3xl rounded-[2rem] p-8 sm:p-10">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-[var(--accent-blue-dim)] text-mid-navy">
              <Sparkles className="h-8 w-8" />
            </div>
            <span className="eyebrow">Running audit</span>
            <h1 className="mt-4 font-heading text-[2.4rem] font-extrabold tracking-[-0.05em] text-navy">
              Analyzing your building.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[1rem] leading-7 text-[var(--text-secondary)]">
              We&apos;re parsing bills, normalizing weather, checking anomalies, and drafting the report.
            </p>
            {analysisError && <p className="mt-5 text-sm text-[var(--accent-red)]">{analysisError}</p>}
          </div>

          <div className="mt-10">
            <LoadingPipeline
              activeStageIdx={analysisStage}
              stages={[
                "Creating your audit workspace",
                "Parsing uploaded utility bills",
                "Running weather and benchmark analysis",
                "Drafting recommendations and report",
                "Packaging the results dashboard",
              ]}
            />
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pb-20 pt-32">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <span className="eyebrow">Step 01 · Upload</span>
          <h1 className="section-title mt-4 text-navy">
            Tell us your
            <span className="block text-mid-navy">building.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[1rem] leading-8 text-[var(--text-secondary)]">
            Build the baseline profile, upload the past year of utility bills, and let the pipeline generate
            the audit.
          </p>
        </div>

        <div className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <GlassCard strong className="rounded-[2rem] p-5 sm:p-7">
            <div className="grid gap-3 sm:grid-cols-4">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = activeStep === index;
                const isComplete = activeStep > index;

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      if (index <= activeStep) {
                        setActiveStep(index);
                      }
                    }}
                    className={[
                      "flex items-center gap-3 rounded-[1.3rem] border px-4 py-4 text-left transition-colors",
                      isActive ? "border-white/80 bg-white/48" : "border-white/48 bg-white/20",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-11 w-11 items-center justify-center rounded-[1rem]",
                        isComplete || isActive ? "bg-[var(--accent-blue-dim)] text-mid-navy" : "bg-white/52 text-[var(--text-muted)]",
                      ].join(" ")}
                    >
                      {isComplete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="font-heading text-[1rem] font-bold tracking-[-0.04em] text-navy">{step.label}</div>
                      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {isComplete ? "Complete" : isActive ? "Current step" : "Upcoming"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-8">
              {activeStep === 0 && (
                <div className="space-y-6">
                  <SectionHeader
                    title="Locate the property"
                    description="Search by address or building name. We use this to geocode the site and seed peer benchmarks."
                  />

                  <form onSubmit={handleGeocode} className="flex flex-col gap-3 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        value={addressSearch}
                        onChange={(event) => {
                          skipNextAutocompleteRef.current = false;
                          setAddressSearch(event.target.value);
                          if (locationError) {
                            setLocationError("");
                          }
                        }}
                        placeholder="350 Fifth Avenue, New York, NY"
                        className="h-14 w-full rounded-full border border-white/70 bg-white/50 pl-12 pr-5 text-[0.98rem] text-navy outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-white"
                      />
                    </div>
                    <button type="submit" className="btn-primary min-w-[11rem]">
                      {isSearchingLocation ? "Searching..." : "Find building"}
                    </button>
                  </form>

                  {(isSearchingLocation || locationSuggestions.length > 0) && (
                    <div className="overflow-hidden rounded-[1.6rem] border border-white/65 bg-white/36">
                      {isSearchingLocation && locationSuggestions.length === 0 ? (
                        <div className="px-5 py-4 text-sm text-[var(--text-muted)]">Looking up matching properties...</div>
                      ) : (
                        <ul className="divide-y divide-white/50">
                          {locationSuggestions.map((feature, index) => (
                            <li key={`${feature.id}-${index}`}>
                              <button
                                type="button"
                                onClick={() => selectLocation(feature)}
                                className="w-full px-5 py-4 text-left transition-colors hover:bg-white/32"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <div className="font-medium text-navy">{feature.full_address}</div>
                                    {feature.place_formatted && (
                                      <div className="mt-1 text-sm text-[var(--text-secondary)]">{feature.place_formatted}</div>
                                    )}
                                  </div>
                                  <span className="rounded-full bg-[var(--accent-blue-dim)] px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-mid-navy">
                                    {feature.feature_type || "match"}
                                  </span>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {locationError && <p className="text-sm text-[var(--accent-red)]">{locationError}</p>}

                  {buildingInfo.lat !== 0 && (
                    <div className="overflow-hidden rounded-[1.8rem] border border-white/65 bg-white/24">
                      <div className="h-[22rem]">
                        <Map
                          mapboxAccessToken={MAPBOX_TOKEN}
                          initialViewState={{
                            longitude: buildingInfo.lng,
                            latitude: buildingInfo.lat,
                            zoom: 15,
                            pitch: 42,
                          }}
                          mapStyle="mapbox://styles/mapbox/light-v11"
                          attributionControl={false}
                        >
                          <Marker longitude={buildingInfo.lng} latitude={buildingInfo.lat} color="#1a6040" />
                        </Map>
                      </div>
                      <div className="border-t border-white/55 px-5 py-4">
                        <div className="font-heading text-[1.15rem] font-bold tracking-[-0.04em] text-navy">
                          {buildingInfo.address}
                        </div>
                        <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          Location confirmed
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeStep === 1 && (
                <div className="space-y-6">
                  <SectionHeader
                    title="Describe the building"
                    description="These inputs help the benchmark and ECM ranking land in the right operating context."
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Primary use type">
                      <select
                        value={buildingInfo.buildingType}
                        onChange={(event) => setBuildingInfo({ buildingType: event.target.value })}
                        className={fieldClassName}
                      >
                        {buildingTypes.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Gross floor area (sq ft)">
                      <input
                        type="number"
                        value={buildingInfo.squareFeet || ""}
                        onChange={(event) => setBuildingInfo({ squareFeet: Number(event.target.value) || 0 })}
                        className={fieldClassName}
                        placeholder="160000"
                      />
                    </FormField>

                    <FormField label="Year built">
                      <input
                        type="number"
                        value={buildingInfo.yearBuilt || ""}
                        onChange={(event) => setBuildingInfo({ yearBuilt: Number(event.target.value) || 0 })}
                        className={fieldClassName}
                        placeholder="1940"
                      />
                    </FormField>

                    <FormField label="Floors">
                      <input
                        type="number"
                        value={buildingInfo.floors || ""}
                        onChange={(event) => setBuildingInfo({ floors: Number(event.target.value) || 0 })}
                        className={fieldClassName}
                        placeholder="5"
                      />
                    </FormField>

                    <FormField label="Operating hours per week">
                      <input
                        type="number"
                        value={buildingInfo.operatingHours || ""}
                        onChange={(event) => setBuildingInfo({ operatingHours: Number(event.target.value) || 0 })}
                        className={fieldClassName}
                        placeholder="80"
                      />
                    </FormField>

                    <FormField label="Typical occupancy (%)">
                      <input
                        type="number"
                        value={buildingInfo.occupancy || ""}
                        onChange={(event) => setBuildingInfo({ occupancy: Number(event.target.value) || 0 })}
                        className={fieldClassName}
                        placeholder="90"
                      />
                    </FormField>
                  </div>
                </div>
              )}

              {activeStep === 2 && (
                <div className="space-y-6">
                  <SectionHeader
                    title="Capture the main systems"
                    description="We use these signals to prioritize the likely drivers behind excess energy use."
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Primary HVAC type">
                      <select
                        value={buildingInfo.hvacType}
                        onChange={(event) => setBuildingInfo({ hvacType: event.target.value })}
                        className={fieldClassName}
                      >
                        {hvacTypes.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Lighting system">
                      <select
                        value={buildingInfo.lightingType}
                        onChange={(event) => setBuildingInfo({ lightingType: event.target.value })}
                        className={fieldClassName}
                      >
                        {lightingTypes.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <label className="flex cursor-pointer items-start gap-4 rounded-[1.5rem] border border-white/65 bg-white/36 px-5 py-5">
                    <input
                      type="checkbox"
                      checked={buildingInfo.hasRenovations}
                      onChange={(event) => setBuildingInfo({ hasRenovations: event.target.checked })}
                      className="mt-1 h-5 w-5 rounded border-white/60 accent-[var(--mid-navy)]"
                    />
                    <div>
                      <div className="font-heading text-[1.05rem] font-bold tracking-[-0.04em] text-navy">
                        Major renovations in the last 5 years
                      </div>
                      <div className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
                        Check this if the building has seen a major HVAC overhaul, envelope work, or significant
                        retrofit recently.
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {activeStep === 3 && (
                <div className="space-y-6">
                  <SectionHeader
                    title="Upload the utility bills"
                    description="A full year of bills gives the cleanest baseline, but you can still run the audit with fewer files."
                  />

                  <FileUpload onFilesSelected={setFiles} maxFiles={24} />

                  <div className="rounded-[1.5rem] border border-white/65 bg-white/34 px-5 py-5">
                    <div className="font-heading text-[1.05rem] font-bold tracking-[-0.04em] text-navy">Privacy notice</div>
                    <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
                      Utility files are parsed for the audit workflow only. They are not used to train public models.
                    </p>
                  </div>

                  {analysisError && <p className="text-sm text-[var(--accent-red)]">{analysisError}</p>}
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/60 pt-6">
              <button
                type="button"
                onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                className="btn-secondary"
                disabled={activeStep === 0}
              >
                Back
              </button>

              {activeStep < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}
                  className="btn-primary"
                  disabled={
                    (activeStep === 0 && buildingInfo.lat === 0) ||
                    (activeStep === 1 && !buildingInfo.squareFeet) ||
                    (activeStep === 2 && !buildingInfo.hvacType)
                  }
                >
                  Continue
                </button>
              ) : (
                <button type="button" onClick={runFullAnalysis} className="btn-primary">
                  <Zap className="h-4 w-4" /> Run audit pipeline
                </button>
              )}
            </div>
          </GlassCard>

          <div className="space-y-6">
            <GlassCard className="rounded-[2rem]">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Building profile
              </div>
              <div className="mt-4 space-y-4">
                <SidebarValue label="Address" value={buildingInfo.address || "Waiting for a confirmed location"} />
                <SidebarValue
                  label="Type"
                  value={buildingTypes.find((option) => option.value === buildingInfo.buildingType)?.label || "Office"}
                />
                <SidebarValue
                  label="Floor area"
                  value={buildingInfo.squareFeet ? `${buildingInfo.squareFeet.toLocaleString()} sq ft` : "Add profile details"}
                />
                <SidebarValue label="Year built" value={buildingInfo.yearBuilt ? String(buildingInfo.yearBuilt) : "Not set"} />
                <SidebarValue
                  label="HVAC"
                  value={hvacTypes.find((option) => option.value === buildingInfo.hvacType)?.label || "Not set"}
                />
                <SidebarValue
                  label="Lighting"
                  value={lightingTypes.find((option) => option.value === buildingInfo.lightingType)?.label || "Not set"}
                />
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Audit checklist
              </div>
              <div className="mt-4 space-y-3">
                <ChecklistRow label="Property located" done={buildingInfo.lat !== 0} />
                <ChecklistRow label="Building profile added" done={Boolean(buildingInfo.squareFeet && buildingInfo.yearBuilt)} />
                <ChecklistRow label="Systems captured" done={Boolean(buildingInfo.hvacType && buildingInfo.lightingType)} />
                <ChecklistRow label="Utility bills uploaded" done={files.length > 0} />
              </div>
            </GlassCard>

            <GlassCard className="rounded-[2rem]">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                What the pipeline does
              </div>
              <div className="mt-4 space-y-3 text-sm leading-7 text-[var(--text-secondary)]">
                <p>1. Extract meter, usage, demand, and cost data from uploaded bills.</p>
                <p>2. Normalize the year against weather and benchmark against similar buildings.</p>
                <p>3. Flag anomalies and rank the highest-value ECMs for the report.</p>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="font-heading text-[1.8rem] font-extrabold tracking-[-0.05em] text-navy">{title}</h2>
      <p className="mt-2 max-w-3xl text-[0.98rem] leading-8 text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      {children}
    </label>
  );
}

function SidebarValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-white/56 bg-white/34 px-4 py-3">
      <div className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-sm leading-6 text-navy">{value}</div>
    </div>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-full border border-white/56 bg-white/30 px-4 py-3">
      <span className="text-sm text-navy">{label}</span>
      <span
        className={[
          "inline-flex items-center rounded-full px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.16em]",
          done ? "bg-[var(--accent-green-dim)] text-success" : "bg-white/55 text-[var(--text-muted)]",
        ].join(" ")}
      >
        {done ? "Ready" : "Pending"}
      </span>
    </div>
  );
}

const fieldClassName =
  "h-14 w-full rounded-[1.1rem] border border-white/70 bg-white/48 px-4 text-[0.96rem] text-navy outline-none transition-colors focus:border-white";
