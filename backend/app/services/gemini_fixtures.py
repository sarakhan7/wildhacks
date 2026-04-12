from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
RECORDINGS_DIR = REPO_ROOT / "gemini_recordings"


def fixture_path(operation: str) -> Path:
    safe = operation.replace("/", "_").replace(" ", "_")
    return RECORDINGS_DIR / f"{safe}.json"


def load_response_text(operation: str) -> str:
    path = fixture_path(operation)
    if not path.is_file():
        raise FileNotFoundError(
            f"Gemini fixture missing for {operation!r} at {path}. "
            "Run once with PROD=true to record (fixtures are written on each live call)."
        )
    envelope = json.loads(path.read_text(encoding="utf-8"))
    text = envelope.get("response_text")
    if not isinstance(text, str):
        raise ValueError(f"Fixture {path} has no string response_text")
    return text


def save_recording(
    operation: str,
    *,
    model: str,
    request_summary: dict[str, Any],
    response_text: str,
) -> None:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    envelope = {
        "operation": operation,
        "model": model,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "request_summary": request_summary,
        "response_text": response_text,
    }
    path = fixture_path(operation)
    path.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
