import type { AuditResultsBundle } from "@/lib/audit-api";

export type VisualizationScenario = "current" | "improved_insulation" | "rooftop_solar";
export type VisualizationOverlayMode = "solar" | "thermal" | "both";

export type VisualizationGrid = {
  width: number;
  height: number;
  values: number[];
};

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type VisualizationBuilding = {
  lat: number;
  lng: number;
  floors: number;
  squareFeet: number;
  inferredHeightMeters: number;
};

export type SolarSegmentStat = {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2: number;
  sunshineQuantiles: number[];
};

export type SolarSourceBuilding = {
  id: string;
  bounds: GeoBounds;
  center: {
    lat: number;
    lng: number;
  };
};

export type SolarVisualization = {
  source: "google_solar" | "modeled_fallback";
  imageryDate: { year: number; month: number; day: number } | null;
  imageryProcessedDate: { year: number; month: number; day: number } | null;
  gridBounds: GeoBounds;
  buildingBounds: GeoBounds | null;
  renderBounds: GeoBounds;
  solarGrid: VisualizationGrid;
  observedSolarGrid: VisualizationGrid;
  coverageGrid: VisualizationGrid;
  confidenceGrid: VisualizationGrid;
  sourceBuildings: SolarSourceBuilding[];
  roofStats: {
    areaMeters2: number;
    groundAreaMeters2: number;
    sunshineQuantiles: number[];
    maxArrayPanelsCount: number;
    maxArrayAreaMeters2: number;
    maxSunshineHoursPerYear: number;
    estimatedAnnualKwh: number;
    estimatedAnnualSavingsUsd: number;
  };
  roofSegmentStats: SolarSegmentStat[];
  annualFluxGrid: VisualizationGrid;
  monthlyFluxGrids: Array<VisualizationGrid & { month: number }>;
  observedMonthlyFluxGrids: Array<VisualizationGrid & { month: number }>;
  roofMaskGrid: VisualizationGrid;
  gridRadiusMeters?: number;
};

export type VisualizationEntrance = {
  lat: number;
  lng: number;
  kind: string;
  access: string | null;
  door: string | null;
  name: string | null;
};

export type VisualizationSurfaceKind =
  | "roof"
  | "north_wall"
  | "south_wall"
  | "east_wall"
  | "west_wall";

export type VisualizationSurface = {
  id: string;
  kind: VisualizationSurfaceKind;
  patchGrid: { cols: number; rows: number };
  baseFluxWm2: number;
  normalizedIntensity: number;
  emitterRate: number;
  direction: "outward" | "inward";
  patchValues: number[];
};

export type ThermalVisualization = {
  source: "modeled_envelope";
  surfaces: VisualizationSurface[];
  assumptions: {
    indoorHeatingSetpointF: number;
    indoorCoolingSetpointF: number;
    envelopeVintageBand: string;
  };
};

export type VisualizationSceneResponse = {
  building: VisualizationBuilding;
  solar: SolarVisualization;
  thermal: ThermalVisualization;
  entrances: VisualizationEntrance[];
};

const ROOF_GRID = { cols: 32, rows: 32 };
const WALL_GRID = { cols: 16, rows: 8 };

export function inferBuildingHeightMeters(floors: number) {
  const safeFloors = Math.max(1, floors || 1);
  return Number((safeFloors * 3.7 + 1.8).toFixed(2));
}

export function describeEnvelopeVintage(yearBuilt: number, hasRenovations: boolean) {
  if (hasRenovations) {
    return "renovated";
  }
  if (yearBuilt >= 2016) {
    return "high_performance";
  }
  if (yearBuilt >= 2000) {
    return "modern";
  }
  if (yearBuilt >= 1980) {
    return "post_1980";
  }
  if (yearBuilt >= 1960) {
    return "mid_century";
  }
  return "legacy";
}

function getEnvelopeFactors(vintageBand: string) {
  switch (vintageBand) {
    case "high_performance":
      return { roof: 0.72, wall: 0.68, infiltration: 0.55 };
    case "modern":
      return { roof: 0.84, wall: 0.82, infiltration: 0.7 };
    case "post_1980":
      return { roof: 0.96, wall: 0.95, infiltration: 0.84 };
    case "mid_century":
      return { roof: 1.12, wall: 1.06, infiltration: 1.04 };
    case "renovated":
      return { roof: 0.8, wall: 0.78, infiltration: 0.64 };
    default:
      return { roof: 1.24, wall: 1.14, infiltration: 1.16 };
  }
}

function createPatchValues(
  cols: number,
  rows: number,
  baseIntensity: number,
  wave: { x: number; y: number; bias?: number },
) {
  const values: number[] = [];
  const bias = wave.bias ?? 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const nx = cols === 1 ? 0.5 : col / (cols - 1);
      const ny = rows === 1 ? 0.5 : row / (rows - 1);
      const ripple =
        Math.sin((nx + bias) * Math.PI * wave.x) * 0.18 +
        Math.cos((ny + bias) * Math.PI * wave.y) * 0.14 +
        Math.sin((nx + ny) * Math.PI * 2.2) * 0.08;
      values.push(Number((baseIntensity * (1 + ripple)).toFixed(4)));
    }
  }
  return values;
}

function computeOccupancyGainFactor(results: AuditResultsBundle["analysis"], building: AuditResultsBundle["building"]) {
  const occupancyFactor = 0.8 + building.occupancy / 250;
  const scheduleFactor = 0.85 + Math.min(1, building.operatingHours / 60) * 0.35;
  const coolingFactor = 0.75 + results.coolingPercent / 100;
  return occupancyFactor * scheduleFactor * coolingFactor;
}

function createSurface(
  kind: VisualizationSurfaceKind,
  patchGrid: { cols: number; rows: number },
  flux: number,
  wave: { x: number; y: number; bias?: number },
): VisualizationSurface {
  const baseIntensity = Math.abs(flux);
  const patchValues = createPatchValues(patchGrid.cols, patchGrid.rows, baseIntensity, wave);
  const peak = Math.max(...patchValues, 0);
  const normalizedIntensity = Number(Math.min(1, peak / 42).toFixed(4));
  return {
    id: kind,
    kind,
    patchGrid,
    baseFluxWm2: Number(flux.toFixed(3)),
    normalizedIntensity,
    emitterRate: Number((Math.max(0, flux) * (kind === "roof" ? 4.8 : 3.6)).toFixed(2)),
    direction: flux >= 0 ? "outward" : "inward",
    patchValues,
  };
}

export function buildThermalVisualization(results: AuditResultsBundle): ThermalVisualization {
  const { building, analysis, weather } = results;
  const vintageBand = describeEnvelopeVintage(building.yearBuilt, building.hasRenovations);
  const envelopeFactors = getEnvelopeFactors(vintageBand);
  const avgHdd =
    weather.reduce((sum, feature) => sum + feature.hdd, 0) / Math.max(weather.length, 1);
  const avgCdd =
    weather.reduce((sum, feature) => sum + feature.cdd, 0) / Math.max(weather.length, 1);
  const climateSwing = 0.7 + (avgHdd + avgCdd) / 120;
  const occupancyGain = computeOccupancyGainFactor(analysis, building);
  const heatingPressure = analysis.heatingPercent / 100;
  const coolingPressure = analysis.coolingPercent / 100;
  const baseloadPressure = Math.max(0.25, analysis.baseloadPercent / 100);

  const roofFlux =
    (heatingPressure * 22 + coolingPressure * 14 + baseloadPressure * 5.5) *
    envelopeFactors.roof *
    climateSwing;
  const northFlux = (heatingPressure * 20 + baseloadPressure * 4.5) * envelopeFactors.wall * climateSwing;
  const southFlux =
    (heatingPressure * 12 + coolingPressure * 9 + occupancyGain * 2.2) *
    envelopeFactors.wall *
    (0.92 + climateSwing * 0.08);
  const eastFlux =
    (coolingPressure * 10 + heatingPressure * 7 + occupancyGain * 1.4) *
    envelopeFactors.wall *
    (0.88 + envelopeFactors.infiltration * 0.12);
  const westFlux =
    (coolingPressure * 13 + heatingPressure * 6 + occupancyGain * 1.8) *
    envelopeFactors.wall *
    (0.96 + envelopeFactors.infiltration * 0.16);

  return {
    source: "modeled_envelope",
    surfaces: [
      createSurface("roof", ROOF_GRID, roofFlux, { x: 3.2, y: 2.5, bias: 0.18 }),
      createSurface("north_wall", WALL_GRID, northFlux, { x: 1.4, y: 2.8, bias: 0.06 }),
      createSurface("south_wall", WALL_GRID, southFlux, { x: 1.8, y: 3.2, bias: 0.24 }),
      createSurface("east_wall", WALL_GRID, eastFlux, { x: 2.4, y: 2.6, bias: 0.41 }),
      createSurface("west_wall", WALL_GRID, westFlux, { x: 2.7, y: 2.1, bias: 0.59 }),
    ],
    assumptions: {
      indoorHeatingSetpointF: 70,
      indoorCoolingSetpointF: 74,
      envelopeVintageBand: vintageBand,
    },
  };
}

export function applyScenarioToThermal(
  thermal: ThermalVisualization,
  scenario: VisualizationScenario,
  month: number,
) {
  const multipliers =
    scenario === "improved_insulation"
      ? { roof: 0.55, wall: 0.7 }
      : scenario === "rooftop_solar" && [5, 6, 7, 8, 9].includes(month)
        ? { roof: 0.72, wall: 1 }
        : { roof: 1, wall: 1 };

  return thermal.surfaces.map((surface) => {
    const factor = surface.kind === "roof" ? multipliers.roof : multipliers.wall;
    const patchValues = surface.patchValues.map((value) => Number((value * factor).toFixed(4)));
    const baseFluxWm2 = Number((surface.baseFluxWm2 * factor).toFixed(3));
    const peak = Math.max(...patchValues, 0);
    return {
      ...surface,
      patchValues,
      baseFluxWm2,
      normalizedIntensity: Number(Math.min(1, peak / 42).toFixed(4)),
      emitterRate: Number((Math.max(0, baseFluxWm2) * (surface.kind === "roof" ? 4.8 : 3.6)).toFixed(2)),
      direction: baseFluxWm2 >= 0 ? "outward" : "inward",
    };
  });
}
