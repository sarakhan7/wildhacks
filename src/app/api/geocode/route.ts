import { NextResponse } from "next/server";

type LocationFeature = {
  id: string;
  name: string;
  full_address: string;
  place_formatted: string;
  feature_type: string;
  center: [number, number];
  source: "mapbox" | "nominatim";
};

type SearchSuggestion = {
  mapbox_id: string;
  name?: string;
  feature_type?: string;
  place_formatted?: string;
  full_address?: string;
  address?: string;
};

type RetrievedFeature = {
  id?: string;
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    feature_type?: string;
    full_address?: string;
    place_formatted?: string;
    address?: string;
    coordinates?: {
      longitude?: number;
      latitude?: number;
    };
  };
};

type NominatimResult = {
  place_id: number;
  lat: string;
  lon: string;
  type?: string;
  name?: string;
  display_name?: string;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(query: string, candidate: string) {
  const queryTokens = normalizeText(query).split(" ").filter((token) => token.length > 2);
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateText = normalizeText(candidate);
  return queryTokens.filter((token) => candidateText.includes(token)).length;
}

function scoreFeature(query: string, feature: LocationFeature) {
  const candidate = `${feature.name} ${feature.full_address}`;
  const normalizedCandidate = normalizeText(candidate);
  const normalizedQuery = normalizeText(query);
  const featureType = feature.feature_type.toLowerCase();

  let score = tokenOverlap(query, candidate) * 10;

  if (normalizedQuery && normalizedCandidate.includes(normalizedQuery)) {
    score += 8;
  }

  if (["building", "university", "college", "school", "campus"].some((token) => featureType.includes(token))) {
    score += 6;
  } else if (["poi", "research", "office", "amenity"].some((token) => featureType.includes(token))) {
    score += 2;
  } else if (["street", "place", "locality", "neighborhood"].some((token) => featureType.includes(token))) {
    score -= 4;
  }

  if (feature.source === "nominatim") {
    score += 1;
  }

  return score;
}

function dedupeFeatures(features: LocationFeature[]) {
  const seen = new Set<string>();
  return features.filter((feature) => {
    const key = `${feature.source}:${feature.id}:${feature.center[0]}:${feature.center[1]}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchMapboxFeatures(query: string, token: string) {
  const sessionToken = crypto.randomUUID();
  const hasStreetNumber = /\d/.test(query);
  const suggestionUrl = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  suggestionUrl.searchParams.set("access_token", token);
  suggestionUrl.searchParams.set("session_token", sessionToken);
  suggestionUrl.searchParams.set("q", query);
  suggestionUrl.searchParams.set("language", "en");
  suggestionUrl.searchParams.set("country", "US");
  suggestionUrl.searchParams.set("limit", "8");
  suggestionUrl.searchParams.set(
    "types",
    hasStreetNumber ? "address,street,poi" : "poi,address,street,place,locality,neighborhood"
  );

  const suggestionRes = await fetch(suggestionUrl, { cache: "no-store" });
  if (!suggestionRes.ok) {
    throw new Error(`Mapbox suggest API error: ${suggestionRes.status} ${suggestionRes.statusText}`);
  }

  const suggestionData = (await suggestionRes.json()) as { suggestions?: SearchSuggestion[] };
  const suggestions = Array.isArray(suggestionData.suggestions) ? suggestionData.suggestions : [];

  const retrievedFeatures: Array<LocationFeature | null> = await Promise.all(
    suggestions.map(async (suggestion) => {
      const retrieveUrl = new URL(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(suggestion.mapbox_id)}`
      );
      retrieveUrl.searchParams.set("access_token", token);
      retrieveUrl.searchParams.set("session_token", sessionToken);
      retrieveUrl.searchParams.set("language", "en");

      const retrieveRes = await fetch(retrieveUrl, { cache: "no-store" });
      if (!retrieveRes.ok) {
        return null;
      }

      const retrieveData = (await retrieveRes.json()) as { features?: RetrievedFeature[] };
      const feature = Array.isArray(retrieveData.features) ? retrieveData.features[0] : null;
      if (!feature) {
        return null;
      }

      const properties = feature.properties;
      const coordinates =
        feature.geometry?.coordinates ||
        (properties?.coordinates?.longitude != null && properties?.coordinates?.latitude != null
          ? [properties.coordinates.longitude, properties.coordinates.latitude]
          : undefined);

      if (!coordinates) {
        return null;
      }

      const fallbackAddress = [
        properties?.name || suggestion.name,
        properties?.address || suggestion.address,
        properties?.place_formatted || suggestion.place_formatted,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        id: String(properties?.mapbox_id || feature.id || suggestion.mapbox_id),
        name: String(properties?.name || suggestion.name || query),
        full_address: String(properties?.full_address || suggestion.full_address || fallbackAddress || query),
        place_formatted: String(properties?.place_formatted || suggestion.place_formatted || ""),
        feature_type: String(properties?.feature_type || suggestion.feature_type || ""),
        center: coordinates,
        source: "mapbox" as const,
      };
    })
  );

  return retrievedFeatures.filter((feature): feature is LocationFeature => feature !== null);
}

async function fetchNominatimFeatures(query: string) {
  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("format", "jsonv2");
  nominatimUrl.searchParams.set("limit", "5");
  nominatimUrl.searchParams.set("countrycodes", "us");
  nominatimUrl.searchParams.set("q", query);

  const res = await fetch(nominatimUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "AuditAI/1.0 (local-dev geocoder fallback)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as NominatimResult[];
  if (!Array.isArray(data)) {
    return [];
  }

  const features: Array<LocationFeature | null> = data.map((result) => {
      const lon = Number(result.lon);
      const lat = Number(result.lat);
      if (Number.isNaN(lon) || Number.isNaN(lat)) {
        return null;
      }

      const displayName = result.display_name || result.name || query;
      return {
        id: `nominatim-${result.place_id}`,
        name: result.name || displayName.split(",")[0] || query,
        full_address: displayName,
        place_formatted: displayName.split(",").slice(1).join(",").trim(),
        feature_type: result.type || "building",
        center: [lon, lat] as [number, number],
        source: "nominatim" as const,
      };
    });

  return features.filter((feature): feature is LocationFeature => feature !== null);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "Mapbox token not configured" }, { status: 500 });
  }

  try {
    let mapboxFeatures: LocationFeature[] = [];
    let mapboxFailed = false;
    const hasStreetNumber = /\d/.test(query);
    const queryTokenCount = normalizeText(query).split(" ").filter((token) => token.length > 2).length;

    try {
      mapboxFeatures = await fetchMapboxFeatures(query, token);
    } catch (error) {
      mapboxFailed = true;
      console.error("Mapbox geocoding error:", error);
    }

    const strongMapboxMatches = mapboxFeatures.filter((feature) => {
      const candidate = `${feature.name} ${feature.full_address}`;
      return tokenOverlap(query, candidate) >= 2;
    });

    let fallbackFeatures: LocationFeature[] = [];
    const shouldBlendNamedBuildingResults = !hasStreetNumber && queryTokenCount >= 2;
    const shouldUseFallback =
      shouldBlendNamedBuildingResults ||
      mapboxFailed ||
      strongMapboxMatches.length === 0 ||
      mapboxFeatures.length === 0;

    if (shouldUseFallback) {
      try {
        fallbackFeatures = await fetchNominatimFeatures(query);
      } catch (error) {
        console.error("Nominatim geocoding error:", error);
      }
    }

    const features = dedupeFeatures(
      shouldUseFallback
        ? [...fallbackFeatures, ...mapboxFeatures]
        : mapboxFeatures
    )
      .sort((left, right) => scoreFeature(query, right) - scoreFeature(query, left))
      .slice(0, 8);

    return NextResponse.json({ features });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Location search failed" },
      { status: 500 }
    );
  }
}
