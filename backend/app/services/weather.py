from __future__ import annotations

import calendar
import json
from datetime import date, datetime
from math import asin, cos, pi, radians, sin, sqrt
from urllib import error, parse, request

from ..config import settings
from ..schemas import BuildingProfile, WeatherMonthFeature
from .weather_fixtures import save_fixture, try_load_fixture_by_month


MONTH_LABELS = [f"2024-{index:02d}" for index in range(1, 13)]
NOAA_CDO_BASE_URL = "https://www.ncei.noaa.gov/cdo-web/api/v2"
NOAA_MAX_RADIUS_KM = 50.0
NOAA_MAX_STATIONS = 10
NOAA_REQUEST_TIMEOUT_SECONDS = 8


class WeatherService:
    def __init__(self, noaa_api_token: str = "") -> None:
        self.noaa_api_token = noaa_api_token

    def derive_climate_zone(self, building: BuildingProfile) -> str:
        lat = building.lat
        if lat >= 45:
            return "6A"
        if lat >= 40:
            return "5A"
        if lat >= 36:
            return "4A"
        if lat >= 32:
            return "3A"
        return "2A"

    def build_monthly_features(self, building: BuildingProfile, months: list[str]) -> list[WeatherMonthFeature]:
        requested_months = sorted(set(months))
        if not requested_months:
            return []

        features: list[WeatherMonthFeature] | None = None
        if self.noaa_api_token:
            try:
                stations = self._find_candidate_stations(building.lat, building.lng, requested_months)
                for station in stations[:NOAA_MAX_STATIONS]:
                    try:
                        features = self._fetch_monthly_features_from_noaa(station, requested_months)
                        break
                    except RuntimeError:
                        continue
            except Exception:
                # The audit must still run if NOAA is unavailable or the token is invalid.
                pass

        if features is None:
            if not settings.prod:
                features = self._materialize_weather_from_fixture_or_fallback(building, requested_months)
            else:
                features = self._build_fallback_monthly_features(building, requested_months)

        save_fixture(requested_months, features)

        return features

    def _materialize_weather_from_fixture_or_fallback(
        self,
        building: BuildingProfile,
        requested_months: list[str],
    ) -> list[WeatherMonthFeature]:
        by_month = try_load_fixture_by_month()
        if by_month is None:
            return self._build_fallback_monthly_features(building, requested_months)
        out: list[WeatherMonthFeature] = []
        for month in requested_months:
            if month in by_month:
                out.append(by_month[month])
            else:
                out.extend(self._build_fallback_monthly_features(building, [month]))
        return out

    def _build_fallback_monthly_features(
        self,
        building: BuildingProfile,
        months: list[str],
    ) -> list[WeatherMonthFeature]:
        climate_zone = self.derive_climate_zone(building)
        lat_factor = max(min((building.lat - 25) / 20, 1), 0)
        features: list[WeatherMonthFeature] = []
        for month in months:
            month_num = int(month.split("-")[1])
            seasonal = cos(((month_num - 1) / 12) * 2 * pi)
            avg_temp = 60 - (lat_factor * 18 * seasonal)
            hdd = max(0.0, (65 - avg_temp) * 30 / 24)
            cdd = max(0.0, (avg_temp - 65) * 30 / 24)
            features.append(
                WeatherMonthFeature(
                    month=month,
                    avg_temp_f=round(avg_temp, 2),
                    hdd=round(hdd, 2),
                    cdd=round(cdd, 2),
                    station_id=f"fallback-{climate_zone.lower()}",
                    station_name=f"{climate_zone} climate fallback",
                    source="climate_zone_fallback",
                )
            )
        return features

    def _find_candidate_stations(self, lat: float, lng: float, months: list[str]) -> list[dict[str, object]]:
        start_date, end_date = _month_bounds(months)
        extent = _bounding_box(lat, lng, NOAA_MAX_RADIUS_KM)
        payload = self._request_noaa_json(
            "/stations",
            {
                "datasetid": "GHCND",
                "startdate": start_date.isoformat(),
                "enddate": end_date.isoformat(),
                "extent": ",".join(f"{value:.4f}" for value in extent),
                "limit": 100,
                "sortfield": "datacoverage",
                "sortorder": "desc",
            },
        )

        candidates = payload.get("results", [])
        if not isinstance(candidates, list):
            return []

        viable: list[tuple[float, dict[str, object]]] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            station_lat = float(candidate.get("latitude") or 0.0)
            station_lng = float(candidate.get("longitude") or 0.0)
            distance_km = _haversine_km(lat, lng, station_lat, station_lng)
            if distance_km > NOAA_MAX_RADIUS_KM:
                continue
            mindate = _parse_api_date(str(candidate.get("mindate") or ""))
            maxdate = _parse_api_date(str(candidate.get("maxdate") or ""))
            if mindate and mindate > start_date:
                continue
            if maxdate and maxdate < end_date:
                continue
            viable.append((distance_km, candidate))

        viable.sort(
            key=lambda item: (
                _station_temperature_priority(str(item[1].get("id") or "")),
                item[0],
                -float(item[1].get("datacoverage") or 0.0),
            )
        )
        return [candidate for _distance_km, candidate in viable]

    def _fetch_monthly_features_from_noaa(
        self,
        station: dict[str, object],
        months: list[str],
    ) -> list[WeatherMonthFeature]:
        station_id = str(station["id"])
        station_name = str(station.get("name") or station_id)
        start_date, end_date = _month_bounds(months)
        payload = self._request_noaa_json(
            "/data",
            {
                "datasetid": "GHCND",
                "stationid": station_id,
                "startdate": start_date.isoformat(),
                "enddate": end_date.isoformat(),
                "datatypeid": ["TMIN", "TMAX"],
                "units": "standard",
                "limit": 1000,
            },
        )

        rows = payload.get("results", [])
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("NOAA daily summaries returned no rows")

        daily_temps: dict[str, dict[str, float]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            reading_date = str(row.get("date") or "")[:10]
            datatype = str(row.get("datatype") or "")
            value = row.get("value")
            if datatype not in {"TMIN", "TMAX"} or value is None:
                continue
            daily_temps.setdefault(reading_date, {})[datatype] = float(value)

        monthly_stats: dict[str, dict[str, float]] = {
            month: {"temp_sum": 0.0, "hdd_sum": 0.0, "cdd_sum": 0.0, "days": 0.0}
            for month in months
        }

        for reading_date, values in daily_temps.items():
            if "TMIN" not in values or "TMAX" not in values:
                continue
            month = reading_date[:7]
            if month not in monthly_stats:
                continue
            mean_temp_f = (values["TMIN"] + values["TMAX"]) / 2
            monthly_stats[month]["temp_sum"] += mean_temp_f
            monthly_stats[month]["hdd_sum"] += max(65.0 - mean_temp_f, 0.0)
            monthly_stats[month]["cdd_sum"] += max(mean_temp_f - 65.0, 0.0)
            monthly_stats[month]["days"] += 1

        features: list[WeatherMonthFeature] = []
        for month in months:
            stats = monthly_stats[month]
            if stats["days"] <= 0:
                raise RuntimeError(f"NOAA daily summaries missing temperature coverage for {month}")
            features.append(
                WeatherMonthFeature(
                    month=month,
                    avg_temp_f=round(stats["temp_sum"] / stats["days"], 2),
                    hdd=round(stats["hdd_sum"], 2),
                    cdd=round(stats["cdd_sum"], 2),
                    station_id=station_id,
                    station_name=station_name,
                    source="noaa",
                )
            )
        return features

    def _request_noaa_json(self, path: str, params: dict[str, object]) -> dict[str, object]:
        if not self.noaa_api_token:
            raise RuntimeError("NOAA_API_TOKEN is not configured")
        query = parse.urlencode(params, doseq=True)
        req = request.Request(
            f"{NOAA_CDO_BASE_URL}{path}?{query}",
            headers={"token": self.noaa_api_token},
        )
        try:
            with request.urlopen(req, timeout=NOAA_REQUEST_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(exc.read().decode("utf-8")) from exc
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc


def _month_bounds(months: list[str]) -> tuple[date, date]:
    first_year, first_month = (int(part) for part in min(months).split("-"))
    last_year, last_month = (int(part) for part in max(months).split("-"))
    start_date = date(first_year, first_month, 1)
    last_day = calendar.monthrange(last_year, last_month)[1]
    end_date = date(last_year, last_month, last_day)
    return start_date, end_date


def _parse_api_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    lat_delta = radius_km / 111.0
    lng_scale = max(cos(radians(lat)), 0.01)
    lng_delta = radius_km / (111.320 * lng_scale)
    return (lat - lat_delta, lng - lng_delta, lat + lat_delta, lng + lng_delta)


def _station_temperature_priority(station_id: str) -> int:
    if station_id.startswith("GHCND:USW"):
        return 0
    if station_id.startswith("GHCND:USC"):
        return 1
    if station_id.startswith("GHCND:CA"):
        return 2
    if station_id.startswith("GHCND:US1"):
        return 4
    return 3


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_rad = radians(lat1)
    lon1_rad = radians(lon1)
    lat2_rad = radians(lat2)
    lon2_rad = radians(lon2)
    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad
    a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(a))
