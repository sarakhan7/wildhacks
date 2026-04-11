from __future__ import annotations

from math import sqrt

import numpy as np
from sklearn.ensemble import IsolationForest

from ..schemas import ChangepointSignal, NormalizedUtilityReading, WeatherMonthFeature
from .prism import reading_to_total_kbtu


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

    if len(readings) >= 4:
        forest = IsolationForest(random_state=42, contamination=min(0.2, 2 / len(readings)))
        scores = -forest.fit(features).score_samples(features)
    else:
        scores = np.zeros(len(readings))

    threshold = float(np.percentile(scores, 75)) if len(scores) else 0
    signals: list[ChangepointSignal] = []
    for idx, month in enumerate(months):
        reasons: list[str] = []
        if normalized_cusum[idx] > 1.5:
            reasons.append("cusum_drift")
        if scores[idx] >= threshold and scores[idx] > 0:
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
