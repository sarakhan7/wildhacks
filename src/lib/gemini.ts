/**
 * Gemini API helpers for OCR and report generation.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { isProd, loadResponseText, saveRecording } from "@/lib/gemini_fixtures";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function geminiLogEnabled(): boolean {
  const v = (process.env.AUDITAI_LOG_GEMINI || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function logGeminiEvent(
  operation: string,
  phase: string,
  fields: Record<string, unknown>
): void {
  if (!geminiLogEnabled()) return;
  const safe: Record<string, unknown> = { operation, phase, ...fields };
  for (const [k, val] of Object.entries(safe)) {
    if (typeof val === "string" && val.length > 4000) {
      safe[k] = `${val.slice(0, 4000)}...(${val.length} chars total)`;
    }
  }
  console.info("[auditai:gemini]", JSON.stringify(safe));
}

/**
 * Extract utility data from a bill image using Gemini Vision.
 */
export async function extractUtilityData(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedReading[]> {
  const modelId = "gemini-3.0-flash";
  const operation = "next.extractUtilityData";

  const prompt = `You are an expert utility bill data extractor. Analyze this utility bill image and extract ALL billing periods shown.

For each billing period, extract:
- month: The billing period in "YYYY-MM" format (use the END date of the billing period)
- kwh: Electricity consumption in kWh (0 if not an electric bill)
- therms: Natural gas consumption in therms (0 if not a gas bill)
- peak_kw: Peak demand in kW if shown (null if not available)
- cost: Total amount due/charged for that period in USD

Return a JSON array of objects. Example:
[
  {"month": "2024-01", "kwh": 4520, "therms": 180, "peak_kw": 22.5, "cost": 485.30},
  {"month": "2024-02", "kwh": 4100, "therms": 210, "peak_kw": 20.1, "cost": 512.10}
]

IMPORTANT:
- Extract ALL periods shown on the bill
- Convert any units to kWh for electricity and therms for gas
- If you see kBtu for gas, divide by 100 to get therms
- If you see CCF for gas, multiply by 1.037 to get therms
- If peak demand is not explicitly shown, set peak_kw to null
- Always include the total cost including all charges and fees
- Be precise with numbers — do not estimate or round`;

  let text: string;
  if (!isProd()) {
    text = await loadResponseText(operation);
    logGeminiEvent(operation, "playback", {
      model: modelId,
      responseTextChars: text.length,
    });
  } else {
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });
    logGeminiEvent(operation, "request", {
      model: modelId,
      mimeType,
      inlineDataBase64Chars: imageBase64.length,
      promptChars: prompt.length,
      promptPreview: prompt.slice(0, 500),
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    });
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      },
    ]);
    text = result.response.text();
    logGeminiEvent(operation, "response_raw", {
      model: modelId,
      responseTextChars: text.length,
      responseTextPreview: text.slice(0, 2000),
    });
    await saveRecording(operation, {
      model: modelId,
      request_summary: {
        mimeType,
        inlineDataBase64Chars: imageBase64.length,
        prompt,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      },
      response_text: text,
    });
  }

  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    logGeminiEvent(operation, "response_parsed", {
      model: modelId,
      readingsCount: rows.length,
    });
    return rows;
  } catch {
    // Try to extract JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      const raw = JSON.parse(match[1]) as unknown;
      const normalized = (Array.isArray(raw) ? raw : [raw]) as ExtractedReading[];
      logGeminiEvent(operation, "response_parsed_codeblock", {
        model: modelId,
        readingsCount: normalized.length,
      });
      return normalized;
    }
    throw new Error("Failed to parse OCR response: " + text.substring(0, 200));
  }
}

export interface ExtractedReading {
  month: string;
  kwh: number;
  therms: number;
  peak_kw: number | null;
  cost: number;
}

/**
 * Generate the full audit report using Gemini Pro.
 */
export async function generateAuditReport(context: AuditReportContext): Promise<string> {
  const modelId = "gemini-3.0-pro";
  const operation = "next.generateAuditReport";

  const prompt = `You are a licensed Professional Engineer (PE) with 20 years of experience conducting ASHRAE Level II commercial building energy audits. You have deep expertise in HVAC systems, building envelope analysis, energy modeling, and financial analysis of Energy Conservation Measures (ECMs).

You have been provided with a complete statistical analysis of a commercial building's energy performance. ALL NUMBERS HAVE BEEN PRE-COMPUTED BY DETERMINISTIC SOFTWARE — you must NOT invent, estimate, or recalculate any numeric values. Your role is to INTERPRET the data, DIAGNOSE efficiency issues, and WRITE a professional audit report.

## BUILDING DATA (Pre-Computed)

\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## INSTRUCTIONS

Write a comprehensive energy audit report in Markdown format with the following sections:

### 1. Executive Summary
- Building profile (type, size, age, location)
- Overall energy performance: EUI of ${context.analysis.siteEUI} kBtu/ft² — cite the percentile rank (${context.percentile}th percentile) and performance grade (${context.grade})
- Top 3 key findings
- Total estimated annual savings opportunity: $${context.analysis.annualSavingsOpportunity.toLocaleString()}
- Confidence level in findings

### 2. Energy Use Breakdown
- Total annual energy: ${context.analysis.totalEnergy.toLocaleString()} kBtu
- Energy split: ${context.analysis.baseloadPercent}% baseload / ${context.analysis.heatingPercent}% heating / ${context.analysis.coolingPercent}% cooling
- Peak consumption month: ${context.analysis.peakMonth}
- Lowest consumption month: ${context.analysis.lowestMonth}
- Seasonal variation ratio: ${context.analysis.seasonalVariation}x
- Note any anomalous months from the data
- Monthly consumption analysis and what the pattern suggests

### 3. Peer Benchmarking
- Building's site EUI: ${context.analysis.siteEUI} kBtu/ft²
- Building type median: ${context.benchmark.medianSiteEUI} kBtu/ft²
- Top quartile target: ${context.benchmark.topQuartileEUI} kBtu/ft²
- Percentile rank: ${context.percentile}th
- Specific comparison narrative — what the gap means in practical terms

### 4. Prioritized Energy Conservation Measures
For each recommended ECM, include:
- Measure name and description
- Estimated energy savings (% and approximate kBtu)
- Cost range
- Simple payback period
- Implementation complexity
- Why this measure is recommended for THIS specific building

### 5. Financial Summary
- Total potential annual savings across all measures
- Aggregate investment range
- Average weighted payback period
- 10-year cumulative savings projection (assume 3% annual energy cost inflation)

### 6. Next Steps
- Recommended path to a professional Level II ASHRAE audit
- Available utility rebate programs to research
- ENERGY STAR certification eligibility (must be ≥50th percentile)
- Immediate low-cost actions the owner can take

## RULES
- NEVER invent numbers. Every figure MUST come from the pre-computed data block above.
- Cite specific months and data points when discussing findings.
- Be direct and actionable, not generic.
- Write in professional but accessible language suitable for a building owner (not an engineer).
- Use markdown headers, bullet points, and emphasis for readability.`;

  if (!isProd()) {
    const markdown = await loadResponseText(operation);
    logGeminiEvent(operation, "playback", {
      model: modelId,
      responseTextChars: markdown.length,
    });
    return markdown;
  }

  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
    },
  });

  logGeminiEvent(operation, "request", {
    model: modelId,
    promptChars: prompt.length,
    promptPreview: prompt.slice(0, 1200),
    contextJsonChars: JSON.stringify(context).length,
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  });

  const result = await model.generateContent(prompt);
  const markdown = result.response.text();
  logGeminiEvent(operation, "response_raw", {
    model: modelId,
    responseTextChars: markdown.length,
    responseTextPreview: markdown.slice(0, 2000),
  });
  await saveRecording(operation, {
    model: modelId,
    request_summary: {
      prompt,
      context,
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    },
    response_text: markdown,
  });
  return markdown;
}

export interface AuditReportContext {
  building: {
    address: string;
    type: string;
    typeLabel: string;
    squareFeet: number;
    yearBuilt: number;
    floors: number;
    operatingHours: number;
    hvacType: string;
    lightingType: string;
  };
  analysis: {
    totalElectricity: number;
    totalGas: number;
    totalEnergy: number;
    totalCost: number;
    siteEUI: number;
    costPerSqFt: number;
    electricIntensity: number;
    loadFactor: number | null;
    peakMonth: string;
    lowestMonth: string;
    seasonalVariation: number;
    estimatedBaseload: number;
    heatingPercent: number;
    coolingPercent: number;
    baseloadPercent: number;
    annualSavingsOpportunity: number;
    monthlyBreakdown: Array<{
      month: string;
      label: string;
      electricKbtu: number;
      gasKbtu: number;
      totalKbtu: number;
      cost: number;
      isAnomaly: boolean;
    }>;
  };
  benchmark: {
    medianSiteEUI: number;
    topQuartileEUI: number;
    bottomQuartileEUI: number;
  };
  percentile: number;
  grade: string;
  ecms: Array<{
    title: string;
    description: string;
    estimatedSavingsPercent: number;
    estimatedCostRange: string;
    paybackYears: number;
    complexity: string;
  }>;
}
