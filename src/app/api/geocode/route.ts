import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("query");

  if (!address) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  // Use the secret token for server-side API calls if available, otherwise fallback to public
  const token =
    process.env.MAPBOX_SECRET_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  
  if (!token) {
    return NextResponse.json({ error: "Mapbox token not configured" }, { status: 500 });
  }

  try {
    const mapboxUrl = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`
    );
    mapboxUrl.searchParams.set("access_token", token);
    mapboxUrl.searchParams.set("limit", "5");

    const res = await fetch(mapboxUrl);

    if (!res.ok) {
      throw new Error(`Mapbox API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Location search failed" },
      { status: 500 }
    );
  }
}
