from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from .analytics.peer import PeerClusterService
from .config import settings
from .db import connect, init_db
from .pipeline import AuditPipeline
from .queue import AuditJobQueue
from .repository import AuditRepository
from .schemas import CreateAuditRequest, CreateAuditResponse, ReviewReadingsRequest
from .services.ocr import OCRService
from .services.reasoning import ReasoningService
from .storage import DocumentStorageService
from .services.weather import WeatherService


app = FastAPI(title=settings.app_name)
conn = connect(settings.database_path)
settings.database_path.parent.mkdir(parents=True, exist_ok=True)
init_db(conn)

storage_service = DocumentStorageService(
    upload_dir=settings.upload_dir,
    supabase_url=settings.supabase_url,
    supabase_publishable_key=settings.supabase_publishable_key,
    supabase_service_role_key=settings.supabase_service_role_key,
    supabase_storage_bucket=settings.supabase_storage_bucket,
)
repository = AuditRepository(conn, settings.upload_dir, storage_service)
queue = AuditJobQueue(settings.max_workers)
peer_data_path = Path(__file__).resolve().parents[1] / "data" / "cbecs_2018_public_use_peers.csv"
if not peer_data_path.exists():
    peer_data_path = Path(__file__).resolve().parents[1] / "data" / "cbecs_clusters.json"

pipeline = AuditPipeline(
    repository=repository,
    ocr_service=OCRService(settings.gemini_api_key, settings.ocr_model),
    weather_service=WeatherService(settings.noaa_api_token),
    reasoning_service=ReasoningService(settings.gemini_api_key, settings.reasoning_model),
    peer_service=PeerClusterService(peer_data_path),
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/audits", response_model=CreateAuditResponse)
def create_audit(payload: CreateAuditRequest) -> CreateAuditResponse:
    audit_id, created_at = repository.create_audit(payload.building)
    return CreateAuditResponse(audit_id=audit_id, status="pending", stage="created", created_at=created_at)


@app.post("/audits/{audit_id}/files")
async def upload_files(audit_id: str, files: list[UploadFile] = File(...)) -> dict[str, object]:
    try:
        repository.get_building(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    uploaded = []
    for upload in files:
        content = await upload.read()
        uploaded.append(
            repository.save_uploaded_bytes(audit_id, upload.filename or "upload.bin", upload.content_type or "application/octet-stream", content)
        )
    repository.update_status(audit_id, status="pending", stage="created", progress=5)
    return {"audit_id": audit_id, "uploaded": [document.model_dump() for document in uploaded]}


@app.post("/audits/{audit_id}/run")
def run_audit(audit_id: str) -> dict[str, object]:
    try:
        repository.get_building(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if queue.is_running(audit_id):
        return {"audit_id": audit_id, "status": "running"}
    repository.update_status(audit_id, status="pending", stage="queued", progress=8)
    queue.enqueue(audit_id, lambda: pipeline.run(audit_id))
    return {"audit_id": audit_id, "status": "queued"}


@app.get("/audits/{audit_id}/status")
def audit_status(audit_id: str):
    try:
        return repository.get_status(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/audits/{audit_id}/results")
def audit_results(audit_id: str):
    try:
        return repository.get_results(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/audits/{audit_id}/readings/review")
def review_readings(audit_id: str, payload: ReviewReadingsRequest):
    try:
        repository.get_building(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    repository.save_normalized_readings(audit_id, payload.readings)
    repository.update_status(audit_id, status="pending", stage="queued", progress=12)
    queue.enqueue(audit_id, lambda: pipeline.rerun_from_review(audit_id))
    return {"audit_id": audit_id, "status": "queued", "review_count": len(payload.readings)}
