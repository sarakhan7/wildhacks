from __future__ import annotations

import json
import uuid
from urllib import error, request

from ..analytics.financials import build_financial_projection
from ..schemas import (
    AnalysisResults,
    AuditReportArtifact,
    BuildingProfile,
    DiagnosticHypothesis,
    ECMRecommendation,
    FinancialProjection,
    PeerClusterAssignment,
)


class ReasoningService:
    def __init__(self, gemini_api_key: str, model: str) -> None:
        self.gemini_api_key = gemini_api_key
        self.model = model

    def diagnose(self, building: BuildingProfile, analysis: AnalysisResults, peer: PeerClusterAssignment) -> list[DiagnosticHypothesis]:
        hypotheses = _deterministic_hypotheses(building, analysis, peer)
        return sorted(hypotheses, key=lambda hypothesis: (-hypothesis.confidence, hypothesis.title))

    def recommend(
        self, building: BuildingProfile, analysis: AnalysisResults, hypotheses: list[DiagnosticHypothesis]
    ) -> tuple[list[ECMRecommendation], list[FinancialProjection]]:
        eligible = [hypothesis for hypothesis in hypotheses if hypothesis.confidence >= 3]
        recommendations = _deterministic_recommendations(building, analysis, eligible)
        projections = [build_financial_projection(recommendation) for recommendation in recommendations]
        projection_map = {projection.recommendation_id: projection for projection in projections}
        enriched = []
        for recommendation in recommendations:
            projection = projection_map[recommendation.recommendation_id]
            enriched.append(
                recommendation.model_copy(
                    update={
                        "simple_payback_years": projection.simple_payback_years,
                        "npv_10y": projection.npv_10y,
                    }
                )
            )
        return enriched, projections

    def write_report(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        hypotheses: list[DiagnosticHypothesis],
        recommendations: list[ECMRecommendation],
        financials: list[FinancialProjection],
    ) -> AuditReportArtifact:
        markdown = _deterministic_markdown(building, analysis, peer, hypotheses, recommendations, financials)
        return AuditReportArtifact(
            markdown=markdown,
            citations=[f"{hypothesis.title}: {', '.join(hypothesis.evidence_months)}" for hypothesis in hypotheses],
            hypothesis_ids=[hypothesis.hypothesis_id for hypothesis in hypotheses],
            recommendation_ids=[recommendation.recommendation_id for recommendation in recommendations],
            provider="deterministic",
        )


def _deterministic_hypotheses(
    building: BuildingProfile, analysis: AnalysisResults, peer: PeerClusterAssignment
) -> list[DiagnosticHypothesis]:
    hypotheses: list[DiagnosticHypothesis] = []
    if analysis.heatingPercent >= 30:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Heating sensitivity is dominating winter load",
                description="The PRISM fit shows elevated heating slope relative to peer expectations, suggesting HVAC inefficiency or envelope losses.",
                confidence=4,
                end_use="heating",
                evidence_months=[analysis.peakMonth],
                signals=["prism_heating_slope", "winter_variation"],
            )
        )
    if analysis.coolingPercent >= 25:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Cooling load is driving summer peaks",
                description="Cooling-sensitive months rise sharply relative to baseload, which points to HVAC scheduling or condenser efficiency issues.",
                confidence=4,
                end_use="cooling",
                evidence_months=[analysis.peakMonth],
                signals=["prism_cooling_slope", "seasonal_variation"],
            )
        )
    if analysis.loadFactor is not None and analysis.loadFactor < 0.65:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Poor demand management is inflating costs",
                description="The estimated load factor is below the target threshold, indicating sharp demand peaks relative to average demand.",
                confidence=5,
                end_use="demand",
                evidence_months=[analysis.peakMonth],
                signals=["load_factor", "peak_kw"],
            )
        )
    if analysis.baseloadPercent >= 50:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Always-on equipment is oversized or unscheduled",
                description="Baseload exceeds typical peer share, which suggests controls, plug-load, or scheduling waste outside occupied hours.",
                confidence=4,
                end_use="baseload",
                evidence_months=[analysis.lowestMonth],
                signals=["baseload_percent", "operating_hours"],
            )
        )
    if analysis.peerPercentile < 35:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Building is underperforming against comparable peers",
                description=f"The building falls below the cluster median for {peer.archetype_label}, so multiple systems likely need tuning rather than one isolated fix.",
                confidence=3,
                end_use="whole_building",
                evidence_months=[analysis.peakMonth, analysis.lowestMonth],
                signals=["peer_percentile", "cluster_assignment"],
            )
        )
    return hypotheses


def _deterministic_recommendations(
    building: BuildingProfile, analysis: AnalysisResults, hypotheses: list[DiagnosticHypothesis]
) -> list[ECMRecommendation]:
    recommendations: list[ECMRecommendation] = []
    hypothesis_ids = {hypothesis.title: hypothesis.hypothesis_id for hypothesis in hypotheses}
    if any(hypothesis.end_use == "heating" for hypothesis in hypotheses):
        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title="Heating plant tune-up and envelope sealing",
                description="Tune the heating plant, recommission schedules, and seal infiltration paths to reduce winter sensitivity.",
                rationale="Mapped from heating-dominant PRISM behavior and winter anomaly evidence.",
                estimated_cost_range="$8,000-$28,000",
                estimated_savings_kwh=4500,
                estimated_savings_therms=650,
                estimated_savings_usd=max(analysis.annualSavingsOpportunity * 0.28, 2500),
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity="Medium",
                priority=1,
                dependencies=["Heating controls review", "Envelope inspection"],
                hypothesis_ids=[hypothesis_ids["Heating sensitivity is dominating winter load"]],
            )
        )
    if any(hypothesis.end_use == "cooling" for hypothesis in hypotheses):
        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title="Cooling optimization and controls reset",
                description="Recommission cooling controls, optimize setpoints, and inspect condenser performance before major capital replacement.",
                rationale="Mapped from cooling-sensitive PRISM fit and summer peak behavior.",
                estimated_cost_range="$5,000-$22,000",
                estimated_savings_kwh=12000,
                estimated_savings_therms=0,
                estimated_savings_usd=max(analysis.annualSavingsOpportunity * 0.25, 2000),
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity="Medium",
                priority=2,
                dependencies=["Cooling controls trend review"],
                hypothesis_ids=[hypothesis_ids["Cooling load is driving summer peaks"]],
            )
        )
    if any(hypothesis.end_use == "demand" for hypothesis in hypotheses):
        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title="Demand management and peak shaving strategy",
                description="Stagger startup schedules, identify peak demand triggers, and evaluate demand response or battery support.",
                rationale="Mapped from low load factor and peak-demand behavior.",
                estimated_cost_range="$4,000-$18,000",
                estimated_savings_kwh=0,
                estimated_savings_therms=0,
                estimated_savings_usd=max(analysis.annualSavingsOpportunity * 0.2, 1500),
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity="Low",
                priority=3,
                dependencies=["Utility tariff review"],
                hypothesis_ids=[hypothesis_ids["Poor demand management is inflating costs"]],
            )
        )
    if any(hypothesis.end_use == "baseload" for hypothesis in hypotheses):
        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title="After-hours shutdown and plug-load controls",
                description="Audit always-on loads, shut down non-critical circuits after hours, and add occupancy-based plug-load controls.",
                rationale="Mapped from elevated baseload relative to occupied-hours expectations.",
                estimated_cost_range="$2,000-$9,000",
                estimated_savings_kwh=8000,
                estimated_savings_therms=0,
                estimated_savings_usd=max(analysis.annualSavingsOpportunity * 0.18, 1000),
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity="Low",
                priority=4,
                dependencies=["Plug-load inventory"],
                hypothesis_ids=[hypothesis_ids["Always-on equipment is oversized or unscheduled"]],
            )
        )
    if not recommendations:
        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title="Continuous commissioning program",
                description="Establish metering, monthly review, and recommissioning workflows before larger capital changes.",
                rationale="Fallback recommendation when signals are weak but benchmarking still shows optimization opportunity.",
                estimated_cost_range="$3,000-$12,000",
                estimated_savings_kwh=4000,
                estimated_savings_therms=100,
                estimated_savings_usd=max(analysis.annualSavingsOpportunity * 0.12, 750),
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity="Low",
                priority=5,
                dependencies=[],
                hypothesis_ids=[hypothesis.hypothesis_id for hypothesis in hypotheses],
            )
        )
    return recommendations


def _deterministic_markdown(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    hypotheses: list[DiagnosticHypothesis],
    recommendations: list[ECMRecommendation],
    financials: list[FinancialProjection],
) -> str:
    lines = [
        "# Executive Summary",
        f"- Property: {building.address}",
        f"- Building type: {building.buildingType}",
        f"- Site EUI: {analysis.siteEUI:.1f} kBtu/ft²",
        f"- Peer percentile: {analysis.peerPercentile:.1f}th percentile within {peer.archetype_label}",
        f"- Estimated annual savings opportunity: ${analysis.annualSavingsOpportunity:,.0f}",
        "",
        "## Energy Use Breakdown",
        f"- Heating share: {analysis.heatingPercent:.1f}%",
        f"- Cooling share: {analysis.coolingPercent:.1f}%",
        f"- Baseload share: {analysis.baseloadPercent:.1f}%",
        f"- Peak month: {analysis.peakMonth}",
        f"- Lowest month: {analysis.lowestMonth}",
        "",
        "## Diagnostic Hypotheses",
    ]
    for hypothesis in hypotheses:
        lines.append(
            f"- **{hypothesis.title}** (confidence {hypothesis.confidence}/5): {hypothesis.description} "
            f"Evidence months: {', '.join(hypothesis.evidence_months) or 'n/a'}."
        )
    lines.append("")
    lines.append("## Prioritized ECMs")
    projection_map = {projection.recommendation_id: projection for projection in financials}
    for recommendation in recommendations:
        projection = projection_map[recommendation.recommendation_id]
        lines.append(
            f"- **{recommendation.title}**: {recommendation.description} "
            f"Estimated annual savings ${recommendation.estimated_savings_usd:,.0f}, "
            f"simple payback {projection.simple_payback_years or 'n/a'} years, "
            f"10-year NPV ${projection.npv_10y:,.0f}."
        )
    lines.extend(
        [
            "",
            "## Next Steps",
            "- Validate the low-confidence OCR rows if any billing periods were inferred.",
            "- Confirm utility tariff structure before finalizing demand-management recommendations.",
            "- Use this report as a preliminary audit and escalate to an on-site engineering review for investment-grade scope.",
        ]
    )
    return "\n".join(lines)
