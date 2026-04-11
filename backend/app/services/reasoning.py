from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from urllib import error, request

from ..analytics.financials import build_financial_projection
from ..analytics.prism import KWH_TO_KBTU, THERMS_TO_KBTU
from ..schemas import (
    AnalysisResults,
    AuditReportArtifact,
    BuildingProfile,
    ChangepointSignal,
    DiagnosticHypothesis,
    ECMRecommendation,
    FinancialProjection,
    PeerClusterAssignment,
)


GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


@dataclass(frozen=True)
class RecommendationModelInputs:
    electric_rate: float
    gas_rate: float
    annual_electric_cost: float
    annual_gas_cost: float
    annual_savings_opportunity: float
    peer_gap_pct: float
    peer_gap_factor: float
    vintage_factor: float
    renovation_factor: float
    hours_factor: float
    occupancy_factor: float
    load_factor_gap: float
    summer_spikiness: float
    lighting_factor: float
    implementation_scale: float
    annual_peak_kw: float
    anomaly_factor: float
    heating_share: float
    cooling_share: float
    baseload_share: float
    institutional_factor: float


@dataclass(frozen=True)
class CandidateMeasure:
    key: str
    title: str
    description: str
    implementation_complexity: str
    dependencies: list[str]
    score: float
    rationale: str
    estimated_cost_range: str
    estimated_savings_kwh: float
    estimated_savings_therms: float
    estimated_savings_usd: float
    target_end_uses: list[str]


class ReasoningService:
    def __init__(self, gemini_api_key: str, model: str) -> None:
        self.gemini_api_key = gemini_api_key
        self.model = model

    def diagnose(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        anomalies: list[ChangepointSignal],
    ) -> list[DiagnosticHypothesis]:
        if self.gemini_api_key:
            try:
                return self._diagnose_with_gemini(building, analysis, peer, anomalies)
            except Exception:
                pass
        hypotheses = _deterministic_hypotheses(building, analysis, peer, anomalies)
        return sorted(hypotheses, key=lambda hypothesis: (-hypothesis.confidence, hypothesis.title))

    def recommend(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        hypotheses: list[DiagnosticHypothesis],
        anomalies: list[ChangepointSignal],
    ) -> tuple[list[ECMRecommendation], list[FinancialProjection]]:
        candidates = _build_candidate_measures(building, analysis, peer, hypotheses, anomalies)
        selected = None
        if self.gemini_api_key and candidates:
            try:
                selected = self._select_recommendations_with_gemini(building, analysis, peer, hypotheses, anomalies, candidates)
            except Exception:
                selected = None
        recommendations = _materialize_recommendations(candidates, hypotheses, selected)
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
        anomalies: list[ChangepointSignal],
        hypotheses: list[DiagnosticHypothesis],
        recommendations: list[ECMRecommendation],
        financials: list[FinancialProjection],
    ) -> AuditReportArtifact:
        if self.gemini_api_key:
            try:
                markdown = self._write_report_with_gemini(
                    building,
                    analysis,
                    peer,
                    anomalies,
                    hypotheses,
                    recommendations,
                    financials,
                )
                return AuditReportArtifact(
                    markdown=markdown,
                    citations=[f"{hypothesis.title}: {', '.join(hypothesis.evidence_months)}" for hypothesis in hypotheses],
                    hypothesis_ids=[hypothesis.hypothesis_id for hypothesis in hypotheses],
                    recommendation_ids=[recommendation.recommendation_id for recommendation in recommendations],
                    provider="gemini",
                )
            except Exception:
                pass

        markdown = _deterministic_markdown(building, analysis, peer, anomalies, hypotheses, recommendations, financials)
        return AuditReportArtifact(
            markdown=markdown,
            citations=[f"{hypothesis.title}: {', '.join(hypothesis.evidence_months)}" for hypothesis in hypotheses],
            hypothesis_ids=[hypothesis.hypothesis_id for hypothesis in hypotheses],
            recommendation_ids=[recommendation.recommendation_id for recommendation in recommendations],
            provider="deterministic",
        )

    def _diagnose_with_gemini(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        anomalies: list[ChangepointSignal],
    ) -> list[DiagnosticHypothesis]:
        context = _build_reasoning_context(building, analysis, peer, anomalies)
        prompt = f"""
You are a senior commercial building energy engineer. Review the structured audit statistics and return 3 to 5 diagnostic hypotheses.

Rules:
- Use only the supplied numbers. Do not invent values.
- Focus on causal building-performance insights, not generic advice.
- Each hypothesis must map to one of these end_use values: heating, cooling, baseload, demand, ventilation, lighting, whole_building.
- Confidence must be an integer from 1 to 5.
- evidence_months must contain one or more explicit YYYY-MM months from the context when possible.
- signals should name the statistical drivers used.

Return strict JSON with this shape:
{{
  "hypotheses": [
    {{
      "title": "string",
      "description": "string",
      "confidence": 4,
      "end_use": "heating",
      "evidence_months": ["2025-01"],
      "signals": ["peer_percentile", "gas_seasonality"]
    }}
  ]
}}

Structured context:
{json.dumps(context, indent=2)}
""".strip()

        payload = self._generate_json(prompt)
        rows = payload.get("hypotheses", [])
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("Gemini diagnostic response did not contain hypotheses")

        hypotheses: list[DiagnosticHypothesis] = []
        for row in rows[:5]:
            if not isinstance(row, dict):
                continue
            hypotheses.append(
                DiagnosticHypothesis(
                    hypothesis_id=str(uuid.uuid4()),
                    title=str(row.get("title") or "Unspecified diagnostic issue"),
                    description=str(row.get("description") or ""),
                    confidence=int(_clamp(float(row.get("confidence") or 3), 1, 5)),
                    end_use=str(row.get("end_use") or "whole_building"),
                    evidence_months=[str(month) for month in row.get("evidence_months", [])][:4],
                    signals=[str(signal) for signal in row.get("signals", [])][:6],
                )
            )
        if not hypotheses:
            raise RuntimeError("Gemini diagnostic response parsed no hypotheses")
        return sorted(hypotheses, key=lambda hypothesis: (-hypothesis.confidence, hypothesis.title))

    def _select_recommendations_with_gemini(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        hypotheses: list[DiagnosticHypothesis],
        anomalies: list[ChangepointSignal],
        candidates: list[CandidateMeasure],
    ) -> list[dict[str, object]]:
        context = _build_reasoning_context(building, analysis, peer, anomalies)
        prompt = f"""
You are a senior commercial building energy engineer. Pick the most credible energy conservation measures from the candidate catalog.

Rules:
- Use only the provided candidate keys. Do not invent new keys.
- Select 3 or 4 measures that complement each other.
- Prioritize measures whose deterministic economics and statistical basis are believable for this building.
- Favor diverse measures across different end uses.
- rationale should explain why the selected measure fits the observed statistics.

Return strict JSON with this shape:
{{
  "selected": [
    {{
      "key": "demand_management",
      "priority": 1,
      "rationale": "string"
    }}
  ]
}}

Structured audit context:
{json.dumps(context, indent=2)}

Diagnostic hypotheses:
{json.dumps([hypothesis.model_dump(exclude={"hypothesis_id"}) for hypothesis in hypotheses], indent=2)}

Candidate catalog:
{json.dumps([_candidate_for_prompt(candidate) for candidate in candidates], indent=2)}
""".strip()

        payload = self._generate_json(prompt)
        selected = payload.get("selected", [])
        if not isinstance(selected, list) or not selected:
            raise RuntimeError("Gemini recommendation selection response did not contain selected measures")
        cleaned = []
        for item in selected[:4]:
            if not isinstance(item, dict):
                continue
            cleaned.append(
                {
                    "key": str(item.get("key") or ""),
                    "priority": int(_clamp(float(item.get("priority") or 5), 1, 10)),
                    "rationale": str(item.get("rationale") or ""),
                }
            )
        if not cleaned:
            raise RuntimeError("Gemini recommendation selection response parsed no measures")
        return cleaned

    def _write_report_with_gemini(
        self,
        building: BuildingProfile,
        analysis: AnalysisResults,
        peer: PeerClusterAssignment,
        anomalies: list[ChangepointSignal],
        hypotheses: list[DiagnosticHypothesis],
        recommendations: list[ECMRecommendation],
        financials: list[FinancialProjection],
    ) -> str:
        projection_map = {projection.recommendation_id: projection.model_dump() for projection in financials}
        context = {
            "building": building.model_dump(),
            "analysis": analysis.model_dump(),
            "peer": peer.model_dump(),
            "anomalies": [signal.model_dump() for signal in anomalies],
            "hypotheses": [hypothesis.model_dump() for hypothesis in hypotheses],
            "recommendations": [
                {
                    **recommendation.model_dump(),
                    "financial_projection": projection_map.get(recommendation.recommendation_id),
                }
                for recommendation in recommendations
            ],
        }
        prompt = f"""
You are a licensed professional engineer writing a preliminary commercial building energy audit report.

Rules:
- Use only the supplied statistics and recommendation data.
- Do not invent new numeric values.
- Explain what the numbers mean in practical operating terms.
- Keep the report grounded and specific to this building.
- Produce Markdown with these sections:
  1. Executive Summary
  2. Energy Use Breakdown
  3. Benchmarking Interpretation
  4. Prioritized Measures
  5. Financial Summary
  6. Next Steps

Structured context:
{json.dumps(context, indent=2)}
""".strip()

        return self._generate_text(prompt)

    def _generate_json(self, prompt: str) -> dict[str, object]:
        payload = self._request_gemini(
            prompt,
            generation_config={
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "maxOutputTokens": 4096,
            },
        )
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Failed to parse Gemini JSON response: {payload[:300]}") from exc

    def _generate_text(self, prompt: str) -> str:
        return self._request_gemini(
            prompt,
            generation_config={
                "temperature": 0.3,
                "maxOutputTokens": 8192,
            },
        )

    def _request_gemini(self, prompt: str, *, generation_config: dict[str, object]) -> str:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }
        req = request.Request(
            url=f"{GEMINI_API_BASE}/{self.model}:generateContent?key={self.gemini_api_key}",
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=90) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(exc.read().decode("utf-8")) from exc
        try:
            return parsed["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected Gemini response payload: {parsed}") from exc


def _deterministic_hypotheses(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    anomalies: list[ChangepointSignal],
) -> list[DiagnosticHypothesis]:
    flagged_months = [signal.month for signal in anomalies if signal.flagged]
    peak_electric_month = _month_with_max(analysis, key="electricKbtu")
    peak_gas_month = _month_with_max(analysis, key="gasKbtu")
    hypotheses: list[DiagnosticHypothesis] = []

    if analysis.heatingPercent >= 20 or analysis.totalGas > 0 and analysis.heatingPercent >= 12:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Heating load is materially driving annual energy use",
                description="The weather-normalized heating component remains elevated relative to peer expectations, which suggests plant, distribution, or envelope losses are contributing meaningfully to annual spend.",
                confidence=4 if analysis.heatingPercent >= 25 else 3,
                end_use="heating",
                evidence_months=[peak_gas_month] if peak_gas_month else (flagged_months[:1] or [analysis.peakMonth]),
                signals=["prism_heating_slope", "winter_gas_load", "peer_gap"],
            )
        )
    if analysis.coolingPercent >= 12 or analysis.seasonalVariation >= 1.6:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Cooling demand is amplifying summer electric peaks",
                description="The combination of summer spikiness and cooling-sensitive PRISM behavior suggests chiller or airside controls are contributing to seasonal electric cost concentration.",
                confidence=4 if analysis.coolingPercent >= 18 else 3,
                end_use="cooling",
                evidence_months=[peak_electric_month] if peak_electric_month else [analysis.peakMonth],
                signals=["prism_cooling_slope", "seasonal_variation", "peak_kw"],
            )
        )
    if analysis.loadFactor is not None and analysis.loadFactor < 0.65:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Peak demand behavior is eroding electric cost efficiency",
                description="Average demand is low relative to measured peak demand, which points to avoidable coincident peaks, startup stacking, or plant sequencing inefficiency.",
                confidence=5 if analysis.loadFactor < 0.55 else 4,
                end_use="demand",
                evidence_months=[peak_electric_month] if peak_electric_month else [analysis.peakMonth],
                signals=["load_factor", "peak_kw", "summer_spikiness"],
            )
        )
    if analysis.baseloadPercent >= 30:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="A large share of use is effectively always-on",
                description="The modeled baseload remains high across the year, which usually indicates schedule drift, ventilation overrun, process loads, or other persistent non-weather-driven consumption.",
                confidence=4,
                end_use="baseload",
                evidence_months=[analysis.lowestMonth],
                signals=["baseload_percent", "operating_hours", "occupancy"],
            )
        )
    if analysis.peerPercentile < 35:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Whole-building performance is lagging comparable peers",
                description=f"The building sits materially above the median EUI for {peer.archetype_label}, indicating the opportunity is likely portfolio-wide operational optimization rather than one isolated retrofit.",
                confidence=3,
                end_use="whole_building",
                evidence_months=[analysis.peakMonth, analysis.lowestMonth],
                signals=["peer_percentile", "cluster_assignment", "site_eui"],
            )
        )
    if not hypotheses:
        hypotheses.append(
            DiagnosticHypothesis(
                hypothesis_id=str(uuid.uuid4()),
                title="Energy signature suggests targeted commissioning opportunities",
                description="The building does not show one dominant end-use issue, but the combined benchmark gap and weather-normalized signature support targeted operational tuning.",
                confidence=3,
                end_use="whole_building",
                evidence_months=[analysis.peakMonth],
                signals=["site_eui", "seasonal_variation"],
            )
        )
    return hypotheses


def _month_with_max(analysis: AnalysisResults, *, key: str) -> str | None:
    if not analysis.monthlyBreakdown:
        return None
    return max(analysis.monthlyBreakdown, key=lambda row: getattr(row, key)).month


def _build_candidate_measures(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    hypotheses: list[DiagnosticHypothesis],
    anomalies: list[ChangepointSignal],
) -> list[CandidateMeasure]:
    inputs = _build_recommendation_inputs(building, analysis, peer, anomalies)
    candidates = [
        _demand_management_candidate(building, analysis, inputs),
        _retro_commissioning_candidate(building, analysis, inputs),
        _ventilation_scheduling_candidate(building, analysis, inputs),
        _heating_plant_candidate(building, analysis, inputs),
        _steam_distribution_candidate(building, analysis, inputs),
        _cooling_plant_candidate(building, analysis, inputs),
        _lighting_candidate(building, analysis, inputs),
        _plug_process_candidate(building, analysis, inputs),
    ]

    hypothesis_end_uses = {hypothesis.end_use for hypothesis in hypotheses}
    boosted: list[CandidateMeasure] = []
    for candidate in candidates:
        alignment_boost = 0.0
        if any(end_use in hypothesis_end_uses for end_use in candidate.target_end_uses):
            alignment_boost += 0.12
        if "whole_building" in hypothesis_end_uses:
            alignment_boost += 0.03
        boosted.append(
            CandidateMeasure(
                key=candidate.key,
                title=candidate.title,
                description=candidate.description,
                implementation_complexity=candidate.implementation_complexity,
                dependencies=candidate.dependencies,
                score=round(_clamp(candidate.score + alignment_boost, 0.0, 1.0), 3),
                rationale=candidate.rationale,
                estimated_cost_range=candidate.estimated_cost_range,
                estimated_savings_kwh=candidate.estimated_savings_kwh,
                estimated_savings_therms=candidate.estimated_savings_therms,
                estimated_savings_usd=candidate.estimated_savings_usd,
                target_end_uses=candidate.target_end_uses,
            )
        )
    return sorted(boosted, key=lambda candidate: (-candidate.score, -candidate.estimated_savings_usd, candidate.title))


def _materialize_recommendations(
    candidates: list[CandidateMeasure],
    hypotheses: list[DiagnosticHypothesis],
    selection: list[dict[str, object]] | None,
) -> list[ECMRecommendation]:
    candidate_map = {candidate.key: candidate for candidate in candidates}
    if selection:
        chosen = []
        seen: set[str] = set()
        for item in sorted(selection, key=lambda row: int(row.get("priority", 10))):
            key = str(item.get("key") or "")
            if key in seen or key not in candidate_map:
                continue
            chosen.append((candidate_map[key], str(item.get("rationale") or "").strip(), int(item.get("priority") or 5)))
            seen.add(key)
        if not chosen:
            selection = None
    if not selection:
        chosen = [(candidate, "", index + 1) for index, candidate in enumerate(candidates[:4])]

    end_use_map: dict[str, list[str]] = {}
    for hypothesis in hypotheses:
        end_use_map.setdefault(hypothesis.end_use, []).append(hypothesis.hypothesis_id)

    recommendations: list[ECMRecommendation] = []
    for candidate, llm_rationale, priority in chosen:
        hypothesis_ids: list[str] = []
        for end_use in candidate.target_end_uses:
            hypothesis_ids.extend(end_use_map.get(end_use, []))
        if not hypothesis_ids:
            hypothesis_ids = [hypothesis.hypothesis_id for hypothesis in hypotheses]

        recommendations.append(
            ECMRecommendation(
                recommendation_id=str(uuid.uuid4()),
                title=candidate.title,
                description=candidate.description,
                rationale=llm_rationale or candidate.rationale,
                estimated_cost_range=candidate.estimated_cost_range,
                estimated_savings_kwh=candidate.estimated_savings_kwh,
                estimated_savings_therms=candidate.estimated_savings_therms,
                estimated_savings_usd=candidate.estimated_savings_usd,
                simple_payback_years=None,
                npv_10y=0,
                implementation_complexity=candidate.implementation_complexity,  # type: ignore[arg-type]
                priority=priority,
                dependencies=candidate.dependencies,
                hypothesis_ids=list(dict.fromkeys(hypothesis_ids)),
            )
        )
    return recommendations


def _demand_management_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    demand_charge_fraction = _clamp(0.12 + 0.28 * inputs.load_factor_gap + 0.08 * inputs.summer_spikiness, 0.12, 0.38)
    annual_demand_spend = inputs.annual_electric_cost * demand_charge_fraction
    peak_reduction_pct = _clamp(0.04 + 0.10 * inputs.load_factor_gap + 0.04 * inputs.summer_spikiness, 0.04, 0.15)
    savings_kwh = round(analysis.totalElectricity * _clamp(0.002 + 0.012 * inputs.load_factor_gap, 0.002, 0.02))
    savings_therms = 0.0
    savings_usd = annual_demand_spend * peak_reduction_pct
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(75000.0, inputs.annual_savings_opportunity * 0.22),
    )
    cost_range = _format_kw_cost_range(inputs.annual_peak_kw, 15, 55, min_low=15000, min_high=55000)
    score = _clamp(0.55 * inputs.load_factor_gap + 0.20 * inputs.summer_spikiness + 0.15 * inputs.peer_gap_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="demand_management",
        title="Demand management and peak shaving",
        description="Resequence major equipment starts, flatten coincident peaks, and evaluate tariff-aware demand limiting or storage-assisted peak clipping.",
        implementation_complexity="Medium",
        dependencies=["Utility tariff review", "Trend data for major plant loads"],
        score=score,
        rationale=(
            f"Demand recommendation is driven by load factor {analysis.loadFactor or 0:.3f}, estimated peak demand "
            f"{inputs.annual_peak_kw:,.0f} kW, and an inferred demand-charge exposure of roughly "
            f"{demand_charge_fraction * 100:.0f}% of annual electric spend."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=0,
        estimated_savings_usd=savings_usd,
        target_end_uses=["demand", "cooling"],
    )


def _retro_commissioning_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    electric_frac = _clamp(0.015 + 0.04 * inputs.peer_gap_factor + 0.03 * inputs.anomaly_factor + 0.02 * inputs.baseload_share, 0.02, 0.08)
    gas_frac = _clamp(0.01 + 0.03 * inputs.peer_gap_factor + 0.04 * inputs.heating_share, 0.01, 0.07)
    savings_kwh = round(analysis.totalElectricity * electric_frac)
    savings_therms = round(analysis.totalGas * gas_frac)
    savings_usd = (savings_kwh * inputs.electric_rate) + (savings_therms * inputs.gas_rate)
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(120000.0, inputs.annual_savings_opportunity * 0.32),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.07,
        high_rate=0.22,
        scale=inputs.implementation_scale,
        min_low=40000,
        min_high=140000,
    )
    score = _clamp(0.35 * inputs.peer_gap_factor + 0.20 * inputs.anomaly_factor + 0.15 * inputs.vintage_factor + 0.15 * inputs.baseload_share + 0.15 * inputs.hours_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="retro_commissioning",
        title="Whole-building retro-commissioning",
        description="Re-tune schedules, reset strategies, ventilation control logic, plant sequencing, and control loops to reduce whole-building waste without major equipment replacement.",
        implementation_complexity="Medium",
        dependencies=["Controls trend review", "BAS sequence documentation"],
        score=score,
        rationale=(
            f"Retro-commissioning is supported by a {inputs.peer_gap_pct:.1f}% peer EUI gap, anomaly factor "
            f"{inputs.anomaly_factor:.2f}, and persistent non-weather load that suggests operational drift."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=savings_therms,
        estimated_savings_usd=savings_usd,
        target_end_uses=["whole_building", "baseload", "ventilation"],
    )


def _ventilation_scheduling_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    electric_frac = _clamp(0.01 + 0.05 * inputs.baseload_share + 0.04 * inputs.occupancy_factor + 0.03 * inputs.hours_factor, 0.01, 0.09)
    gas_frac = _clamp(0.005 + 0.06 * inputs.heating_share + 0.04 * inputs.occupancy_factor, 0.005, 0.08)
    savings_kwh = round(analysis.totalElectricity * electric_frac)
    savings_therms = round(analysis.totalGas * gas_frac)
    savings_usd = (savings_kwh * inputs.electric_rate) + (savings_therms * inputs.gas_rate)
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(90000.0, inputs.annual_savings_opportunity * 0.24),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.05,
        high_rate=0.14,
        scale=inputs.implementation_scale,
        min_low=30000,
        min_high=95000,
    )
    score = _clamp(0.30 * inputs.baseload_share + 0.25 * inputs.occupancy_factor + 0.20 * inputs.hours_factor + 0.15 * inputs.peer_gap_factor + 0.10 * inputs.institutional_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="ventilation_scheduling",
        title="Ventilation scheduling and outside-air reset",
        description="Align ventilation and airside schedules to actual occupancy, reset outside-air delivery where code-appropriate, and reduce after-hours fan and conditioning runtime.",
        implementation_complexity="Medium",
        dependencies=["Occupancy schedule review", "Airside controls verification"],
        score=score,
        rationale=(
            f"Ventilation optimization is driven by occupancy mismatch indicators, a baseload share of "
            f"{analysis.baseloadPercent:.1f}%, and the building’s institutional operating profile."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=savings_therms,
        estimated_savings_usd=savings_usd,
        target_end_uses=["ventilation", "baseload", "heating", "cooling"],
    )


def _heating_plant_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    heating_spend = inputs.annual_gas_cost * _clamp(0.80 + 0.20 * inputs.heating_share, 0.75, 0.95)
    achievable_pct = _clamp(0.04 + 0.04 * inputs.heating_share + 0.03 * inputs.vintage_factor + 0.02 * inputs.peer_gap_factor, 0.04, 0.11)
    savings_usd = heating_spend * achievable_pct
    savings_therms = round((savings_usd * 0.92) / max(inputs.gas_rate, 0.35)) if analysis.totalGas > 0 else 0
    savings_kwh = round((savings_usd * 0.08) / max(inputs.electric_rate, 0.05)) if analysis.totalElectricity > 0 else 0
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(120000.0, inputs.annual_savings_opportunity * 0.28),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.08,
        high_rate=0.24,
        scale=inputs.implementation_scale * (1.0 + 0.10 * inputs.vintage_factor),
        min_low=60000,
        min_high=180000,
    )
    score = _clamp(0.45 * inputs.heating_share + 0.20 * inputs.vintage_factor + 0.15 * inputs.renovation_factor + 0.20 * inputs.peer_gap_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="heating_plant_optimization",
        title="Heating plant optimization",
        description="Recommission the heating plant, adjust hot-water or steam reset strategies, repair control valve drift, and tune distribution setpoints before considering capital replacement.",
        implementation_complexity="Medium",
        dependencies=["Boiler/steam plant trend review", "Distribution temperature verification"],
        score=score,
        rationale=(
            f"Heating optimization is supported by a {analysis.heatingPercent:.1f}% heating share, gas spend of "
            f"${inputs.annual_gas_cost:,.0f}/yr, and building vintage factor {inputs.vintage_factor:.2f}."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=savings_therms,
        estimated_savings_usd=savings_usd,
        target_end_uses=["heating"],
    )


def _steam_distribution_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    distribution_spend = inputs.annual_gas_cost * _clamp(0.45 + 0.15 * inputs.heating_share + 0.10 * inputs.institutional_factor, 0.40, 0.70)
    achievable_pct = _clamp(0.02 + 0.025 * inputs.heating_share + 0.02 * inputs.vintage_factor + 0.02 * inputs.institutional_factor, 0.02, 0.07)
    savings_usd = distribution_spend * achievable_pct
    savings_therms = round(savings_usd / max(inputs.gas_rate, 0.35)) if analysis.totalGas > 0 else 0
    savings_kwh = 0
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(80000.0, inputs.annual_savings_opportunity * 0.18),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.04,
        high_rate=0.14,
        scale=inputs.implementation_scale,
        min_low=40000,
        min_high=160000,
    )
    score = _clamp(0.30 * inputs.heating_share + 0.25 * inputs.vintage_factor + 0.25 * inputs.institutional_factor + 0.20 * (inputs.annual_gas_cost / max(inputs.annual_electric_cost + inputs.annual_gas_cost, 1)), 0.0, 1.0)
    return CandidateMeasure(
        key="steam_distribution",
        title="Steam and hot-water distribution tune-up",
        description="Repair traps, insulation gaps, and control leakage in the heating distribution network to reduce standby and distribution losses.",
        implementation_complexity="Medium",
        dependencies=["Distribution survey", "Steam or hot-water maintenance log review"],
        score=score,
        rationale=(
            f"Distribution losses are a credible issue because the building has high annual gas spend, older infrastructure, "
            f"and an institutional load profile where central heating distribution matters."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=savings_therms,
        estimated_savings_usd=savings_usd,
        target_end_uses=["heating"],
    )


def _cooling_plant_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    kwh_frac = _clamp(0.02 + 0.10 * inputs.cooling_share + 0.06 * inputs.summer_spikiness + 0.04 * inputs.peer_gap_factor, 0.02, 0.14)
    savings_kwh = round(analysis.totalElectricity * kwh_frac)
    savings_therms = 0.0
    savings_usd = savings_kwh * inputs.electric_rate
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(80000.0, inputs.annual_savings_opportunity * 0.20),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.05,
        high_rate=0.16,
        scale=inputs.implementation_scale,
        min_low=40000,
        min_high=120000,
    )
    score = _clamp(0.45 * inputs.cooling_share + 0.25 * inputs.summer_spikiness + 0.15 * inputs.load_factor_gap + 0.15 * inputs.peer_gap_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="cooling_plant_optimization",
        title="Cooling plant and airside optimization",
        description="Tune chilled-water or DX plant sequencing, condenser reset, and airside temperature control to reduce summer peak electric intensity.",
        implementation_complexity="Medium",
        dependencies=["Cooling plant trend review", "Airside sequence verification"],
        score=score,
        rationale=(
            f"Cooling optimization is based on a {analysis.coolingPercent:.1f}% cooling share, seasonal variation "
            f"{analysis.seasonalVariation:.2f}x, and strong summer peak behavior."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=0,
        estimated_savings_usd=savings_usd,
        target_end_uses=["cooling", "demand"],
    )


def _lighting_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    kwh_frac = _clamp(0.01 + 0.08 * inputs.lighting_factor + 0.05 * inputs.baseload_share, 0.01, 0.14)
    savings_kwh = round(analysis.totalElectricity * kwh_frac)
    savings_therms = 0.0
    savings_usd = savings_kwh * inputs.electric_rate
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(100000.0, inputs.annual_savings_opportunity * 0.26),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.06,
        high_rate=0.24,
        scale=inputs.implementation_scale * (0.8 + 0.4 * inputs.lighting_factor),
        min_low=60000,
        min_high=180000,
    )
    score = _clamp(0.50 * inputs.lighting_factor + 0.30 * inputs.baseload_share + 0.20 * inputs.peer_gap_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="lighting_controls",
        title="Lighting retrofit and controls optimization",
        description="Reduce lighting energy through fixture retrofits where needed, occupancy controls, and schedule cleanup in low-use zones.",
        implementation_complexity="Low" if building.lightingType == "led" else "Medium",
        dependencies=["Lighting inventory", "Control zoning review"],
        score=score,
        rationale=(
            f"Lighting measures are supported by a lighting factor of {inputs.lighting_factor:.2f} for {building.lightingType} systems "
            f"and a modeled baseload share of {analysis.baseloadPercent:.1f}%."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=0,
        estimated_savings_usd=savings_usd,
        target_end_uses=["lighting", "baseload"],
    )


def _plug_process_candidate(building: BuildingProfile, analysis: AnalysisResults, inputs: RecommendationModelInputs) -> CandidateMeasure:
    kwh_frac = _clamp(0.015 + 0.06 * inputs.baseload_share + 0.05 * inputs.institutional_factor + 0.03 * inputs.peer_gap_factor, 0.015, 0.12)
    savings_kwh = round(analysis.totalElectricity * kwh_frac)
    savings_therms = 0.0
    savings_usd = savings_kwh * inputs.electric_rate
    savings_kwh, savings_therms, savings_usd = _apply_savings_cap(
        savings_kwh,
        savings_therms,
        savings_usd,
        max(100000.0, inputs.annual_savings_opportunity * 0.22),
    )
    cost_range = _format_cost_range(
        building.squareFeet,
        low_rate=0.04,
        high_rate=0.12,
        scale=inputs.implementation_scale,
        min_low=35000,
        min_high=110000,
    )
    score = _clamp(0.40 * inputs.baseload_share + 0.25 * inputs.institutional_factor + 0.20 * inputs.peer_gap_factor + 0.15 * inputs.occupancy_factor, 0.0, 1.0)
    return CandidateMeasure(
        key="plug_process_management",
        title="Plug and process load management",
        description="Target high-runtime lab, IT, and plug loads with shutdown policy, timer control, and equipment-level runtime reduction where operationally acceptable.",
        implementation_complexity="Low",
        dependencies=["Equipment runtime inventory", "Stakeholder sign-off for shutdown strategy"],
        score=score,
        rationale=(
            f"Plug/process management is justified when persistent non-weather electric load remains high in an institutional building with lab-like or specialty equipment density."
        ),
        estimated_cost_range=cost_range,
        estimated_savings_kwh=savings_kwh,
        estimated_savings_therms=0,
        estimated_savings_usd=savings_usd,
        target_end_uses=["baseload", "whole_building"],
    )


def _deterministic_markdown(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    anomalies: list[ChangepointSignal],
    hypotheses: list[DiagnosticHypothesis],
    recommendations: list[ECMRecommendation],
    financials: list[FinancialProjection],
) -> str:
    flagged_months = [signal.month for signal in anomalies if signal.flagged]
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
        f"- Flagged anomaly months: {', '.join(flagged_months) if flagged_months else 'None'}",
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
            f"10-year NPV ${projection.npv_10y:,.0f}. "
            f"Model basis: {recommendation.rationale}"
        )
    lines.extend(
        [
            "",
            "## Next Steps",
            "- Validate any flagged anomaly months against operating changes or special events.",
            "- Confirm utility tariff structure before finalizing demand-management economics.",
            "- Use this output as a screening audit and refine with interval trends and plant data before capital commitment.",
        ]
    )
    return "\n".join(lines)


def _build_reasoning_context(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    anomalies: list[ChangepointSignal],
) -> dict[str, object]:
    flagged = [signal.model_dump() for signal in anomalies if signal.flagged]
    return {
        "building": {
            "address": building.address,
            "building_type": building.buildingType,
            "square_feet": building.squareFeet,
            "year_built": building.yearBuilt,
            "floors": building.floors,
            "operating_hours_per_week": building.operatingHours,
            "hvac_type": building.hvacType,
            "lighting_type": building.lightingType,
            "has_renovations": building.hasRenovations,
            "occupancy_pct": building.occupancy,
        },
        "analysis": {
            "total_electricity_kwh": analysis.totalElectricity,
            "total_gas_therms": analysis.totalGas,
            "total_energy_kbtu": analysis.totalEnergy,
            "total_cost_usd": analysis.totalCost,
            "site_eui": analysis.siteEUI,
            "cost_per_sqft": analysis.costPerSqFt,
            "load_factor": analysis.loadFactor,
            "peak_month": analysis.peakMonth,
            "lowest_month": analysis.lowestMonth,
            "seasonal_variation": analysis.seasonalVariation,
            "estimated_baseload_kbtu_per_month": analysis.estimatedBaseload,
            "heating_percent": analysis.heatingPercent,
            "cooling_percent": analysis.coolingPercent,
            "baseload_percent": analysis.baseloadPercent,
            "annual_savings_opportunity_usd": analysis.annualSavingsOpportunity,
            "prism": analysis.prism.model_dump(),
        },
        "peer": peer.model_dump(),
        "flagged_anomalies": flagged,
    }


def _candidate_for_prompt(candidate: CandidateMeasure) -> dict[str, object]:
    return {
        "key": candidate.key,
        "title": candidate.title,
        "description": candidate.description,
        "complexity": candidate.implementation_complexity,
        "score": candidate.score,
        "estimated_cost_range": candidate.estimated_cost_range,
        "estimated_savings_usd": candidate.estimated_savings_usd,
        "estimated_savings_kwh": candidate.estimated_savings_kwh,
        "estimated_savings_therms": candidate.estimated_savings_therms,
        "technical_basis": candidate.rationale,
        "target_end_uses": candidate.target_end_uses,
    }


def _build_recommendation_inputs(
    building: BuildingProfile,
    analysis: AnalysisResults,
    peer: PeerClusterAssignment,
    anomalies: list[ChangepointSignal],
) -> RecommendationModelInputs:
    electric_kbtu = analysis.totalElectricity * KWH_TO_KBTU
    gas_kbtu = analysis.totalGas * THERMS_TO_KBTU
    electric_weight = electric_kbtu * 4.0 if electric_kbtu > 0 else 0.0
    gas_weight = gas_kbtu if gas_kbtu > 0 else 0.0
    total_weight = electric_weight + gas_weight
    annual_electric_cost = analysis.totalCost * (electric_weight / total_weight) if total_weight > 0 else analysis.totalCost
    annual_gas_cost = max(0.0, analysis.totalCost - annual_electric_cost)
    electric_rate = annual_electric_cost / max(analysis.totalElectricity, 1)
    gas_rate = annual_gas_cost / max(analysis.totalGas, 1) if analysis.totalGas > 0 else 0.0
    peer_gap_pct = max(0.0, ((analysis.siteEUI - peer.median_eui) / max(peer.median_eui, 1)) * 100)
    peer_gap_factor = _clamp(peer_gap_pct / 80.0, 0.0, 1.0)
    vintage_factor = _clamp((1995 - building.yearBuilt) / 45, 0.0, 1.0)
    renovation_factor = 0.0 if building.hasRenovations else 1.0
    hours_factor = _clamp((70 - building.operatingHours) / 50, 0.0, 1.0)
    occupancy_factor = _clamp((85 - building.occupancy) / 45, 0.0, 1.0)
    load_factor_gap = _clamp((0.65 - (analysis.loadFactor if analysis.loadFactor is not None else 0.65)) / 0.25, 0.0, 1.0)
    summer_spikiness = _clamp((analysis.seasonalVariation - 1.15) / 1.5, 0.0, 1.0)
    lighting_factor = {"led": 0.15, "mixed": 0.55, "fluorescent": 0.95}.get(building.lightingType, 0.45)
    implementation_scale = _clamp(0.85 + (building.squareFeet / 500000) + (building.floors * 0.025), 0.85, 2.0)
    annual_peak_kw = analysis.totalElectricity / max(len(analysis.monthlyBreakdown) * 730 * max(analysis.loadFactor or 0.6, 0.1), 1)
    anomaly_factor = _clamp(sum(1 for signal in anomalies if signal.flagged) / 4, 0.0, 1.0)
    institutional_factor = 1.0 if "institutional" in peer.cluster_label.lower() or "university" in peer.archetype_label.lower() else 0.0
    return RecommendationModelInputs(
        electric_rate=_clamp(electric_rate, 0.05, 0.40),
        gas_rate=_clamp(gas_rate, 0.35, 2.50) if analysis.totalGas > 0 else 0.0,
        annual_electric_cost=annual_electric_cost,
        annual_gas_cost=annual_gas_cost,
        annual_savings_opportunity=analysis.annualSavingsOpportunity,
        peer_gap_pct=peer_gap_pct,
        peer_gap_factor=peer_gap_factor,
        vintage_factor=vintage_factor,
        renovation_factor=renovation_factor,
        hours_factor=hours_factor,
        occupancy_factor=occupancy_factor,
        load_factor_gap=load_factor_gap,
        summer_spikiness=summer_spikiness,
        lighting_factor=lighting_factor,
        implementation_scale=implementation_scale,
        annual_peak_kw=annual_peak_kw,
        anomaly_factor=anomaly_factor,
        heating_share=analysis.heatingPercent / 100,
        cooling_share=analysis.coolingPercent / 100,
        baseload_share=analysis.baseloadPercent / 100,
        institutional_factor=institutional_factor,
    )


def _format_cost_range(
    square_feet: int,
    *,
    low_rate: float,
    high_rate: float,
    scale: float,
    min_low: float,
    min_high: float,
) -> str:
    low = max(min_low, square_feet * low_rate * scale)
    high = max(min_high, square_feet * high_rate * scale)
    low_rounded = _round_currency(low)
    high_rounded = max(low_rounded + 5000, _round_currency(high))
    return f"${low_rounded:,.0f}-${high_rounded:,.0f}"


def _format_kw_cost_range(peak_kw: float, low_per_kw: float, high_per_kw: float, *, min_low: float, min_high: float) -> str:
    low = max(min_low, peak_kw * low_per_kw)
    high = max(min_high, peak_kw * high_per_kw)
    low_rounded = _round_currency(low)
    high_rounded = max(low_rounded + 5000, _round_currency(high))
    return f"${low_rounded:,.0f}-${high_rounded:,.0f}"


def _round_currency(value: float) -> float:
    return round(value / 500) * 500


def _apply_savings_cap(
    savings_kwh: float,
    savings_therms: float,
    savings_usd: float,
    max_usd: float,
) -> tuple[float, float, float]:
    savings_usd = max(0.0, savings_usd)
    if savings_usd <= 0:
        return 0.0, 0.0, 0.0
    capped_usd = min(savings_usd, max_usd)
    scale = capped_usd / savings_usd
    return (
        round(savings_kwh * scale),
        round(savings_therms * scale),
        _round_currency(capped_usd),
    )


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))
