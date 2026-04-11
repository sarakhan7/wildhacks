import { NextResponse } from "next/server";
import { generateAuditReport, AuditReportContext } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const context: AuditReportContext = await request.json();
    
    // Input validation
    if (!context || !context.building || !context.analysis) {
      return NextResponse.json({ error: "Missing required context" }, { status: 400 });
    }

    const reportMarkdown = await generateAuditReport(context);
    
    return NextResponse.json({ report: reportMarkdown });
  } catch (error: any) {
    console.error("Report generation error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
