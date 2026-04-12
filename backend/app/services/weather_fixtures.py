from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..schemas import WeatherMonthFeature

REPO_ROOT = Path(__file__).resolve().parents[3]
RECORDINGS_DIR = REPO_ROOT / "weather_recordings"
FIXTURE_PATH = RECORDINGS_DIR / "monthly_features.json"


def try_load_fixture_by_month() -> dict[str, WeatherMonthFeature] | None:
    if not FIXTURE_PATH.is_file():
        return None
    data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    raw = data.get("features")
    if not isinstance(raw, list):
        return None
    out: dict[str, WeatherMonthFeature] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        feature = WeatherMonthFeature.model_validate(item)
        out[feature.month] = feature
    return out or None


def save_fixture(months: list[str], features: list[WeatherMonthFeature]) -> None:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    envelope: dict[str, Any] = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "months": sorted(set(months)),
        "features": [f.model_dump() for f in features],
    }
    FIXTURE_PATH.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
