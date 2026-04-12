from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from ..schemas import BuildingProfile, PeerClusterAssignment


LEGACY_SIZE_FLOOR = 40


STATE_TO_CENSUS_DIVISION: dict[str, int] = {
    "ct": 1,
    "connecticut": 1,
    "me": 1,
    "maine": 1,
    "ma": 1,
    "massachusetts": 1,
    "nh": 1,
    "new hampshire": 1,
    "ri": 1,
    "rhode island": 1,
    "vt": 1,
    "vermont": 1,
    "nj": 2,
    "new jersey": 2,
    "ny": 2,
    "new york": 2,
    "pa": 2,
    "pennsylvania": 2,
    "il": 3,
    "illinois": 3,
    "in": 3,
    "indiana": 3,
    "mi": 3,
    "michigan": 3,
    "oh": 3,
    "ohio": 3,
    "wi": 3,
    "wisconsin": 3,
    "ia": 4,
    "iowa": 4,
    "ks": 4,
    "kansas": 4,
    "mn": 4,
    "minnesota": 4,
    "mo": 4,
    "missouri": 4,
    "ne": 4,
    "nebraska": 4,
    "nd": 4,
    "north dakota": 4,
    "sd": 4,
    "south dakota": 4,
    "de": 5,
    "delaware": 5,
    "dc": 5,
    "district of columbia": 5,
    "fl": 5,
    "florida": 5,
    "ga": 5,
    "georgia": 5,
    "md": 5,
    "maryland": 5,
    "nc": 5,
    "north carolina": 5,
    "sc": 5,
    "south carolina": 5,
    "va": 5,
    "virginia": 5,
    "wv": 5,
    "west virginia": 5,
    "al": 6,
    "alabama": 6,
    "ky": 6,
    "kentucky": 6,
    "ms": 6,
    "mississippi": 6,
    "tn": 6,
    "tennessee": 6,
    "ar": 7,
    "arkansas": 7,
    "la": 7,
    "louisiana": 7,
    "ok": 7,
    "oklahoma": 7,
    "tx": 7,
    "texas": 7,
    "az": 8,
    "arizona": 8,
    "co": 8,
    "colorado": 8,
    "id": 8,
    "idaho": 8,
    "mt": 8,
    "montana": 8,
    "nv": 8,
    "nevada": 8,
    "nm": 8,
    "new mexico": 8,
    "ut": 8,
    "utah": 8,
    "wy": 8,
    "wyoming": 8,
    "ak": 9,
    "alaska": 9,
    "ca": 9,
    "california": 9,
    "hi": 9,
    "hawaii": 9,
    "or": 9,
    "oregon": 9,
    "wa": 9,
    "washington": 9,
}


DEFAULT_PBA_MAP: dict[str, list[int]] = {
    "office": [2],
    "retail": [23, 24, 25],
    "multifamily": [],
    "hospital": [16, 8],
    "k12_school": [14],
    "warehouse": [5, 11],
    "other": [91],
}


TOKEN_PBA_MAP: list[tuple[tuple[str, ...], list[int]]] = [
    (("school", "university", "college", "campus", "classroom", "academic", "education", "institute"), [14]),
    (("lab", "laboratory", "research", "science", "engineering", "technolog"), [4]),
    (("office", "administration", "admin"), [2]),
    (("warehouse", "storage", "distribution", "fulfillment"), [5, 11]),
    (("grocery", "supermarket", "food market"), [6]),
    (("restaurant", "cafeteria", "dining", "food service"), [15]),
    (("clinic", "outpatient", "ambulatory"), [8]),
    (("hospital", "medical center", "inpatient"), [16]),
    (("nursing", "skilled care"), [17]),
    (("hotel", "lodging", "motel", "dorm", "dormitory", "residence hall"), [18]),
    (("retail", "store", "shop", "shopping", "mall", "mercantile"), [23, 24, 25]),
    (("service", "bank", "salon", "post office"), [26]),
    (("worship", "church", "mosque", "temple", "synagogue"), [12]),
    (("library", "auditorium", "museum", "gym", "arena", "assembly", "student center"), [13]),
    (("police", "fire", "courthouse", "public safety"), [7]),
]


class PeerClusterService:
    def __init__(self, data_path: Path) -> None:
        self.data_path = data_path
        if data_path.suffix.lower() == ".csv":
            self.mode = "cbecs_public_use"
            self.rows = pd.read_csv(data_path)
            self.rows["log_sqft"] = np.log(self.rows["sqft"].clip(lower=1000))
            self.rows["occupancy_pct"] = self.rows["occupancy_pct"].astype(float)
            self.rows["weight"] = self.rows["weight"].astype(float)
            self.rows["site_eui"] = self.rows["site_eui"].astype(float)
        else:
            self.mode = "legacy_seed"
            payload = json.loads(data_path.read_text())
            self.clusters = payload["clusters"]

    def assign(self, building: BuildingProfile, site_eui: float, climate_zone: str) -> PeerClusterAssignment:
        if self.mode == "cbecs_public_use":
            return self._assign_cbecs(building, site_eui, climate_zone)
        return self._assign_legacy(building, site_eui, climate_zone)

    def _assign_cbecs(self, building: BuildingProfile, site_eui: float, climate_zone: str) -> PeerClusterAssignment:
        candidate_codes = _infer_pba_codes(building)
        candidate_labels = [
            label
            for code, label in self.rows[["pba_code", "pba_label"]].drop_duplicates().itertuples(index=False)
            if code in candidate_codes
        ]
        census_division = _infer_census_division(building.address)
        climate_bucket = _climate_zone_to_pubclim(climate_zone)

        weights = self.rows["weight"].to_numpy(dtype=float).copy()
        exact_pba_mask = self.rows["pba_code"].isin(candidate_codes).to_numpy() if candidate_codes else np.ones(len(self.rows), dtype=bool)
        exact_pba_weight = float(weights[exact_pba_mask].sum())
        if candidate_codes:
            outside_penalty = 0.08 if exact_pba_weight >= LEGACY_SIZE_FLOOR else 0.25
            weights *= np.where(exact_pba_mask, 1.0, outside_penalty)

        if climate_bucket is not None:
            same_climate = (self.rows["pubclim"] == climate_bucket).to_numpy()
            climate_weight = float(weights[same_climate].sum())
            if climate_weight > 0:
                weights *= np.where(same_climate, 1.25, 0.80 if climate_weight >= LEGACY_SIZE_FLOOR else 0.95)

        if census_division is not None:
            same_division = (self.rows["cendiv"] == census_division).to_numpy()
            division_weight = float(weights[same_division].sum())
            if division_weight > 0:
                weights *= np.where(same_division, 1.15, 0.90 if division_weight >= LEGACY_SIZE_FLOOR else 0.97)

        building_log_sqft = math.log(max(building.squareFeet, 1000))
        size_factor = np.exp(-np.abs(self.rows["log_sqft"].to_numpy(dtype=float) - building_log_sqft) / 1.0)
        vintage_factor = np.exp(
            -np.abs(self.rows["year_built_category"].to_numpy(dtype=float) - _year_built_to_cbecs_category(building.yearBuilt)) / 1.35
        )
        hours_factor = np.exp(-np.abs(self.rows["operating_hours"].to_numpy(dtype=float) - building.operatingHours) / 40.0)
        occupancy_reference = self.rows["occupancy_pct"].fillna(building.occupancy).to_numpy(dtype=float)
        occupancy_factor = np.exp(-np.abs(occupancy_reference - building.occupancy) / 30.0)
        floor_factor = np.exp(-np.abs(self.rows["floor_count"].to_numpy(dtype=float) - _normalize_floor_count(building.floors)) / 5.0)
        weights *= size_factor * vintage_factor * hours_factor * occupancy_factor * floor_factor

        positive = weights > 0
        values = self.rows.loc[positive, "site_eui"].to_numpy(dtype=float)
        effective_weights = weights[positive]
        if len(values) == 0 or effective_weights.sum() <= 0:
            return self._assign_legacy(building, site_eui, climate_zone)

        percentile = _weighted_percentile_rank(values, effective_weights, site_eui)
        median_eui = _weighted_quantile(values, effective_weights, 0.50)
        top_quartile_eui = _weighted_quantile(values, effective_weights, 0.25)
        benchmark_eui = float(np.average(values, weights=effective_weights))
        peer_mass = int(np.count_nonzero(exact_pba_mask)) if candidate_codes else len(self.rows)
        pba_label = " / ".join(candidate_labels[:3]) if candidate_labels else "Commercial"
        climate_label = _pubclim_label(climate_bucket) or "National"
        division_label = _census_division_label(census_division)
        archetype_bits = [pba_label]
        if climate_label != "National":
            archetype_bits.append(climate_label)
        if division_label:
            archetype_bits.append(division_label)

        return PeerClusterAssignment(
            cluster_id=f"cbecs-2018-{'-'.join(str(code) for code in candidate_codes) if candidate_codes else 'general'}-{census_division or 'national'}",
            cluster_label=f"CBECS weighted peers ({peer_mass} sampled buildings)",
            archetype_label=", ".join(archetype_bits),
            percentile=round(percentile, 1),
            climate_zone=climate_zone,
            benchmark_eui=round(benchmark_eui, 1),
            median_eui=round(median_eui, 1),
            top_quartile_eui=round(top_quartile_eui, 1),
            source="cbecs_2018_public_use",
        )

    def _assign_legacy(self, building: BuildingProfile, site_eui: float, climate_zone: str) -> PeerClusterAssignment:
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
        percentile = _legacy_percentile_from_distribution(site_eui, cluster["eui_percentiles"])
        return PeerClusterAssignment(
            cluster_id=cluster["cluster_id"],
            cluster_label=cluster["cluster_label"],
            archetype_label=cluster["archetype_label"],
            percentile=round(percentile, 1),
            climate_zone=climate_zone,
            benchmark_eui=cluster["eui_percentiles"]["p50"],
            median_eui=cluster["eui_percentiles"]["p50"],
            top_quartile_eui=cluster["eui_percentiles"]["p25"],
            source="cbecs_seed",
        )


def _weighted_quantile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    ordered_values = values[order]
    ordered_weights = weights[order]
    cumulative = np.cumsum(ordered_weights)
    cutoff = q * ordered_weights.sum()
    index = int(np.searchsorted(cumulative, cutoff, side="left"))
    index = min(index, len(ordered_values) - 1)
    return float(ordered_values[index])


def _weighted_percentile_rank(values: np.ndarray, weights: np.ndarray, target: float) -> float:
    order = np.argsort(values)
    ordered_values = values[order]
    ordered_weights = weights[order]
    total = ordered_weights.sum()
    if total <= 0:
        return 50.0
    lower = ordered_weights[ordered_values < target].sum()
    equal = ordered_weights[ordered_values == target].sum()
    cdf = (lower + 0.5 * equal) / total
    return max(0.0, min(100.0, (1.0 - cdf) * 100.0))


def _infer_pba_codes(building: BuildingProfile) -> list[int]:
    tokens = _normalize_text(f"{building.buildingType} {building.address}")
    codes = set(DEFAULT_PBA_MAP.get(building.buildingType, []))
    for keywords, pba_codes in TOKEN_PBA_MAP:
        if any(keyword in tokens for keyword in keywords):
            codes.update(pba_codes)
    return sorted(codes)


def _infer_census_division(address: str) -> int | None:
    normalized = _normalize_text(address)
    for token, division in STATE_TO_CENSUS_DIVISION.items():
        if re.search(rf"(^|\s){re.escape(token)}(\s|$)", normalized):
            return division
    return None


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _year_built_to_cbecs_category(year_built: int) -> int:
    if year_built < 1946:
        return 2
    if year_built <= 1959:
        return 3
    if year_built <= 1969:
        return 4
    if year_built <= 1979:
        return 5
    if year_built <= 1989:
        return 6
    if year_built <= 1999:
        return 7
    if year_built <= 2012:
        return 8
    return 9


def _normalize_floor_count(floors: int) -> int:
    if floors <= 0:
        return 1
    return min(floors, 18)


def _climate_zone_to_pubclim(climate_zone: str) -> int | None:
    match = re.match(r"^(\d+)", climate_zone or "")
    if not match:
        return None
    zone = int(match.group(1))
    if zone >= 6:
        return 1
    if zone == 5:
        return 2
    if zone == 4:
        return 3
    if zone == 3:
        return 4
    if zone in {1, 2}:
        return 5
    return None


def _pubclim_label(pubclim: int | None) -> str | None:
    mapping = {
        1: "Cold or very cold",
        2: "Cool",
        3: "Mixed mild",
        4: "Warm",
        5: "Hot or very hot",
    }
    return mapping.get(pubclim)


def _census_division_label(cendiv: int | None) -> str | None:
    mapping = {
        1: "New England",
        2: "Middle Atlantic",
        3: "East North Central",
        4: "West North Central",
        5: "South Atlantic",
        6: "East South Central",
        7: "West South Central",
        8: "Mountain",
        9: "Pacific",
    }
    return mapping.get(cendiv)


def _legacy_percentile_from_distribution(site_eui: float, distribution: dict[str, float]) -> float:
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
