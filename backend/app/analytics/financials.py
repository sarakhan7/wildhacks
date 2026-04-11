from __future__ import annotations

import numpy as np

from ..schemas import ECMRecommendation, FinancialProjection


def build_financial_projection(
    recommendation: ECMRecommendation,
    *,
    discount_rate: float = 0.08,
    escalation_rate: float = 0.03,
) -> FinancialProjection:
    annual = recommendation.estimated_savings_usd
    baseline_cost = _midpoint_from_range(recommendation.estimated_cost_range)
    cash_flows = [-baseline_cost]
    running_savings = 0.0
    discounted = -baseline_cost
    for year in range(1, 11):
        savings = annual * ((1 + escalation_rate) ** (year - 1))
        cash_flows.append(savings)
        running_savings += savings
        discounted += savings / ((1 + discount_rate) ** year)

    simple_payback = baseline_cost / annual if annual > 0 else None
    return FinancialProjection(
        recommendation_id=recommendation.recommendation_id,
        annual_savings_usd=round(annual, 2),
        simple_payback_years=round(simple_payback, 2) if simple_payback is not None else None,
        npv_10y=round(float(discounted), 2),
        cumulative_savings_10y=round(float(running_savings), 2),
        discount_rate=discount_rate,
        escalation_rate=escalation_rate,
    )


def _midpoint_from_range(cost_range: str) -> float:
    digits = [float(part.replace(",", "").replace("$", "")) for part in cost_range.replace("–", "-").split("-") if part.strip()]
    if not digits:
        return 0.0
    if len(digits) == 1:
        return digits[0]
    return sum(digits[:2]) / 2
