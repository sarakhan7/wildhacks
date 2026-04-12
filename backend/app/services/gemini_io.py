from __future__ import annotations

import json
import logging
import os
from typing import Any

_logger = logging.getLogger("auditai.gemini")

_CALLS = (
    "ocr.extract (REST generateContent, JSON bill readings)",
    "reasoning.diagnose (REST generateContent, JSON hypotheses)",
    "reasoning.select_recommendations (REST generateContent, JSON selected ECM keys)",
    "reasoning.write_report (REST generateContent, markdown text)",
)


def log_gemini_enabled() -> bool:
    return os.getenv("AUDITAI_LOG_GEMINI", "").strip().lower() in ("1", "true", "yes", "on")


def registered_call_sites() -> tuple[str, ...]:
    return _CALLS


def _truncate(value: str, max_len: int) -> str:
    if len(value) <= max_len:
        return value
    return f"{value[:max_len]}...({len(value)} chars total)"


def _jsonable(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return str(value)


def log_gemini_event(operation: str, phase: str, **fields: Any) -> None:
    if not log_gemini_enabled():
        return
    payload = _jsonable({"operation": operation, "phase": phase, **fields})
    line = json.dumps(payload, default=str)
    if len(line) > 24000:
        line = line[:24000] + "...(truncated)"
    _logger.info("%s", line)
