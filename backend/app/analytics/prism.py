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
    excluded = excluded_months or set()
    weather_by_month = {feature.month: feature for feature in weather}
    rows = [reading for reading in readings if reading.month in weather_by_month and reading.month not in excluded]
    if len(rows) < 3:
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
        for reading in rows:
            feature = weather_by_month[reading.month]
            targets.append(reading_to_total_kbtu(reading))
            design.append([1.0, max(feature.hdd + (65 - base_temp), 0), max(feature.cdd + (base_temp - 65), 0)])
            weights.append(max(reading.confidence, 0.25))

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
        modeled_months=[reading.month for reading in rows],
    )
