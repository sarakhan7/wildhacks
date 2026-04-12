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

const SOLAR_GRID_RADIUS = 350;
const SOLAR_GRID_SIZE = 150;

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

function downsampleAndMask(
  source: number[],
  width: number,
  height: number,
  mask?: number[]
): VisualizationGrid {
  const targetSize = 150;
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / targetSize));
  const newWidth = Math.ceil(width / scale);
  const newHeight = Math.ceil(height / scale);

  const values: number[] = [];
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      let sum = 0;
      let count = 0;
      let maskedOut = false;

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const srcX = x * scale + dx;
          const srcY = y * scale + dy;
          if (srcX < width && srcY < height) {
            const i = srcY * width + srcX;
            if (mask && mask[i] <= 0) {
              maskedOut = true;
            } else if (Number.isFinite(source[i])) {
              sum += source[i];
              count++;
            }
          }
        }
      }

      if (maskedOut && count === 0) {
        values.push(0);
      } else {
        const val = count > 0 ? sum / count : 0;
        values.push(Number(val.toFixed(4)));
      }
    }
  }

  return { width: newWidth, height: newHeight, values };
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

      // Simulate realistic roof irradiance with ridge lines and segments
      const centerDist = Math.hypot(nx - 0.5, ny - 0.5);
      const radial = Math.max(0, 1 - centerDist * 1.6);

      // Roof ridge line (bright center line)
      const ridgeLine = Math.exp(-Math.pow((ny - 0.48) * 8, 2)) * 0.35;

      // Roof segments with different pitches (like the reference image)
      const segSouth = ny > 0.48 ? Math.cos((ny - 0.48) * Math.PI * 1.1) * 0.4 : 0;
      const segNorth = ny <= 0.48 ? Math.cos((0.48 - ny) * Math.PI * 1.3) * 0.25 : 0;

      // Edge shadows and obstructions
      const edgeFalloff = Math.min(
        Math.min(nx, 1 - nx) * 4,
        Math.min(ny, 1 - ny) * 4,
      );
      const edgePenalty = Math.min(1, edgeFalloff);

      // Random-ish structural features (HVAC units, skylights)
      const feature1 = Math.exp(-Math.pow((nx - 0.25) * 12, 2) - Math.pow((ny - 0.3) * 12, 2)) * -0.5;
      const feature2 = Math.exp(-Math.pow((nx - 0.7) * 10, 2) - Math.pow((ny - 0.65) * 10, 2)) * -0.3;

      // High-frequency texture
      const texture = Math.sin(nx * Math.PI * 5.3) * Math.cos(ny * Math.PI * 4.7) * 0.08 +
        Math.sin((nx + ny) * Math.PI * 7.1) * 0.05;

      const intensity = (radial * 0.5 + ridgeLine + segSouth + segNorth + feature1 + feature2 + texture) * edgePenalty;
      const flux = Math.max(0, intensity) * 850 * latBias + 200;
      annualValues.push(Number(flux.toFixed(3)));

      // More realistic mask shape: stronger inset at edges
      const maskEdge = 0.12;
      const inRoof = nx > maskEdge && nx < (1 - maskEdge) && ny > maskEdge && ny < (1 - maskEdge);
      maskValues.push(inRoof ? 1 : 0);
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
    gridRadiusMeters: SOLAR_GRID_RADIUS,
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
      radiusMeters: String(SOLAR_GRID_RADIUS),
      view: "IMAGERY_AND_ANNUAL_FLUX_LAYERS",
      requiredQuality: "HIGH",
      exactQualityRequired: "true",
      pixelSizeMeters: "1.0",
    });

    const layers = await fetchGoogleJson<DataLayersResponse>(
      `https://solar.googleapis.com/v1/dataLayers:get?${layerParams}`,
    );

    if (!layers.annualFluxUrl || !layers.maskUrl) {
      return buildFallbackSolar(results);
    }

    const [annual, mask] = await Promise.all([
      fetchGeoTiffGrid(layers.annualFluxUrl, key),
      fetchGeoTiffGrid(layers.maskUrl, key),
    ]);

    const maskBand = mask.bands[0];
    const annualFluxGrid = downsampleAndMask(annual.bands[0], annual.width, annual.height, maskBand);
    const roofMaskGrid = downsampleAndMask(maskBand, mask.width, mask.height);

    const monthlyFluxGrids = Array.from({ length: 12 }, (_, index) => {
      const scale = 0.72 + Math.sin(((index + 1) / 12) * Math.PI) * 0.2;
      return {
        month: index + 1,
        width: annualFluxGrid.width,
        height: annualFluxGrid.height,
        values: annualFluxGrid.values.map((v) => Number((v * scale).toFixed(4))),
      };
    });

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
      gridRadiusMeters: SOLAR_GRID_RADIUS,
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
