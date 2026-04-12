import "server-only";

import { fromArrayBuffer } from "geotiff";

import type { AuditResultsBundle } from "@/lib/audit-api";
import type {
  SolarVisualization,
  VisualizationGrid,
  VisualizationSceneResponse,
} from "@/lib/visualization";
import { inferBuildingHeightMeters } from "@/lib/visualization";

type SolarDate = { year: number; month: number; day: number };

type BuildingInsightsResponse = {
  imageryDate?: SolarDate;
  postalCode?: string;
  regionCode?: string;
  solarPotential?: {
    maxArrayPanelsCount?: number;
    maxArrayAreaMeters2?: number;
    maxSunshineHoursPerYear?: number;
    wholeRoofStats?: {
      areaMeters2?: number;
      groundAreaMeters2?: number;
      sunshineQuantiles?: number[];
    };
    roofSegmentStats?: Array<{
      pitchDegrees?: number;
      azimuthDegrees?: number;
      stats?: {
        areaMeters2?: number;
        sunshineQuantiles?: number[];
      };
    }>;
  };
};

type DataLayersResponse = {
  imageryDate?: SolarDate;
  imageryProcessedDate?: SolarDate;
  annualFluxUrl?: string;
  monthlyFluxUrl?: string;
  maskUrl?: string;
};

const SOLAR_GRID_SIZE = 32;

function getSolarApiKey() {
  return process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function addKeyToUrl(url: string, key: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("key", key);
  return parsed.toString();
}

async function fetchGoogleJson<T>(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Google Solar request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function fetchGeoTiffGrid(url: string, key: string) {
  const response = await fetch(addKeyToUrl(url, key), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GeoTIFF fetch failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bands: Array.from(rasters, (band) => Array.from(band as ArrayLike<number>)),
  };
}

function downsampleGrid(
  source: number[],
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  mask?: number[],
): VisualizationGrid {
  const values: number[] = [];
  for (let row = 0; row < targetHeight; row += 1) {
    const y0 = Math.floor((row / targetHeight) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) / targetHeight) * height));
    for (let col = 0; col < targetWidth; col += 1) {
      const x0 = Math.floor((col / targetWidth) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) / targetWidth) * width));

      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = y * width + x;
          if (mask && mask[index] <= 0) {
            continue;
          }
          const value = source[index];
          if (!Number.isFinite(value)) {
            continue;
          }
          sum += value;
          count += 1;
        }
      }
      values.push(Number((count > 0 ? sum / count : 0).toFixed(4)));
    }
  }
  return { width: targetWidth, height: targetHeight, values };
}

function buildFallbackSolar(results: AuditResultsBundle): SolarVisualization {
  const roofAreaMeters2 = Math.max(
    40,
    (results.building.squareFeet / Math.max(1, results.building.floors || 1)) * 0.092903,
  );
  const latBias = Math.max(0.5, 1 - Math.abs(results.building.lat - 37) / 40);
  const annualValues: number[] = [];
  const maskValues: number[] = [];
  for (let row = 0; row < SOLAR_GRID_SIZE; row += 1) {
    for (let col = 0; col < SOLAR_GRID_SIZE; col += 1) {
      const nx = col / (SOLAR_GRID_SIZE - 1);
      const ny = row / (SOLAR_GRID_SIZE - 1);
      const radial = 1 - Math.hypot(nx - 0.5, ny - 0.5) * 1.25;
      const ripple = Math.sin(nx * Math.PI * 2.2) * 0.08 + Math.cos(ny * Math.PI * 2.8) * 0.06;
      annualValues.push(Number((Math.max(0, radial + ripple) * 850 * latBias + 320).toFixed(3)));
      maskValues.push(nx > 0.08 && nx < 0.92 && ny > 0.08 && ny < 0.92 ? 1 : 0);
    }
  }

  return {
    source: "modeled_fallback",
    imageryDate: null,
    imageryProcessedDate: null,
    roofStats: {
      areaMeters2: Number(roofAreaMeters2.toFixed(2)),
      groundAreaMeters2: Number((roofAreaMeters2 * 0.78).toFixed(2)),
      sunshineQuantiles: [420, 560, 680, 780, 900, 1020, 1120, 1210, 1310, 1410, 1500],
      maxArrayPanelsCount: Math.round(roofAreaMeters2 / 2.1),
      maxArrayAreaMeters2: Number((roofAreaMeters2 * 0.72).toFixed(2)),
      maxSunshineHoursPerYear: Number((1180 * latBias).toFixed(2)),
      estimatedAnnualKwh: Math.round(roofAreaMeters2 * 22),
      estimatedAnnualSavingsUsd: Math.round(roofAreaMeters2 * 3.4),
    },
    roofSegmentStats: [],
    annualFluxGrid: {
      width: SOLAR_GRID_SIZE,
      height: SOLAR_GRID_SIZE,
      values: annualValues,
    },
    monthlyFluxGrids: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      width: SOLAR_GRID_SIZE,
      height: SOLAR_GRID_SIZE,
      values: annualValues.map((value) =>
        Number((value * (0.72 + Math.sin(((index + 1) / 12) * Math.PI) * 0.2)).toFixed(4)),
      ),
    })),
    roofMaskGrid: {
      width: SOLAR_GRID_SIZE,
      height: SOLAR_GRID_SIZE,
      values: maskValues,
    },
  };
}

export async function buildSolarVisualization(results: AuditResultsBundle): Promise<SolarVisualization> {
  const key = getSolarApiKey();
  if (!key) {
    return buildFallbackSolar(results);
  }

  const { lat, lng } = results.building;
  const baseParams = new URLSearchParams({
    key,
    "location.latitude": String(lat),
    "location.longitude": String(lng),
    requiredQuality: "HIGH",
  });

  try {
    const insights = await fetchGoogleJson<BuildingInsightsResponse>(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?${baseParams}`,
    );

    const layerParams = new URLSearchParams({
      key,
      "location.latitude": String(lat),
      "location.longitude": String(lng),
      radiusMeters: "45",
      view: "FULL_LAYERS",
      requiredQuality: "HIGH",
      exactQualityRequired: "true",
      pixelSizeMeters: "0.5",
    });

    const layers = await fetchGoogleJson<DataLayersResponse>(
      `https://solar.googleapis.com/v1/dataLayers:get?${layerParams}`,
    );

    if (!layers.annualFluxUrl || !layers.monthlyFluxUrl || !layers.maskUrl) {
      return buildFallbackSolar(results);
    }

    const [annual, monthly, mask] = await Promise.all([
      fetchGeoTiffGrid(layers.annualFluxUrl, key),
      fetchGeoTiffGrid(layers.monthlyFluxUrl, key),
      fetchGeoTiffGrid(layers.maskUrl, key),
    ]);

    const maskBand = mask.bands[0];
    const annualFluxGrid = downsampleGrid(
      annual.bands[0],
      annual.width,
      annual.height,
      SOLAR_GRID_SIZE,
      SOLAR_GRID_SIZE,
      maskBand,
    );

    const roofMaskGrid = downsampleGrid(
      maskBand,
      mask.width,
      mask.height,
      SOLAR_GRID_SIZE,
      SOLAR_GRID_SIZE,
    );

    const monthlyFluxGrids = monthly.bands.slice(0, 12).map((band, index) => ({
      month: index + 1,
      ...downsampleGrid(
        band,
        monthly.width,
        monthly.height,
        SOLAR_GRID_SIZE,
        SOLAR_GRID_SIZE,
        maskBand,
      ),
    }));

    const roofStats = insights.solarPotential?.wholeRoofStats;
    const maxSunshineHoursPerYear = insights.solarPotential?.maxSunshineHoursPerYear ?? 0;
    const maxArrayPanelsCount = insights.solarPotential?.maxArrayPanelsCount ?? 0;
    const estimatedAnnualKwh = Math.round(maxArrayPanelsCount * 375 * (maxSunshineHoursPerYear / 1000) * 0.82);
    const estimatedAnnualSavingsUsd = Math.round(estimatedAnnualKwh * 0.14);

    return {
      source: "google_solar",
      imageryDate: layers.imageryDate || insights.imageryDate || null,
      imageryProcessedDate: layers.imageryProcessedDate || null,
      roofStats: {
        areaMeters2: Number((roofStats?.areaMeters2 ?? 0).toFixed(2)),
        groundAreaMeters2: Number((roofStats?.groundAreaMeters2 ?? 0).toFixed(2)),
        sunshineQuantiles: roofStats?.sunshineQuantiles ?? [],
        maxArrayPanelsCount,
        maxArrayAreaMeters2: Number((insights.solarPotential?.maxArrayAreaMeters2 ?? 0).toFixed(2)),
        maxSunshineHoursPerYear: Number(maxSunshineHoursPerYear.toFixed(2)),
        estimatedAnnualKwh,
        estimatedAnnualSavingsUsd,
      },
      roofSegmentStats:
        insights.solarPotential?.roofSegmentStats?.map((segment) => ({
          pitchDegrees: Number((segment.pitchDegrees ?? 0).toFixed(3)),
          azimuthDegrees: Number((segment.azimuthDegrees ?? 0).toFixed(3)),
          areaMeters2: Number((segment.stats?.areaMeters2 ?? 0).toFixed(2)),
          sunshineQuantiles: segment.stats?.sunshineQuantiles ?? [],
        })) ?? [],
      annualFluxGrid,
      monthlyFluxGrids,
      roofMaskGrid,
    };
  } catch {
    return buildFallbackSolar(results);
  }
}

export function buildVisualizationResponse(
  results: AuditResultsBundle,
  solar: SolarVisualization,
  thermal: VisualizationSceneResponse["thermal"],
): VisualizationSceneResponse {
  return {
    building: {
      lat: results.building.lat,
      lng: results.building.lng,
      floors: results.building.floors,
      squareFeet: results.building.squareFeet,
      inferredHeightMeters: inferBuildingHeightMeters(results.building.floors),
    },
    solar,
    thermal,
  };
}
