/**
 * ENERGY STAR national median EUI benchmarks by building type.
 * Source: EPA ENERGY STAR Portfolio Manager Technical Reference
 * "U.S. National Energy Use Intensity" (August 2024 update).
 * Values are in kBtu/ft² (site EUI).
 */

export interface BuildingBenchmark {
  type: string;
  label: string;
  medianSiteEUI: number;    // kBtu/ft² — median
  topQuartileEUI: number;   // kBtu/ft² — 25th percentile (efficient)
  bottomQuartileEUI: number; // kBtu/ft² — 75th percentile (inefficient)
  medianSourceEUI: number;  // kBtu/ft² — source energy
}

export const BUILDING_BENCHMARKS: BuildingBenchmark[] = [
  { type: "office", label: "Office", medianSiteEUI: 54.0, topQuartileEUI: 32.0, bottomQuartileEUI: 82.0, medianSourceEUI: 131.8 },
  { type: "retail", label: "Retail Store", medianSiteEUI: 51.9, topQuartileEUI: 28.0, bottomQuartileEUI: 80.0, medianSourceEUI: 122.5 },
  { type: "grocery", label: "Grocery / Food Sales", medianSiteEUI: 179.6, topQuartileEUI: 120.0, bottomQuartileEUI: 250.0, medianSourceEUI: 460.0 },
  { type: "restaurant", label: "Restaurant / Food Service", medianSiteEUI: 254.0, topQuartileEUI: 150.0, bottomQuartileEUI: 380.0, medianSourceEUI: 580.0 },
  { type: "healthcare", label: "Healthcare / Clinic", medianSiteEUI: 80.5, topQuartileEUI: 48.0, bottomQuartileEUI: 120.0, medianSourceEUI: 194.0 },
  { type: "hospital", label: "Hospital", medianSiteEUI: 168.3, topQuartileEUI: 120.0, bottomQuartileEUI: 230.0, medianSourceEUI: 389.0 },
  { type: "hotel", label: "Hotel", medianSiteEUI: 68.3, topQuartileEUI: 44.0, bottomQuartileEUI: 95.0, medianSourceEUI: 148.0 },
  { type: "k12_school", label: "K-12 School", medianSiteEUI: 45.2, topQuartileEUI: 28.0, bottomQuartileEUI: 65.0, medianSourceEUI: 110.0 },
  { type: "university", label: "College / University", medianSiteEUI: 95.8, topQuartileEUI: 60.0, bottomQuartileEUI: 140.0, medianSourceEUI: 218.0 },
  { type: "warehouse", label: "Warehouse / Storage", medianSiteEUI: 20.6, topQuartileEUI: 10.0, bottomQuartileEUI: 35.0, medianSourceEUI: 43.0 },
  { type: "multifamily", label: "Multifamily Housing", medianSiteEUI: 53.8, topQuartileEUI: 32.0, bottomQuartileEUI: 78.0, medianSourceEUI: 115.0 },
  { type: "worship", label: "Worship Facility", medianSiteEUI: 37.1, topQuartileEUI: 20.0, bottomQuartileEUI: 58.0, medianSourceEUI: 82.0 },
  { type: "lab", label: "Laboratory", medianSiteEUI: 164.7, topQuartileEUI: 100.0, bottomQuartileEUI: 240.0, medianSourceEUI: 390.0 },
  { type: "data_center", label: "Data Center", medianSiteEUI: 562.0, topQuartileEUI: 300.0, bottomQuartileEUI: 900.0, medianSourceEUI: 1636.0 },
  { type: "convention", label: "Convention Center", medianSiteEUI: 52.7, topQuartileEUI: 30.0, bottomQuartileEUI: 80.0, medianSourceEUI: 120.0 },
  { type: "mixed_use", label: "Mixed Use Property", medianSiteEUI: 60.0, topQuartileEUI: 35.0, bottomQuartileEUI: 90.0, medianSourceEUI: 140.0 },
  { type: "other", label: "Other", medianSiteEUI: 62.0, topQuartileEUI: 35.0, bottomQuartileEUI: 95.0, medianSourceEUI: 146.0 },
];

export function getBenchmarkForType(type: string): BuildingBenchmark {
  return BUILDING_BENCHMARKS.find(b => b.type === type) || BUILDING_BENCHMARKS[BUILDING_BENCHMARKS.length - 1];
}

/**
 * Calculate percentile rank of building's EUI within its type.
 * Uses a simplified linear interpolation between known quartiles.
 */
export function calculateEUIPercentile(siteEUI: number, buildingType: string): number {
  const benchmark = getBenchmarkForType(buildingType);

  // Lower EUI = better = higher percentile
  if (siteEUI <= benchmark.topQuartileEUI) {
    // Better than top quartile — 75th–100th percentile
    const ratio = Math.max(0, siteEUI / benchmark.topQuartileEUI);
    return 75 + (1 - ratio) * 25;
  } else if (siteEUI <= benchmark.medianSiteEUI) {
    // Between top quartile and median — 50th–75th
    const ratio = (siteEUI - benchmark.topQuartileEUI) / (benchmark.medianSiteEUI - benchmark.topQuartileEUI);
    return 75 - ratio * 25;
  } else if (siteEUI <= benchmark.bottomQuartileEUI) {
    // Between median and bottom quartile — 25th–50th
    const ratio = (siteEUI - benchmark.medianSiteEUI) / (benchmark.bottomQuartileEUI - benchmark.medianSiteEUI);
    return 50 - ratio * 25;
  } else {
    // Worse than bottom quartile — 0–25th
    const excess = siteEUI - benchmark.bottomQuartileEUI;
    const range = benchmark.bottomQuartileEUI - benchmark.medianSiteEUI;
    const ratio = Math.min(1, excess / range);
    return 25 * (1 - ratio);
  }
}

/**
 * Get rating label and color from percentile.
 */
export function getPerformanceRating(percentile: number): { label: string; color: string; grade: string } {
  if (percentile >= 75) return { label: "Excellent", color: "#00e586", grade: "A" };
  if (percentile >= 50) return { label: "Good", color: "#06b6d4", grade: "B" };
  if (percentile >= 25) return { label: "Fair", color: "#f59e0b", grade: "C" };
  return { label: "Poor", color: "#ef4444", grade: "D" };
}
