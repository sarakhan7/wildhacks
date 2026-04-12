import "server-only";

import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";

import type { AuditResultsBundle } from "@/lib/audit-api";
import type {
  GeoBounds,
  SolarSourceBuilding,
  SolarVisualization,
  VisualizationGrid,
  VisualizationEntrance,
  VisualizationSceneResponse,
} from "@/lib/visualization";
import { inferBuildingHeightMeters } from "@/lib/visualization";

type SolarDate = { year: number; month: number; day: number };
type LatLng = { latitude: number; longitude: number };
type LatLngBox = { sw?: LatLng; ne?: LatLng };

type BuildingInsightsResponse = {
  name?: string;
  center?: LatLng;
  boundingBox?: LatLngBox;
  imageryDate?: SolarDate;
  imageryProcessedDate?: SolarDate;
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
    buildingStats?: {
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

type SolarRaster = {
  width: number;
  height: number;
  bands: number[][];
  bounds: GeoBounds | null;
};

type SolarSource = {
  id: string;
  center: { lat: number; lng: number };
  bounds: GeoBounds;
  rasterBounds: GeoBounds;
  imageryDate: SolarDate | null;
  imageryProcessedDate: SolarDate | null;
  roofStats: SolarVisualization["roofStats"];
  roofSegmentStats: SolarVisualization["roofSegmentStats"];
  annualFluxGrid: VisualizationGrid;
  monthlyFluxGrids: Array<VisualizationGrid & { month: number }>;
  roofMaskGrid: VisualizationGrid;
  gridRadiusMeters: number;
};

const SOLAR_GRID_RADIUS = 175;
const SOLAR_GRID_SIZE = 160;
const PROBE_FRACTIONS = [0.08, 0.24, 0.4, 0.6, 0.76, 0.92];

function getSolarApiKey() {
  return process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function addKeyToUrl(url: string, key: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("key", key);
  return parsed.toString();
}

function boundsFromLatLngBox(box?: LatLngBox | null): GeoBounds | null {
  if (!box?.sw || !box.ne) {
    return null;
  }
  return {
    west: box.sw.longitude,
    south: box.sw.latitude,
    east: box.ne.longitude,
    north: box.ne.latitude,
  };
}

function boundsFromCenter(lat: number, lng: number, radiusMeters: number): GeoBounds {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(1, 111_320 * Math.cos((lat * Math.PI) / 180));
  const latDelta = radiusMeters / metersPerDegreeLat;
  const lngDelta = radiusMeters / metersPerDegreeLng;
  return {
    west: lng - lngDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    north: lat + latDelta,
  };
}

function expandBounds(bounds: GeoBounds, ratio = 0.18) {
  const lngPad = Math.max((bounds.east - bounds.west) * ratio, 0.000035);
  const latPad = Math.max((bounds.north - bounds.south) * ratio, 0.000035);
  return {
    west: bounds.west - lngPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    north: bounds.north + latPad,
  } satisfies GeoBounds;
}

function unionBounds(bounds: GeoBounds[]) {
  return bounds.reduce(
    (acc, bounds) => ({
      west: Math.min(acc.west, bounds.west),
      south: Math.min(acc.south, bounds.south),
      east: Math.max(acc.east, bounds.east),
      north: Math.max(acc.north, bounds.north),
    }),
    { ...bounds[0] },
  );
}

function getBoundsArea(bounds: GeoBounds) {
  return Math.max(0, bounds.east - bounds.west) * Math.max(0, bounds.north - bounds.south);
}

function getIntersectionArea(a: GeoBounds, b: GeoBounds) {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (east <= west || north <= south) {
    return 0;
  }
  return (east - west) * (north - south);
}

function getBoundsCenter(bounds: GeoBounds) {
  return {
    lat: (bounds.north + bounds.south) * 0.5,
    lng: (bounds.east + bounds.west) * 0.5,
  };
}

function getCenterDistanceMeters(a: GeoBounds, b: GeoBounds) {
  const c1 = getBoundsCenter(a);
  const c2 = getBoundsCenter(b);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(
    1,
    111_320 * Math.cos((((c1.lat + c2.lat) * 0.5) * Math.PI) / 180),
  );
  return Math.hypot((c1.lng - c2.lng) * metersPerDegreeLng, (c1.lat - c2.lat) * metersPerDegreeLat);
}

function isReasonableBounds(bounds: GeoBounds | null | undefined): bounds is GeoBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.west) &&
      Number.isFinite(bounds.east) &&
      Number.isFinite(bounds.south) &&
      Number.isFinite(bounds.north) &&
      Math.abs(bounds.west) <= 180 &&
      Math.abs(bounds.east) <= 180 &&
      Math.abs(bounds.south) <= 90 &&
      Math.abs(bounds.north) <= 90 &&
      bounds.east > bounds.west &&
      bounds.north > bounds.south,
  );
}

function estimateDataLayerRadiusMeters(box: GeoBounds | null, fallbackLat: number, fallbackLng: number) {
  if (!box) {
    return 110;
  }

  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(
    1,
    111_320 * Math.cos((((box.north + box.south) * 0.5) * Math.PI) / 180),
  );
  const halfWidth = Math.abs(box.east - box.west) * metersPerDegreeLng * 0.5;
  const halfHeight = Math.abs(box.north - box.south) * metersPerDegreeLat * 0.5;
  const centerOffsetX = Math.abs((((box.east + box.west) * 0.5) - fallbackLng) * metersPerDegreeLng);
  const centerOffsetY = Math.abs((((box.north + box.south) * 0.5) - fallbackLat) * metersPerDegreeLat);

  return Math.min(
    SOLAR_GRID_RADIUS,
    Math.max(70, Math.ceil(Math.hypot(halfWidth + 12, halfHeight + 12) + Math.hypot(centerOffsetX, centerOffsetY))),
  );
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

async function fetchGeoTiffGrid(url: string, key: string): Promise<SolarRaster> {
  const response = await fetch(addKeyToUrl(url, key), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GeoTIFF fetch failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const rawBounds = image.getBoundingBox();
  const geoKeys = image.getGeoKeys();

  let bounds: GeoBounds | null = null;
  if (
    Array.isArray(rawBounds) &&
    rawBounds.length === 4 &&
    rawBounds.every((value) => Number.isFinite(value))
  ) {
    const [minX, minY, maxX, maxY] = rawBounds;
    const directBounds = {
      west: minX,
      south: minY,
      east: maxX,
      north: maxY,
    } satisfies GeoBounds;

    if (isReasonableBounds(directBounds)) {
      bounds = directBounds;
    } else if (geoKeys) {
      try {
        const projection = geokeysToProj4.toProj4(
          geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0],
        );
        const corners = [
          [minX, minY],
          [minX, maxY],
          [maxX, minY],
          [maxX, maxY],
        ].map(([x, y]) => {
          const converted = geokeysToProj4.convertCoordinates(
            x,
            y,
            0,
            projection.coordinatesConversionParameters,
          );

          if (projection.isGCS) {
            return { lng: converted.x, lat: converted.y };
          }

          const [lng, lat] = proj4(projection.proj4, "EPSG:4326", [converted.x, converted.y]);
          return { lng, lat };
        });

        const projectedBounds = {
          west: Math.min(...corners.map((corner) => corner.lng)),
          south: Math.min(...corners.map((corner) => corner.lat)),
          east: Math.max(...corners.map((corner) => corner.lng)),
          north: Math.max(...corners.map((corner) => corner.lat)),
        } satisfies GeoBounds;

        if (isReasonableBounds(projectedBounds)) {
          bounds = projectedBounds;
        }
      } catch {
        bounds = null;
      }
    }
  }

  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bands: Array.from(rasters, (band) => Array.from(band as ArrayLike<number>)),
    bounds,
  };
}

function downsampleAndMask(
  source: number[],
  width: number,
  height: number,
  mask?: number[],
): VisualizationGrid {
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / SOLAR_GRID_SIZE));
  const newWidth = Math.ceil(width / scale);
  const newHeight = Math.ceil(height / scale);

  const values: number[] = [];
  for (let y = 0; y < newHeight; y += 1) {
    for (let x = 0; x < newWidth; x += 1) {
      let sum = 0;
      let count = 0;
      let maskedOut = false;

      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const srcX = x * scale + dx;
          const srcY = y * scale + dy;
          if (srcX >= width || srcY >= height) {
            continue;
          }
          const index = srcY * width + srcX;
          if (mask && mask[index] <= 0) {
            maskedOut = true;
          } else if (Number.isFinite(source[index])) {
            sum += source[index];
            count += 1;
          }
        }
      }

      if (maskedOut && count === 0) {
        values.push(0);
      } else {
        values.push(Number((count > 0 ? sum / count : 0).toFixed(4)));
      }
    }
  }

  return { width: newWidth, height: newHeight, values };
}

function createEmptyGrid(width: number, height: number, fill = 0): VisualizationGrid {
  return {
    width,
    height,
    values: Array.from({ length: width * height }, () => fill),
  };
}

function sampleGrid(grid: VisualizationGrid, u: number, v: number) {
  const x = Math.min(grid.width - 1, Math.max(0, u * (grid.width - 1)));
  const y = Math.min(grid.height - 1, Math.max(0, (1 - v) * (grid.height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const topLeft = grid.values[y0 * grid.width + x0];
  const topRight = grid.values[y0 * grid.width + x1];
  const bottomLeft = grid.values[y1 * grid.width + x0];
  const bottomRight = grid.values[y1 * grid.width + x1];

  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;
  return top * (1 - ty) + bottom * ty;
}

function blurGrid(grid: VisualizationGrid, passes = 3) {
  let values = [...grid.values];
  const width = grid.width;
  const height = grid.height;
  const offsets = [
    [-1, -1, 0.65],
    [0, -1, 1],
    [1, -1, 0.65],
    [-1, 0, 1],
    [1, 0, 1],
    [-1, 1, 0.65],
    [0, 1, 1],
    [1, 1, 0.65],
  ] as const;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...values];
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * width + col;
        let sum = values[index] * 1.6;
        let weight = 1.6;
        offsets.forEach(([dx, dy, factor]) => {
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) {
            return;
          }
          sum += values[y * width + x] * factor;
          weight += factor;
        });
        next[index] = sum / Math.max(weight, 1e-6);
      }
    }
    values = next;
  }

  return {
    ...grid,
    values: values.map((value) => Number(value.toFixed(6))),
  };
}

function fillMissingCells(grid: VisualizationGrid, coverageGrid: VisualizationGrid, passes = 6) {
  if (
    grid.width !== coverageGrid.width ||
    grid.height !== coverageGrid.height
  ) {
    return grid;
  }

  let values = [...grid.values];
  const width = grid.width;
  const height = grid.height;
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...values];
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * width + col;
        if (coverageGrid.values[index] > 0.05) {
          continue;
        }

        let sum = 0;
        let count = 0;
        offsets.forEach(([dx, dy]) => {
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) {
            return;
          }
          const neighborIndex = y * width + x;
          if (values[neighborIndex] > 0) {
            sum += values[neighborIndex];
            count += 1;
          }
        });
        if (count > 0) {
          next[index] = sum / count;
        }
      }
    }
    values = next;
  }

  return {
    ...grid,
    values: values.map((value) => Number(value.toFixed(4))),
  };
}

function completeSolarField(grid: VisualizationGrid, coverageGrid: VisualizationGrid) {
  const expanded = fillMissingCells(grid, coverageGrid, 18);
  const softened = blurGrid(expanded, 3);

  return {
    ...grid,
    values: softened.values.map((value, index) => {
      const original = grid.values[index];
      const completed = coverageGrid.values[index] > 0.08 ? original * 0.72 + value * 0.28 : value;
      return Number(completed.toFixed(4));
    }),
  };
}

function sharpenObservedField(grid: VisualizationGrid, coverageGrid: VisualizationGrid) {
  const detail = blurGrid(grid, 1);
  return {
    ...grid,
    values: detail.values.map((value, index) => {
      if (coverageGrid.values[index] <= 0.08) {
        return 0;
      }
      const raw = grid.values[index];
      return Number((raw * 0.82 + value * 0.18).toFixed(4));
    }),
  };
}

function buildFallbackSolar(results: AuditResultsBundle): SolarVisualization {
  const roofAreaMeters2 = Math.max(
    40,
    (results.building.squareFeet / Math.max(1, results.building.floors || 1)) * 0.092903,
  );
  const estimatedHalfSpanMeters = Math.max(38, Math.sqrt(roofAreaMeters2) * 0.8);
  const fallbackBounds = boundsFromCenter(results.building.lat, results.building.lng, estimatedHalfSpanMeters + 28);
  const latBias = Math.max(0.5, 1 - Math.abs(results.building.lat - 37) / 40);
  const annualValues: number[] = [];
  const maskValues: number[] = [];

  for (let row = 0; row < SOLAR_GRID_SIZE; row += 1) {
    for (let col = 0; col < SOLAR_GRID_SIZE; col += 1) {
      const nx = col / (SOLAR_GRID_SIZE - 1);
      const ny = row / (SOLAR_GRID_SIZE - 1);
      const centerDist = Math.hypot(nx - 0.5, ny - 0.5);
      const radial = Math.max(0, 1 - centerDist * 1.6);
      const ridgeLine = Math.exp(-Math.pow((ny - 0.48) * 8, 2)) * 0.35;
      const segSouth = ny > 0.48 ? Math.cos((ny - 0.48) * Math.PI * 1.1) * 0.4 : 0;
      const segNorth = ny <= 0.48 ? Math.cos((0.48 - ny) * Math.PI * 1.3) * 0.25 : 0;
      const edgeFalloff = Math.min(Math.min(nx, 1 - nx) * 4, Math.min(ny, 1 - ny) * 4);
      const feature1 = Math.exp(-Math.pow((nx - 0.25) * 12, 2) - Math.pow((ny - 0.3) * 12, 2)) * -0.5;
      const feature2 = Math.exp(-Math.pow((nx - 0.7) * 10, 2) - Math.pow((ny - 0.65) * 10, 2)) * -0.3;
      const texture =
        Math.sin(nx * Math.PI * 5.3) * Math.cos(ny * Math.PI * 4.7) * 0.08 +
        Math.sin((nx + ny) * Math.PI * 7.1) * 0.05;

      const intensity = (radial * 0.5 + ridgeLine + segSouth + segNorth + feature1 + feature2 + texture) * Math.min(1, edgeFalloff);
      annualValues.push(Number((Math.max(0, intensity) * 850 * latBias + 200).toFixed(3)));

      const inRoof = nx > 0.12 && nx < 0.88 && ny > 0.12 && ny < 0.88;
      maskValues.push(inRoof ? 1 : 0);
    }
  }

  const annualFluxGrid = {
    width: SOLAR_GRID_SIZE,
    height: SOLAR_GRID_SIZE,
    values: annualValues,
  } satisfies VisualizationGrid;
  const roofMaskGrid = {
    width: SOLAR_GRID_SIZE,
    height: SOLAR_GRID_SIZE,
    values: maskValues,
  } satisfies VisualizationGrid;
  const monthlyFluxGrids = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    width: SOLAR_GRID_SIZE,
    height: SOLAR_GRID_SIZE,
    values: annualValues.map((value) =>
      Number((value * (0.72 + Math.sin((((index + 1) / 12) * Math.PI)) * 0.2)).toFixed(4)),
    ),
  }));

  return {
    source: "modeled_fallback",
    imageryDate: null,
    imageryProcessedDate: null,
    gridBounds: fallbackBounds,
    buildingBounds: fallbackBounds,
    renderBounds: fallbackBounds,
    solarGrid: annualFluxGrid,
    observedSolarGrid: annualFluxGrid,
    coverageGrid: roofMaskGrid,
    confidenceGrid: roofMaskGrid,
    sourceBuildings: [
      {
        id: "modeled_fallback",
        bounds: fallbackBounds,
        center: { lat: results.building.lat, lng: results.building.lng },
      },
    ],
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
    annualFluxGrid,
    monthlyFluxGrids,
    observedMonthlyFluxGrids: monthlyFluxGrids,
    roofMaskGrid,
    gridRadiusMeters: SOLAR_GRID_RADIUS,
  };
}

function createInsightKey(insight: BuildingInsightsResponse) {
  const bounds = boundsFromLatLngBox(insight.boundingBox);
  const boundsKey = bounds
    ? [
        bounds.west.toFixed(5),
        bounds.south.toFixed(5),
        bounds.east.toFixed(5),
        bounds.north.toFixed(5),
      ].join(":")
    : `${insight.center?.latitude?.toFixed(6) ?? "x"}:${insight.center?.longitude?.toFixed(6) ?? "y"}`;
  return insight.name ? `${insight.name}:${boundsKey}` : boundsKey;
}

function generateProbePoints(lat: number, lng: number, bounds: GeoBounds | null) {
  const points = [{ lat, lng }];
  const targetBounds = bounds ? expandBounds(bounds, 0.22) : boundsFromCenter(lat, lng, 48);

  PROBE_FRACTIONS.forEach((y) => {
    PROBE_FRACTIONS.forEach((x) => {
      points.push({
        lat: targetBounds.south + (targetBounds.north - targetBounds.south) * y,
        lng: targetBounds.west + (targetBounds.east - targetBounds.west) * x,
      });
    });
  });

  const deduped = new Map<string, { lat: number; lng: number }>();
  points.forEach((point) => {
    deduped.set(`${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`, point);
  });
  return Array.from(deduped.values());
}

function shouldIncludeInsight(candidateBounds: GeoBounds, primaryBounds: GeoBounds) {
  const expandedPrimary = expandBounds(primaryBounds, 0.34);
  const overlap = getIntersectionArea(candidateBounds, expandedPrimary);
  const minArea = Math.min(getBoundsArea(candidateBounds), getBoundsArea(primaryBounds));
  return overlap > 0 || (minArea > 0 && overlap / minArea > 0.03) || getCenterDistanceMeters(candidateBounds, primaryBounds) < 135;
}

function getCompositeDimensions(renderBounds: GeoBounds) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(
    1,
    111_320 * Math.cos((((renderBounds.north + renderBounds.south) * 0.5) * Math.PI) / 180),
  );
  const widthMeters = Math.max(1, (renderBounds.east - renderBounds.west) * metersPerDegreeLng);
  const heightMeters = Math.max(1, (renderBounds.north - renderBounds.south) * metersPerDegreeLat);

  if (widthMeters >= heightMeters) {
    return {
      width: SOLAR_GRID_SIZE,
      height: Math.max(72, Math.round(SOLAR_GRID_SIZE * (heightMeters / widthMeters))),
    };
  }

  return {
    width: Math.max(72, Math.round(SOLAR_GRID_SIZE * (widthMeters / heightMeters))),
    height: SOLAR_GRID_SIZE,
  };
}

function buildConfidenceGrid(coverageGrid: VisualizationGrid) {
  const softened = blurGrid(coverageGrid, 4);
  return {
    ...coverageGrid,
    values: softened.values.map((value, index) =>
      Number(
        (
          coverageGrid.values[index] > 0.08
            ? 1
            : Math.max(0.78, Math.min(0.92, 0.78 + value * 0.14))
        ).toFixed(4),
      ),
    ),
  };
}

function composeGridForMonth(
  sources: SolarSource[],
  renderBounds: GeoBounds,
  width: number,
  height: number,
  month: number,
) {
  const observedSolarGrid = createEmptyGrid(width, height, 0);
  const coverageGrid = createEmptyGrid(width, height, 0);
  const sums = Array.from({ length: width * height }, () => 0);
  const counts = Array.from({ length: width * height }, () => 0);

  for (let row = 0; row < height; row += 1) {
    const v = 1 - (row + 0.5) / height;
    const lat = renderBounds.south + (renderBounds.north - renderBounds.south) * v;

    for (let col = 0; col < width; col += 1) {
      const u = (col + 0.5) / width;
      const lng = renderBounds.west + (renderBounds.east - renderBounds.west) * u;
      const index = row * width + col;

      sources.forEach((source) => {
        if (
          lng < source.rasterBounds.west ||
          lng > source.rasterBounds.east ||
          lat < source.rasterBounds.south ||
          lat > source.rasterBounds.north
        ) {
          return;
        }

        const sourceU =
          (lng - source.rasterBounds.west) / Math.max(source.rasterBounds.east - source.rasterBounds.west, 1e-9);
        const sourceV =
          (lat - source.rasterBounds.south) / Math.max(source.rasterBounds.north - source.rasterBounds.south, 1e-9);
        const mask = sampleGrid(source.roofMaskGrid, sourceU, sourceV);
        if (mask <= 0.06) {
          return;
        }

        const fluxGrid =
          month > 0
            ? source.monthlyFluxGrids.find((grid) => grid.month === month) ?? source.annualFluxGrid
            : source.annualFluxGrid;
        sums[index] += sampleGrid(fluxGrid, sourceU, sourceV);
        counts[index] += 1;
        coverageGrid.values[index] = 1;
      });

      if (counts[index] > 0) {
        observedSolarGrid.values[index] = Number((sums[index] / counts[index]).toFixed(4));
      }
    }
  }

  const sharpenedObservedSolarGrid = sharpenObservedField(observedSolarGrid, coverageGrid);
  return {
    solarGrid: completeSolarField(sharpenedObservedSolarGrid, coverageGrid),
    observedSolarGrid: sharpenedObservedSolarGrid,
    coverageGrid,
  };
}

function averageQuantiles(stats: SolarSource[]) {
  const maxLength = Math.max(...stats.map((source) => source.roofStats.sunshineQuantiles.length), 0);
  return Array.from({ length: maxLength }, (_, index) => {
    let sum = 0;
    let count = 0;
    stats.forEach((source) => {
      const value = source.roofStats.sunshineQuantiles[index];
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    });
    return count > 0 ? Number((sum / count).toFixed(2)) : 0;
  });
}

async function findClosestBuilding(lat: number, lng: number, key: string) {
  const params = new URLSearchParams({
    key,
    "location.latitude": String(lat),
    "location.longitude": String(lng),
    requiredQuality: "HIGH",
  });
  return fetchGoogleJson<BuildingInsightsResponse>(
    `https://solar.googleapis.com/v1/buildingInsights:findClosest?${params}`,
  );
}

async function buildSolarSource(insight: BuildingInsightsResponse, key: string): Promise<SolarSource | null> {
  const bounds = boundsFromLatLngBox(insight.boundingBox);
  const center = {
    lat: insight.center?.latitude ?? getBoundsCenter(bounds ?? boundsFromCenter(0, 0, 1)).lat,
    lng: insight.center?.longitude ?? getBoundsCenter(bounds ?? boundsFromCenter(0, 0, 1)).lng,
  };
  const radiusMeters = estimateDataLayerRadiusMeters(bounds, center.lat, center.lng);
  const pixelSizeMeters = radiusMeters > 120 ? "0.5" : "0.25";

  const layerParams = new URLSearchParams({
    key,
    "location.latitude": String(center.lat),
    "location.longitude": String(center.lng),
    radiusMeters: String(radiusMeters),
    view: radiusMeters > 175 ? "IMAGERY_AND_ANNUAL_FLUX_LAYERS" : "IMAGERY_AND_ALL_FLUX_LAYERS",
    requiredQuality: "HIGH",
    exactQualityRequired: "true",
    pixelSizeMeters,
  });

  const layers = await fetchGoogleJson<DataLayersResponse>(
    `https://solar.googleapis.com/v1/dataLayers:get?${layerParams}`,
  );
  if (!layers.annualFluxUrl || !layers.maskUrl || !bounds) {
    return null;
  }

  const [annual, mask, monthly] = await Promise.all([
    fetchGeoTiffGrid(layers.annualFluxUrl, key),
    fetchGeoTiffGrid(layers.maskUrl, key),
    layers.monthlyFluxUrl ? fetchGeoTiffGrid(layers.monthlyFluxUrl, key) : Promise.resolve(null),
  ]);
  const rasterBounds = annual.bounds ?? mask.bounds ?? monthly?.bounds ?? bounds;
  if (!rasterBounds) {
    return null;
  }

  const maskBand = mask.bands[0];
  const annualFluxGrid = downsampleAndMask(annual.bands[0], annual.width, annual.height, maskBand);
  const roofMaskGrid = downsampleAndMask(maskBand, mask.width, mask.height);
  const monthlyFluxGrids =
    monthly?.bands.length && monthly.bands.length >= 12
      ? monthly.bands.slice(0, 12).map((band, index) => ({
          month: index + 1,
          ...downsampleAndMask(band, monthly.width, monthly.height, maskBand),
        }))
      : Array.from({ length: 12 }, (_, index) => {
          const scale = 0.72 + Math.sin((((index + 1) / 12) * Math.PI)) * 0.2;
          return {
            month: index + 1,
            width: annualFluxGrid.width,
            height: annualFluxGrid.height,
            values: annualFluxGrid.values.map((value) => Number((value * scale).toFixed(4))),
          };
        });

  const roofStats = insight.solarPotential?.wholeRoofStats ?? insight.solarPotential?.buildingStats;
  const maxSunshineHoursPerYear = insight.solarPotential?.maxSunshineHoursPerYear ?? 0;
  const maxArrayPanelsCount = insight.solarPotential?.maxArrayPanelsCount ?? 0;
  const estimatedAnnualKwh = Math.round(
    maxArrayPanelsCount * 375 * (maxSunshineHoursPerYear / 1000) * 0.82,
  );

  return {
    id: createInsightKey(insight),
    center,
    bounds,
    rasterBounds,
    imageryDate: layers.imageryDate || insight.imageryDate || null,
    imageryProcessedDate: layers.imageryProcessedDate || insight.imageryProcessedDate || null,
    roofStats: {
      areaMeters2: Number((roofStats?.areaMeters2 ?? 0).toFixed(2)),
      groundAreaMeters2: Number((roofStats?.groundAreaMeters2 ?? 0).toFixed(2)),
      sunshineQuantiles: roofStats?.sunshineQuantiles ?? [],
      maxArrayPanelsCount,
      maxArrayAreaMeters2: Number((insight.solarPotential?.maxArrayAreaMeters2 ?? 0).toFixed(2)),
      maxSunshineHoursPerYear: Number(maxSunshineHoursPerYear.toFixed(2)),
      estimatedAnnualKwh,
      estimatedAnnualSavingsUsd: Math.round(estimatedAnnualKwh * 0.14),
    },
    roofSegmentStats:
      insight.solarPotential?.roofSegmentStats?.map((segment) => ({
        pitchDegrees: Number((segment.pitchDegrees ?? 0).toFixed(3)),
        azimuthDegrees: Number((segment.azimuthDegrees ?? 0).toFixed(3)),
        areaMeters2: Number((segment.stats?.areaMeters2 ?? 0).toFixed(2)),
        sunshineQuantiles: segment.stats?.sunshineQuantiles ?? [],
      })) ?? [],
    annualFluxGrid,
    monthlyFluxGrids,
    roofMaskGrid,
    gridRadiusMeters: radiusMeters,
  };
}

function buildVisualizationFromSources(
  sources: SolarSource[],
  fallbackLat: number,
  fallbackLng: number,
): SolarVisualization {
  const renderBounds = unionBounds(sources.map((source) => source.rasterBounds));
  const { width, height } = getCompositeDimensions(renderBounds);
  const annualComposite = composeGridForMonth(sources, renderBounds, width, height, 0);
  const monthlyComposites = Array.from({ length: 12 }, (_, index) =>
    composeGridForMonth(sources, renderBounds, width, height, index + 1),
  );
  const monthlyFluxGrids = monthlyComposites.map((monthlyComposite, index) => {
    return {
      month: index + 1,
      ...monthlyComposite.solarGrid,
    };
  });
  const observedMonthlyFluxGrids = monthlyComposites.map((monthlyComposite, index) => {
    return {
      month: index + 1,
      ...monthlyComposite.observedSolarGrid,
    };
  });

  const coverageGrid = annualComposite.coverageGrid;
  const confidenceGrid = buildConfidenceGrid(coverageGrid);
  const maxSunshineHoursPerYear = Math.max(...sources.map((source) => source.roofStats.maxSunshineHoursPerYear), 0);

  return {
    source: "google_solar",
    imageryDate: sources.find((source) => source.imageryDate)?.imageryDate ?? null,
    imageryProcessedDate:
      sources.find((source) => source.imageryProcessedDate)?.imageryProcessedDate ?? null,
    gridBounds: renderBounds,
    buildingBounds: sources[0]?.bounds ?? boundsFromCenter(fallbackLat, fallbackLng, 64),
    renderBounds,
    solarGrid: annualComposite.solarGrid,
    observedSolarGrid: annualComposite.observedSolarGrid,
    coverageGrid,
    confidenceGrid,
    sourceBuildings: sources.map((source) => ({
      id: source.id,
      bounds: source.bounds,
      center: source.center,
    }) satisfies SolarSourceBuilding),
    roofStats: {
      areaMeters2: Number(sources.reduce((sum, source) => sum + source.roofStats.areaMeters2, 0).toFixed(2)),
      groundAreaMeters2: Number(
        sources.reduce((sum, source) => sum + source.roofStats.groundAreaMeters2, 0).toFixed(2),
      ),
      sunshineQuantiles: averageQuantiles(sources),
      maxArrayPanelsCount: sources.reduce((sum, source) => sum + source.roofStats.maxArrayPanelsCount, 0),
      maxArrayAreaMeters2: Number(
        sources.reduce((sum, source) => sum + source.roofStats.maxArrayAreaMeters2, 0).toFixed(2),
      ),
      maxSunshineHoursPerYear: Number(maxSunshineHoursPerYear.toFixed(2)),
      estimatedAnnualKwh: sources.reduce((sum, source) => sum + source.roofStats.estimatedAnnualKwh, 0),
      estimatedAnnualSavingsUsd: sources.reduce((sum, source) => sum + source.roofStats.estimatedAnnualSavingsUsd, 0),
    },
    roofSegmentStats: sources.flatMap((source) => source.roofSegmentStats),
    annualFluxGrid: annualComposite.solarGrid,
    monthlyFluxGrids,
    observedMonthlyFluxGrids,
    roofMaskGrid: coverageGrid,
    gridRadiusMeters: Math.max(...sources.map((source) => source.gridRadiusMeters), 0),
  };
}

export async function buildSolarVisualization(results: AuditResultsBundle): Promise<SolarVisualization> {
  const key = getSolarApiKey();
  if (!key) {
    return buildFallbackSolar(results);
  }

  const { lat, lng } = results.building;

  try {
    const primaryInsight = await findClosestBuilding(lat, lng, key);
    const primaryBounds = boundsFromLatLngBox(primaryInsight.boundingBox);
    const probePoints = generateProbePoints(lat, lng, primaryBounds);
    const rawInsights = await Promise.allSettled(
      probePoints.map((point) => findClosestBuilding(point.lat, point.lng, key)),
    );

    const insightMap = new Map<string, BuildingInsightsResponse>();
    rawInsights.forEach((result) => {
      if (result.status !== "fulfilled") {
        return;
      }
      const insight = result.value;
      const bounds = boundsFromLatLngBox(insight.boundingBox);
      if (!isReasonableBounds(bounds)) {
        return;
      }
      if (primaryBounds && !shouldIncludeInsight(bounds, primaryBounds)) {
        return;
      }
      insightMap.set(createInsightKey(insight), insight);
    });

    if (isReasonableBounds(primaryBounds)) {
      insightMap.set(createInsightKey(primaryInsight), primaryInsight);
    }

    const sourceResults = await Promise.allSettled(
      Array.from(insightMap.values()).slice(0, 12).map((insight) => buildSolarSource(insight, key)),
    );
    const sources = sourceResults
      .filter((result): result is PromiseFulfilledResult<SolarSource | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((source): source is SolarSource => Boolean(source));

    if (sources.length === 0) {
      return buildFallbackSolar(results);
    }

    return buildVisualizationFromSources(sources, lat, lng);
  } catch {
    return buildFallbackSolar(results);
  }
}

export function buildVisualizationResponse(
  results: AuditResultsBundle,
  solar: SolarVisualization,
  thermal: VisualizationSceneResponse["thermal"],
  entrances: VisualizationEntrance[],
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
    entrances,
  };
}
