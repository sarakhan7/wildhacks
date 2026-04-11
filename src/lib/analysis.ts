/**
 * Energy analysis engine — statistical calculations for building audit.
 * All numeric reasoning is deterministic (no LLM).
 */

import { getBenchmarkForType } from "./benchmarks";

export interface UtilityReading {
  month: string;          // "2024-01", "2024-02", etc.
  kwh: number;            // electricity consumption
  therms: number;         // natural gas consumption
  peakKw: number | null;  // peak demand if available
  cost: number;           // total cost
}

export interface BuildingInfo {
  address: string;
  lat: number;
  lng: number;
  buildingType: string;
  squareFeet: number;
  yearBuilt: number;
  floors: number;
  operatingHours: number; // hours per week
  hvacType: string;
  lightingType: string;
  hasRenovations: boolean;
  occupancy: number;      // percentage
}

export interface AnalysisResults {
  totalElectricity: number;    // kWh/year
  totalGas: number;            // therms/year
  totalEnergy: number;         // kBtu/year
  totalCost: number;           // $/year
  siteEUI: number;             // kBtu/ft²
  costPerSqFt: number;        // $/ft²
  electricIntensity: number;   // kWh/ft²
  gasIntensity: number;        // therms/ft² (×1000 for readability)
  loadFactor: number | null;   // average/peak demand ratio
  monthlyBreakdown: MonthlyBreakdown[];
  peakMonth: string;
  lowestMonth: string;
  seasonalVariation: number;   // ratio of peak to lowest
  estimatedBaseload: number;   // kBtu/month — minimum monthly usage
  heatingPercent: number;      // % of energy likely heating
  coolingPercent: number;      // % of energy likely cooling
  baseloadPercent: number;     // % of energy always-on equipment
  annualSavingsOpportunity: number; // estimated $ savings if brought to median
  peerPercentile?: number;
  clusterLabel?: string;
  climateZone?: string;
  anomalyCount?: number;
  prism?: {
    base_temperature_f: number;
    r_squared: number;
    baseload_kbtu_per_month: number;
    heating_slope_kbtu_per_hdd: number;
    cooling_slope_kbtu_per_cdd: number;
    modeled_months: string[];
  };
}

export interface MonthlyBreakdown {
  month: string;
  label: string;         // "Jan 2024", "Feb 2024"
  electricKbtu: number;
  gasKbtu: number;
  totalKbtu: number;
  cost: number;
  isAnomaly: boolean;
}

// kWh to kBtu conversion factor
const KWH_TO_KBTU = 3.412;
// therms to kBtu conversion factor
const THERMS_TO_KBTU = 100;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * Run the full analysis pipeline.
 */
export function runAnalysis(readings: UtilityReading[], building: BuildingInfo): AnalysisResults {
  // Sort readings by month
  const sorted = [...readings].sort((a, b) => a.month.localeCompare(b.month));

  // Calculate totals
  const totalElectricity = sorted.reduce((sum, r) => sum + r.kwh, 0);
  const totalGas = sorted.reduce((sum, r) => sum + r.therms, 0);
  const totalCost = sorted.reduce((sum, r) => sum + r.cost, 0);

  // Convert to kBtu
  const totalElectricKbtu = totalElectricity * KWH_TO_KBTU;
  const totalGasKbtu = totalGas * THERMS_TO_KBTU;
  const totalEnergy = totalElectricKbtu + totalGasKbtu;

  // EUI
  const siteEUI = building.squareFeet > 0 ? totalEnergy / building.squareFeet : 0;
  const costPerSqFt = building.squareFeet > 0 ? totalCost / building.squareFeet : 0;
  const electricIntensity = building.squareFeet > 0 ? totalElectricity / building.squareFeet : 0;
  const gasIntensity = building.squareFeet > 0 ? (totalGas * 1000) / building.squareFeet : 0;

  // Monthly breakdown
  const monthlyBreakdown: MonthlyBreakdown[] = sorted.map(r => {
    const electricKbtu = r.kwh * KWH_TO_KBTU;
    const gasKbtu = r.therms * THERMS_TO_KBTU;
    const dateParts = r.month.split("-");
    const monthIdx = parseInt(dateParts[1]) - 1;
    const year = dateParts[0];
    return {
      month: r.month,
      label: `${MONTH_LABELS[monthIdx]} ${year}`,
      electricKbtu,
      gasKbtu,
      totalKbtu: electricKbtu + gasKbtu,
      cost: r.cost,
      isAnomaly: false,
    };
  });

  // Detect anomalies — simple IQR method on total kBtu
  const totalValues = monthlyBreakdown.map(m => m.totalKbtu).sort((a, b) => a - b);
  const q1 = totalValues[Math.floor(totalValues.length * 0.25)];
  const q3 = totalValues[Math.floor(totalValues.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  monthlyBreakdown.forEach(m => {
    if (m.totalKbtu < lowerBound || m.totalKbtu > upperBound) {
      m.isAnomaly = true;
    }
  });

  // Peak and lowest months
  const peakMonthData = monthlyBreakdown.reduce((max, m) => m.totalKbtu > max.totalKbtu ? m : max);
  const lowestMonthData = monthlyBreakdown.reduce((min, m) => m.totalKbtu < min.totalKbtu ? m : min);
  const seasonalVariation = lowestMonthData.totalKbtu > 0
    ? peakMonthData.totalKbtu / lowestMonthData.totalKbtu
    : 0;

  // Estimate baseload (minimum monthly consumption ≈ always-on equipment)
  const estimatedBaseload = Math.min(...monthlyBreakdown.map(m => m.totalKbtu));
  // Simplified heating/cooling/baseload split
  // Baseload = minimum monthly usage
  // Heating months = those above baseload in cold season (Oct-Mar)
  // Cooling months = those above baseload in warm season (Apr-Sep)
  const baseloadAnnual = estimatedBaseload * 12;
  const baseloadPercent = totalEnergy > 0 ? Math.round((baseloadAnnual / totalEnergy) * 100) : 100;

  let heatingExcess = 0;
  let coolingExcess = 0;

  monthlyBreakdown.forEach(m => {
    const excess = m.totalKbtu - estimatedBaseload;
    if (excess <= 0) return;
    const monthNum = parseInt(m.month.split("-")[1]);
    if (monthNum >= 10 || monthNum <= 3) {
      heatingExcess += excess;
    } else {
      coolingExcess += excess;
    }
  });

  const variableEnergy = heatingExcess + coolingExcess;
  const heatingPercent = variableEnergy > 0
    ? Math.round((heatingExcess / totalEnergy) * 100)
    : 0;
  const coolingPercent = variableEnergy > 0
    ? Math.round((coolingExcess / totalEnergy) * 100)
    : 0;

  // Load factor
  let loadFactor: number | null = null;
  const peakKwReadings = sorted.filter(r => r.peakKw !== null && r.peakKw > 0);
  if (peakKwReadings.length > 0) {
    const avgDemand = totalElectricity / (sorted.length * 730); // 730 hours/month avg
    const peakDemand = Math.max(...peakKwReadings.map(r => r.peakKw!));
    loadFactor = peakDemand > 0 ? avgDemand / peakDemand : null;
  }

  // Estimated savings if brought to median
  const benchmark = getBenchmarkForType(building.buildingType);
  let annualSavingsOpportunity = 0;
  if (siteEUI > benchmark.medianSiteEUI) {
    const excessKbtu = (siteEUI - benchmark.medianSiteEUI) * building.squareFeet;
    const avgCostPerKbtu = totalEnergy > 0 ? totalCost / totalEnergy : 0;
    annualSavingsOpportunity = Math.round(excessKbtu * avgCostPerKbtu);
  }

  return {
    totalElectricity,
    totalGas,
    totalEnergy: Math.round(totalEnergy),
    totalCost: Math.round(totalCost),
    siteEUI: Math.round(siteEUI * 10) / 10,
    costPerSqFt: Math.round(costPerSqFt * 100) / 100,
    electricIntensity: Math.round(electricIntensity * 10) / 10,
    gasIntensity: Math.round(gasIntensity * 10) / 10,
    loadFactor: loadFactor ? Math.round(loadFactor * 100) / 100 : null,
    monthlyBreakdown,
    peakMonth: peakMonthData.label,
    lowestMonth: lowestMonthData.label,
    seasonalVariation: Math.round(seasonalVariation * 10) / 10,
    estimatedBaseload: Math.round(estimatedBaseload),
    heatingPercent: Math.min(heatingPercent, 100 - baseloadPercent),
    coolingPercent: Math.min(coolingPercent, 100 - baseloadPercent - heatingPercent),
    baseloadPercent,
    annualSavingsOpportunity,
  };
}

/**
 * Generate recommended Energy Conservation Measures based on analysis.
 */
export function generateECMSuggestions(
  results: AnalysisResults,
  building: BuildingInfo
): ECMSuggestion[] {
  const ecms: ECMSuggestion[] = [];

  // High EUI overall
  if (results.siteEUI > 80) {
    ecms.push({
      title: "Building Envelope Improvements",
      description: "Install or upgrade insulation, seal air leaks, and consider window upgrades to reduce heating/cooling loads.",
      estimatedSavingsPercent: 15,
      estimatedCostRange: "$10,000 – $50,000",
      paybackYears: 4,
      complexity: "High",
      category: "envelope",
    });
  }

  // High cooling percentage
  if (results.coolingPercent > 25) {
    ecms.push({
      title: "HVAC System Optimization",
      description: "Upgrade to high-efficiency cooling equipment, improve ductwork, and implement smart controls.",
      estimatedSavingsPercent: 20,
      estimatedCostRange: "$5,000 – $30,000",
      paybackYears: 3,
      complexity: "Medium",
      category: "hvac",
    });
  }

  // High heating percentage
  if (results.heatingPercent > 30) {
    ecms.push({
      title: "Heating System Upgrade",
      description: "Consider high-efficiency boilers, heat pumps, or condensing furnaces. Implement programmable thermostats.",
      estimatedSavingsPercent: 18,
      estimatedCostRange: "$8,000 – $40,000",
      paybackYears: 5,
      complexity: "High",
      category: "hvac",
    });
  }

  // Lighting (always applicable if older building)
  if (building.yearBuilt < 2015 || building.lightingType !== "led") {
    ecms.push({
      title: "LED Lighting Retrofit",
      description: "Replace remaining fluorescent/HID fixtures with LED. Add occupancy sensors and daylight harvesting.",
      estimatedSavingsPercent: 12,
      estimatedCostRange: "$2,000 – $15,000",
      paybackYears: 2,
      complexity: "Low",
      category: "lighting",
    });
  }

  // Load factor issue
  if (results.loadFactor !== null && results.loadFactor < 0.65) {
    ecms.push({
      title: "Peak Demand Management",
      description: "Implement demand response controls, stagger equipment startup, or consider battery storage for peak shaving.",
      estimatedSavingsPercent: 10,
      estimatedCostRange: "$5,000 – $25,000",
      paybackYears: 3,
      complexity: "Medium",
      category: "controls",
    });
  }

  // High baseload (always-on equipment)
  if (results.baseloadPercent > 60) {
    ecms.push({
      title: "Plug Load & Equipment Audit",
      description: "Identify always-on equipment, implement smart power strips, schedule off-hours shutdown for non-essential loads.",
      estimatedSavingsPercent: 8,
      estimatedCostRange: "$500 – $5,000",
      paybackYears: 1,
      complexity: "Low",
      category: "equipment",
    });
  }

  // Controls upgrade (operating hours > 60 hrs/week)
  if (building.operatingHours > 60) {
    ecms.push({
      title: "Building Automation System (BAS)",
      description: "Install or upgrade BAS for scheduling, setpoint optimization, and fault detection.",
      estimatedSavingsPercent: 15,
      estimatedCostRange: "$10,000 – $50,000",
      paybackYears: 4,
      complexity: "High",
      category: "controls",
    });
  }

  // Always suggest energy management
  ecms.push({
    title: "Energy Management & Monitoring",
    description: "Install submetering and real-time energy dashboards. Enable continuous commissioning and trend analysis.",
    estimatedSavingsPercent: 5,
    estimatedCostRange: "$2,000 – $10,000",
    paybackYears: 2,
    complexity: "Low",
    category: "monitoring",
  });

  return ecms;
}

export interface ECMSuggestion {
  title: string;
  description: string;
  estimatedSavingsPercent: number;
  estimatedCostRange: string;
  paybackYears: number;
  complexity: "Low" | "Medium" | "High";
  category: string;
}
