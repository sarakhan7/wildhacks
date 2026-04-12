from __future__ import annotations

from math import sqrt

import numpy as np
from sklearn.ensemble import IsolationForest

from ..schemas import ChangepointSignal, NormalizedUtilityReading, WeatherMonthFeature
from .prism import KWH_TO_KBTU, THERMS_TO_KBTU, fit_prism_series, prism_degree_day_terms, reading_to_total_kbtu


def detect_anomalies(
    readings: list[NormalizedUtilityReading], weather: list[WeatherMonthFeature]
) -> list[ChangepointSignal]:
    if not readings:
        return []

    weather_by_month = {feature.month: feature for feature in weather}
    months = [reading.month for reading in readings]
    totals = np.array([reading_to_total_kbtu(reading) for reading in readings], dtype=float)

    mean = totals.mean() if len(totals) else 0
    std = totals.std() if len(totals) else 0
    cusum = np.cumsum(totals - mean)
    normalized_cusum = np.abs(cusum) / max(std * sqrt(max(len(totals), 1)), 1)

    features = []
    for index, reading in enumerate(readings, start=1):
        weather_row = weather_by_month.get(reading.month)
        features.append(
            [
                reading_to_total_kbtu(reading),
                weather_row.hdd if weather_row else 0,
                weather_row.cdd if weather_row else 0,
                float(index),
            ]
        )

    residual_scores = _weather_normalized_residual_scores(readings, weather, weather_by_month)

    if len(readings) >= 4:
        forest = IsolationForest(random_state=42, contamination=min(0.2, 2 / len(readings)))
        forest.fit(features)
        scores = -forest.score_samples(features)
        predictions = forest.predict(features)
    else:
        scores = np.zeros(len(readings))
        predictions = np.ones(len(readings), dtype=int)
    signals: list[ChangepointSignal] = []
    for idx, month in enumerate(months):
        reasons: list[str] = []
        residual_score = abs(float(residual_scores[idx])) if len(residual_scores) else 0.0
        if residual_score >= 2.5:
            reasons.append("weather_normalized_residual")
        if normalized_cusum[idx] > 1.5 and residual_score >= 1.5:
            reasons.append("cusum_drift")
        if predictions[idx] == -1 and residual_score >= 1.5:
            reasons.append("isolation_forest_outlier")
        signals.append(
            ChangepointSignal(
                month=month,
                cusum_score=round(float(normalized_cusum[idx]), 3),
                isolation_score=round(float(scores[idx]), 3),
                flagged=bool(reasons),
                reasons=reasons,
            )
        )
    return signals


def _weather_normalized_residual_scores(
    readings: list[NormalizedUtilityReading],
    weather: list[WeatherMonthFeature],
    weather_by_month: dict[str, WeatherMonthFeature],
) -> np.ndarray:
    if not readings or not weather:
        return np.zeros(len(readings))

    electric_prism = fit_prism_series(
        [(reading.month, reading.kwh * KWH_TO_KBTU, max(reading.confidence, 0.25)) for reading in readings],
        weather,
    )
    gas_prism = fit_prism_series(
        [(reading.month, reading.therms * THERMS_TO_KBTU, max(reading.confidence, 0.25)) for reading in readings],
        weather,
    )

    residuals = []
    for reading in readings:
        feature = weather_by_month.get(reading.month)
        if feature is None:
            residuals.append(0.0)
            continue
        electric_pred = _predict_month_kbtu(electric_prism, feature)
        gas_pred = _predict_month_kbtu(gas_prism, feature)
        actual_total = reading_to_total_kbtu(reading)
        residuals.append(actual_total - (electric_pred + gas_pred))

    return _robust_z_scores(np.asarray(residuals, dtype=float))


def _predict_month_kbtu(prism, feature: WeatherMonthFeature) -> float:
    hdd_term, cdd_term = prism_degree_day_terms(feature, prism.base_temperature_f)
    return (
        prism.baseload_kbtu_per_month
        + (prism.heating_slope_kbtu_per_hdd * hdd_term)
        + (prism.cooling_slope_kbtu_per_cdd * cdd_term)
    )


def _robust_z_scores(values: np.ndarray) -> np.ndarray:
    if len(values) == 0:
        return np.array([], dtype=float)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    if mad > 0:
        return 0.6745 * (values - median) / mad
    std = float(values.std())
    if std > 0:
        return (values - values.mean()) / std
    return np.zeros(len(values), dtype=float)
