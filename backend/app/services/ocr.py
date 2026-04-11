from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any
from urllib import error, request
import zlib

from ..schemas import OCRDocumentResult, OCRReading, UploadedDocument


class OCRService:
    def __init__(self, gemini_api_key: str, model: str) -> None:
        self.gemini_api_key = gemini_api_key
        self.model = model

    def extract(self, document: UploadedDocument) -> OCRDocumentResult:
        deterministic = _extract_structured_pdf(document)
        if deterministic is not None:
            return deterministic
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
    if "Billing Period:" not in fields or "Electric Usage (kWh)" not in fields or "Total Amount Due ($)" not in fields:
        return None

    month = _parse_billing_month(fields["Billing Period:"])
    if month is None:
        return None

    peak_kw = _parse_number(fields.get("Peak Demand (kW)"))
    total_due = _parse_number(fields.get("Total Amount Due ($)")) or 0.0
    supply = _parse_number(fields.get("Supply Charges ($)"))
    delivery = _parse_number(fields.get("Delivery Charges ($)"))
    cost = total_due if total_due > 0 else (supply or 0.0) + (delivery or 0.0)

    reading = OCRReading(
        month=month,
        kwh=_parse_number(fields.get("Electric Usage (kWh)")) or 0.0,
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

    return OCRDocumentResult(
        document_id=document.document_id,
        filename=document.filename,
        overall_confidence=0.99,
        readings=[reading],
        notes=notes,
        provider="structured_pdf_text",
    )


def _extract_label_value_pairs(strings: list[str]) -> dict[str, str]:
    labels = {
        "Customer Name:",
        "Service Address:",
        "Address:",
        "Billing Period:",
        "Meter Number:",
        "Electric Usage (kWh)",
        "Peak Demand (kW)",
        "Supply Charges ($)",
        "Delivery Charges ($)",
        "Total Amount Due ($)",
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


def _parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = value.replace(",", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
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
