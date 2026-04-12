from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any
from urllib import error, request
import zlib

from ..config import settings
from ..schemas import OCRDocumentResult, OCRReading, UploadedDocument
from .gemini_fixtures import load_response_text, save_recording
from .gemini_io import log_gemini_event


class OCRService:
    def __init__(self, gemini_api_key: str, model: str) -> None:
        self.gemini_api_key = gemini_api_key
        self.model = model

    def extract(self, document: UploadedDocument) -> OCRDocumentResult:
        deterministic = _extract_structured_pdf(document)
        if deterministic is not None:
            return deterministic
        if not settings.prod:
            try:
                return self._extract_with_gemini(document)
            except Exception as exc:
                fallback = self._fallback_extract(document)
                fallback.notes.append(f"Gemini fixture playback failed: {exc}")
                return fallback
        if self.gemini_api_key:
            try:
                return self._extract_with_gemini(document)
            except Exception as exc:
                fallback = self._fallback_extract(document)
                fallback.notes.append(f"Gemini OCR failed: {exc}")
                return fallback
        return self._fallback_extract(document)

    def _extract_with_gemini(self, document: UploadedDocument) -> OCRDocumentResult:
        operation = "ocr.extract"
        content: str
        if not settings.prod:
            content = load_response_text(operation)
            log_gemini_event(
                operation,
                "playback",
                model=self.model,
                document_id=document.document_id,
                filename=document.filename,
                response_text_chars=len(content),
            )
        else:
            b64 = base64.b64encode(Path(document.storage_path).read_bytes()).decode("utf-8")
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
                                    "data": b64,
                                }
                            },
                        ]
                    }
                ],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
            }
            log_gemini_event(
                operation,
                "request",
                model=self.model,
                document_id=document.document_id,
                filename=document.filename,
                mime_type=document.mime_type,
                inline_data_base64_chars=len(b64),
                generation_config=payload["generationConfig"],
                system_prompt_preview=payload["contents"][0]["parts"][0]["text"][:400],
            )
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
                body = exc.read().decode("utf-8", errors="replace")
                log_gemini_event(operation, "http_error", model=self.model, status=exc.code, body_preview=body[:1200])
                raise RuntimeError(body) from exc

            usage = parsed.get("usageMetadata")
            content = parsed["candidates"][0]["content"]["parts"][0]["text"]
            log_gemini_event(
                operation,
                "response_raw",
                model=self.model,
                document_id=document.document_id,
                usage_metadata=usage,
                response_text_preview=content[:1500],
                response_text_chars=len(content),
            )
            save_recording(
                operation,
                model=self.model,
                request_summary={
                    "document_id": document.document_id,
                    "filename": document.filename,
                    "mime_type": document.mime_type,
                    "inline_data_base64_chars": len(b64),
                    "generation_config": payload["generationConfig"],
                    "system_prompt": payload["contents"][0]["parts"][0]["text"],
                },
                response_text=content,
            )
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
        log_gemini_event(
            "ocr.extract",
            "response_parsed",
            model=self.model,
            document_id=document.document_id,
            readings_count=len(readings),
            document_confidence=result.get("document_confidence"),
            notes=result.get("notes"),
        )
        return OCRDocumentResult(
            document_id=document.document_id,
            filename=document.filename,
            overall_confidence=float(result.get("document_confidence", 0.75)),
            readings=readings,
            notes=result.get("notes", []),
            provider="gemini",
        )

    def _fallback_extract(self, document: UploadedDocument) -> OCRDocumentResult:
        notes = []
        if _is_image_document(document):
            notes.append("Image OCR requires GEMINI_API_KEY. No structured readings were extracted.")
        else:
            notes.append("No structured bill parser matched this document, and AI OCR was unavailable.")
        return OCRDocumentResult(
            document_id=document.document_id,
            filename=document.filename,
            overall_confidence=0.0,
            readings=[],
            notes=notes,
            provider="fallback",
        )


def _is_image_document(document: UploadedDocument) -> bool:
    mime_type = (document.mime_type or "").lower()
    filename = document.filename.lower()
    return mime_type.startswith("image/") or filename.endswith((".png", ".jpg", ".jpeg", ".webp"))


def _extract_structured_pdf(document: UploadedDocument) -> OCRDocumentResult | None:
    if document.mime_type != "application/pdf" and not document.filename.lower().endswith(".pdf"):
        return None

    pdf_bytes = Path(document.storage_path).read_bytes()
    strings = _extract_pdf_strings(pdf_bytes)
    if not strings:
        return None

    fields = _extract_label_value_pairs(strings)
    reading, notes = _build_structured_pdf_reading(document, strings, fields)
    if reading is None:
        return None

    return OCRDocumentResult(
        document_id=document.document_id,
        filename=document.filename,
        overall_confidence=0.99,
        readings=[reading],
        notes=notes,
        provider="structured_pdf_text",
    )


def _build_structured_pdf_reading(
    document: UploadedDocument,
    strings: list[str],
    fields: dict[str, str],
) -> tuple[OCRReading | None, list[str]]:
    legacy_period = fields.get("Billing Period:")
    legacy_kwh = fields.get("Electric Usage (kWh)")
    if legacy_period and legacy_kwh:
        month = _parse_billing_month(legacy_period)
        if month is None:
            return None, []

        peak_kw = _parse_number(fields.get("Peak Demand (kW)"))
        total_due = _parse_number(fields.get("Total Amount Due ($)")) or 0.0
        supply = _parse_number(fields.get("Supply Charges ($)"))
        delivery = _parse_number(fields.get("Delivery Charges ($)"))
        cost = total_due if total_due > 0 else (supply or 0.0) + (delivery or 0.0)

        reading = OCRReading(
            month=month,
            kwh=_parse_number(legacy_kwh) or 0.0,
            therms=0.0,
            peak_kw=peak_kw,
            cost=cost,
            confidence=0.99,
            source_document_id=document.document_id,
            source_pages=[1],
            extraction_notes=["Structured PDF text parser extracted ComEd demo bill fields."],
        )

        notes = [
            "Parsed embedded PDF text directly; OCR was not required.",
        ]
        if "Service Address:" in fields:
            notes.append(f"Service address label: {fields['Service Address:']}")
        if "Address:" in fields:
            notes.append(f"Parsed address: {fields['Address:']}")
        return reading, notes

    nw_period = fields.get("Billing Period")
    nw_kwh = fields.get("Usage (kWh)")
    nw_therms = fields.get("Gas Usage (Therms)")
    if nw_period and nw_kwh and nw_therms:
        month = _parse_billing_month(nw_period)
        if month is None:
            return None, []

        electric_total = _parse_number(fields.get("Electric Total ($)")) or 0.0
        gas_total = _parse_number(fields.get("Gas Total ($)")) or 0.0
        total_utility = _parse_inline_currency(strings, "Total Utility Charges This Period:")
        cost = total_utility if total_utility is not None else electric_total + gas_total

        reading = OCRReading(
            month=month,
            kwh=_parse_number(nw_kwh) or 0.0,
            therms=_parse_number(nw_therms) or 0.0,
            peak_kw=_parse_number(fields.get("Peak Demand (kW)")),
            cost=cost,
            confidence=0.99,
            source_document_id=document.document_id,
            source_pages=[1],
            extraction_notes=["Structured PDF text parser extracted Northwestern dual-fuel utility statement fields."],
        )

        notes = [
            "Parsed embedded PDF text directly; OCR was not required.",
        ]
        if len(strings) > 1:
            notes.append(f"Parsed address: {strings[1]}")
        return reading, notes

    demo_month = fields.get("Billing Month")
    if demo_month and nw_kwh and nw_therms:
        month = _parse_month_name(demo_month, _infer_demo_year(document.filename))
        if month is None:
            return None, []

        total_charges = _parse_inline_currency(strings, "Total Charges:")
        electric_total = _parse_number(fields.get("Electric Total ($)")) or 0.0
        gas_total = _parse_number(fields.get("Gas Total ($)")) or 0.0
        cost = total_charges if total_charges is not None else electric_total + gas_total

        reading = OCRReading(
            month=month,
            kwh=_parse_number(nw_kwh) or 0.0,
            therms=_parse_number(nw_therms) or 0.0,
            peak_kw=_parse_number(fields.get("Peak Demand (kW)")),
            cost=cost,
            confidence=0.99,
            source_document_id=document.document_id,
            source_pages=[1],
            extraction_notes=["Structured PDF text parser extracted simplified Northwestern demo utility statement fields."],
        )

        notes = [
            "Parsed embedded PDF text directly; OCR was not required.",
            "Detected simplified demo utility statement format.",
        ]
        if len(strings) > 1:
            notes.append(f"Parsed address: {strings[1]}")
        return reading, notes

    return None, []


def _extract_label_value_pairs(strings: list[str]) -> dict[str, str]:
    labels = {
        "Customer Name:",
        "Service Address:",
        "Address:",
        "Billing Period:",
        "Billing Period",
        "Billing Month",
        "Meter Number:",
        "Electric Usage (kWh)",
        "Usage (kWh)",
        "Peak Demand (kW)",
        "Supply Charges ($)",
        "Delivery Charges ($)",
        "Total Amount Due ($)",
        "Electric Total ($)",
        "Gas Usage (Therms)",
        "Gas Total ($)",
    }
    pairs: dict[str, str] = {}
    for index, value in enumerate(strings[:-1]):
        if value in labels:
            pairs[value] = strings[index + 1].strip()
    return pairs


def _parse_billing_month(period_text: str) -> str | None:
    matches = re.findall(r"(\d{2}/\d{2}/\d{4})", period_text)
    if not matches:
        return None
    end_date = matches[-1]
    month, _day, year = end_date.split("/")
    return f"{year}-{month}"


def _parse_month_name(month_text: str, default_year: int) -> str | None:
    normalized = month_text.strip().lower()
    month_map = {
        "january": "01",
        "february": "02",
        "march": "03",
        "april": "04",
        "may": "05",
        "june": "06",
        "july": "07",
        "august": "08",
        "september": "09",
        "october": "10",
        "november": "11",
        "december": "12",
    }
    month = month_map.get(normalized)
    if month is None:
        return None
    return f"{default_year}-{month}"


def _infer_demo_year(filename: str) -> int:
    match = re.search(r"(20\d{2})", filename)
    if match:
        return int(match.group(1))
    return 2025


def _parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = value.replace(",", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_inline_currency(strings: list[str], prefix: str) -> float | None:
    for value in strings:
        if value.startswith(prefix):
            match = re.search(r"\$([\d,]+(?:\.\d+)?)", value)
            if match:
                return _parse_number(match.group(1))
    return None


def _extract_pdf_strings(pdf_bytes: bytes) -> list[str]:
    strings: list[str] = []
    for match in re.finditer(br"stream\r?\n(.*?)endstream", pdf_bytes, re.S):
        raw_stream = match.group(1).strip()
        try:
            decoded = base64.a85decode(raw_stream, adobe=True)
            content = zlib.decompress(decoded).decode("latin1", "replace")
        except Exception:
            continue
        strings.extend(_parse_pdf_literal_strings(content))
    return [value.strip() for value in strings if value.strip()]


def _parse_pdf_literal_strings(content: str) -> list[str]:
    parsed: list[str] = []
    current: list[str] = []
    in_string = False
    depth = 0
    index = 0

    while index < len(content):
        char = content[index]
        if not in_string:
            if char == "(":
                in_string = True
                depth = 1
                current = []
            index += 1
            continue

        if char == "\\":
            index += 1
            if index >= len(content):
                break
            escaped = content[index]
            if escaped in "\\()":
                current.append(escaped)
            elif escaped.isdigit():
                octal = escaped
                for _ in range(2):
                    if index + 1 < len(content) and content[index + 1].isdigit():
                        index += 1
                        octal += content[index]
                    else:
                        break
                current.append(chr(int(octal, 8)))
            else:
                current.append(escaped)
            index += 1
            continue

        if char == "(":
            depth += 1
            current.append(char)
            index += 1
            continue

        if char == ")":
            depth -= 1
            if depth == 0:
                parsed.append("".join(current))
                in_string = False
            else:
                current.append(char)
            index += 1
            continue

        current.append(char)
        index += 1

    return parsed
