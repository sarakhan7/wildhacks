import { NextResponse } from "next/server";
import { extractUtilityData, AuditReportContext } from "@/lib/gemini";
import { runAnalysis, generateECMSuggestions, BuildingInfo } from "@/lib/analysis";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const buildingInfoStr = formData.get("buildingInfo");
    
    if (!buildingInfoStr) {
      return NextResponse.json({ error: "Missing building info" }, { status: 400 });
    }

    const buildingInfo: BuildingInfo = JSON.parse(buildingInfoStr as string);
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      // Mock data path if no files uploaded (for fast demo testing)
      const mockReadings = generateMockReadings();
      const analysis = runAnalysis(mockReadings, buildingInfo);
      const ecms = generateECMSuggestions(analysis, buildingInfo);
      
      return NextResponse.json({
        readings: mockReadings,
        analysis,
        ecms
      });
    }

    // Process actual files via Gemini 3 Flash OCR
    const allReadings = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64 = buffer.toString("base64");
      
      try {
        const extracted = await extractUtilityData(base64, file.type);
        allReadings.push(...extracted);
      } catch (err: any) {
        console.error(`Failed to extract from \${file.name}:`, err);
        // Continue processing other files
      }
    }

    if (allReadings.length === 0) {
      return NextResponse.json({ error: "Could not extract any data from uploaded files" }, { status: 422 });
    }

    // Remove duplicates by month (in case a bill has multiple periods or overlaps)
    const uniqueMap = new Map();
    for (const r of allReadings) {
      uniqueMap.set(r.month, r);
    }
    const finalReadings = Array.from(uniqueMap.values());

    // Run statistical engine
    const analysis = runAnalysis(finalReadings, buildingInfo);
    
    // Generate ECMs
    const ecms = generateECMSuggestions(analysis, buildingInfo);

    return NextResponse.json({
      readings: finalReadings,
      analysis,
      ecms
    });

  } catch (error: any) {
    console.error("Analysis pipeline error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// Generate reasonable mock utility bills if user hasn't uploaded any
function generateMockReadings() {
  const readings = [];
  const startMonth = 1;
  const year = 2024;
  
  // Seasonal curve
  for (let i = 0; i < 12; i++) {
    const monthNum = i + 1;
    const monthStr = `\${year}-\${monthNum.toString().padStart(2, "0")}`;
    
    // Higher electric in summer
    const isSummer = monthNum >= 6 && monthNum <= 9;
    const kwh = 8000 + (isSummer ? 4000 : 0) + Math.random() * 2000;
    
    // Higher gas in winter
    const isWinter = monthNum <= 3 || monthNum >= 11;
    const therms = 100 + (isWinter ? 300 : 0) + Math.random() * 50;
    
    const peakKw = (kwh / 730) * (2.5 + Math.random());
    const cost = (kwh * 0.15) + (therms * 1.5) + 150; // base charge
    
    readings.push({
      month: monthStr,
      kwh: Math.round(kwh),
      therms: Math.round(therms),
      peakKw: Math.round(peakKw),
      cost: Math.round(cost * 100) / 100
    });
  }
  return readings;
}
