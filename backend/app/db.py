from __future__ import annotations

import sqlite3
from pathlib import Path


def connect(database_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS building_profile (
          building_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_run (
          audit_id TEXT PRIMARY KEY,
          building_id TEXT NOT NULL,
          status TEXT NOT NULL,
          stage TEXT NOT NULL,
          progress INTEGER NOT NULL,
          warnings_json TEXT NOT NULL,
          error_text TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS uploaded_document (
          document_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS utility_reading_raw (
          reading_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS utility_reading_normalized (
          reading_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS weather_monthly_features (
          weather_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS peer_cluster_assignment (
          audit_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS analytics_output (
          audit_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS diagnostic_hypothesis (
          hypothesis_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ecm_recommendation (
          recommendation_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS financial_projection (
          projection_id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_report (
          audit_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
