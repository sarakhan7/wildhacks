from __future__ import annotations

from typing import Iterable

import numpy as np

from ..schemas import NormalizedUtilityReading, PrismFit, WeatherMonthFeature


KWH_TO_KBTU = 3.412
THERMS_TO_KBTU = 100.0


def reading_to_total_kbtu(reading: NormalizedUtilityReading) -> float:
    return reading.kwh * KWH_TO_KBTU + reading.therms * THERMS_TO_KBTU


def fit_prism_model(
    readings: Iterable[NormalizedUtilityReading],
    weather: Iterable[WeatherMonthFeature],
    excluded_months: set[str] | None = None,
) -> PrismFit:
    rows = [
        (
            reading.month,
            reading_to_total_kbtu(reading),
            max(reading.confidence, 0.25),
        )
        for reading in readings
    ]
    return fit_prism_series(rows, weather, excluded_months)


def fit_prism_series(
    rows: Iterable[tuple[str, float, float]],
    weather: Iterable[WeatherMonthFeature],
    excluded_months: set[str] | None = None,
) -> PrismFit:
    excluded = excluded_months or set()
    weather_by_month = {feature.month: feature for feature in weather}
    filtered_rows = [
        (month, value, weight)
        for month, value, weight in rows
        if month in weather_by_month and month not in excluded
    ]
    if len(filtered_rows) < 3:
        return PrismFit(
            base_temperature_f=65,
            r_squared=0,
            baseload_kbtu_per_month=0,
            heating_slope_kbtu_per_hdd=0,
            cooling_slope_kbtu_per_cdd=0,
            modeled_months=[],
        )

    best: tuple[float, float, np.ndarray] | None = None
    for base_temp in range(45, 76):
        targets = []
        design = []
        weights = []
        for month, value, weight in filtered_rows:
            feature = weather_by_month[month]
            hdd_term, cdd_term = prism_degree_day_terms(feature, float(base_temp))
            targets.append(value)
            design.append([1.0, hdd_term, cdd_term])
            weights.append(weight)

        y = np.asarray(targets, dtype=float)
        x = np.asarray(design, dtype=float)
        w = np.sqrt(np.asarray(weights, dtype=float))[:, np.newaxis]
        weighted_x = x * w
        weighted_y = y * w[:, 0]
        coeffs, *_ = np.linalg.lstsq(weighted_x, weighted_y, rcond=None)
        fitted = x @ coeffs
        residual = np.sum((y - fitted) ** 2)
        total = np.sum((y - np.mean(y)) ** 2)
        r2 = float(1 - residual / total) if total > 0 else 0
        if best is None or r2 > best[0]:
            best = (r2, float(base_temp), coeffs)

    assert best is not None
    r2, base_temperature_f, coeffs = best
    baseload, heating_slope, cooling_slope = coeffs.tolist()
    return PrismFit(
        base_temperature_f=base_temperature_f,
        r_squared=max(0, round(r2, 4)),
        baseload_kbtu_per_month=max(0, round(baseload, 2)),
        heating_slope_kbtu_per_hdd=max(0, round(heating_slope, 4)),
        cooling_slope_kbtu_per_cdd=max(0, round(cooling_slope, 4)),
        modeled_months=[month for month, _value, _weight in filtered_rows],
    )


def prism_degree_day_terms(feature: WeatherMonthFeature, base_temperature_f: float) -> tuple[float, float]:
    heating_term = max(feature.hdd + (65 - base_temperature_f), 0)
    cooling_term = max(feature.cdd + (base_temperature_f - 65), 0)
    return float(heating_term), float(cooling_term)


def estimate_prism_components(
    prism: PrismFit,
    weather: Iterable[WeatherMonthFeature],
    months: Iterable[str],
) -> tuple[float, float, float]:
    weather_by_month = {feature.month: feature for feature in weather}
    baseload_total = 0.0
    heating_total = 0.0
    cooling_total = 0.0

    for month in months:
        feature = weather_by_month.get(month)
        if feature is None:
            continue
        hdd_term, cdd_term = prism_degree_day_terms(feature, prism.base_temperature_f)
        baseload_total += prism.baseload_kbtu_per_month
        heating_total += prism.heating_slope_kbtu_per_hdd * hdd_term
        cooling_total += prism.cooling_slope_kbtu_per_cdd * cdd_term

    return (
        max(0.0, baseload_total),
        max(0.0, heating_total),
        max(0.0, cooling_total),
    )
