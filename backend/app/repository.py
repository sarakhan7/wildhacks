from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .schemas import (
    AnalysisResults,
    AuditReportArtifact,
    AuditResultsResponse,
    AuditStatusResponse,
    BuildingProfile,
    ChangepointSignal,
    DiagnosticHypothesis,
    ECMRecommendation,
    FinancialProjection,
    NormalizedUtilityReading,
    OCRReading,
    PeerClusterAssignment,
    UploadedDocument,
    WeatherMonthFeature,
)
from .storage import DocumentStorageService


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AuditRepository:
    def __init__(self, conn: sqlite3.Connection, upload_dir: Path, storage_service: DocumentStorageService) -> None:
        self.conn = conn
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.storage_service = storage_service

    def _insert_many_json(self, table: str, key_name: str, audit_id: str, rows: list[dict[str, Any]], created_at: str) -> None:
        self.conn.execute(f"DELETE FROM {table} WHERE audit_id = ?", (audit_id,))
        for row in rows:
            row_id = row.get(key_name) or str(uuid.uuid4())
            self.conn.execute(
                f"INSERT INTO {table} ({key_name}, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (row_id, audit_id, json.dumps(row), created_at),
            )
        self.conn.commit()

    def create_audit(self, building: BuildingProfile) -> tuple[str, datetime]:
        audit_id = str(uuid.uuid4())
        building_id = str(uuid.uuid4())
        timestamp = datetime.now(UTC)
        now = timestamp.isoformat()
        self.conn.execute(
            "INSERT INTO building_profile (building_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (building_id, building.model_dump_json(), now, now),
        )
        self.conn.execute(
            """
            INSERT INTO audit_run (
              audit_id, building_id, status, stage, progress, warnings_json, error_text, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (audit_id, building_id, "pending", "created", 0, "[]", None, "{}", now, now),
        )
        self.conn.commit()
        return audit_id, timestamp

    def save_document(self, audit_id: str, filename: str, mime_type: str, source_path: Path) -> UploadedDocument:
        document_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        stored = self.storage_service.store_bytes(
            audit_id=audit_id,
            document_id=document_id,
            filename=filename,
            mime_type=mime_type,
            content=source_path.read_bytes(),
        )
        payload = {
            "document_id": document_id,
            "audit_id": audit_id,
            "filename": filename,
            "mime_type": mime_type,
            "storage_path": str(stored.local_path),
            "storage_provider": stored.storage_provider,
            "storage_bucket": stored.storage_bucket,
            "storage_object_path": stored.storage_object_path,
            "storage_url": stored.storage_url,
            "upload_warnings": stored.warnings,
            "created_at": created_at.isoformat(),
        }
        self.conn.execute(
            """
            INSERT INTO uploaded_document (
              document_id, audit_id, filename, mime_type, storage_path, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (document_id, audit_id, filename, mime_type, str(stored.local_path), json.dumps(payload), created_at.isoformat()),
        )
        self.conn.commit()
        return UploadedDocument.model_validate(payload)

    def save_uploaded_bytes(self, audit_id: str, filename: str, mime_type: str, content: bytes) -> UploadedDocument:
        document_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        stored = self.storage_service.store_bytes(
            audit_id=audit_id,
            document_id=document_id,
            filename=filename,
            mime_type=mime_type,
            content=content,
        )
        payload = {
            "document_id": document_id,
            "audit_id": audit_id,
            "filename": filename,
            "mime_type": mime_type,
            "storage_path": str(stored.local_path),
            "storage_provider": stored.storage_provider,
            "storage_bucket": stored.storage_bucket,
            "storage_object_path": stored.storage_object_path,
            "storage_url": stored.storage_url,
            "upload_warnings": stored.warnings,
            "created_at": created_at.isoformat(),
        }
        self.conn.execute(
            """
            INSERT INTO uploaded_document (
              document_id, audit_id, filename, mime_type, storage_path, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (document_id, audit_id, filename, mime_type, str(stored.local_path), json.dumps(payload), created_at.isoformat()),
        )
        self.conn.commit()
        return UploadedDocument.model_validate(payload)

    def list_documents(self, audit_id: str) -> list[UploadedDocument]:
        rows = self.conn.execute("SELECT payload_json FROM uploaded_document WHERE audit_id = ? ORDER BY created_at ASC", (audit_id,)).fetchall()
        return [UploadedDocument.model_validate_json(row["payload_json"]) for row in rows]

    def get_building(self, audit_id: str) -> BuildingProfile:
        row = self.conn.execute(
            """
            SELECT bp.payload_json
            FROM audit_run ar
            JOIN building_profile bp ON bp.building_id = ar.building_id
            WHERE ar.audit_id = ?
            """,
            (audit_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown audit_id {audit_id}")
        return BuildingProfile.model_validate_json(row["payload_json"])

    def update_status(
        self,
        audit_id: str,
        *,
        status: str,
        stage: str,
        progress: int,
        warnings: list[str] | None = None,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        current = self.conn.execute("SELECT warnings_json, metadata_json FROM audit_run WHERE audit_id = ?", (audit_id,)).fetchone()
        if current is None:
            raise KeyError(f"Unknown audit_id {audit_id}")
        merged_warnings = warnings if warnings is not None else json.loads(current["warnings_json"])
        merged_metadata = metadata if metadata is not None else json.loads(current["metadata_json"])
        self.conn.execute(
            """
            UPDATE audit_run
            SET status = ?, stage = ?, progress = ?, warnings_json = ?, error_text = ?, metadata_json = ?, updated_at = ?
            WHERE audit_id = ?
            """,
            (status, stage, progress, json.dumps(merged_warnings), error, json.dumps(merged_metadata), now_iso(), audit_id),
        )
        self.conn.commit()

    def get_status(self, audit_id: str) -> AuditStatusResponse:
        row = self.conn.execute("SELECT * FROM audit_run WHERE audit_id = ?", (audit_id,)).fetchone()
        if row is None:
            raise KeyError(f"Unknown audit_id {audit_id}")
        return AuditStatusResponse(
            audit_id=audit_id,
            status=row["status"],
            stage=row["stage"],
            progress=row["progress"],
            warning_messages=json.loads(row["warnings_json"]),
            review_required=row["status"] == "needs_review",
            error=row["error_text"],
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def save_raw_readings(self, audit_id: str, readings: list[OCRReading]) -> None:
        self.conn.execute("DELETE FROM utility_reading_raw WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for reading in readings:
            reading_id = str(uuid.uuid4())
            self.conn.execute(
                "INSERT INTO utility_reading_raw (reading_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (reading_id, audit_id, reading.model_dump_json(), created_at),
            )
        self.conn.commit()

    def save_normalized_readings(self, audit_id: str, readings: list[NormalizedUtilityReading]) -> None:
        self.conn.execute("DELETE FROM utility_reading_normalized WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for reading in readings:
            reading_id = str(uuid.uuid4())
            self.conn.execute(
                "INSERT INTO utility_reading_normalized (reading_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (reading_id, audit_id, reading.model_dump_json(), created_at),
            )
        self.conn.commit()

    def list_normalized_readings(self, audit_id: str) -> list[NormalizedUtilityReading]:
        rows = self.conn.execute(
            "SELECT payload_json FROM utility_reading_normalized WHERE audit_id = ? ORDER BY created_at ASC",
            (audit_id,),
        ).fetchall()
        return [NormalizedUtilityReading.model_validate_json(row["payload_json"]) for row in rows]

    def save_weather(self, audit_id: str, features: list[WeatherMonthFeature]) -> None:
        self.conn.execute("DELETE FROM weather_monthly_features WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for feature in features:
            weather_id = str(uuid.uuid4())
            self.conn.execute(
                "INSERT INTO weather_monthly_features (weather_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (weather_id, audit_id, feature.model_dump_json(), created_at),
            )
        self.conn.commit()

    def list_weather(self, audit_id: str) -> list[WeatherMonthFeature]:
        rows = self.conn.execute(
            "SELECT payload_json FROM weather_monthly_features WHERE audit_id = ? ORDER BY created_at ASC",
            (audit_id,),
        ).fetchall()
        return [WeatherMonthFeature.model_validate_json(row["payload_json"]) for row in rows]

    def save_peer_assignment(self, audit_id: str, peer: PeerClusterAssignment) -> None:
        self.conn.execute("DELETE FROM peer_cluster_assignment WHERE audit_id = ?", (audit_id,))
        self.conn.execute(
            "INSERT INTO peer_cluster_assignment (audit_id, payload_json, created_at) VALUES (?, ?, ?)",
            (audit_id, peer.model_dump_json(), now_iso()),
        )
        self.conn.commit()

    def save_analysis(self, audit_id: str, analysis: AnalysisResults) -> None:
        self.conn.execute("DELETE FROM analytics_output WHERE audit_id = ?", (audit_id,))
        self.conn.execute(
            "INSERT INTO analytics_output (audit_id, payload_json, created_at) VALUES (?, ?, ?)",
            (audit_id, analysis.model_dump_json(), now_iso()),
        )
        self.conn.commit()

    def save_hypotheses(self, audit_id: str, hypotheses: list[DiagnosticHypothesis]) -> None:
        self.conn.execute("DELETE FROM diagnostic_hypothesis WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for hypothesis in hypotheses:
            self.conn.execute(
                "INSERT INTO diagnostic_hypothesis (hypothesis_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (hypothesis.hypothesis_id, audit_id, hypothesis.model_dump_json(), created_at),
            )
        self.conn.commit()

    def save_recommendations(self, audit_id: str, recommendations: list[ECMRecommendation]) -> None:
        self.conn.execute("DELETE FROM ecm_recommendation WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for recommendation in recommendations:
            self.conn.execute(
                "INSERT INTO ecm_recommendation (recommendation_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (recommendation.recommendation_id, audit_id, recommendation.model_dump_json(), created_at),
            )
        self.conn.commit()

    def save_financials(self, audit_id: str, projections: list[FinancialProjection]) -> None:
        self.conn.execute("DELETE FROM financial_projection WHERE audit_id = ?", (audit_id,))
        created_at = now_iso()
        for projection in projections:
            self.conn.execute(
                "INSERT INTO financial_projection (projection_id, audit_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), audit_id, projection.model_dump_json(), created_at),
            )
        self.conn.commit()

    def save_report(self, audit_id: str, report: AuditReportArtifact) -> None:
        self.conn.execute("DELETE FROM audit_report WHERE audit_id = ?", (audit_id,))
        self.conn.execute(
            "INSERT INTO audit_report (audit_id, payload_json, created_at) VALUES (?, ?, ?)",
            (audit_id, report.model_dump_json(), now_iso()),
        )
        self.conn.commit()

    def get_results(self, audit_id: str) -> AuditResultsResponse:
        audit = self.conn.execute("SELECT * FROM audit_run WHERE audit_id = ?", (audit_id,)).fetchone()
        if audit is None:
            raise KeyError(f"Unknown audit_id {audit_id}")

        def fetch_many(table: str, model: Any, order_by: str = "created_at ASC") -> list[Any]:
            rows = self.conn.execute(f"SELECT payload_json FROM {table} WHERE audit_id = ? ORDER BY {order_by}", (audit_id,)).fetchall()
            return [model.model_validate_json(row["payload_json"]) for row in rows]

        peer_row = self.conn.execute("SELECT payload_json FROM peer_cluster_assignment WHERE audit_id = ?", (audit_id,)).fetchone()
        analysis_row = self.conn.execute("SELECT payload_json FROM analytics_output WHERE audit_id = ?", (audit_id,)).fetchone()
        report_row = self.conn.execute("SELECT payload_json FROM audit_report WHERE audit_id = ?", (audit_id,)).fetchone()
        if not peer_row or not analysis_row or not report_row:
            raise KeyError(f"Results not ready for audit_id {audit_id}")

        return AuditResultsResponse(
            audit_id=audit_id,
            status=audit["status"],
            stage=audit["stage"],
            building=self.get_building(audit_id),
            readings=fetch_many("utility_reading_normalized", NormalizedUtilityReading),
            weather=fetch_many("weather_monthly_features", WeatherMonthFeature),
            anomalies=[
                ChangepointSignal.model_validate(signal)
                for signal in json.loads(audit["metadata_json"]).get("anomalies", [])
            ],
            peer=PeerClusterAssignment.model_validate_json(peer_row["payload_json"]),
            analysis=AnalysisResults.model_validate_json(analysis_row["payload_json"]),
            diagnostics=fetch_many("diagnostic_hypothesis", DiagnosticHypothesis),
            recommendations=fetch_many("ecm_recommendation", ECMRecommendation),
            financials=fetch_many("financial_projection", FinancialProjection),
            report=AuditReportArtifact.model_validate_json(report_row["payload_json"]),
            warnings=json.loads(audit["warnings_json"]),
            metadata=json.loads(audit["metadata_json"]),
        )
