import "server-only";

import type { GeoBounds, VisualizationEntrance } from "@/lib/visualization";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const QUERY_TIMEOUT_SECONDS = 8;
const REQUEST_TIMEOUT_MS = 3500;

type OverpassNode = {
  type: "node";
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassNode[];
};

function expandBounds(bounds: GeoBounds, paddingMeters: number): GeoBounds {
  const centerLat = (bounds.north + bounds.south) * 0.5;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(1, 111_320 * Math.cos((centerLat * Math.PI) / 180));
  const latDelta = paddingMeters / metersPerDegreeLat;
  const lngDelta = paddingMeters / metersPerDegreeLng;
  return {
    west: bounds.west - lngDelta,
    south: bounds.south - latDelta,
    east: bounds.east + lngDelta,
    north: bounds.north + latDelta,
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

function withinBounds(lat: number, lng: number, bounds: GeoBounds) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

export async function fetchVisualizationEntrances(
  lat: number,
  lng: number,
  buildingBounds: GeoBounds | null,
): Promise<VisualizationEntrance[]> {
  const searchBounds = expandBounds(buildingBounds ?? boundsFromCenter(lat, lng, 55), 18);
  const query = `
[out:json][timeout:${QUERY_TIMEOUT_SECONDS}];
(
  node["entrance"]["entrance"!="no"](${searchBounds.south},${searchBounds.west},${searchBounds.north},${searchBounds.east});
);
out body;
`.trim();

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: query,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as OverpassResponse;
    const seen = new Set<string>();
    const entrances: VisualizationEntrance[] = [];

    for (const element of payload.elements ?? []) {
      if (element.type !== "node") {
        continue;
      }
      if (!withinBounds(element.lat, element.lon, searchBounds)) {
        continue;
      }
      const kind = element.tags?.entrance;
      if (!kind || kind === "no") {
        continue;
      }

      const key = `${element.lat.toFixed(6)}:${element.lon.toFixed(6)}:${kind}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      entrances.push({
        lat: element.lat,
        lng: element.lon,
        kind,
        access: element.tags?.access ?? null,
        door: element.tags?.door ?? null,
        name: element.tags?.name ?? null,
      });
    }

    return entrances.slice(0, 12);
  } catch {
    return [];
  }
}
