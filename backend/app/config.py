from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"


def _load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if value and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


for dotenv_name in (".env", ".env.local"):
    _load_dotenv_file(REPO_ROOT / dotenv_name)


@dataclass(frozen=True)
class Settings:
    app_name: str = "AuditAI Backend"
    database_path: Path = DATA_DIR / "auditai.db"
    upload_dir: Path = UPLOAD_DIR
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    noaa_api_token: str = os.getenv("NOAA_API_TOKEN", "")
    solar_api_key: str = os.getenv("GOOGLE_SOLAR_API_KEY", "")
    supabase_url: str = os.getenv("SUPABASE_URL", os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
    supabase_publishable_key: str = os.getenv(
        "SUPABASE_PUBLISHABLE_KEY",
        os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ""),
    )
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    supabase_storage_bucket: str = os.getenv("SUPABASE_STORAGE_BUCKET", "audit-documents")
    default_reasoning_provider: str = os.getenv("AUDITAI_REASONING_PROVIDER", "gemini")
    ocr_model: str = os.getenv("AUDITAI_OCR_MODEL", "gemini-2.0-flash")
    reasoning_model: str = os.getenv("AUDITAI_REASONING_MODEL", "gemini-2.0-flash")
    max_workers: int = int(os.getenv("AUDITAI_MAX_WORKERS", "2"))


settings = Settings()
