from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"


@dataclass(frozen=True)
class Settings:
    app_name: str = "AuditAI Backend"
    database_path: Path = DATA_DIR / "auditai.db"
    upload_dir: Path = UPLOAD_DIR
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    noaa_api_token: str = os.getenv("NOAA_API_TOKEN", "")
    solar_api_key: str = os.getenv("GOOGLE_SOLAR_API_KEY", "")
    default_reasoning_provider: str = os.getenv("AUDITAI_REASONING_PROVIDER", "gemini")
    ocr_model: str = os.getenv("AUDITAI_OCR_MODEL", "gemini-2.0-flash")
    reasoning_model: str = os.getenv("AUDITAI_REASONING_MODEL", "gemini-2.0-flash")
    max_workers: int = int(os.getenv("AUDITAI_MAX_WORKERS", "2"))


settings = Settings()
