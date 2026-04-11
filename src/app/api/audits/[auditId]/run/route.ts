import { NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/backend";

export async function POST(_request: Request, { params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const response = await proxyToBackend(`/audits/${auditId}/run`, { method: "POST" });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
