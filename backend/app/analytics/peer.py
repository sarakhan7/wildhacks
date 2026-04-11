from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..schemas import BuildingProfile, PeerClusterAssignment


class PeerClusterService:
    def __init__(self, data_path: Path) -> None:
        payload = json.loads(data_path.read_text())
        self.clusters = payload["clusters"]

    def assign(self, building: BuildingProfile, site_eui: float, climate_zone: str) -> PeerClusterAssignment:
        feature_vector = np.array(
            [
                site_eui,
                float(building.squareFeet),
                float(building.yearBuilt),
                float(building.operatingHours),
                float(building.occupancy),
            ],
            dtype=float,
        )

        def distance(cluster: dict) -> float:
            centroid = np.array(cluster["centroid"], dtype=float)
            scales = np.array(cluster["scale"], dtype=float)
            return float(np.linalg.norm((feature_vector - centroid) / scales))

        cluster = min(self.clusters, key=distance)
        percentile = _percentile_from_distribution(site_eui, cluster["eui_percentiles"])
        return PeerClusterAssignment(
            cluster_id=cluster["cluster_id"],
            cluster_label=cluster["cluster_label"],
            archetype_label=cluster["archetype_label"],
            percentile=round(percentile, 1),
            climate_zone=climate_zone,
            benchmark_eui=cluster["eui_percentiles"]["p50"],
            median_eui=cluster["eui_percentiles"]["p50"],
            top_quartile_eui=cluster["eui_percentiles"]["p25"],
        )


def _percentile_from_distribution(site_eui: float, distribution: dict[str, float]) -> float:
    p25 = distribution["p25"]
    p50 = distribution["p50"]
    p75 = distribution["p75"]
    if site_eui <= p25:
        return 75 + max(0, 25 * (1 - site_eui / max(p25, 1)))
    if site_eui <= p50:
        ratio = (site_eui - p25) / max(p50 - p25, 1)
        return 75 - ratio * 25
    if site_eui <= p75:
        ratio = (site_eui - p50) / max(p75 - p50, 1)
        return 50 - ratio * 25
    ratio = min(1.0, (site_eui - p75) / max(p75 - p50, 1))
    return 25 * (1 - ratio)
