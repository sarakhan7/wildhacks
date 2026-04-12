import { NextResponse } from "next/server";

import type { AuditResultsBundle } from "@/lib/audit-api";
import { proxyToBackend } from "@/lib/backend";
import { buildSolarVisualization, buildVisualizationResponse } from "@/lib/google-solar";
import { buildThermalVisualization } from "@/lib/visualization";

export async function GET(_request: Request, { params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const response = await proxyToBackend(`/audits/${auditId}/results`, { method: "GET" });

  if (!response.ok) {
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
    });
  }

  const results = (await response.json()) as AuditResultsBundle;
  const thermal = buildThermalVisualization(results);
  const solar = await buildSolarVisualization(results);

  return NextResponse.json(buildVisualizationResponse(results, solar, thermal), {
    headers: { "Cache-Control": "no-store" },
  });
}
