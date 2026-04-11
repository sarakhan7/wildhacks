import { NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/backend";

export async function POST(request: Request, { params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const formData = await request.formData();
  const response = await proxyToBackend(`/audits/${auditId}/files`, {
    method: "POST",
    body: formData,
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
