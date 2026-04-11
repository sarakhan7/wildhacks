from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


AuditStage = Literal[
    "created",
    "queued",
    "ocr",
    "normalize",
    "weather",
    "analytics",
    "diagnostics",
    "recommendations",
    "report",
    "completed",
    "needs_review",
    "failed",
]

AuditState = Literal["pending", "running", "completed", "needs_review", "failed"]


class BuildingProfile(BaseModel):
    address: str
    lat: float
    lng: float
    buildingType: str
    squareFeet: int = Field(ge=0)
    yearBuilt: int = Field(ge=1800, le=2100)
    floors: int = Field(ge=0)
    operatingHours: int = Field(ge=0)
    hvacType: str
    lightingType: str
    hasRenovations: bool = False
    occupancy: int = Field(default=100, ge=0, le=100)


class CreateAuditRequest(BaseModel):
    building: BuildingProfile


class CreateAuditResponse(BaseModel):
    audit_id: str
    status: AuditState
    stage: AuditStage
    created_at: datetime


class UploadedDocument(BaseModel):
    document_id: str
    audit_id: str
    filename: str
    mime_type: str
    storage_path: str
    storage_provider: str = "local"
    storage_bucket: str | None = None
    storage_object_path: str | None = None
    storage_url: str | None = None
    upload_warnings: list[str] = Field(default_factory=list)
    created_at: datetime


class OCRReading(BaseModel):
    month: str
    kwh: float = 0
    therms: float = 0
    peak_kw: float | None = None
    cost: float = 0
    confidence: float = Field(default=0.5, ge=0, le=1)
    source_document_id: str
    source_pages: list[int] = Field(default_factory=list)
    extraction_notes: list[str] = Field(default_factory=list)


class OCRDocumentResult(BaseModel):
    document_id: str
    filename: str
    overall_confidence: float = Field(default=0.5, ge=0, le=1)
    readings: list[OCRReading] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    provider: str = "fallback"


class NormalizedUtilityReading(BaseModel):
    month: str
    kwh: float = 0
    therms: float = 0
    peak_kw: float | None = None
    cost: float = 0
    confidence: float = Field(default=0.5, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    source_document_ids: list[str] = Field(default_factory=list)


class ReviewReadingsRequest(BaseModel):
    readings: list[NormalizedUtilityReading]


class WeatherMonthFeature(BaseModel):
    month: str
    avg_temp_f: float
    hdd: float
    cdd: float
    station_id: str
    station_name: str
    source: Literal["noaa", "climate_zone_fallback"] = "climate_zone_fallback"


class ChangepointSignal(BaseModel):
    month: str
    cusum_score: float
    isolation_score: float
    flagged: bool
    reasons: list[str] = Field(default_factory=list)


class PrismFit(BaseModel):
    base_temperature_f: float
    r_squared: float
    baseload_kbtu_per_month: float
    heating_slope_kbtu_per_hdd: float
    cooling_slope_kbtu_per_cdd: float
    modeled_months: list[str] = Field(default_factory=list)


class PeerClusterAssignment(BaseModel):
    cluster_id: str
    cluster_label: str
    archetype_label: str
    percentile: float
    climate_zone: str
    benchmark_eui: float
    median_eui: float
    top_quartile_eui: float
    source: str = "cbecs_seed"


class MonthlyBreakdown(BaseModel):
    month: str
    label: str
    electricKbtu: float
    gasKbtu: float
    totalKbtu: float
    cost: float
    isAnomaly: bool


class AnalysisResults(BaseModel):
    totalElectricity: float
    totalGas: float
    totalEnergy: float
    totalCost: float
    siteEUI: float
    costPerSqFt: float
    electricIntensity: float
    gasIntensity: float
    loadFactor: float | None
    monthlyBreakdown: list[MonthlyBreakdown]
    peakMonth: str
    lowestMonth: str
    seasonalVariation: float
    estimatedBaseload: float
    heatingPercent: float
    coolingPercent: float
    baseloadPercent: float
    annualSavingsOpportunity: float
    peerPercentile: float
    clusterLabel: str
    climateZone: str
    anomalyCount: int
    prism: PrismFit


class DiagnosticHypothesis(BaseModel):
    hypothesis_id: str
    title: str
    description: str
    confidence: int = Field(ge=1, le=5)
    end_use: str
    evidence_months: list[str] = Field(default_factory=list)
    signals: list[str] = Field(default_factory=list)
    review_required: bool = False


class FinancialProjection(BaseModel):
    recommendation_id: str
    annual_savings_usd: float
    simple_payback_years: float | None
    npv_10y: float
    cumulative_savings_10y: float
    discount_rate: float
    escalation_rate: float


class ECMRecommendation(BaseModel):
    recommendation_id: str
    title: str
    description: str
    rationale: str
    estimated_cost_range: str
    estimated_savings_kwh: float
    estimated_savings_therms: float
    estimated_savings_usd: float
    simple_payback_years: float | None
    npv_10y: float
    implementation_complexity: Literal["Low", "Medium", "High"]
    priority: int = Field(ge=1, le=10)
    dependencies: list[str] = Field(default_factory=list)
    hypothesis_ids: list[str] = Field(default_factory=list)


class AuditReportArtifact(BaseModel):
    markdown: str
    citations: list[str] = Field(default_factory=list)
    hypothesis_ids: list[str] = Field(default_factory=list)
    recommendation_ids: list[str] = Field(default_factory=list)
    provider: str = "deterministic"


class AuditStatusResponse(BaseModel):
    audit_id: str
    status: AuditState
    stage: AuditStage
    progress: int = Field(ge=0, le=100)
    warning_messages: list[str] = Field(default_factory=list)
    review_required: bool = False
    error: str | None = None
    updated_at: datetime


class AuditResultsResponse(BaseModel):
    audit_id: str
    status: AuditState
    stage: AuditStage
    building: BuildingProfile
    readings: list[NormalizedUtilityReading]
    weather: list[WeatherMonthFeature]
    anomalies: list[ChangepointSignal]
    peer: PeerClusterAssignment
    analysis: AnalysisResults
    diagnostics: list[DiagnosticHypothesis]
    recommendations: list[ECMRecommendation]
    financials: list[FinancialProjection]
    report: AuditReportArtifact
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
