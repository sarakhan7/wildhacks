from __future__ import annotations

from math import cos, pi

from ..schemas import BuildingProfile, WeatherMonthFeature


MONTH_LABELS = [f"2024-{index:02d}" for index in range(1, 13)]


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
