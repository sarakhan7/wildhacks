import { NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/backend";

export async function GET(_request: Request, { params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const response = await proxyToBackend(`/audits/${auditId}/results`, { method: "GET" });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
