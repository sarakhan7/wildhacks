import type { AnalysisResults, BuildingInfo, UtilityReading } from "@/lib/analysis";

export interface AuditStatus {
  audit_id: string;
  status: "pending" | "running" | "completed" | "needs_review" | "failed";
  stage:
    | "created"
    | "queued"
    | "ocr"
    | "normalize"
    | "weather"
    | "analytics"
    | "diagnostics"
    | "recommendations"
    | "report"
    | "completed"
    | "needs_review"
    | "failed";
  progress: number;
  warning_messages: string[];
  review_required: boolean;
  error: string | null;
  updated_at: string;
}

export interface WeatherMonthFeature {
  month: string;
  avg_temp_f: number;
  hdd: number;
  cdd: number;
  station_id: string;
  station_name: string;
  source: "noaa" | "climate_zone_fallback";
}

export interface PeerClusterAssignment {
  cluster_id: string;
  cluster_label: string;
  archetype_label: string;
  percentile: number;
  climate_zone: string;
  benchmark_eui: number;
  median_eui: number;
  top_quartile_eui: number;
  source: string;
}

export interface DiagnosticHypothesis {
  hypothesis_id: string;
  title: string;
  description: string;
  confidence: number;
  end_use: string;
  evidence_months: string[];
  signals: string[];
  review_required: boolean;
}

export interface ECMRecommendation {
  recommendation_id: string;
  title: string;
  description: string;
  rationale: string;
  estimated_cost_range: string;
  estimated_savings_kwh: number;
  estimated_savings_therms: number;
  estimated_savings_usd: number;
  simple_payback_years: number | null;
  npv_10y: number;
  implementation_complexity: "Low" | "Medium" | "High";
  priority: number;
  dependencies: string[];
  hypothesis_ids: string[];
}

export interface FinancialProjection {
  recommendation_id: string;
  annual_savings_usd: number;
  simple_payback_years: number | null;
  npv_10y: number;
  cumulative_savings_10y: number;
  discount_rate: number;
  escalation_rate: number;
}

export interface AuditReportArtifact {
  markdown: string;
  citations: string[];
  hypothesis_ids: string[];
  recommendation_ids: string[];
  provider: string;
}

export interface AuditResultsBundle {
  audit_id: string;
  status: AuditStatus["status"];
  stage: AuditStatus["stage"];
  building: BuildingInfo;
  readings: UtilityReading[];
  weather: WeatherMonthFeature[];
  anomalies: Array<{
    month: string;
    cusum_score: number;
    isolation_score: number;
    flagged: boolean;
    reasons: string[];
  }>;
  peer: PeerClusterAssignment;
  analysis: AnalysisResults & {
    peerPercentile?: number;
    clusterLabel?: string;
    climateZone?: string;
    anomalyCount?: number;
  };
  diagnostics: DiagnosticHypothesis[];
  recommendations: ECMRecommendation[];
  financials: FinancialProjection[];
  report: AuditReportArtifact;
  warnings: string[];
  metadata: Record<string, unknown>;
}
