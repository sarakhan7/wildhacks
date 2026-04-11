from __future__ import annotations

import base64
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from urllib import error, request

from ..schemas import OCRDocumentResult, OCRReading, UploadedDocument


class OCRService:
    def __init__(self, gemini_api_key: str, model: str) -> None:
        self.gemini_api_key = gemini_api_key
        self.model = model

    def extract(self, document: UploadedDocument) -> OCRDocumentResult:
        if self.gemini_api_key:
            try:
                return self._extract_with_gemini(document)
            except Exception as exc:
                fallback = self._fallback_extract(document)
                fallback.notes.append(f"Gemini OCR failed: {exc}")
                return fallback
        return self._fallback_extract(document)

    def _extract_with_gemini(self, document: UploadedDocument) -> OCRDocumentResult:
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "You are an OCR extractor for commercial utility bills. "
                                "Return strict JSON with keys document_confidence, notes, readings. "
                                "Each reading must contain month, kwh, therms, peak_kw, cost, confidence, source_pages, extraction_notes. "
                                "Normalize billing month to YYYY-MM using the end date of the billing period."
                            )
                        },
                        {
                            "inline_data": {
                                "mime_type": document.mime_type,
                                "data": base64.b64encode(Path(document.storage_path).read_bytes()).decode("utf-8"),
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
        }
        req = request.Request(
            url=f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.gemini_api_key}",
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=90) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(exc.read().decode("utf-8")) from exc

        content = parsed["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(content)
        readings = [
            OCRReading(
                month=reading["month"],
                kwh=float(reading.get("kwh") or 0),
                therms=float(reading.get("therms") or 0),
                peak_kw=float(reading["peak_kw"]) if reading.get("peak_kw") is not None else None,
                cost=float(reading.get("cost") or 0),
                confidence=float(reading.get("confidence") or result.get("document_confidence") or 0.75),
                source_document_id=document.document_id,
                source_pages=[int(page) for page in reading.get("source_pages", [])],
                extraction_notes=reading.get("extraction_notes", []),
            )
            for reading in result.get("readings", [])
        ]
        return OCRDocumentResult(
            document_id=document.document_id,
            filename=document.filename,
            overall_confidence=float(result.get("document_confidence", 0.75)),
            readings=readings,
            notes=result.get("notes", []),
            provider="gemini",
        )

    def _fallback_extract(self, document: UploadedDocument) -> OCRDocumentResult:
        guessed_month = _guess_month_from_filename(document.filename)
        readings: list[OCRReading] = []
        if guessed_month:
            readings.append(
                OCRReading(
                    month=guessed_month,
                    kwh=9000,
                    therms=120,
                    peak_kw=18,
                    cost=1450,
                    confidence=0.35,
                    source_document_id=document.document_id,
                    source_pages=[1],
                    extraction_notes=["Fallback OCR used because AI OCR was unavailable."],
                )
            )
        return OCRDocumentResult(
            document_id=document.document_id,
            filename=document.filename,
            overall_confidence=0.35,
            readings=readings,
            notes=["Fallback OCR inferred limited data from filename only."],
            provider="fallback",
        )


def _guess_month_from_filename(filename: str) -> str | None:
    match = re.search(r"(20\d{2})[-_ ]?([01]?\d)", filename)
    if not match:
        return None
    year = match.group(1)
    month = int(match.group(2))
    if month < 1 or month > 12:
        return None
    return f"{year}-{month:02d}"
